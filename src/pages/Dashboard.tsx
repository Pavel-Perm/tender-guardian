import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { AppLayout } from "@/components/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus, FileSearch, AlertTriangle, CheckCircle, XCircle, Clock, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

type Analysis = {
  id: string;
  title: string;
  procurement_type: string;
  status: string;
  overall_risk: string | null;
  created_at: string;
};

const riskBadge = (risk: string | null) => {
  switch (risk) {
    case "ok": return <Badge className="bg-success text-success-foreground gap-1"><CheckCircle className="h-3 w-3" />Без рисков</Badge>;
    case "warning": return <Badge className="bg-warning text-warning-foreground gap-1"><AlertTriangle className="h-3 w-3" />Есть замечания</Badge>;
    case "critical": return <Badge variant="destructive" className="gap-1"><XCircle className="h-3 w-3" />Критично</Badge>;
    default: return <Badge variant="secondary" className="gap-1"><Clock className="h-3 w-3" />В обработке</Badge>;
  }
};

const procurementLabel = (type: string) => {
  switch (type) {
    case "44-fz": return "44-ФЗ";
    case "223-fz": return "223-ФЗ";
    case "commercial": return "Коммерческая";
    default: return type;
  }
};

const Dashboard = () => {
  const { user } = useAuth();
  const [analyses, setAnalyses] = useState<Analysis[]>([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({ total: 0, ok: 0, warning: 0, critical: 0 });
  const { toast } = useToast();

  const handleDelete = async (e: React.MouseEvent, analysisId: string) => {
    e.preventDefault();
    e.stopPropagation();

    // Delete related files from storage
    const { data: files } = await supabase
      .from("analysis_files")
      .select("file_path")
      .eq("analysis_id", analysisId);

    if (files && files.length > 0) {
      await supabase.storage.from("documents").remove(files.map(f => f.file_path));
    }

    // Delete analysis (cascades to results & files via FK)
    const { error } = await supabase.from("analyses").delete().eq("id", analysisId);

    if (error) {
      toast({ title: "Ошибка", description: "Не удалось удалить анализ", variant: "destructive" });
      return;
    }

    setAnalyses(prev => {
      const updated = prev.filter(a => a.id !== analysisId);
      setStats({
        total: updated.length,
        ok: updated.filter(a => a.overall_risk === "ok").length,
        warning: updated.filter(a => a.overall_risk === "warning").length,
        critical: updated.filter(a => a.overall_risk === "critical").length,
      });
      return updated;
    });
    toast({ title: "Удалено", description: "Анализ успешно удалён" });
  };

  useEffect(() => {
    const fetchAnalyses = async () => {
      const { data } = await supabase
        .from("analyses")
        .select("*")
        .order("created_at", { ascending: false });

      if (data) {
        setAnalyses(data as Analysis[]);
        setStats({
          total: data.length,
          ok: data.filter((a: any) => a.overall_risk === "ok").length,
          warning: data.filter((a: any) => a.overall_risk === "warning").length,
          critical: data.filter((a: any) => a.overall_risk === "critical").length,
        });
      }
      setLoading(false);
    };
    fetchAnalyses();
  }, []);

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Дашборд</h1>
            <p className="text-muted-foreground">Обзор ваших проверок тендерной документации</p>
          </div>
          <Link to="/analysis/new">
            <Button className="gap-2">
              <Plus className="h-4 w-4" />
              Новый анализ
            </Button>
          </Link>
        </div>

        {/* Stats */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="rounded-lg bg-primary/10 p-2"><FileSearch className="h-5 w-5 text-primary" /></div>
                <div>
                  <p className="text-2xl font-bold">{stats.total}</p>
                  <p className="text-sm text-muted-foreground">Всего проверок</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="rounded-lg bg-success/10 p-2"><CheckCircle className="h-5 w-5 text-success" /></div>
                <div>
                  <p className="text-2xl font-bold">{stats.ok}</p>
                  <p className="text-sm text-muted-foreground">Без рисков</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="rounded-lg bg-warning/10 p-2"><AlertTriangle className="h-5 w-5 text-warning" /></div>
                <div>
                  <p className="text-2xl font-bold">{stats.warning}</p>
                  <p className="text-sm text-muted-foreground">Требуют внимания</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="rounded-lg bg-destructive/10 p-2"><XCircle className="h-5 w-5 text-destructive" /></div>
                <div>
                  <p className="text-2xl font-bold">{stats.critical}</p>
                  <p className="text-sm text-muted-foreground">Критично</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Analysis list */}
        <Card>
          <CardHeader>
            <CardTitle>Последние проверки</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex justify-center py-8">
                <div className="animate-spin h-6 w-6 border-4 border-primary border-t-transparent rounded-full" />
              </div>
            ) : analyses.length === 0 ? (
              <div className="text-center py-12 space-y-3">
                <FileSearch className="h-12 w-12 mx-auto text-muted-foreground/40" />
                <p className="text-muted-foreground">Нет проверок. Начните первый анализ!</p>
                <Link to="/analysis/new">
                  <Button variant="outline" className="gap-2">
                    <Plus className="h-4 w-4" />
                    Новый анализ
                  </Button>
                </Link>
              </div>
            ) : (
              <div className="space-y-2">
                {analyses.map((a) => (
                  <div key={a.id} className="flex items-center justify-between rounded-lg border p-4 transition-colors hover:bg-muted/50">
                    <Link to={`/analysis/${a.id}`} className="flex-1 min-w-0">
                      <div className="space-y-1">
                        <p className="font-medium">{a.title}</p>
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <Badge variant="outline">{procurementLabel(a.procurement_type)}</Badge>
                          <span>{new Date(a.created_at).toLocaleDateString("ru-RU")}</span>
                        </div>
                      </div>
                    </Link>
                    <div className="flex items-center gap-3 ml-3">
                      {riskBadge(a.overall_risk)}
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-destructive"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Удалить анализ?</AlertDialogTitle>
                            <AlertDialogDescription>
                              «{a.title}» будет удалён вместе со всеми файлами и результатами. Это действие необратимо.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Отмена</AlertDialogCancel>
                            <AlertDialogAction
                              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                              onClick={(e) => handleDelete(e, a.id)}
                            >
                              Удалить
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
};

export default Dashboard;
