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

    // Verify user
    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) throw new Error("Unauthorized");

    const { filePath, analysisId } = await req.json();
    if (!filePath) throw new Error("filePath is required");

    // Download the file
    const { data: fileData, error: downloadError } = await supabase.storage
      .from("documents")
      .download(filePath);
    if (downloadError || !fileData) throw new Error("Failed to download file");

    const text = await fileData.text();

    // Also try to get tender docs text for context (from analysis files if analysisId provided)
    let tenderContext = "";
    if (analysisId) {
      const { data: files } = await supabase
        .from("analysis_files")
        .select("file_path, file_name")
        .eq("analysis_id", analysisId);

      if (files && files.length > 0) {
        // Look for appendices / questionnaire files
        for (const f of files) {
          const nameLower = f.file_name.toLowerCase();
          if (nameLower.includes("анкет") || nameLower.includes("приложен") || nameLower.includes("форм")) {
            try {
              const { data: fData } = await supabase.storage.from("documents").download(f.file_path);
              if (fData) {
                const fText = await fData.text();
                tenderContext += `\n=== ${f.file_name} ===\n${fText.substring(0, 30000)}`;
              }
            } catch {}
          }
        }
      }
    }

    const systemPrompt = `Ты — эксперт по извлечению реквизитов организаций из документов.

Из предоставленного документа (карточка организации / анкета участника / учредительный документ) извлеки все возможные реквизиты.

${tenderContext ? "Также используй тендерную документацию для извлечения полей анкеты участника, если они там указаны." : ""}

Верни ТОЛЬКО валидный JSON-объект с полями:
{
  "inn": "ИНН",
  "kpp": "КПП",
  "ogrn": "ОГРН/ОГРНИП",
  "full_name": "Полное наименование организации",
  "short_name": "Сокращённое наименование",
  "legal_address": "Юридический адрес",
  "actual_address": "Фактический адрес",
  "director_name": "ФИО руководителя",
  "director_position": "Должность руководителя",
  "phone": "Телефон",
  "email": "Email",
  "bank_name": "Наименование банка",
  "bank_bik": "БИК",
  "bank_account": "Расчётный счёт",
  "bank_corr_account": "Корреспондентский счёт",
  "okved": "Основной ОКВЭД"
}

Если значение не найдено — оставь пустую строку "".
Без markdown, без пояснений вне JSON.`;

    const aiInput = `Документ карточки организации:\n${text.substring(0, 50000)}${tenderContext ? `\n\nТендерная документация (для контекста):\n${tenderContext.substring(0, 30000)}` : ""}`;

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
          { role: "user", content: aiInput },
        ],
      }),
    });

    if (!aiResponse.ok) {
      const errText = await aiResponse.text();
      console.error("AI gateway error:", aiResponse.status, errText);
      if (aiResponse.status === 429) {
        return new Response(JSON.stringify({ error: "Превышен лимит запросов к AI. Попробуйте позже." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (aiResponse.status === 402) {
        return new Response(JSON.stringify({ error: "Необходимо пополнить баланс AI. Перейдите в Settings → Workspace → Usage для пополнения." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ error: "Ошибка AI-сервиса" }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aiData = await aiResponse.json();
    let content = aiData.choices?.[0]?.message?.content || "";
    content = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();

    let company;
    try {
      company = JSON.parse(content);
    } catch {
      console.error("Failed to parse AI response:", content.substring(0, 500));
      throw new Error("Не удалось извлечь данные из документа");
    }

    return new Response(JSON.stringify({ company }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("parse-company-card error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
