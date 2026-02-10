import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const ANALYSIS_BLOCKS = [
  { name: "Предмет закупки", order: 1 },
  { name: "НМЦК (Начальная максимальная цена контракта)", order: 2 },
  { name: "Единицы измерения", order: 3 },
  { name: "Страна происхождения", order: 4 },
  { name: "Торговые марки", order: 5 },
  { name: "Срок исполнения", order: 6 },
  { name: "Требования к участникам", order: 7 },
  { name: "Финансовые требования", order: 8 },
  { name: "Обеспечение заявки", order: 9 },
  { name: "Обеспечение исполнения", order: 10 },
  { name: "Порядок приёмки", order: 11 },
  { name: "Ответственность сторон", order: 12 },
  { name: "Расторжение контракта", order: 13 },
  { name: "Форс-мажор", order: 14 },
  { name: "Конфиденциальность", order: 15 },
  { name: "Субподряд", order: 16 },
  { name: "Изменение условий контракта", order: 17 },
  { name: "Аудит и доступ", order: 18 },
  { name: "Разрешение споров", order: 19 },
  { name: "Приложения", order: 20 },
  { name: "Антидемпинговые меры", order: 21 },
  { name: "Электронная подпись", order: 22 },
  { name: "Соответствие КТРУ", order: 23 },
  { name: "Преференции СМП/СОНКО", order: 24 },
  { name: "Порядок оплаты", order: 25 },
  { name: "Гарантийные обязательства", order: 26 },
  { name: "Штрафы и пени", order: 27 },
  { name: "Права на результаты интеллектуальной деятельности", order: 28 },
  { name: "Требования к упаковке и маркировке", order: 29 },
  { name: "Условия поставки и логистика", order: 30 },
];

