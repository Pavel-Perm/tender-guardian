import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { AppLayout } from "@/components/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowLeft, Building2, User, Briefcase, FileCheck, Plus, Loader2 } from "lucide-react";

type DocCategory = {
  category: string;
  documents: string[];
};

const categoryConfig: Record<string, { label: string; icon: React.ElementType; description: string }> = {
  enterprise: {
    label: "Юридические лица",
    icon: Building2,
    description: "ООО, АО, ПАО и другие организационно-правовые формы",
  },
  ip: {
    label: "Индивидуальные предприниматели",
    icon: Briefcase,
    description: "ИП — физические лица, зарегистрированные как предприниматели",
  },
  self_employed: {
    label: "Самозанятые",
    icon: User,
    description: "Плательщики налога на профессиональный доход (НПД)",
  },
};

const RequiredDocuments = () => {
  const { id } = useParams<{ id: string }>();
  const [categories, setCategories] = useState<DocCategory[]>([]);
  const [analysisTitle, setAnalysisTitle] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      const [{ data: docs }, { data: analysis }] = await Promise.all([
        supabase
          .from("analysis_required_documents")
          .select("category, documents")
          .eq("analysis_id", id!),
        supabase
          .from("analyses")
          .select("title")
          .eq("id", id!)
          .maybeSingle(),
      ]);
      if (docs) setCategories(docs as DocCategory[]);
      if (analysis) setAnalysisTitle(analysis.title);
      setLoading(false);
    };
    fetchData();
  }, [id]);

  if (loading) {
    return (
      <AppLayout>
        <div className="flex justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </AppLayout>
    );
  }

  const availableCategories = categories.filter(c => c.documents && c.documents.length > 0);
  const defaultTab = availableCategories.length > 0 ? availableCategories[0].category : "enterprise";

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Link to={`/analysis/${id}`}>
            <Button variant="ghost" size="sm">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div className="flex-1">
            <h1 className="text-2xl font-bold">Требуемые документы для участия</h1>
            <p className="text-muted-foreground text-sm">{analysisTitle}</p>
          </div>
        </div>

        {availableCategories.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center space-y-3">
              <FileCheck className="h-10 w-10 mx-auto text-muted-foreground" />
              <p className="font-medium">Информация о требуемых документах не найдена</p>
              <p className="text-sm text-muted-foreground">
                Возможно, в загруженной документации не указаны требования к составу заявки
              </p>
            </CardContent>
          </Card>
        ) : (
          <Tabs defaultValue={defaultTab} className="space-y-4">
            <TabsList className="grid w-full" style={{ gridTemplateColumns: `repeat(${availableCategories.length}, 1fr)` }}>
              {availableCategories.map((cat) => {
                const config = categoryConfig[cat.category];
                if (!config) return null;
                const Icon = config.icon;
                return (
                  <TabsTrigger key={cat.category} value={cat.category} className="gap-2">
                    <Icon className="h-4 w-4" />
                    <span className="hidden sm:inline">{config.label}</span>
                  </TabsTrigger>
                );
              })}
            </TabsList>

            {availableCategories.map((cat) => {
              const config = categoryConfig[cat.category];
              if (!config) return null;
              const Icon = config.icon;
              return (
                <TabsContent key={cat.category} value={cat.category}>
                  <Card>
                    <CardHeader>
                      <div className="flex items-center gap-3">
                        <div className="rounded-lg bg-primary/10 p-2">
                          <Icon className="h-5 w-5 text-primary" />
                        </div>
                        <div>
                          <CardTitle className="text-lg">{config.label}</CardTitle>
                          <p className="text-sm text-muted-foreground">{config.description}</p>
                        </div>
                      </div>
                      <Badge variant="secondary" className="w-fit mt-2">
                        {cat.documents.length} {cat.documents.length === 1 ? "документ" : cat.documents.length < 5 ? "документа" : "документов"}
                      </Badge>
                    </CardHeader>
                    <CardContent>
                      <ol className="space-y-3">
                        {cat.documents.map((doc, idx) => (
                          <li key={idx} className="flex items-start gap-3 rounded-lg border p-3 bg-muted/20">
                            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                              {idx + 1}
                            </span>
                            <span className="text-sm">{doc}</span>
                          </li>
                        ))}
                      </ol>
                    </CardContent>
                  </Card>
                </TabsContent>
              );
            })}
          </Tabs>
        )}

        {/* Bottom navigation */}
        <div className="flex justify-between items-center pt-4 border-t">
          <Link to={`/analysis/${id}`}>
            <Button variant="outline" className="gap-2">
              <ArrowLeft className="h-4 w-4" />
              Назад к результатам
            </Button>
          </Link>
          <Link to="/analysis/new">
            <Button className="gap-2">
              <Plus className="h-4 w-4" />
              Новый анализ
            </Button>
          </Link>
        </div>
      </div>
    </AppLayout>
  );
};

export default RequiredDocuments;
