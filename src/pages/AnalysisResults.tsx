import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { AppLayout } from "@/components/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useToast } from "@/hooks/use-toast";
import {
  CheckCircle, AlertTriangle, XCircle, ChevronDown, Download,
  FileText, ArrowLeft, Loader2, Clock, Filter, ClipboardList, Plus,
} from "lucide-react";

type Result = {
  id: string;
  block_name: string;
  block_order: number;
  status: string;
  risk_description: string | null;
  recommendation: string | null;
  details: string | null;
};

type Analysis = {
  id: string;
  title: string;
  procurement_type: string;
  status: string;
  overall_risk: string | null;
  created_at: string;
};

const statusIcon = (status: string) => {
  switch (status) {
    case "ok": return <CheckCircle className="h-5 w-5 text-success" />;
    case "warning": return <AlertTriangle className="h-5 w-5 text-warning" />;
    case "critical": return <XCircle className="h-5 w-5 text-destructive" />;
    default: return <Clock className="h-5 w-5 text-muted-foreground" />;
  }
};

const statusLabel = (status: string) => {
  switch (status) {
    case "ok": return "✅ В порядке";
    case "warning": return "⚠️ Внимание";
    case "critical": return "❌ Критично";
    default: return status;
  }
};

const AnalysisResults = () => {
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [results, setResults] = useState<Result[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);

  useEffect(() => {
    const fetch = async () => {
      const [{ data: a }, { data: r }] = await Promise.all([
        supabase.from("analyses").select("*").eq("id", id!).single(),
        supabase.from("analysis_results").select("*").eq("analysis_id", id!).order("block_order"),
      ]);
      if (a) setAnalysis(a as Analysis);
      if (r) setResults(r as Result[]);
      setLoading(false);
    };
    fetch();
  }, [id]);

  const handleDownload = async (format: "pdf" | "excel") => {
     setDownloading(format);
     try {
       const { data, error } = await supabase.functions.invoke("generate-report", {
         body: { analysisId: id, format },
       });

       if (error) {
         const errMsg = data?.error 
           || (typeof error === 'object' && 'context' in error ? error.context?.body?.error : null)
           || error.message 
           || "Ошибка при скачивании";
         throw new Error(errMsg);
       }

      const base64 = data.file;
      if (format === "pdf") {
        // HTML report - open in new tab for print-to-PDF
        const html = decodeURIComponent(escape(atob(base64)));
        const blob = new Blob([html], { type: "text/html" });
        const url = URL.createObjectURL(blob);
        window.open(url, "_blank");
        URL.revokeObjectURL(url);
      } else {
        // CSV/Excel
        const csv = decodeURIComponent(escape(atob(base64)));
        const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `report_${analysis?.title || "analysis"}.csv`;
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch (e: any) {
      toast({ title: "Ошибка скачивания", description: e.message, variant: "destructive" });
    }
    setDownloading(null);
  };

  const filteredResults = filter ? results.filter((r) => r.status === filter) : results;
  const counts = {
    ok: results.filter((r) => r.status === "ok").length,
    warning: results.filter((r) => r.status === "warning").length,
    critical: results.filter((r) => r.status === "critical").length,
  };

  if (loading) {
    return (
      <AppLayout>
        <div className="flex justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </AppLayout>
    );
  }

  if (!analysis) {
    return (
      <AppLayout>
        <div className="text-center py-20">
          <p className="text-muted-foreground">Анализ не найден</p>
          <Link to="/dashboard"><Button variant="outline" className="mt-4">На дашборд</Button></Link>
        </div>
      </AppLayout>
    );
  }

  const isProcessing = analysis.status !== "completed" && analysis.status !== "failed";

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Link to="/dashboard"><Button variant="ghost" size="sm"><ArrowLeft className="h-4 w-4" /></Button></Link>
          <div className="flex-1">
            <h1 className="text-2xl font-bold">{analysis.title}</h1>
            <p className="text-muted-foreground text-sm">
              {new Date(analysis.created_at).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" })}
            </p>
          </div>
        </div>

        {isProcessing ? (
          <Card>
            <CardContent className="py-12 text-center space-y-3">
              <Loader2 className="h-10 w-10 animate-spin mx-auto text-primary" />
              <p className="font-medium">Анализ в процессе...</p>
              <p className="text-sm text-muted-foreground">Обновите страницу через несколько минут</p>
            </CardContent>
          </Card>
        ) : analysis.status === "failed" ? (
          <Card>
            <CardContent className="py-12 text-center space-y-3">
              <XCircle className="h-10 w-10 mx-auto text-destructive" />
              <p className="font-medium">Ошибка анализа</p>
              <p className="text-sm text-muted-foreground">Попробуйте загрузить документы снова</p>
            </CardContent>
          </Card>
        ) : (
          <>
            {/* Summary */}
            <div className="grid gap-4 sm:grid-cols-3">
              <Card className="cursor-pointer hover:bg-muted/50 transition-colors" onClick={() => setFilter(filter === "ok" ? null : "ok")}>
                <CardContent className="pt-6 flex items-center gap-3">
                  <CheckCircle className="h-6 w-6 text-success" />
                  <div>
                    <p className="text-2xl font-bold">{counts.ok}</p>
                    <p className="text-sm text-muted-foreground">В порядке</p>
                  </div>
                </CardContent>
              </Card>
              <Card className="cursor-pointer hover:bg-muted/50 transition-colors" onClick={() => setFilter(filter === "warning" ? null : "warning")}>
                <CardContent className="pt-6 flex items-center gap-3">
                  <AlertTriangle className="h-6 w-6 text-warning" />
                  <div>
                    <p className="text-2xl font-bold">{counts.warning}</p>
                    <p className="text-sm text-muted-foreground">Требуют внимания</p>
                  </div>
                </CardContent>
              </Card>
              <Card className="cursor-pointer hover:bg-muted/50 transition-colors" onClick={() => setFilter(filter === "critical" ? null : "critical")}>
                <CardContent className="pt-6 flex items-center gap-3">
                  <XCircle className="h-6 w-6 text-destructive" />
                  <div>
                    <p className="text-2xl font-bold">{counts.critical}</p>
                    <p className="text-sm text-muted-foreground">Критично</p>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Download buttons */}
            <div className="flex gap-3">
              <Button variant="outline" className="gap-2" onClick={() => handleDownload("pdf")} disabled={!!downloading}>
                {downloading === "pdf" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                Скачать PDF
              </Button>
              <Button variant="outline" className="gap-2" onClick={() => handleDownload("excel")} disabled={!!downloading}>
                {downloading === "excel" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
                Скачать Excel
              </Button>
              {filter && (
                <Button variant="ghost" className="gap-2 ml-auto" onClick={() => setFilter(null)}>
                  <Filter className="h-4 w-4" />
                  Сбросить фильтр
                </Button>
              )}
            </div>

            {/* Results */}
            <div className="space-y-2">
              {filteredResults.map((r) => (
                <Collapsible key={r.id}>
                  <CollapsibleTrigger className="w-full">
                    <div className="flex items-center justify-between rounded-lg border p-4 hover:bg-muted/50 transition-colors text-left">
                      <div className="flex items-center gap-3">
                        {statusIcon(r.status)}
                        <div>
                          <p className="font-medium">{r.block_name}</p>
                          {r.risk_description && (
                            <p className="text-sm text-muted-foreground mt-0.5 line-clamp-1">{r.risk_description}</p>
                          )}
                        </div>
                      </div>
                      <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0 transition-transform duration-200 group-data-[state=open]:rotate-180" />
                    </div>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="rounded-b-lg border border-t-0 p-4 space-y-3 bg-muted/20">
                      <div>
                        <p className="text-sm font-medium text-muted-foreground mb-1">Статус</p>
                        <p>{statusLabel(r.status)}</p>
                      </div>
                      {r.risk_description && (
                        <div>
                          <p className="text-sm font-medium text-muted-foreground mb-1">Описание риска</p>
                          <p className="text-sm">{r.risk_description}</p>
                        </div>
                      )}
                      {r.recommendation && (
                        <div>
                          <p className="text-sm font-medium text-muted-foreground mb-1">Рекомендация</p>
                          <p className="text-sm">{r.recommendation}</p>
                        </div>
                      )}
                      {r.details && (
                        <div>
                          <p className="text-sm font-medium text-muted-foreground mb-1">Подробности</p>
                          <p className="text-sm whitespace-pre-wrap">{r.details}</p>
                        </div>
                      )}
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              ))}
            </div>

            {/* Bottom navigation */}
            <div className="flex flex-col gap-4 pt-4 border-t">
              <div className="flex justify-start">
                <Link to={`/analysis/${id}/participant`}>
                  <Button variant="outline" className="gap-2">
                    <ClipboardList className="h-4 w-4" />
                    Требуемые документы для участия
                  </Button>
                </Link>
              </div>
              <div className="flex justify-center">
                <Link to="/analysis/new">
                  <Button className="gap-2">
                    <Plus className="h-4 w-4" />
                    Новый анализ
                  </Button>
                </Link>
              </div>
            </div>
          </>
        )}
      </div>
    </AppLayout>
  );
};

export default AnalysisResults;
