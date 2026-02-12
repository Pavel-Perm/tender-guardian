import { useEffect, useState, useMemo } from "react";
import { useParams, Link, useSearchParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { AppLayout } from "@/components/AppLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowLeft, ChevronRight, Loader2, Save, CheckCircle2, Calculator } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { numberToWordsRubles, formatCurrency } from "@/lib/numberToWords";

const vatLabels: Record<string, string> = {
  "22": "22%",
  "10": "10%",
  "0": "0%",
  "5": "5%",
  "7": "7%",
  "none": "Без НДС",
};

const BidAmount = () => {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const participantType = searchParams.get("type") || "enterprise";
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user } = useAuth();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [amountStr, setAmountStr] = useState("");
  const [vatRate, setVatRate] = useState("");
  const [vatRateLabel, setVatRateLabel] = useState("");

  // Load company VAT rate and existing bid amount
  useEffect(() => {
    const fetchData = async () => {
      if (!user || !id) return;

      const [companyRes, bidRes] = await Promise.all([
        supabase.from("companies").select("vat_rate").eq("user_id", user.id).order("updated_at", { ascending: false }).limit(1).maybeSingle(),
        supabase.from("bid_amounts").select("*").eq("analysis_id", id).maybeSingle(),
      ]);

      if (companyRes.data?.vat_rate) {
        setVatRate(companyRes.data.vat_rate);
        setVatRateLabel(vatLabels[companyRes.data.vat_rate] || companyRes.data.vat_rate);
      }

      if (bidRes.data) {
        setAmountStr(String(bidRes.data.amount));
        setSaved(true);
      }

      setLoading(false);
    };
    fetchData();
  }, [user, id]);

  const amount = useMemo(() => {
    const n = parseFloat(amountStr.replace(/\s/g, "").replace(",", "."));
    return isNaN(n) || n < 0 ? 0 : n;
  }, [amountStr]);

  const isVatApplicable = vatRate && vatRate !== "none";
  const vatPercent = isVatApplicable ? parseFloat(vatRate) : 0;

  const vatAmount = useMemo(() => {
    if (!isVatApplicable || amount === 0) return 0;
    // НДС включён в сумму: VAT = amount * rate / (100 + rate)
    return Math.round((amount * vatPercent / (100 + vatPercent)) * 100) / 100;
  }, [amount, vatPercent, isVatApplicable]);

  const totalWithVat = amount; // Сумма уже включает НДС
  const amountWithoutVat = isVatApplicable ? amount - vatAmount : amount;

  const amountWords = useMemo(() => amount > 0 ? numberToWordsRubles(amount) : "", [amount]);
  const vatAmountWords = useMemo(() => vatAmount > 0 ? numberToWordsRubles(vatAmount) : "", [vatAmount]);

  const saveBidAmount = async () => {
    if (!user || !id || amount <= 0) {
      toast({ title: "Ошибка", description: "Укажите сумму заявки", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const payload = {
        analysis_id: id,
        user_id: user.id,
        amount,
        vat_rate: vatRate || "none",
        vat_amount: vatAmount,
        total_with_vat: totalWithVat,
        amount_words: amountWords,
        vat_amount_words: vatAmountWords,
        total_words: amountWords,
      };

      const { error } = await supabase
        .from("bid_amounts")
        .upsert(payload, { onConflict: "analysis_id" });

      if (error) throw error;
      setSaved(true);
      toast({ title: "Сохранено", description: "Сумма заявки сохранена" });
    } catch (err: any) {
      toast({ title: "Ошибка", description: err.message, variant: "destructive" });
    }
    setSaving(false);
  };

  const goToDocuments = () => {
    if (!saved) {
      toast({ title: "Сохраните сумму", description: "Сначала сохраните сумму заявки", variant: "destructive" });
      return;
    }
    navigate(`/analysis/${id}/generate-documents?type=${participantType}`);
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

  return (
    <AppLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center gap-4">
          <Link to={`/analysis/${id}/bid-preparation?type=${participantType}`}>
            <Button variant="ghost" size="sm">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div className="flex-1">
            <h1 className="text-2xl font-bold">Сумма для подачи заявки</h1>
            <p className="text-muted-foreground text-sm">Укажите сумму, с которой хотите подать заявку</p>
          </div>
        </div>

        {/* Amount input */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Calculator className="h-5 w-5" />
              Сумма заявки
            </CardTitle>
            <CardDescription>Введите общую сумму заявки (в рублях, включая НДС если применимо)</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="amount">Сумма заявки (₽) *</Label>
              <Input
                id="amount"
                type="text"
                inputMode="decimal"
                placeholder="0.00"
                value={amountStr}
                onChange={e => {
                  setAmountStr(e.target.value);
                  setSaved(false);
                }}
                className="text-lg font-semibold"
              />
            </div>

            {/* VAT info */}
            <Card className="bg-muted/30">
              <CardContent className="pt-4 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Ставка НДС (из реквизитов):</span>
                  <span className="font-medium">{vatRateLabel || "Не указана"}</span>
                </div>
              </CardContent>
            </Card>

            {amount > 0 && (
              <div className="space-y-4">
                {/* Amounts breakdown */}
                <Card className="border-primary/30">
                  <CardContent className="pt-4 space-y-3">
                    <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">Расчёт</h3>
                    
                    <div className="space-y-2">
                      <div className="flex justify-between items-baseline">
                        <span className="text-sm text-muted-foreground">Сумма заявки:</span>
                        <span className="font-bold text-lg">{formatCurrency(amount)}</span>
                      </div>
                      <p className="text-xs text-muted-foreground italic">{amountWords}</p>
                    </div>

                    {isVatApplicable && (
                      <>
                        <div className="border-t pt-2 space-y-2">
                          <div className="flex justify-between items-baseline">
                            <span className="text-sm text-muted-foreground">Сумма без НДС:</span>
                            <span className="font-medium">{formatCurrency(amountWithoutVat)}</span>
                          </div>
                        </div>

                        <div className="space-y-2">
                          <div className="flex justify-between items-baseline">
                            <span className="text-sm text-muted-foreground">В т.ч. НДС ({vatRateLabel}):</span>
                            <span className="font-bold">{formatCurrency(vatAmount)}</span>
                          </div>
                          <p className="text-xs text-muted-foreground italic">{vatAmountWords}</p>
                        </div>
                      </>
                    )}

                    {!isVatApplicable && (
                      <div className="border-t pt-2">
                        <p className="text-sm text-muted-foreground">НДС не облагается</p>
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Save */}
                <Button onClick={saveBidAmount} disabled={saving || amount <= 0} className="gap-2 w-full sm:w-auto" size="lg">
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : saved ? <CheckCircle2 className="h-4 w-4" /> : <Save className="h-4 w-4" />}
                  {saved ? "Сохранено" : "Сохранить сумму"}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Bottom navigation */}
        <div className="flex justify-between pt-4 border-t">
          <Link to={`/analysis/${id}/bid-preparation?type=${participantType}`}>
            <Button variant="outline" className="gap-2">
              <ArrowLeft className="h-4 w-4" />
              Назад к реквизитам
            </Button>
          </Link>
          <Button className="gap-2" onClick={goToDocuments}>
            Генерация документов
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </AppLayout>
  );
};

export default BidAmount;
