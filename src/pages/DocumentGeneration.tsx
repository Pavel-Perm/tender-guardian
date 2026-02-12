import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, Link, useSearchParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { AppLayout } from "@/components/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import {
  ArrowLeft, ArrowRight, FileText, Loader2, Download, Eye, CheckCircle2,
  AlertCircle, FileDown, Pencil, Check, X, SkipForward, Save, PackageCheck, Archive
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { Document, Packer, Paragraph, TextRun, AlignmentType } from "docx";
import { saveAs } from "file-saver";
import JSZip from "jszip";
import { formatCurrency, numberToWordsRubles } from "@/lib/numberToWords";

type GeneratedDocument = {
  title: string;
  sections: { heading: string; content: string }[];
  signature_block: string;
};

type DocState = {
  name: string;
  status: "idle" | "generating" | "done" | "skipped" | "not_required" | "error";
  document?: GeneratedDocument;
  error?: string;
  editedSections?: { heading: string; content: string }[];
  editedSignature?: string;
};

type WizardStep = "steps" | "summary";

const DocumentGeneration = () => {
   const { id } = useParams<{ id: string }>();
   const [searchParams] = useSearchParams();
   const navigate = useNavigate();
   const participantType = searchParams.get("type") || "enterprise";
   const { toast } = useToast();
   const { user } = useAuth();

   // Функция для определения, требует ли документ выписку из ЕГРИП/ЕГРИЮ
   const isEGRIPDocument = (docName: string): boolean => {
     const lowerName = docName.toLowerCase();
     return (
       lowerName.includes("выписка из егрип") ||
       lowerName.includes("выписка из егрю") ||
       lowerName.includes("копия выписки из егрип") ||
       lowerName.includes("копия выписки из егрю")
     );
   };

  const [loading, setLoading] = useState(true);
  const [docStates, setDocStates] = useState<DocState[]>([]);
  const [companyData, setCompanyData] = useState<any>(null);
  const [bidAmountData, setBidAmountData] = useState<any>(null);
  const [tenderContext, setTenderContext] = useState("");
  const [analysisTitle, setAnalysisTitle] = useState("");

  // Wizard state
  const [currentStep, setCurrentStep] = useState(0);
  const [wizardPhase, setWizardPhase] = useState<WizardStep>("steps");

  // Edit mode for preview
  const [editMode, setEditMode] = useState(false);
  const [editSections, setEditSections] = useState<{ heading: string; content: string }[]>([]);
  const [editSignature, setEditSignature] = useState("");

  // Editable amount
  const [editingAmount, setEditingAmount] = useState(false);
  const [editAmount, setEditAmount] = useState("");

  const dataLoadedRef = useRef(false);

  useEffect(() => {
    if (dataLoadedRef.current) return;
    const fetchData = async () => {
      if (!id || !user) return;

      const [docsRes, resultsRes, analysisRes, companyRes, bidAmountRes, savedDocsRes] = await Promise.all([
        supabase.from("analysis_required_documents").select("category, documents").eq("analysis_id", id),
        supabase.from("analysis_results").select("block_name, details, risk_description").eq("analysis_id", id).order("block_order"),
        supabase.from("analyses").select("title, procurement_type").eq("id", id).single(),
        supabase.from("companies").select("*").eq("user_id", user.id).order("updated_at", { ascending: false }).limit(1).maybeSingle(),
        supabase.from("bid_amounts").select("*").eq("analysis_id", id).maybeSingle(),
        supabase.from("generated_documents").select("*").eq("analysis_id", id).eq("participant_type", participantType),
      ]);

      if (analysisRes.data) setAnalysisTitle(analysisRes.data.title);

      const categoryDocs = docsRes.data?.find(d => d.category === participantType);
      const docs = (categoryDocs?.documents as string[]) || [];

      // Merge with saved documents from DB
      const savedMap = new Map<string, any>();
      if (savedDocsRes.data) {
        for (const sd of savedDocsRes.data) {
          savedMap.set(sd.doc_name, sd);
        }
      }

      setDocStates(docs.map(name => {
        const saved = savedMap.get(name);
        if (saved && (saved.status === "done" || saved.status === "skipped" || saved.status === "not_required")) {
          const docState: DocState = {
            name,
            status: saved.status as DocState["status"],
          };
          if (saved.status === "done" && saved.title && saved.sections) {
            docState.document = {
              title: saved.title,
              sections: saved.sections as { heading: string; content: string }[],
              signature_block: saved.signature_block || "",
            };
          }
          return docState;
        }
        return { name, status: "idle" as const };
      }));

      if (resultsRes.data) {
        const context = resultsRes.data
          .filter(r => r.details)
          .map(r => `${r.block_name}: ${r.details}`)
          .join("\n");
        setTenderContext(context);
      }

      if (companyRes.data) setCompanyData({ ...companyRes.data, participantType });
      if (bidAmountRes.data) setBidAmountData(bidAmountRes.data);

      dataLoadedRef.current = true;
      setLoading(false);
    };
    fetchData();
  }, [id, user, participantType]);

  // Save document state to DB
  const saveDocToDb = useCallback(async (docState: DocState) => {
    if (!id || !user) return;
    const sections = docState.editedSections || docState.document?.sections || [];
    const signature = docState.editedSignature || docState.document?.signature_block || "";
    const title = docState.document?.title || "";

    await supabase.from("generated_documents").upsert({
      analysis_id: id,
      user_id: user.id,
      doc_name: docState.name,
      participant_type: participantType,
      status: docState.status,
      title,
      sections: sections as any,
      signature_block: signature,
    }, { onConflict: "analysis_id,participant_type,doc_name" });
  }, [id, user, participantType]);

  const generateDocument = useCallback(async (docIndex: number) => {
    let docName = "";
    setDocStates(prev => {
      docName = prev[docIndex].name;
      return prev.map((d, i) => i === docIndex ? { ...d, status: "generating" } : d);
    });

    try {
      const { data, error } = await supabase.functions.invoke("generate-bid-documents", {
        body: {
          analysisId: id,
          documentName: docName,
          companyData,
          tenderContext: tenderContext.slice(0, 10000),
          bidAmountData,
        },
      });

      if (error) {
        let errMsg = "Ошибка генерации";
        try { if (data?.error) errMsg = data.error; } catch {}
        throw new Error(errMsg);
      }

      if (data?.document) {
        const newDocState: DocState = { name: docName, status: "done", document: data.document };
        setDocStates(prev => prev.map((d, i) => i === docIndex ? newDocState : d));
        // Save to DB
        saveDocToDb(newDocState);
      } else {
        throw new Error("Пустой ответ от AI");
      }
    } catch (err: any) {
      setDocStates(prev => prev.map((d, i) => i === docIndex ? { ...d, status: "error", error: err.message } : d));
      toast({ title: "Ошибка", description: err.message, variant: "destructive" });
    }
  }, [id, companyData, tenderContext, bidAmountData, toast, saveDocToDb]);

  // Amount edit
  const startEditAmount = () => {
    setEditAmount(bidAmountData?.amount?.toString() || "");
    setEditingAmount(true);
  };
  const cancelEditAmount = () => { setEditingAmount(false); setEditAmount(""); };
  const saveEditAmount = () => {
    const newAmount = parseFloat(editAmount);
    if (isNaN(newAmount) || newAmount <= 0) {
      toast({ title: "Ошибка", description: "Введите корректную сумму", variant: "destructive" });
      return;
    }
    const vatRate = bidAmountData?.vat_rate || "20%";
    let vatAmount = 0;
    let totalWithVat = newAmount;
    if (vatRate !== "Без НДС") {
      const rate = parseFloat(vatRate) / 100;
      vatAmount = Math.round((newAmount * rate / (1 + rate)) * 100) / 100;
      totalWithVat = newAmount;
    }
    const updatedBid = {
      ...bidAmountData,
      amount: newAmount,
      vat_amount: vatAmount,
      total_with_vat: totalWithVat,
      amount_words: numberToWordsRubles(newAmount),
      vat_amount_words: numberToWordsRubles(vatAmount),
      total_words: numberToWordsRubles(totalWithVat),
    };
    setBidAmountData(updatedBid);
    setEditingAmount(false);
    setDocStates(prev => prev.map(d => ({ ...d, status: "idle", document: undefined, error: undefined })));
    // Clear saved docs from DB when amount changes
    if (id) {
      supabase.from("generated_documents").delete().eq("analysis_id", id).eq("participant_type", participantType);
    }
    toast({ title: "Сумма обновлена", description: `Новая сумма: ${formatCurrency(newAmount)}. Перегенерируйте документы.` });
  };

  // Edit document content
  const startEdit = (doc: DocState) => {
    const sections = doc.editedSections || doc.document?.sections || [];
    setEditSections(sections.map(s => ({ ...s })));
    setEditSignature(doc.editedSignature || doc.document?.signature_block || "");
    setEditMode(true);
  };

  const saveEdit = () => {
    let updatedDoc: DocState | null = null;
    setDocStates(prev => prev.map((d, i) => {
      if (i !== currentStep) return d;
      updatedDoc = {
        ...d,
        editedSections: editSections,
        editedSignature: editSignature,
      };
      return updatedDoc;
    }));
    setEditMode(false);
    toast({ title: "Сохранено", description: "Изменения сохранены" });
    // Persist to DB
    if (updatedDoc) saveDocToDb(updatedDoc);
  };

  const skipDocument = () => {
    const skippedDoc: DocState = { ...docStates[currentStep], status: "skipped" };
    setDocStates(prev => prev.map((d, i) => i === currentStep ? skippedDoc : d));
    saveDocToDb(skippedDoc);
  };

  const markNotRequired = () => {
    const notReqDoc: DocState = { ...docStates[currentStep], status: "not_required" };
    setDocStates(prev => prev.map((d, i) => i === currentStep ? notReqDoc : d));
    saveDocToDb(notReqDoc);
  };

  const goNext = () => {
    // Проверяем, выбран ли вариант "создать" или "пропустить"
    const currentDoc = docStates[currentStep];
    if (currentDoc.status !== "done" && currentDoc.status !== "skipped" && currentDoc.status !== "not_required") {
      return; // Не переходим, если статус не выбран
    }

    if (currentStep < docStates.length - 1) {
      setCurrentStep(currentStep + 1);
      setEditMode(false);
    } else {
      setWizardPhase("summary");
      setEditMode(false);
    }
  };

  const goPrev = () => {
    if (wizardPhase === "summary") {
      setWizardPhase("steps");
      setCurrentStep(docStates.length - 1);
    } else if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
      setEditMode(false);
    }
  };

  // DOCX building helper
  const buildDocxBlob = async (doc: DocState): Promise<Blob> => {
    const gd = doc.document!;
    const sections = doc.editedSections || gd.sections;
    const sigBlock = doc.editedSignature || gd.signature_block;
    const children: Paragraph[] = [];

    children.push(new Paragraph({
      children: [new TextRun({ text: gd.title, bold: true, size: 28, font: "Times New Roman" })],
      alignment: AlignmentType.CENTER,
      spacing: { after: 300 },
    }));

    for (const section of sections) {
      if (section.heading) {
        children.push(new Paragraph({
          children: [new TextRun({ text: section.heading, bold: true, size: 24, font: "Times New Roman" })],
          spacing: { before: 200, after: 100 },
        }));
      }
      for (const line of section.content.split("\n")) {
        children.push(new Paragraph({
          children: [new TextRun({ text: line, size: 24, font: "Times New Roman" })],
          spacing: { after: 60 },
        }));
      }
    }

    if (sigBlock) {
      children.push(new Paragraph({ spacing: { before: 400 } }));
      for (const line of sigBlock.split("\n")) {
        children.push(new Paragraph({
          children: [new TextRun({ text: line, size: 24, font: "Times New Roman" })],
          spacing: { after: 60 },
        }));
      }
    }

    const docx = new Document({
      sections: [{ properties: { page: { margin: { top: 1134, bottom: 1134, left: 1701, right: 850 } } }, children }],
    });
    return Packer.toBlob(docx);
  };

  const downloadDocx = async (doc: DocState) => {
    const blob = await buildDocxBlob(doc);
    const safeName = doc.document!.title.replace(/[^a-zA-Zа-яА-Я0-9\s]/g, "").trim().slice(0, 50) || "document";
    saveAs(blob, `${safeName}.docx`);
  };

  const downloadAllZip = async () => {
    const doneDocs = docStates.filter(d => d.status === "done" && d.document);
    if (doneDocs.length === 0) return;

    const zip = new JSZip();
    for (const doc of doneDocs) {
      const blob = await buildDocxBlob(doc);
      const safeName = doc.document!.title.replace(/[^a-zA-Zа-яА-Я0-9\s]/g, "").trim().slice(0, 50) || "document";
      zip.file(`${safeName}.docx`, blob);
    }
    const zipBlob = await zip.generateAsync({ type: "blob" });
    saveAs(zipBlob, `Документы_${analysisTitle.slice(0, 30)}.zip`);
  };

  const finishWizard = () => {
    navigate("/dashboard");
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

  const doneCount = docStates.filter(d => d.status === "done").length;
  const skippedCount = docStates.filter(d => d.status === "skipped").length;
  const notRequiredCount = docStates.filter(d => d.status === "not_required").length;
  const totalDocs = docStates.length;
  const currentDoc = docStates[currentStep];
  const progressPercent = totalDocs > 0 ? ((currentStep + (wizardPhase === "summary" ? 1 : 0)) / totalDocs) * 100 : 0;

  // Get the display sections (edited or original)
  const getDisplaySections = (doc: DocState) => doc.editedSections || doc.document?.sections || [];
  const getDisplaySignature = (doc: DocState) => doc.editedSignature || doc.document?.signature_block || "";

  return (
    <AppLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" onClick={goPrev} disabled={currentStep === 0 && wizardPhase === "steps"}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="flex-1">
            <h1 className="text-2xl font-bold">Генерация документов</h1>
            <p className="text-muted-foreground text-sm">{analysisTitle}</p>
          </div>
          <Badge variant="secondary">
            {wizardPhase === "summary" ? "Итого" : `${currentStep + 1} / ${totalDocs}`}
          </Badge>
        </div>

        {/* Progress bar */}
        <Progress value={wizardPhase === "summary" ? 100 : progressPercent} className="h-2" />

        {/* Company + Amount info card */}
        {companyData && (
          <Card className="bg-muted/30">
            <CardContent className="pt-4 space-y-3">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-primary" />
                <span className="font-medium text-sm">Данные участника</span>
              </div>
              <p className="text-sm text-muted-foreground">{companyData.full_name} • ИНН {companyData.inn}</p>
              {bidAmountData && (
                <div className="flex items-center gap-2 pt-1 border-t border-border/50">
                  <span className="text-sm text-muted-foreground">Сумма заявки:</span>
                  {editingAmount ? (
                    <div className="flex items-center gap-1.5">
                      <Input
                        type="number"
                        value={editAmount}
                        onChange={(e) => setEditAmount(e.target.value)}
                        className="h-7 w-40 text-sm"
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === "Enter") saveEditAmount();
                          if (e.key === "Escape") cancelEditAmount();
                        }}
                      />
                      <span className="text-sm text-muted-foreground">₽</span>
                      <Button size="icon" variant="ghost" className="h-6 w-6" onClick={saveEditAmount}>
                        <Check className="h-3.5 w-3.5 text-primary" />
                      </Button>
                      <Button size="icon" variant="ghost" className="h-6 w-6" onClick={cancelEditAmount}>
                        <X className="h-3.5 w-3.5 text-muted-foreground" />
                      </Button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm font-medium">{formatCurrency(Number(bidAmountData.amount))}</span>
                      {bidAmountData.vat_rate !== "Без НДС" && (
                        <span className="text-xs text-muted-foreground">(вкл. НДС {bidAmountData.vat_rate})</span>
                      )}
                      <Button size="icon" variant="ghost" className="h-6 w-6" onClick={startEditAmount}>
                        <Pencil className="h-3 w-3 text-muted-foreground" />
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {!companyData && (
          <Card className="border-amber-300 bg-amber-50 dark:bg-amber-950/30">
            <CardContent className="pt-4 flex items-center gap-3">
              <AlertCircle className="h-5 w-5 text-amber-600" />
              <div>
                <p className="font-medium text-sm">Данные участника не найдены</p>
                <p className="text-sm text-muted-foreground">Вернитесь на предыдущий шаг</p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* ============ WIZARD PHASE: STEPS ============ */}
        {wizardPhase === "steps" && currentDoc && (
          <div className="space-y-4">
            {/* Current document card */}
            <Card>
              <CardContent className="pt-6 space-y-4">
                <div className="flex items-start gap-4">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-lg font-bold text-primary">
                    {currentStep + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h2 className="text-lg font-semibold">Форма №{currentStep + 1}</h2>
                    <p className="text-sm text-muted-foreground mt-1">{currentDoc.name}</p>
                    {currentDoc.status === "skipped" && (
                      <Badge variant="outline" className="mt-2 text-amber-600 border-amber-300">
                        <SkipForward className="h-3 w-3 mr-1" /> Пропущено
                      </Badge>
                    )}
                    {currentDoc.status === "not_required" && (
                      <Badge variant="outline" className="mt-2 text-muted-foreground border-muted-foreground/30">
                        <X className="h-3 w-3 mr-1" /> Не требуется
                      </Badge>
                    )}
                    {currentDoc.status === "done" && (
                      <Badge variant="outline" className="mt-2 text-primary border-primary/30">
                        <CheckCircle2 className="h-3 w-3 mr-1" /> Готов
                      </Badge>
                    )}
                    {currentDoc.status === "generating" && (
                      <Badge variant="outline" className="mt-2">
                        <Loader2 className="h-3 w-3 mr-1 animate-spin" /> Генерация...
                      </Badge>
                    )}
                    {currentDoc.status === "error" && (
                      <p className="text-xs text-destructive mt-2">{currentDoc.error}</p>
                    )}
                  </div>
                </div>

                {/* Action buttons for this document */}
                <div className="flex flex-wrap gap-2 pt-2 border-t border-border/50">
                  {/* EGRIP/EGRU Document - Show download link instead of generate */}
                  {isEGRIPDocument(currentDoc.name) && currentDoc.status !== "done" && currentDoc.status !== "skipped" && (
                    <>
                      <div className="w-full">
                        <p className="text-sm text-muted-foreground mb-2">
                          Инструкция: Перейди на сайт налоговой, введи ИНН и скачай свежую выписку
                        </p>
                      </div>
                      <a href="https://egrul.nalog.ru/index.html" target="_blank" rel="noopener noreferrer">
                        <Button className="gap-2">
                          <Download className="h-4 w-4" />
                          Скачать
                        </Button>
                      </a>
                    </>
                  )}

                  {/* Regular documents - Show create button */}
                  {!isEGRIPDocument(currentDoc.name) && (currentDoc.status === "idle" || currentDoc.status === "error" || currentDoc.status === "skipped" || currentDoc.status === "not_required") && (
                    <Button onClick={() => generateDocument(currentStep)} disabled={!companyData} className="gap-2">
                      <FileText className="h-4 w-4" />
                      Создать
                    </Button>
                  )}

                  {/* Document done - Show edit/download options (except EGRIP) */}
                  {!isEGRIPDocument(currentDoc.name) && currentDoc.status === "done" && currentDoc.document && (
                    <>
                      <Button variant="outline" onClick={() => generateDocument(currentStep)} className="gap-2">
                        <FileText className="h-4 w-4" />
                        Пересоздать
                      </Button>
                      <Button variant="outline" onClick={() => startEdit(currentDoc)} className="gap-2">
                        <Eye className="h-4 w-4" />
                        Просмотр / Редактирование
                      </Button>
                      <Button variant="outline" onClick={() => downloadDocx(currentDoc)} className="gap-2">
                        <Download className="h-4 w-4" />
                        Скачать
                      </Button>
                    </>
                  )}

                  {/* Skip button - always available for non-done documents */}
                  {currentDoc.status !== "generating" && currentDoc.status !== "done" && (
                    <>
                      <Button variant="ghost" onClick={skipDocument} className="gap-2 text-muted-foreground">
                        <SkipForward className="h-4 w-4" />
                        Пропустить (заполню сам)
                      </Button>
                      <Button variant="ghost" onClick={markNotRequired} className="gap-2 text-muted-foreground">
                        <X className="h-4 w-4" />
                        Не требуется
                      </Button>
                    </>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Edit/Preview panel */}
            {editMode && currentDoc.status === "done" && currentDoc.document && (
              <Card>
                <CardContent className="pt-6 space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold">Редактирование документа</h3>
                    <div className="flex gap-2">
                      <Button size="sm" onClick={saveEdit} className="gap-1">
                        <Save className="h-3.5 w-3.5" />
                        Сохранить
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditMode(false)}>
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                  <ScrollArea className="max-h-[50vh]">
                    <div className="space-y-4 pr-4">
                      <p className="text-sm font-medium text-center text-muted-foreground">{currentDoc.document.title}</p>
                      {editSections.map((section, idx) => (
                        <div key={idx} className="space-y-2">
                          <Input
                            value={section.heading}
                            onChange={(e) => {
                              const updated = [...editSections];
                              updated[idx] = { ...updated[idx], heading: e.target.value };
                              setEditSections(updated);
                            }}
                            placeholder="Заголовок секции"
                            className="font-semibold text-sm"
                          />
                          <Textarea
                            value={section.content}
                            onChange={(e) => {
                              const updated = [...editSections];
                              updated[idx] = { ...updated[idx], content: e.target.value };
                              setEditSections(updated);
                            }}
                            rows={Math.max(4, section.content.split("\n").length + 1)}
                            className="text-sm font-mono"
                          />
                        </div>
                      ))}
                      <div className="pt-4 border-t border-border/50 space-y-2">
                        <p className="text-sm font-medium">Блок подписи</p>
                        <Textarea
                          value={editSignature}
                          onChange={(e) => setEditSignature(e.target.value)}
                          rows={4}
                          className="text-sm font-mono"
                        />
                      </div>
                    </div>
                  </ScrollArea>
                </CardContent>
              </Card>
            )}

            {/* Preview (read-only) when not editing but doc is done */}
            {!editMode && currentDoc.status === "done" && currentDoc.document && (
              <Card className="bg-muted/20">
                <CardContent className="pt-4">
                  <ScrollArea className="max-h-[30vh]">
                    <div className="space-y-3 text-sm pr-4">
                      <p className="font-semibold text-center">{currentDoc.document.title}</p>
                      {getDisplaySections(currentDoc).map((section, idx) => (
                        <div key={idx}>
                          {section.heading && <p className="font-bold">{section.heading}</p>}
                          <div className="whitespace-pre-wrap text-muted-foreground">{section.content}</div>
                        </div>
                      ))}
                      {getDisplaySignature(currentDoc) && (
                        <div className="pt-3 border-t whitespace-pre-wrap text-muted-foreground">
                          {getDisplaySignature(currentDoc)}
                        </div>
                      )}
                    </div>
                  </ScrollArea>
                </CardContent>
              </Card>
            )}

            {/* Navigation */}
            <div className="flex justify-between pt-4 border-t">
              <Button variant="outline" onClick={goPrev} disabled={currentStep === 0} className="gap-2">
                <ArrowLeft className="h-4 w-4" />
                Назад
              </Button>
              <Button 
                onClick={goNext} 
                disabled={currentDoc.status !== "done" && currentDoc.status !== "skipped" && currentDoc.status !== "not_required"}
                className="gap-2"
              >
                {currentStep < totalDocs - 1 ? (
                  <>
                    Далее
                    <ArrowRight className="h-4 w-4" />
                  </>
                ) : (
                  <>
                    К итогам
                    <PackageCheck className="h-4 w-4" />
                  </>
                )}
              </Button>
            </div>
          </div>
        )}

        {/* ============ WIZARD PHASE: SUMMARY ============ */}
        {wizardPhase === "summary" && (
          <div className="space-y-4">
            <Card>
              <CardContent className="pt-6 space-y-2">
                <h2 className="text-lg font-semibold flex items-center gap-2">
                  <PackageCheck className="h-5 w-5 text-primary" />
                  Итоговый пакет документов
                </h2>
                <p className="text-sm text-muted-foreground">
                  Из {totalDocs} документов: Заполнено: {doneCount} Пропущено: {skippedCount} Не требуется: {notRequiredCount}
                </p>
              </CardContent>
            </Card>

            <div className="space-y-2">
              {docStates.map((doc, idx) => (
                <Card key={idx} className={doc.status === "done" ? "border-primary/30" : doc.status === "skipped" ? "border-amber-300/30" : doc.status === "not_required" ? "border-muted-foreground/20" : ""}>
                  <CardContent className="py-3 flex items-center gap-3">
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                      {idx + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{doc.name}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {doc.status === "done" && (
                        <>
                          <Badge variant="outline" className="text-primary border-primary/30 text-xs">
                            <CheckCircle2 className="h-3 w-3 mr-1" /> Заполнено
                          </Badge>
                          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => {
                            setWizardPhase("steps");
                            setCurrentStep(idx);
                          }}>
                            <Eye className="h-3.5 w-3.5" />
                          </Button>
                          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => downloadDocx(doc)}>
                            <Download className="h-3.5 w-3.5" />
                          </Button>
                        </>
                      )}
                      {doc.status === "skipped" && (
                        <>
                          <Badge variant="outline" className="text-amber-600 border-amber-300 text-xs">
                            <SkipForward className="h-3 w-3 mr-1" /> Сам заполню
                          </Badge>
                          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => {
                            setWizardPhase("steps");
                            setCurrentStep(idx);
                          }}>
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                        </>
                      )}
                      {doc.status === "not_required" && (
                        <>
                          <Badge variant="outline" className="text-muted-foreground border-muted-foreground/30 text-xs">
                            <X className="h-3 w-3 mr-1" /> Не требуется
                          </Badge>
                          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => {
                            setWizardPhase("steps");
                            setCurrentStep(idx);
                          }}>
                            <Pencil className="h-3.5 w-3.5 mr-1" />
                            Изменить
                          </Button>
                        </>
                      )}
                      {(doc.status === "idle" || doc.status === "error") && (
                        <>
                          <Badge variant="outline" className="text-muted-foreground text-xs">Не заполнено</Badge>
                          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => {
                            setWizardPhase("steps");
                            setCurrentStep(idx);
                          }}>
                            <FileText className="h-3.5 w-3.5" />
                          </Button>
                        </>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* Download actions */}
            <div className="flex flex-wrap gap-3 pt-2">
              {doneCount > 0 && (
                <>
                  <Button variant="outline" onClick={downloadAllZip} className="gap-2">
                    <Archive className="h-4 w-4" />
                    Скачать всё (ZIP)
                  </Button>
                </>
              )}
            </div>

            {/* Bottom: Finish */}
            <div className="flex justify-between pt-4 border-t">
              <Button variant="outline" onClick={goPrev} className="gap-2">
                <ArrowLeft className="h-4 w-4" />
                Назад
              </Button>
              <Button onClick={finishWizard} className="gap-2">
                <CheckCircle2 className="h-4 w-4" />
                Завершить
              </Button>
            </div>
          </div>
        )}

        {totalDocs === 0 && (
          <Card>
            <CardContent className="py-12 text-center space-y-3">
              <FileText className="h-10 w-10 mx-auto text-muted-foreground" />
              <p className="font-medium">Нет документов для генерации</p>
              <p className="text-sm text-muted-foreground">Для выбранного типа участника не найдены требуемые документы</p>
            </CardContent>
          </Card>
        )}
      </div>
    </AppLayout>
  );
};

export default DocumentGeneration;
