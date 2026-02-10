import { useState, useEffect } from "react";
import { Navigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { AppLayout } from "@/components/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  Users, BarChart3, Shield, Loader2, ShieldCheck, ShieldX,
  FileSearch, CheckCircle, AlertTriangle, XCircle
} from "lucide-react";

type UserInfo = {
  id: string;
  email: string;
  fullName: string;
  company: string;
  roles: string[];
  analysesCount: number;
  createdAt: string;
  lastSignIn: string | null;
};

type Stats = {
  totalUsers: number;
  totalAnalyses: number;
  riskDistribution: { ok: number; warning: number; critical: number };
};

const AdminPanel = () => {
  const { isAdmin, loading: roleLoading } = useIsAdmin();
  const { toast } = useToast();
  const [users, setUsers] = useState<UserInfo[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"stats" | "users">("stats");

  const fetchData = async () => {
    setLoading(true);
    const [usersRes, statsRes] = await Promise.all([
      supabase.functions.invoke("admin", { body: { action: "list-users" } }),
      supabase.functions.invoke("admin", { body: { action: "stats" } }),
    ]);
    if (usersRes.data?.users) setUsers(usersRes.data.users);
    if (statsRes.data) setStats(statsRes.data);
    setLoading(false);
  };

  useEffect(() => {
    if (isAdmin) fetchData();
  }, [isAdmin]);

  const toggleRole = async (userId: string, role: string, hasRole: boolean) => {
    const action = hasRole ? "remove-role" : "assign-role";
    const { error } = await supabase.functions.invoke("admin", {
      body: { action, userId, role },
    });
    if (error) {
      toast({ title: "Ошибка", description: error.message, variant: "destructive" });
    } else {
      toast({ title: hasRole ? "Роль удалена" : "Роль назначена" });
      fetchData();
    }
  };

  if (roleLoading) {
    return <AppLayout><div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div></AppLayout>;
  }

  if (!isAdmin) return <Navigate to="/dashboard" replace />;

  return (
    <AppLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Shield className="h-6 w-6" />
            Панель администратора
          </h1>
          <p className="text-muted-foreground">Управление пользователями и системой</p>
        </div>

        <div className="flex gap-2">
          <Button variant={tab === "stats" ? "default" : "outline"} onClick={() => setTab("stats")} className="gap-2">
            <BarChart3 className="h-4 w-4" />Статистика
          </Button>
          <Button variant={tab === "users" ? "default" : "outline"} onClick={() => setTab("users")} className="gap-2">
            <Users className="h-4 w-4" />Пользователи
          </Button>
        </div>

        {loading ? (
          <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
        ) : tab === "stats" && stats ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <div className="rounded-lg bg-primary/10 p-2"><Users className="h-5 w-5 text-primary" /></div>
                  <div><p className="text-2xl font-bold">{stats.totalUsers}</p><p className="text-sm text-muted-foreground">Пользователей</p></div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <div className="rounded-lg bg-primary/10 p-2"><FileSearch className="h-5 w-5 text-primary" /></div>
                  <div><p className="text-2xl font-bold">{stats.totalAnalyses}</p><p className="text-sm text-muted-foreground">Всего анализов</p></div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <div className="rounded-lg bg-success/10 p-2"><CheckCircle className="h-5 w-5 text-success" /></div>
                  <div><p className="text-2xl font-bold">{stats.riskDistribution.ok}</p><p className="text-sm text-muted-foreground">Без рисков</p></div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <div className="rounded-lg bg-destructive/10 p-2"><XCircle className="h-5 w-5 text-destructive" /></div>
                  <div><p className="text-2xl font-bold">{stats.riskDistribution.critical}</p><p className="text-sm text-muted-foreground">Критичных</p></div>
                </div>
              </CardContent>
            </Card>
          </div>
        ) : tab === "users" ? (
          <Card>
            <CardHeader>
              <CardTitle>Пользователи ({users.length})</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {users.map((u) => (
                  <div key={u.id} className="flex items-center justify-between rounded-lg border p-4">
                    <div className="space-y-1 min-w-0">
                      <p className="font-medium truncate">{u.fullName || u.email}</p>
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <span>{u.email}</span>
                        {u.company && <span>• {u.company}</span>}
                        <span>• {u.analysesCount} анализов</span>
                      </div>
                      <div className="flex gap-1 mt-1">
                        {u.roles.map(r => (
                          <Badge key={r} variant={r === "admin" ? "default" : "secondary"}>{r}</Badge>
                        ))}
                      </div>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      {u.roles.includes("admin") ? (
                        <Button variant="outline" size="sm" className="gap-1" onClick={() => toggleRole(u.id, "admin", true)}>
                          <ShieldX className="h-3.5 w-3.5" />Снять админ
                        </Button>
                      ) : (
                        <Button variant="outline" size="sm" className="gap-1" onClick={() => toggleRole(u.id, "admin", false)}>
                          <ShieldCheck className="h-3.5 w-3.5" />Сделать админ
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        ) : null}
      </div>
    </AppLayout>
  );
};

export default AdminPanel;
