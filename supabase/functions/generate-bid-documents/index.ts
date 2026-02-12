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

    const { analysisId, documentName, companyData, tenderContext } = await req.json();
    if (!analysisId || !documentName) throw new Error("analysisId and documentName required");

    // Verify ownership
    const { data: analysis } = await userClient.from("analyses").select("*").eq("id", analysisId).single();
    if (!analysis) throw new Error("Analysis not found");

    const participantTypeLabel = companyData?.participantType === "ip" ? "Индивидуальный предприниматель" :
      companyData?.participantType === "self_employed" ? "Самозанятый" : "Юридическое лицо";

    const prompt = `Ты — эксперт по подготовке тендерной документации в РФ. Сгенерируй заполненный документ "${documentName}" для подачи заявки на участие в закупке.

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

ДАННЫЕ ТЕНДЕРА:
- Название: ${analysis.title}
- Тип закупки: ${analysis.procurement_type === "44-fz" ? "44-ФЗ" : analysis.procurement_type === "223-fz" ? "223-ФЗ" : "Коммерческая"}
${tenderContext || ""}

ТРЕБОВАНИЯ:
1. Сгенерируй полный текст документа, максимально приближённый к стандартным формам тендерной документации
2. Подставь все известные реквизиты участника в соответствующие поля
3. Где данные не указаны — поставь "[___]" как плейсхолдер для ручного заполнения
4. Используй деловой стиль, соответствующий тендерной документации РФ
5. Добавь место для подписи и печати в конце документа
6. Дату документа укажи как текущую

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

    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${lovableApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: "Ты генерируешь тендерные документы. Отвечай ТОЛЬКО валидным JSON." },
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
    
    // Clean markdown wrappers
    content = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    
    // Try to parse JSON
    let document;
    try {
      document = JSON.parse(content);
    } catch {
      // Try to find JSON in the response
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        document = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error("Failed to parse AI response as JSON");
      }
    }

    return new Response(JSON.stringify({ document }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("generate-bid-documents error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
