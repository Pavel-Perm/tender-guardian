import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("No authorization header");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const lovableApiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!lovableApiKey) throw new Error("LOVABLE_API_KEY not configured");

    const supabase = createClient(supabaseUrl, supabaseKey);
    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) throw new Error("Unauthorized");

    const { analysisId, documentName, companyData, tenderContext, bidAmountData } = await req.json();
    if (!analysisId || !documentName) throw new Error("analysisId and documentName required");

    const { data: analysis } = await userClient.from("analyses").select("*").eq("id", analysisId).single();
    if (!analysis) throw new Error("Analysis not found");

    // Fetch uploaded files for this analysis
    const { data: analysisFiles } = await supabase
      .from("analysis_files")
      .select("file_name, file_path, file_type")
      .eq("analysis_id", analysisId);

    // Download and extract text from uploaded files to find the template
    let templateText = "";
    const allFilesText: string[] = [];

    if (analysisFiles && analysisFiles.length > 0) {
      for (const file of analysisFiles) {
        try {
          const { data: fileData } = await supabase.storage
            .from("documents")
            .download(file.file_path);

          if (!fileData) continue;

          const arrayBuffer = await fileData.arrayBuffer();
          const bytes = new Uint8Array(arrayBuffer);
          let extractedText = "";

          const lowerName = file.file_name.toLowerCase();

          if (lowerName.endsWith(".docx")) {
            extractedText = await extractDocxText(bytes);
          } else if (lowerName.endsWith(".txt") || lowerName.endsWith(".csv")) {
            extractedText = new TextDecoder("utf-8").decode(bytes);
          } else if (lowerName.endsWith(".pdf")) {
            // For PDFs, use Gemini vision to extract text
            const base64 = arrayBufferToBase64(arrayBuffer);
            extractedText = await extractFileWithVision(base64, "application/pdf", lovableApiKey);
          }

          if (extractedText && extractedText.trim().length > 20) {
            allFilesText.push(`=== ФАЙЛ: ${file.file_name} ===\n${extractedText}`);

            // Check if this file contains the template for the requested document
            const normalizedDocName = documentName.toLowerCase().replace(/[^а-яa-z0-9\s]/g, "").trim();
            const normalizedFileName = file.file_name.toLowerCase().replace(/[^а-яa-z0-9\s]/g, "").trim();
            const normalizedText = extractedText.toLowerCase();

            if (
              normalizedFileName.includes(normalizedDocName.slice(0, 20)) ||
              normalizedText.includes(normalizedDocName) ||
              fuzzyMatch(normalizedDocName, normalizedFileName) ||
              fuzzyMatch(normalizedDocName, normalizedText.slice(0, 2000))
            ) {
              templateText += extractedText + "\n\n";
            }
          }
        } catch (e) {
          console.error(`Error extracting text from ${file.file_name}:`, e);
        }
      }
    }

    // If no specific template found, search all files for the document name
    if (!templateText) {
      const docNameWords = documentName.toLowerCase().split(/\s+/).filter((w: string) => w.length > 3);
      for (const fileText of allFilesText) {
        const lowerText = fileText.toLowerCase();
        const matchCount = docNameWords.filter((w: string) => lowerText.includes(w)).length;
        if (matchCount >= Math.ceil(docNameWords.length * 0.5)) {
          templateText += fileText + "\n\n";
        }
      }
    }

    // If still nothing, use all file texts as context
    const filesContext = templateText || allFilesText.join("\n\n");

    const participantTypeLabel = companyData?.participantType === "ip" ? "Индивидуальный предприниматель" :
      companyData?.participantType === "self_employed" ? "Самозанятый" : "Юридическое лицо";

    let bidAmountContext = "";
    if (bidAmountData) {
      bidAmountContext = `
ДАННЫЕ О СУММЕ ЗАЯВКИ:
- Сумма: ${bidAmountData.amount || "Не указано"}
- Сумма прописью: ${bidAmountData.amount_words || "Не указано"}
- Ставка НДС: ${bidAmountData.vat_rate || "Не указано"}
- Сумма НДС: ${bidAmountData.vat_amount || "Не указано"}
- Сумма НДС прописью: ${bidAmountData.vat_amount_words || "Не указано"}
- Итого с НДС: ${bidAmountData.total_with_vat || "Не указано"}
- Итого прописью: ${bidAmountData.total_words || "Не указано"}`;
    }

    const hasTemplate = templateText.length > 50;

    const prompt = hasTemplate
      ? `Ты — эксперт по подготовке тендерной документации. Тебе дан ТОЧНЫЙ ШАБЛОН документа "${documentName}" из загруженной тендерной документации. 

КРИТИЧЕСКИ ВАЖНО:
1. Ты ОБЯЗАН сохранить ТОЧНУЮ структуру, формулировки и порядок секций из шаблона
2. НЕ добавляй ничего от себя — используй ТОЛЬКО текст из шаблона
3. НЕ удаляй и не пропускай ни одной секции, таблицы, пункта из шаблона
4. Заполни ВСЕ пустые поля (помеченные как [___], «указывается», «выбирается необходимое», пустые ячейки таблиц) данными участника
5. Если для поля нет данных в реквизитах участника — оставь плейсхолдер [___]
6. Сохрани ВСЕ таблицы из шаблона, заполнив их данными участника. Таблицы представляй в текстовом формате с разделителями | (вертикальная черта), каждая строка таблицы на отдельной строке.
7. Сохрани нумерацию, маркировку списков, заголовки секций ТОЧНО как в шаблоне
8. «Выбирается необходимое» — выбери подходящий вариант на основе данных участника

ШАБЛОН ДОКУМЕНТА (воспроизведи его ТОЧНО, только заполнив пустые поля):
${templateText.slice(0, 80000)}

ДАННЫЕ УЧАСТНИКА ДЛЯ ЗАПОЛНЕНИЯ:
- Тип: ${participantTypeLabel}
- Полное наименование: ${companyData?.full_name || "[___]"}
- Сокращённое наименование: ${companyData?.short_name || "[___]"}
- ИНН: ${companyData?.inn || "[___]"}
- КПП: ${companyData?.kpp || "-"}
- ОГРН/ОГРНИП: ${companyData?.ogrn || "[___]"}
- ОКПО: ${companyData?.okpo || "[___]"}
- ОКАТО: ${companyData?.okato || "[___]"}
- ОКТМО: ${companyData?.oktmo || "[___]"}
- ОКВЭД: ${companyData?.okved || "[___]"}
- Юр. адрес: ${companyData?.legal_address || "[___]"}
- Факт. адрес: ${companyData?.actual_address || "[___]"}
- Руководитель: ${companyData?.director_name || "[___]"}, ${companyData?.director_position || "[___]"}
- Телефон: ${companyData?.phone || "[___]"}
- Email: ${companyData?.email || "[___]"}
- Банк: ${companyData?.bank_name || "[___]"}
- БИК: ${companyData?.bank_bik || "[___]"}
- Р/с: ${companyData?.bank_account || "[___]"}
- К/с: ${companyData?.bank_corr_account || "[___]"}
- ИНН банка: ${companyData?.bank_inn || "[___]"}
- КПП банка: ${companyData?.bank_kpp || "[___]"}
- НДС: ${companyData?.vat_rate || "[___]"}
- Система налогообложения: ${companyData?.tax_system || "[___]"}
${bidAmountContext}

ДАННЫЕ ТЕНДЕРА:
- Название: ${analysis.title}
- Тип закупки: ${analysis.procurement_type === "44-fz" ? "44-ФЗ" : analysis.procurement_type === "223-fz" ? "223-ФЗ" : "Коммерческая"}
${tenderContext ? `\nКОНТЕКСТ ТЕНДЕРА:\n${tenderContext.slice(0, 10000)}` : ""}

Ответь ТОЛЬКО содержимым документа в формате JSON:
{
  "title": "Точное название документа как в шаблоне",
  "sections": [
    {
      "heading": "Заголовок секции точно как в шаблоне (если есть)",
      "content": "Полный текст секции с заполненными полями. Используй \\n для переносов."
    }
  ],
  "signature_block": "Блок подписи точно как в шаблоне, с заполненными данными"
}
Без markdown, без пояснений вне JSON.`
      : `Ты — эксперт по подготовке тендерной документации в РФ. Сгенерируй заполненный документ "${documentName}" для подачи заявки на участие в закупке.

ДАННЫЕ УЧАСТНИКА:
- Тип: ${participantTypeLabel}
- Полное наименование: ${companyData?.full_name || "Не указано"}
- Сокращённое наименование: ${companyData?.short_name || "Не указано"}
- ИНН: ${companyData?.inn || "Не указано"}
- КПП: ${companyData?.kpp || "-"}
- ОГРН/ОГРНИП: ${companyData?.ogrn || "Не указано"}
- ОКПО: ${companyData?.okpo || "Не указано"}
- ОКАТО: ${companyData?.okato || "Не указано"}
- ОКТМО: ${companyData?.oktmo || "Не указано"}
- ОКВЭД: ${companyData?.okved || "Не указано"}
- Юридический адрес: ${companyData?.legal_address || "Не указано"}
- Фактический адрес: ${companyData?.actual_address || "Не указано"}
- Руководитель: ${companyData?.director_name || "Не указано"}, ${companyData?.director_position || "Не указано"}
- Телефон: ${companyData?.phone || "Не указано"}
- Email: ${companyData?.email || "Не указано"}
- Банк: ${companyData?.bank_name || "Не указано"}
- БИК: ${companyData?.bank_bik || "Не указано"}
- Р/с: ${companyData?.bank_account || "Не указано"}
- К/с: ${companyData?.bank_corr_account || "Не указано"}
- ИНН банка: ${companyData?.bank_inn || "Не указано"}
- КПП банка: ${companyData?.bank_kpp || "Не указано"}
- НДС: ${companyData?.vat_rate || "Не указано"}
- Система налогообложения: ${companyData?.tax_system || "Не указано"}
${bidAmountContext}

КОНТЕКСТ ИЗ ЗАГРУЖЕННЫХ ФАЙЛОВ ТЕНДЕРА:
${filesContext.slice(0, 50000)}

ДАННЫЕ ТЕНДЕРА:
- Название: ${analysis.title}
- Тип закупки: ${analysis.procurement_type === "44-fz" ? "44-ФЗ" : analysis.procurement_type === "223-fz" ? "223-ФЗ" : "Коммерческая"}
${tenderContext ? `\n${tenderContext.slice(0, 10000)}` : ""}

ТРЕБОВАНИЯ:
1. Сгенерируй полный текст документа, максимально приближённый к стандартным формам тендерной документации
2. Используй контекст из загруженных файлов для точного воспроизведения структуры
3. Подставь все известные реквизиты участника в соответствующие поля
4. Где данные не указаны — поставь "[___]" как плейсхолдер
5. Сохрани все таблицы если они есть в контексте файлов. Таблицы представляй с разделителями |
6. НЕ добавляй лишнего от себя
7. Добавь место для подписи и печати в конце документа

Ответь ТОЛЬКО содержимым документа в формате JSON:
{
  "title": "Точное название документа",
  "sections": [
    {
      "heading": "Заголовок секции (если есть, иначе пустая строка)",
      "content": "Текст секции. Используй \\n для переносов строк."
    }
  ],
  "signature_block": "Блок подписи (должность, ФИО, место для подписи и печати)"
}

Без markdown, без пояснений вне JSON.`;

    // Use a stronger model for better template reproduction
    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${lovableApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: "Ты генерируешь тендерные документы. Твоя задача — ТОЧНО воспроизвести структуру шаблона и заполнить все пустые поля данными участника. Отвечай ТОЛЬКО валидным JSON. НЕ добавляй ничего от себя, чего нет в шаблоне. Таблицы форматируй с разделителями | (вертикальная черта)." },
          { role: "user", content: prompt },
        ],
      }),
    });

    if (!aiResponse.ok) {
      if (aiResponse.status === 429) {
        return new Response(JSON.stringify({ error: "Превышен лимит запросов. Попробуйте позже." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (aiResponse.status === 402) {
        return new Response(JSON.stringify({ error: "Необходимо пополнить баланс AI." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw new Error("AI error: " + aiResponse.status);
    }

    const aiData = await aiResponse.json();
    let content = aiData.choices?.[0]?.message?.content || "";
    
    content = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    
    let document;
    try {
      document = JSON.parse(content);
    } catch {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        document = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error("Failed to parse AI response as JSON");
      }
    }

    return new Response(JSON.stringify({ document, hasTemplate }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("generate-bid-documents error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

// Helper: Extract text from DOCX (handles both stored and deflate-compressed entries)
async function extractDocxText(bytes: Uint8Array): Promise<string> {
  try {
    const files = await parseZip(bytes);
    const docXml = files["word/document.xml"];
    if (!docXml) return "";
    
    const xmlText = new TextDecoder("utf-8").decode(docXml);
    const texts: string[] = [];
    let current = "";
    let inTag = false;
    
    for (let i = 0; i < xmlText.length; i++) {
      const ch = xmlText[i];
      if (ch === "<") {
        if (current) texts.push(current);
        current = "";
        inTag = true;
        const nextChars = xmlText.slice(i, i + 20);
        if (nextChars.match(/^<w:p[\s>\/]/) || nextChars.match(/^<w:br/)) {
          texts.push("\n");
        }
        if (nextChars.match(/^<w:tab/)) {
          texts.push("\t");
        }
      } else if (ch === ">") {
        inTag = false;
      } else if (!inTag) {
        current += ch;
      }
    }
    if (current) texts.push(current);
    
    return texts.join("").replace(/\n{3,}/g, "\n\n").trim();
  } catch (e) {
    console.error("DOCX extraction error:", e);
    return "";
  }
}

// Async ZIP parser that handles both stored and deflate-compressed entries
async function parseZip(data: Uint8Array): Promise<Record<string, Uint8Array>> {
  const files: Record<string, Uint8Array> = {};
  let offset = 0;

  while (offset < data.length - 4) {
    const sig = data[offset] | (data[offset + 1] << 8) | (data[offset + 2] << 16) | (data[offset + 3] << 24);
    if (sig !== 0x04034b50) break;

    const compressionMethod = data[offset + 8] | (data[offset + 9] << 8);
    const compressedSize = data[offset + 18] | (data[offset + 19] << 8) | (data[offset + 20] << 16) | (data[offset + 21] << 24);
    const uncompressedSize = data[offset + 22] | (data[offset + 23] << 8) | (data[offset + 24] << 16) | (data[offset + 25] << 24);
    const nameLen = data[offset + 26] | (data[offset + 27] << 8);
    const extraLen = data[offset + 28] | (data[offset + 29] << 8);

    const nameBytes = data.slice(offset + 30, offset + 30 + nameLen);
    const fileName = new TextDecoder("utf-8").decode(nameBytes);

    const dataStart = offset + 30 + nameLen + extraLen;
    const size = compressedSize || uncompressedSize;

    if (compressionMethod === 0 && size > 0) {
      files[fileName] = data.slice(dataStart, dataStart + size);
    } else if (compressionMethod === 8 && size > 0) {
      // Deflate - try to decompress but don't fail on corrupt streams
      try {
        const compressed = data.slice(dataStart, dataStart + size);
        const ds = new DecompressionStream("deflate");
        const writer = ds.writable.getWriter();
        const reader = ds.readable.getReader();
        
        let completed = false;
        try {
          await writer.write(compressed);
          await writer.close();
          
          const chunks: Uint8Array[] = [];
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
          }
          
          if (chunks.length > 0) {
            const totalLen = chunks.reduce((s, c) => s + c.length, 0);
            const result = new Uint8Array(totalLen);
            let pos = 0;
            for (const chunk of chunks) {
              result.set(chunk, pos);
              pos += chunk.length;
            }
            files[fileName] = result;
            completed = true;
          }
        } catch (decompressErr) {
          // Silently skip corrupt deflate streams
        }
      } catch (e) {
        // Silently skip decompression errors
      }
    }

    offset = dataStart + (size || 0);
  }

  return files;
}

// Fuzzy match helper
function fuzzyMatch(needle: string, haystack: string): boolean {
  const needleWords = needle.split(/\s+/).filter(w => w.length > 3);
  if (needleWords.length === 0) return false;
  const matchCount = needleWords.filter(w => haystack.includes(w)).length;
  return matchCount >= Math.ceil(needleWords.length * 0.4);
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// Extract file content using Gemini with inline_data (supports PDF, DOCX, etc.)
async function extractFileWithVision(base64Data: string, mimeType: string, apiKey: string): Promise<string> {
  try {
    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash-lite",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Извлеки ВЕСЬ текст из этого документа. Сохрани структуру: заголовки, таблицы (форматируй с разделителями |), нумерованные списки, все поля форм. Верни ТОЛЬКО извлечённый текст без комментариев.",
              },
              {
                type: "image_url",
                image_url: {
                  url: `data:${mimeType};base64,${base64Data.slice(0, 20000000)}`,
                },
              },
            ],
          },
        ],
      }),
    });

    const responseText = await response.text();
    if (!response.ok) {
      console.error(`Vision extraction failed with status ${response.status}: ${responseText.slice(0, 200)}`);
      return "";
    }
    const data = JSON.parse(responseText);
    return data.choices?.[0]?.message?.content || "";
  } catch (e) {
    console.error("Vision extraction error:", e);
    return "";
  }
}