// Блоки, для которых приоритетным источником является Проект контракта (договора)
const CONTRACT_PRIORITY_BLOCKS = [
  "Ответственность сторон",
  "Расторжение контракта",
  "Форс-мажор",
  "Изменение условий контракта",
  "Разрешение споров",
  "Порядок оплаты",
  "Гарантийные обязательства",
  "Штрафы и пени",
  "Права на результаты интеллектуальной деятельности",
  "Конфиденциальность",
  "Субподряд",
];

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

    // Verify the user
    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) throw new Error("Unauthorized");

    const { analysisId } = await req.json();
    if (!analysisId) throw new Error("analysisId is required");

    // Verify ownership
    const { data: analysis, error: analysisError } = await userClient
      .from("analyses")
      .select("*")
      .eq("id", analysisId)
      .single();
    if (analysisError || !analysis) throw new Error("Analysis not found");

    // Get uploaded files
    const { data: files } = await supabase
      .from("analysis_files")
      .select("*")
      .eq("analysis_id", analysisId);

    if (!files || files.length === 0) throw new Error("No files found");

    // Download and extract text from each file separately
    const fileTexts: { name: string; text: string; isMain: boolean; isContract: boolean }[] = [];
    for (const file of files) {
      try {
        const { data: fileData } = await supabase.storage
          .from("documents")
          .download(file.file_path);

        if (fileData) {
          const text = await fileData.text();
          const nameLower = file.file_name.toLowerCase();
          const isMain = nameLower.includes("документация") || nameLower.includes("dokumentaciya") ||
            nameLower.includes("основн") || nameLower.includes("извещение") ||
            nameLower.includes("тз") || nameLower.includes("техническое задание");
          const isContract = nameLower.includes("контракт") || nameLower.includes("договор") ||
            nameLower.includes("проект контракта") || nameLower.includes("проект договора");
          fileTexts.push({ name: file.file_name, text: text.substring(0, 50000), isMain, isContract });
        }
      } catch (e) {
        fileTexts.push({ name: file.file_name, text: "(не удалось извлечь текст)", isMain: false, isContract: false });
      }
    }

    // If no file was detected as main, treat the first/largest as main
    if (!fileTexts.some(f => f.isMain) && fileTexts.length > 0) {
      fileTexts[0].isMain = true;
    }

    const hasContractFile = fileTexts.some(f => f.isContract);

    // Sort: main file first, then contract
    fileTexts.sort((a, b) => (b.isMain ? 2 : b.isContract ? 1 : 0) - (a.isMain ? 2 : a.isContract ? 1 : 0));

    // Update status to analyzing
    await supabase.from("analyses").update({ status: "analyzing" }).eq("id", analysisId);

    const procType = analysis.procurement_type === "44-fz" ? "44-ФЗ" :
                     analysis.procurement_type === "223-fz" ? "223-ФЗ" : "коммерческая закупка";

    const blocksListStr = ANALYSIS_BLOCKS.map(b => `${b.order}. ${b.name}`).join("\n");

    // Build file listing for AI with clear labels
    const filesListing = fileTexts.map(f => {
      let label = f.isMain ? " (ОСНОВНОЙ — ДОКУМЕНТАЦИЯ)" : f.isContract ? " (ПРОЕКТ КОНТРАКТА/ДОГОВОРА)" : "";
      return `\n\n=== ФАЙЛ${label}: ${f.name} ===\n${f.text}`;
    }).join("");

    const contractBlocksStr = CONTRACT_PRIORITY_BLOCKS.map(b => `"${b}"`).join(", ");

    const systemPrompt = `Ты — эксперт по проверке тендерной документации в России. Анализируй документацию по ${procType}.

ВАЖНО — ИНСТРУКЦИЯ ПО РАБОТЕ С НЕСКОЛЬКИМИ ФАЙЛАМИ:
1. Проанализируй КАЖДЫЙ файл по отдельности по всем блокам проверки.
2. Если один и тот же риск или тема встречается в нескольких файлах — ОБЪЕДИНИ их в один результат по данному блоку.
3. Основной файл (помечен как "ОСНОВНОЙ — ДОКУМЕНТАЦИЯ") имеет приоритет для большинства блоков.
4. ${hasContractFile ? `КРИТИЧЕСКИ ВАЖНО: Для следующих блоков ПРИОРИТЕТНЫМ источником является файл "ПРОЕКТ КОНТРАКТА/ДОГОВОРА": ${contractBlocksStr}. Именно из проекта контракта бери основную информацию по этим блокам. Если есть противоречия с другими файлами — приоритет у проекта контракта.` : "Если проект контракта отсутствует среди файлов, анализируй контрактные блоки по доступной документации и отметь в details, что проект контракта не был предоставлен."}
5. В поле "details" указывай, из какого файла взята информация (например: "Из проекта контракта: ..., Из документации: ...").
6. Итоговый результат — ОДИН набор из ${ANALYSIS_BLOCKS.length} блоков, без дублирования.

Проверь по следующим ${ANALYSIS_BLOCKS.length} блокам:
${blocksListStr}

Для КАЖДОГО блока верни JSON-объект:
- block_name: название блока (точно как в списке)
- block_order: номер блока
- status: "ok" | "warning" | "critical"
- risk_description: описание найденного риска или "Нарушений не обнаружено"
- recommendation: рекомендация по исправлению (если есть риск)
- details: подробное описание с указанием, из каких файлов получена информация

Отвечай ТОЛЬКО валидным JSON-массивом из ${ANALYSIS_BLOCKS.length} объектов. Без markdown, без пояснений вне JSON.`;

    // Call Lovable AI
    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${lovableApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `Проанализируй следующую тендерную документацию (${fileTexts.length} файлов):\n${filesListing.substring(0, 120000)}` },
        ],
      }),
    });

    if (!aiResponse.ok) {
      const errText = await aiResponse.text();
      console.error("AI error:", aiResponse.status, errText);
      if (aiResponse.status === 429) {
        await supabase.from("analyses").update({ status: "failed" }).eq("id", analysisId);
        throw new Error("Превышен лимит запросов, попробуйте позже");
      }
      if (aiResponse.status === 402) {
        await supabase.from("analyses").update({ status: "failed" }).eq("id", analysisId);
        throw new Error("Необходимо пополнить баланс AI");
      }
      throw new Error("AI gateway error");
    }

    const aiData = await aiResponse.json();
    let content = aiData.choices?.[0]?.message?.content || "";

    // Clean potential markdown wrapping
    content = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();

    let results;
    try {
      results = JSON.parse(content);
    } catch {
      console.error("Failed to parse AI response:", content.substring(0, 500));
      // Create fallback results
      results = ANALYSIS_BLOCKS.map(b => ({
        block_name: b.name,
        block_order: b.order,
        status: "warning",
        risk_description: "Не удалось проанализировать данный блок автоматически",
        recommendation: "Рекомендуется ручная проверка",
        details: null,
      }));
    }

    // Insert results
    const resultsToInsert = results.map((r: any) => ({
      analysis_id: analysisId,
      block_name: r.block_name,
      block_order: r.block_order || 0,
      status: ["ok", "warning", "critical"].includes(r.status) ? r.status : "warning",
      risk_description: r.risk_description || null,
      recommendation: r.recommendation || null,
      details: r.details || null,
    }));

    await supabase.from("analysis_results").insert(resultsToInsert);

    // Determine overall risk
    const hasC = results.some((r: any) => r.status === "critical");
    const hasW = results.some((r: any) => r.status === "warning");
    const overallRisk = hasC ? "critical" : hasW ? "warning" : "ok";

    await supabase.from("analyses").update({
      status: "completed",
      overall_risk: overallRisk,
    }).eq("id", analysisId);

    // --- Extract required participation documents ---
    try {
      const docsPrompt = `Ты — эксперт по тендерной документации в России (${procType}).

На основе ВСЕХ предоставленных файлов документации составь ИСЧЕРПЫВАЮЩИЙ список документов и форм, которые участник закупки должен подготовить и приложить в составе заявки.

КРИТИЧЕСКИ ВАЖНО — ищи во ВСЕХ файлах:
1. Все ФОРМЫ, указанные в документации (Форма заявки, Форма ценового предложения, Анкета участника, Форма согласия, Декларации и т.д.) — они часто находятся в приложениях к документации или в отдельных файлах.
2. Все ДОКУМЕНТЫ, которые необходимо предоставить (выписки, справки, копии, лицензии, допуски и т.д.).
3. Все ДЕКЛАРАЦИИ и СОГЛАСИЯ (декларация о соответствии требованиям, согласие на обработку персональных данных, декларация о принадлежности к СМП и т.д.).
4. Все документы, подтверждающие КВАЛИФИКАЦИЮ и ОПЫТ (реестр контрактов, отзывы, акты выполненных работ и т.д.).
5. Обеспечение заявки (если требуется — банковская гарантия или платёжное поручение).

Раздели на 3 категории:
1. "enterprise" — для юридических лиц (ООО, АО и т.д.)
2. "ip" — для индивидуальных предпринимателей
3. "self_employed" — для самозанятых (плательщиков НПД)

Для каждой категории перечисли ВСЕ документы и формы. Если документ — это форма из приложения, укажи: "Форма N: [название формы] (Приложение N)".

Отвечай ТОЛЬКО валидным JSON-объектом в формате:
{
  "enterprise": ["Документ/Форма 1", "Документ/Форма 2", ...],
  "ip": ["Документ/Форма 1", "Документ/Форма 2", ...],
  "self_employed": ["Документ/Форма 1", "Документ/Форма 2", ...]
}

Если для какой-то категории участники не допускаются — укажи пустой массив.
Без markdown, без пояснений вне JSON.`;

      const docsResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${lovableApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [
            { role: "system", content: docsPrompt },
            { role: "user", content: `Проанализируй ВСЕ файлы и найди ВСЕ формы, документы и приложения, необходимые для подачи заявки (${fileTexts.length} файлов):\n${filesListing.substring(0, 120000)}` },
          ],
        }),
      });

      if (docsResponse.ok) {
        const docsData = await docsResponse.json();
        let docsContent = docsData.choices?.[0]?.message?.content || "";
        docsContent = docsContent.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();

        try {
          const docsList = JSON.parse(docsContent);
          const categories = ["enterprise", "ip", "self_employed"];
          const docsToInsert = categories
            .filter(cat => Array.isArray(docsList[cat]))
            .map(cat => ({
              analysis_id: analysisId,
              category: cat,
              documents: docsList[cat],
            }));

          if (docsToInsert.length > 0) {
            await supabase.from("analysis_required_documents").insert(docsToInsert);
          }
        } catch (parseErr) {
          console.error("Failed to parse required docs:", parseErr);
        }
      }
    } catch (docsErr) {
      console.error("Required docs extraction error:", docsErr);
      // Non-critical — don't fail the whole analysis
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("analyze-tender error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
