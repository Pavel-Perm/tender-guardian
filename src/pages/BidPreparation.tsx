import { useEffect, useState, useCallback } from "react";
import { useParams, Link, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { AppLayout } from "@/components/AppLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, Search, Upload, Loader2, CheckCircle2, Building2, FileUp, PenLine } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";

type CompanyData = {
  id?: string;
  inn: string;
  kpp: string;
  ogrn: string;
  full_name: string;
  short_name: string;
  legal_address: string;
  actual_address: string;
  director_name: string;
  director_position: string;
  phone: string;
  email: string;
  bank_name: string;
  bank_bik: string;
  bank_account: string;
  bank_corr_account: string;
  okved: string;
  tax_system: string;
  vat_rate: string;
};

const emptyCompany: CompanyData = {
  inn: "", kpp: "", ogrn: "", full_name: "", short_name: "",
  legal_address: "", actual_address: "", director_name: "", director_position: "",
  phone: "", email: "", bank_name: "", bank_bik: "", bank_account: "",
  bank_corr_account: "", okved: "", tax_system: "", vat_rate: "",
};

const vatOptions = [
  { value: "22", label: "22% — основная ставка (ОСНО)" },
  { value: "10", label: "10% — льготная ставка (ОСНО)" },
  { value: "0", label: "0% — экспорт и льготные операции" },
  { value: "5", label: "5% — спецставка УСН (доход до 272,5 млн)" },
  { value: "7", label: "7% — спецставка УСН (доход до 490,5 млн)" },
  { value: "none", label: "Без НДС — освобождение / НПД / ПСН" },
];

const taxSystems = [
  { value: "osno", label: "ОСНО — общая система" },
  { value: "usn_income", label: "УСН — доходы" },
  { value: "usn_income_expense", label: "УСН — доходы минус расходы" },
  { value: "eshn", label: "ЕСХН — единый сельскохозяйственный налог" },
  { value: "patent", label: "ПСН — патентная система" },
  { value: "npd", label: "НПД — самозанятый" },
  { value: "ausn", label: "АУСН — автоматизированная УСН" },
];

const BidPreparation = () => {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const participantType = searchParams.get("type") || "enterprise";
  const { toast } = useToast();
  const { user } = useAuth();

  const [activeTab, setActiveTab] = useState("inn");
  const [innSearch, setInnSearch] = useState("");
  const [innError, setInnError] = useState("");
  const [searching, setSearching] = useState(false);

  const isEntity = participantType === "enterprise";
  const requiredInnLength = isEntity ? 10 : 12;
  const innLengthLabel = isEntity ? "10 цифр (юр. лицо)" : "12 цифр (ИП / физ. лицо)";
  const [foundCompany, setFoundCompany] = useState<CompanyData | null>(null);
  const [company, setCompany] = useState<CompanyData>(emptyCompany);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [fillMode, setFillMode] = useState<"manual" | "upload" | null>(null);

  // Search company by INN in DB
  const searchByInn = useCallback(async () => {
    if (!innSearch.trim()) return;
    if (innSearch.length !== requiredInnLength) {
      setInnError(`ИНН должен содержать ${innLengthLabel}`);
      return;
    }
    setInnError("");
    setSearching(true);
    setFoundCompany(null);

    const { data, error } = await supabase
      .from("companies")
      .select("*")
      .eq("inn", innSearch.trim())
      .maybeSingle();

    if (data && !error) {
      setFoundCompany(data as unknown as CompanyData);
      setCompany(data as unknown as CompanyData);
      toast({ title: "Организация найдена!", description: `${data.full_name}` });
    } else {
      toast({ title: "Не найдено", description: "Организация с таким ИНН не найдена в базе. Заполните данные вручную или загрузите карточку.", variant: "destructive" });
    }
    setSearching(false);
  }, [innSearch, toast]);

  const updateField = (field: keyof CompanyData, value: string) => {
    setCompany(prev => ({ ...prev, [field]: value }));
    setSaved(false);
  };

  // Upload company card and parse via AI
  const handleCardUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !id) return;

    setParsing(true);
    try {
      // Upload file to storage
      const ext = file.name.split(".").pop();
      const filePath = `${user?.id}/company-cards/${Date.now()}.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from("documents")
        .upload(filePath, file);
      if (uploadError) throw uploadError;

      // Call edge function to parse
      const { data, error } = await supabase.functions.invoke("parse-company-card", {
        body: { filePath, analysisId: id },
      });

      if (error) throw error;
      if (data?.company) {
        // Merge: keep existing non-empty fields, fill empty ones from parsed
        setCompany(prev => {
          const merged = { ...prev };
          for (const key of Object.keys(data.company)) {
            if (data.company[key] && !merged[key as keyof CompanyData]) {
              (merged as any)[key] = data.company[key];
            }
          }
          return merged;
        });
        toast({ title: "Карточка обработана", description: "Данные извлечены из документа. Проверьте и дополните при необходимости." });
      }
    } catch (err: any) {
      toast({ title: "Ошибка", description: err.message || "Не удалось обработать карточку", variant: "destructive" });
    }
    setParsing(false);
  };

  // Save company to DB
  const saveCompany = async () => {
    if (!user || !company.inn || !company.full_name) {
      toast({ title: "Ошибка", description: "Заполните ИНН и полное наименование", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const payload = {
        user_id: user.id,
        inn: company.inn.trim(),
        kpp: company.kpp || null,
        ogrn: company.ogrn || null,
        full_name: company.full_name,
        short_name: company.short_name || null,
        legal_address: company.legal_address || null,
        actual_address: company.actual_address || null,
        director_name: company.director_name || null,
        director_position: company.director_position || null,
        phone: company.phone || null,
        email: company.email || null,
        bank_name: company.bank_name || null,
        bank_bik: company.bank_bik || null,
        bank_account: company.bank_account || null,
        bank_corr_account: company.bank_corr_account || null,
        okved: company.okved || null,
        tax_system: company.tax_system || null,
        vat_rate: company.vat_rate || null,
      };

      if (company.id) {
        // Update existing
        const { error } = await supabase
          .from("companies")
          .update(payload)
          .eq("id", company.id);
        if (error) throw error;
      } else {
        // Upsert by user_id + inn
        const { data, error } = await supabase
          .from("companies")
          .upsert(payload, { onConflict: "user_id,inn" })
          .select()
          .single();
        if (error) throw error;
        if (data) setCompany(prev => ({ ...prev, id: data.id }));
      }
      setSaved(true);
      toast({ title: "Сохранено", description: "Данные организации сохранены в базу" });
    } catch (err: any) {
      toast({ title: "Ошибка сохранения", description: err.message, variant: "destructive" });
    }
    setSaving(false);
  };

  return (
    <AppLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center gap-4">
          <Link to={`/analysis/${id}/documents?type=${participantType}`}>
            <Button variant="ghost" size="sm">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div className="flex-1">
            <h1 className="text-2xl font-bold">Подготовка заявки на участие</h1>
            <p className="text-muted-foreground text-sm">Заполните реквизиты и выберите ставку НДС</p>
          </div>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="inn" className="gap-2">
              <Search className="h-4 w-4" />
              <span className="hidden sm:inline">Поиск по ИНН</span>
            </TabsTrigger>
            <TabsTrigger value="details" className="gap-2">
              <Building2 className="h-4 w-4" />
              <span className="hidden sm:inline">Реквизиты</span>
            </TabsTrigger>
            <TabsTrigger value="vat" className="gap-2">
              <CheckCircle2 className="h-4 w-4" />
              <span className="hidden sm:inline">НДС и итог</span>
            </TabsTrigger>
          </TabsList>

          {/* Tab 1: ИНН Search */}
          <TabsContent value="inn">
            <Card>
              <CardHeader>
                <CardTitle>Поиск организации по ИНН</CardTitle>
                <CardDescription>
                  Если организация уже есть в вашей базе — данные заполнятся автоматически
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <div className="flex gap-2">
                    <Input
                      placeholder={`Введите ИНН (${innLengthLabel})`}
                      value={innSearch}
                      onChange={e => {
                        const val = e.target.value.replace(/\D/g, "").slice(0, requiredInnLength);
                        setInnSearch(val);
                        if (innError) setInnError("");
                      }}
                      onKeyDown={e => e.key === "Enter" && searchByInn()}
                      maxLength={requiredInnLength}
                    />
                    <Button onClick={searchByInn} disabled={searching || !innSearch.trim()}>
                      {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                      Найти
                    </Button>
                  </div>
                  {innError && <p className="text-sm text-destructive">{innError}</p>}
                  <p className="text-xs text-muted-foreground">
                    {isEntity ? "Для юридических лиц ИНН — 10 цифр" : "Для ИП и физических лиц ИНН — 12 цифр"}
                  </p>
                </div>

                {foundCompany && (
                  <Card className="border-primary/30 bg-primary/5">
                    <CardContent className="pt-4 space-y-2">
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="h-5 w-5 text-primary" />
                        <span className="font-semibold">Организация найдена в базе</span>
                      </div>
                      <p className="text-sm"><span className="text-muted-foreground">Наименование:</span> {foundCompany.full_name}</p>
                      <p className="text-sm"><span className="text-muted-foreground">ИНН:</span> {foundCompany.inn}</p>
                      {foundCompany.kpp && <p className="text-sm"><span className="text-muted-foreground">КПП:</span> {foundCompany.kpp}</p>}
                      <Button size="sm" onClick={() => setActiveTab("details")} className="mt-2">
                        Перейти к реквизитам
                      </Button>
                    </CardContent>
                  </Card>
                )}

                {!foundCompany && !searching && innSearch.length === requiredInnLength && (
                  <div className="space-y-3">
                    <p className="text-sm text-muted-foreground">
                      Организация не найдена. Заполните данные вручную или загрузите карточку.
                    </p>
                    <Button variant="outline" onClick={() => { setCompany(prev => ({ ...prev, inn: innSearch })); setActiveTab("details"); }}>
                      Продолжить с ИНН {innSearch}
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Tab 2: Details / Requisites */}
          <TabsContent value="details">
            <div className="space-y-4">
              {/* Fill mode selector */}
              {!fillMode && !foundCompany && (
                <div className="grid gap-4 sm:grid-cols-2">
                  <Card className="cursor-pointer hover:border-primary/50 transition-all" onClick={() => setFillMode("manual")}>
                    <CardContent className="pt-6 flex flex-col items-center text-center gap-3">
                      <div className="rounded-xl bg-primary/10 p-4">
                        <PenLine className="h-8 w-8 text-primary" />
                      </div>
                      <p className="font-semibold">Заполнить вручную</p>
                      <p className="text-sm text-muted-foreground">Ввести реквизиты самостоятельно</p>
                    </CardContent>
                  </Card>
                  <Card className="cursor-pointer hover:border-primary/50 transition-all" onClick={() => setFillMode("upload")}>
                    <CardContent className="pt-6 flex flex-col items-center text-center gap-3">
                      <div className="rounded-xl bg-primary/10 p-4">
                        <FileUp className="h-8 w-8 text-primary" />
                      </div>
                      <p className="font-semibold">Загрузить карточку</p>
                      <p className="text-sm text-muted-foreground">PDF, Word, Excel или изображение</p>
                    </CardContent>
                  </Card>
                </div>
              )}

              {/* Upload card */}
              {fillMode === "upload" && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">Загрузка карточки участника</CardTitle>
                    <CardDescription>Загрузите карточку организации — данные будут извлечены автоматически</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <label className="flex flex-col items-center gap-3 rounded-lg border-2 border-dashed p-8 cursor-pointer hover:border-primary/50 transition-colors">
                      {parsing ? (
                        <>
                          <Loader2 className="h-8 w-8 animate-spin text-primary" />
                          <span className="text-sm text-muted-foreground">Обработка документа...</span>
                        </>
                      ) : (
                        <>
                          <Upload className="h-8 w-8 text-muted-foreground" />
                          <span className="text-sm text-muted-foreground">Нажмите или перетащите файл</span>
                          <span className="text-xs text-muted-foreground">PDF, DOCX, XLSX, JPG, PNG</span>
                        </>
                      )}
                      <input type="file" className="hidden" accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.webp" onChange={handleCardUpload} disabled={parsing} />
                    </label>
                  </CardContent>
                </Card>
              )}

              {/* Requisites form — show when fillMode is set or company found */}
              {(fillMode || foundCompany) && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">Реквизиты организации</CardTitle>
                    <CardDescription>Проверьте и при необходимости скорректируйте данные</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    {/* Basic info */}
                    <div className="space-y-4">
                      <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">Основные данные</h3>
                      <div className="grid gap-4 sm:grid-cols-2">
                        <div className="space-y-2">
                          <Label htmlFor="inn">ИНН *</Label>
                          <Input id="inn" value={company.inn} onChange={e => updateField("inn", e.target.value.replace(/\D/g, "").slice(0, requiredInnLength))} maxLength={requiredInnLength} />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="kpp">КПП</Label>
                          <Input id="kpp" value={company.kpp} onChange={e => updateField("kpp", e.target.value.replace(/\D/g, "").slice(0, 9))} maxLength={9} />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="ogrn">ОГРН</Label>
                          <Input id="ogrn" value={company.ogrn} onChange={e => updateField("ogrn", e.target.value.replace(/\D/g, "").slice(0, 15))} maxLength={15} />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="okved">Основной ОКВЭД</Label>
                          <Input id="okved" value={company.okved} onChange={e => updateField("okved", e.target.value)} placeholder="00.00" />
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="full_name">Полное наименование *</Label>
                        <Input id="full_name" value={company.full_name} onChange={e => updateField("full_name", e.target.value)} />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="short_name">Сокращённое наименование</Label>
                        <Input id="short_name" value={company.short_name} onChange={e => updateField("short_name", e.target.value)} />
                      </div>
                    </div>

                    {/* Address */}
                    <div className="space-y-4">
                      <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">Адреса</h3>
                      <div className="space-y-2">
                        <Label htmlFor="legal_address">Юридический адрес</Label>
                        <Input id="legal_address" value={company.legal_address} onChange={e => updateField("legal_address", e.target.value)} />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="actual_address">Фактический адрес</Label>
                        <Input id="actual_address" value={company.actual_address} onChange={e => updateField("actual_address", e.target.value)} />
                      </div>
                    </div>

                    {/* Director */}
                    <div className="space-y-4">
                      <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">Руководитель</h3>
                      <div className="grid gap-4 sm:grid-cols-2">
                        <div className="space-y-2">
                          <Label htmlFor="director_name">ФИО руководителя</Label>
                          <Input id="director_name" value={company.director_name} onChange={e => updateField("director_name", e.target.value)} />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="director_position">Должность</Label>
                          <Input id="director_position" value={company.director_position} onChange={e => updateField("director_position", e.target.value)} placeholder="Генеральный директор" />
                        </div>
                      </div>
                    </div>

                    {/* Contacts */}
                    <div className="space-y-4">
                      <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">Контакты</h3>
                      <div className="grid gap-4 sm:grid-cols-2">
                        <div className="space-y-2">
                          <Label htmlFor="phone">Телефон</Label>
                          <Input id="phone" value={company.phone} onChange={e => updateField("phone", e.target.value)} placeholder="+7 (___) ___-__-__" />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="email">Email</Label>
                          <Input id="email" type="email" value={company.email} onChange={e => updateField("email", e.target.value)} />
                        </div>
                      </div>
                    </div>

                    {/* Bank details */}
                    <div className="space-y-4">
                      <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">Банковские реквизиты</h3>
                      <div className="grid gap-4 sm:grid-cols-2">
                        <div className="space-y-2">
                          <Label htmlFor="bank_name">Наименование банка</Label>
                          <Input id="bank_name" value={company.bank_name} onChange={e => updateField("bank_name", e.target.value)} />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="bank_bik">БИК</Label>
                          <Input id="bank_bik" value={company.bank_bik} onChange={e => updateField("bank_bik", e.target.value.replace(/\D/g, "").slice(0, 9))} maxLength={9} />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="bank_account">Расчётный счёт</Label>
                          <Input id="bank_account" value={company.bank_account} onChange={e => updateField("bank_account", e.target.value.replace(/\D/g, "").slice(0, 20))} maxLength={20} />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="bank_corr_account">Корреспондентский счёт</Label>
                          <Input id="bank_corr_account" value={company.bank_corr_account} onChange={e => updateField("bank_corr_account", e.target.value.replace(/\D/g, "").slice(0, 20))} maxLength={20} />
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          </TabsContent>

          {/* Tab 3: VAT & Summary */}
          <TabsContent value="vat">
            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Система налогообложения и НДС</CardTitle>
                  <CardDescription>Выберите вашу систему налогообложения и применимую ставку НДС</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label>Система налогообложения</Label>
                    <Select value={company.tax_system} onValueChange={v => updateField("tax_system", v)}>
                      <SelectTrigger>
                        <SelectValue placeholder="Выберите систему" />
                      </SelectTrigger>
                      <SelectContent>
                        {taxSystems.map(ts => (
                          <SelectItem key={ts.value} value={ts.value}>{ts.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Ставка НДС</Label>
                    <Select value={company.vat_rate} onValueChange={v => updateField("vat_rate", v)}>
                      <SelectTrigger>
                        <SelectValue placeholder="Выберите ставку НДС" />
                      </SelectTrigger>
                      <SelectContent>
                        {vatOptions.map(vo => (
                          <SelectItem key={vo.value} value={vo.value}>{vo.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* VAT info card */}
                  {company.tax_system && (
                    <Card className="bg-muted/30">
                      <CardContent className="pt-4 text-sm space-y-1">
                        {company.tax_system === "osno" && <p>ОСНО: применяются основные ставки 22%, 10% или 0% с правом вычетов.</p>}
                        {(company.tax_system === "usn_income" || company.tax_system === "usn_income_expense") && (
                          <p>УСН: при доходах до 20 млн — освобождение от НДС. Свыше — выбор между общими ставками (22/10/0) или спецставками (5%/7%) без обычных вычетов.</p>
                        )}
                        {company.tax_system === "eshn" && <p>ЕСХН: при доходах свыше 60 млн — плательщик НДС. Возможно освобождение по ст. 145 НК РФ.</p>}
                        {company.tax_system === "patent" && <p>ПСН: НДС не уплачивается по видам деятельности на патенте (кроме импорта).</p>}
                        {company.tax_system === "npd" && <p>НПД (самозанятый): НДС не возникает по операциям внутри РФ.</p>}
                        {company.tax_system === "ausn" && <p>АУСН: НДС не уплачивается (кроме импорта/налогового агента).</p>}
                      </CardContent>
                    </Card>
                  )}
                </CardContent>
              </Card>

              {/* Summary card */}
              {company.full_name && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">Итог — данные участника</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3 text-sm">
                    <div className="grid gap-2 sm:grid-cols-2">
                      {company.full_name && <div><span className="text-muted-foreground">Наименование:</span> {company.full_name}</div>}
                      {company.inn && <div><span className="text-muted-foreground">ИНН:</span> {company.inn}</div>}
                      {company.kpp && <div><span className="text-muted-foreground">КПП:</span> {company.kpp}</div>}
                      {company.ogrn && <div><span className="text-muted-foreground">ОГРН:</span> {company.ogrn}</div>}
                      {company.director_name && <div><span className="text-muted-foreground">Руководитель:</span> {company.director_name}</div>}
                      {company.phone && <div><span className="text-muted-foreground">Телефон:</span> {company.phone}</div>}
                      {company.email && <div><span className="text-muted-foreground">Email:</span> {company.email}</div>}
                      {company.vat_rate && <div><span className="text-muted-foreground">НДС:</span> {vatOptions.find(v => v.value === company.vat_rate)?.label}</div>}
                      {company.tax_system && <div><span className="text-muted-foreground">Налогообложение:</span> {taxSystems.find(t => t.value === company.tax_system)?.label}</div>}
                    </div>
                    <div className="pt-4">
                      <Button onClick={saveCompany} disabled={saving} className="gap-2">
                        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : saved ? <CheckCircle2 className="h-4 w-4" /> : null}
                        {saved ? "Сохранено" : "Сохранить в базу"}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          </TabsContent>
        </Tabs>

        {/* Bottom navigation */}
        <div className="flex justify-between pt-4 border-t">
          <Link to={`/analysis/${id}/documents?type=${participantType}`}>
            <Button variant="outline" className="gap-2">
              <ArrowLeft className="h-4 w-4" />
              Назад к документам
            </Button>
          </Link>
        </div>
      </div>
    </AppLayout>
  );
};

export default BidPreparation;
