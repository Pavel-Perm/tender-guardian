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

    // Download and extract text from files
    let allText = "";
    for (const file of files) {
      try {
        const { data: fileData } = await supabase.storage
          .from("documents")
          .download(file.file_path);

        if (fileData) {
          const text = await fileData.text();
          // For binary files this won't be perfect, but for text-based docs it'll work
          // A production system would use proper parsers
          allText += `\n\n--- Файл: ${file.file_name} ---\n${text.substring(0, 50000)}`;
        }
      } catch (e) {
        allText += `\n\n--- Файл: ${file.file_name} --- (не удалось извлечь текст)`;
      }
    }

    // Update status to analyzing
    await supabase.from("analyses").update({ status: "analyzing" }).eq("id", analysisId);

    const procType = analysis.procurement_type === "44-fz" ? "44-ФЗ" :
                     analysis.procurement_type === "223-fz" ? "223-ФЗ" : "коммерческая закупка";

    const blocksListStr = ANALYSIS_BLOCKS.map(b => `${b.order}. ${b.name}`).join("\n");

    const systemPrompt = `Ты — эксперт по проверке тендерной документации в России. Анализируй документацию по ${procType} на предмет типовых ошибок и рисков.

Проверь документацию по следующим ${ANALYSIS_BLOCKS.length} блокам:
${blocksListStr}

Для КАЖДОГО блока верни JSON-объект с полями:
- block_name: название блока (точно как в списке выше)
- block_order: номер блока
- status: "ok" | "warning" | "critical"
- risk_description: описание найденного риска или "Нарушений не обнаружено"
- recommendation: рекомендация по исправлению (если есть риск)
- details: подробное описание с цитатами из документации

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
          { role: "user", content: `Проанализируй следующую тендерную документацию:\n\n${allText.substring(0, 100000)}` },
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
