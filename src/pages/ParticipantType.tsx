import { useParams, Link, useNavigate } from "react-router-dom";
import { AppLayout } from "@/components/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Building2, Briefcase, User, Plus, ChevronRight } from "lucide-react";

const participantTypes = [
  {
    key: "enterprise",
    label: "Юридические лица",
    description: "ООО, АО, ПАО и другие организационно-правовые формы",
    icon: Building2,
  },
  {
    key: "ip",
    label: "Индивидуальные предприниматели",
    description: "ИП — физические лица, зарегистрированные как предприниматели",
    icon: Briefcase,
  },
  {
    key: "self_employed",
    label: "Самозанятые",
    description: "Плательщики налога на профессиональный доход (НПД)",
    icon: User,
  },
] as const;

const ParticipantType = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const handleSelect = (type: string) => {
    navigate(`/analysis/${id}/documents?type=${type}`);
  };

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
            <h1 className="text-2xl font-bold">Выбор типа участника</h1>
            <p className="text-muted-foreground text-sm">
              Выберите, кто будет принимать участие в закупке
            </p>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          {participantTypes.map((type) => {
            const Icon = type.icon;
            return (
              <Card
                key={type.key}
                className="cursor-pointer hover:border-primary/50 hover:shadow-md transition-all group"
                onClick={() => handleSelect(type.key)}
              >
                <CardContent className="pt-6 pb-6 flex flex-col items-center text-center gap-4">
                  <div className="rounded-xl bg-primary/10 p-4 group-hover:bg-primary/20 transition-colors">
                    <Icon className="h-8 w-8 text-primary" />
                  </div>
                  <div className="space-y-1">
                    <p className="font-semibold">{type.label}</p>
                    <p className="text-sm text-muted-foreground">{type.description}</p>
                  </div>
                  <ChevronRight className="h-5 w-5 text-muted-foreground group-hover:text-primary transition-colors" />
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* Bottom navigation */}
        <div className="flex justify-center items-center pt-4 border-t">
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

export default ParticipantType;
