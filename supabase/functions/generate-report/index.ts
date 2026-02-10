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

    const { analysisId, format } = await req.json();
    if (!analysisId || !format) throw new Error("analysisId and format required");

    // Verify ownership
    const { data: analysis } = await userClient.from("analyses").select("*").eq("id", analysisId).single();
    if (!analysis) throw new Error("Analysis not found");

    const { data: results } = await userClient.from("analysis_results").select("*").eq("analysis_id", analysisId).order("block_order");
    if (!results) throw new Error("No results");

    const statusEmoji = (s: string) => s === "ok" ? "✅" : s === "warning" ? "⚠️" : "❌";
    const procLabel = analysis.procurement_type === "44-fz" ? "44-ФЗ" :
                      analysis.procurement_type === "223-fz" ? "223-ФЗ" : "Коммерческая";

    if (format === "excel") {
      // Generate CSV (simpler, universal Excel support)
      let csv = "\uFEFF"; // BOM for Excel UTF-8
      csv += "Блок;Статус;Описание риска;Рекомендация\n";
      for (const r of results) {
        const escape = (s: string | null) => s ? `"${s.replace(/"/g, '""')}"` : '""';
        csv += `${escape(r.block_name)};${statusEmoji(r.status)};${escape(r.risk_description)};${escape(r.recommendation)}\n`;
      }

      const encoded = btoa(unescape(encodeURIComponent(csv)));
      return new Response(JSON.stringify({ file: encoded }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (format === "pdf") {
      // Generate HTML-based report that can be used as PDF
      const prompt = `Сформируй красивый HTML-отчёт по результатам проверки тендерной документации.

Название: ${analysis.title}
Тип закупки: ${procLabel}
Дата: ${new Date(analysis.created_at).toLocaleDateString("ru-RU")}

Результаты проверки:
${results.map(r => `${statusEmoji(r.status)} ${r.block_name}: ${r.risk_description || "Нарушений нет"} | Рекомендация: ${r.recommendation || "Нет"}`).join("\n")}

Сформируй полный HTML документ с таблицей результатов, цветовой индикацией рисков (зелёный/жёлтый/красный), сводкой и рекомендациями. Стиль - деловой, профессиональный. Только HTML код, без markdown.`;

      const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${lovableApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [
            { role: "system", content: "Ты генерируешь красивые HTML-отчёты. Отвечай ТОЛЬКО HTML кодом." },
            { role: "user", content: prompt },
          ],
        }),
      });

      if (!aiResponse.ok) {
        if (aiResponse.status === 429) throw new Error("Превышен лимит запросов");
        if (aiResponse.status === 402) throw new Error("Необходимо пополнить баланс");
        throw new Error("AI error");
      }

      const aiData = await aiResponse.json();
      let html = aiData.choices?.[0]?.message?.content || "";
      html = html.replace(/```html\n?/g, "").replace(/```\n?/g, "").trim();

      const encoded = btoa(unescape(encodeURIComponent(html)));
      return new Response(JSON.stringify({ file: encoded }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    throw new Error("Unknown format");
  } catch (e) {
    console.error("generate-report error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
