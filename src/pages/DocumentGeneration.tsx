import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, Link, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { AppLayout } from "@/components/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ArrowLeft, FileText, Loader2, Download, Eye, CheckCircle2, AlertCircle, FileDown, Pencil, Check, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { Document, Packer, Paragraph, TextRun, AlignmentType } from "docx";
import { saveAs } from "file-saver";
import { formatCurrency, numberToWordsRubles } from "@/lib/numberToWords";

type GeneratedDocument = {
  title: string;
  sections: { heading: string; content: string }[];
  signature_block: string;
};

type DocState = {
  name: string;
  status: "idle" | "generating" | "done" | "error";
  document?: GeneratedDocument;
  error?: string;
};

const DocumentGeneration = () => {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const participantType = searchParams.get("type") || "enterprise";
  const { toast } = useToast();
  const { user } = useAuth();

  const [loading, setLoading] = useState(true);
  const [requiredDocs, setRequiredDocs] = useState<string[]>([]);
  const [docStates, setDocStates] = useState<DocState[]>([]);
  const [companyData, setCompanyData] = useState<any>(null);
  const [bidAmountData, setBidAmountData] = useState<any>(null);
  const [tenderContext, setTenderContext] = useState("");
  const [analysisTitle, setAnalysisTitle] = useState("");
  const [previewDoc, setPreviewDoc] = useState<DocState | null>(null);
  const [generatingAll, setGeneratingAll] = useState(false);

  // Editable amount state
  const [editingAmount, setEditingAmount] = useState(false);
  const [editAmount, setEditAmount] = useState("");

  // Prevent useEffect from resetting generated docs
  const dataLoadedRef = useRef(false);

  useEffect(() => {
    if (dataLoadedRef.current) return; // Don't re-run and reset state
    const fetchData = async () => {
      if (!id || !user) return;
      
      const [docsRes, resultsRes, analysisRes, companyRes, bidAmountRes] = await Promise.all([
        supabase.from("analysis_required_documents").select("category, documents").eq("analysis_id", id),
        supabase.from("analysis_results").select("block_name, details, risk_description").eq("analysis_id", id).order("block_order"),
        supabase.from("analyses").select("title, procurement_type").eq("id", id).single(),
        supabase.from("companies").select("*").eq("user_id", user.id).order("updated_at", { ascending: false }).limit(1).maybeSingle(),
        supabase.from("bid_amounts").select("*").eq("analysis_id", id).maybeSingle(),
      ]);

      if (analysisRes.data) setAnalysisTitle(analysisRes.data.title);

      const categoryDocs = docsRes.data?.find(d => d.category === participantType);
      const docs = (categoryDocs?.documents as string[]) || [];
      setRequiredDocs(docs);
      setDocStates(docs.map(name => ({ name, status: "idle" })));

      if (resultsRes.data) {
        const context = resultsRes.data
          .filter(r => r.details)
          .map(r => `${r.block_name}: ${r.details}`)
          .join("\n");
        setTenderContext(context);
      }

      if (companyRes.data) {
        setCompanyData({ ...companyRes.data, participantType });
      }
      if (bidAmountRes.data) {
        setBidAmountData(bidAmountRes.data);
      }

      dataLoadedRef.current = true;
      setLoading(false);
    };
    fetchData();
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
        setDocStates(prev => prev.map((d, i) => i === docIndex ? { ...d, status: "done", document: data.document } : d));
      } else {
        throw new Error("Пустой ответ от AI");
      }
    } catch (err: any) {
      setDocStates(prev => prev.map((d, i) => i === docIndex ? { ...d, status: "error", error: err.message } : d));
      toast({ title: "Ошибка", description: err.message, variant: "destructive" });
    }
  }, [id, companyData, tenderContext, bidAmountData, toast]);

  const generateAll = async () => {
    setGeneratingAll(true);
    for (let i = 0; i < docStates.length; i++) {
      if (docStates[i].status !== "done") {
        await generateDocument(i);
      }
    }
    setGeneratingAll(false);
    toast({ title: "Готово", description: "Все документы сгенерированы" });
  };

  // Quick amount edit handlers
  const startEditAmount = () => {
    setEditAmount(bidAmountData?.amount?.toString() || "");
    setEditingAmount(true);
  };

  const cancelEditAmount = () => {
    setEditingAmount(false);
    setEditAmount("");
  };

  const saveEditAmount = () => {
    const newAmount = parseFloat(editAmount);
    if (isNaN(newAmount) || newAmount <= 0) {
      toast({ title: "Ошибка", description: "Введите корректную сумму", variant: "destructive" });
      return;
    }

    // Recalculate VAT based on the same vat_rate
    const vatRate = bidAmountData?.vat_rate || "20%";
    let vatAmount = 0;
    let totalWithVat = newAmount;

    if (vatRate === "Без НДС") {
      vatAmount = 0;
      totalWithVat = newAmount;
    } else {
      const rate = parseFloat(vatRate) / 100;
      // НДС включен в сумму
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

    // Reset generated docs since amount changed
    setDocStates(prev => prev.map(d => ({ ...d, status: "idle", document: undefined, error: undefined })));

    toast({ title: "Сумма обновлена", description: `Новая сумма: ${formatCurrency(newAmount)}. Перегенерируйте документы.` });
  };

  const downloadDocx = async (doc: GeneratedDocument) => {
    const children: Paragraph[] = [];

    children.push(new Paragraph({
      children: [new TextRun({ text: doc.title, bold: true, size: 28, font: "Times New Roman" })],
      alignment: AlignmentType.CENTER,
      spacing: { after: 300 },
    }));

    for (const section of doc.sections) {
      if (section.heading) {
        children.push(new Paragraph({
          children: [new TextRun({ text: section.heading, bold: true, size: 24, font: "Times New Roman" })],
          spacing: { before: 200, after: 100 },
        }));
      }
      const lines = section.content.split("\n");
      for (const line of lines) {
        children.push(new Paragraph({
          children: [new TextRun({ text: line, size: 24, font: "Times New Roman" })],
          spacing: { after: 60 },
        }));
      }
    }

    if (doc.signature_block) {
      children.push(new Paragraph({ spacing: { before: 400 } }));
      const sigLines = doc.signature_block.split("\n");
      for (const line of sigLines) {
        children.push(new Paragraph({
          children: [new TextRun({ text: line, size: 24, font: "Times New Roman" })],
          spacing: { after: 60 },
        }));
      }
    }

    const docx = new Document({
      sections: [{ properties: { page: { margin: { top: 1134, bottom: 1134, left: 1701, right: 850 } } }, children }],
    });

    const blob = await Packer.toBlob(docx);
    const safeName = doc.title.replace(/[^a-zA-Zа-яА-Я0-9\s]/g, "").trim().slice(0, 50) || "document";
    saveAs(blob, `${safeName}.docx`);
  };

  const downloadAll = async () => {
    const doneDocs = docStates.filter(d => d.status === "done" && d.document);
    for (const d of doneDocs) {
      await downloadDocx(d.document!);
    }
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

  return (
    <AppLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center gap-4">
          <Link to={`/analysis/${id}/bid-amount?type=${participantType}`}>
            <Button variant="ghost" size="sm">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div className="flex-1">
            <h1 className="text-2xl font-bold">Генерация документов</h1>
            <p className="text-muted-foreground text-sm">{analysisTitle}</p>
          </div>
          <Badge variant="secondary">{doneCount} / {docStates.length}</Badge>
        </div>

        {/* Company + Amount info card */}
        {companyData && (
          <Card className="bg-muted/30">
            <CardContent className="pt-4 space-y-3">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-primary" />
                <span className="font-medium text-sm">Данные участника загружены</span>
              </div>
              <p className="text-sm text-muted-foreground">{companyData.full_name} • ИНН {companyData.inn}</p>
              
              {/* Bid amount display/edit */}
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
                <p className="text-sm text-muted-foreground">Вернитесь на предыдущий шаг и сохраните реквизиты в базу</p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Action buttons */}
        <div className="flex gap-3">
          <Button onClick={generateAll} disabled={generatingAll || !companyData} className="gap-2">
            {generatingAll ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
            Сгенерировать все документы
          </Button>
          {doneCount > 0 && (
            <Button variant="outline" onClick={downloadAll} className="gap-2">
              <FileDown className="h-4 w-4" />
              Скачать все ({doneCount})
            </Button>
          )}
        </div>

        {/* Documents list */}
        <div className="space-y-3">
          {docStates.map((doc, idx) => (
            <Card key={idx} className={doc.status === "done" ? "border-primary/30" : ""}>
              <CardContent className="py-4 flex items-center gap-4">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">
                  {idx + 1}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{doc.name}</p>
                  {doc.status === "generating" && (
                    <p className="text-xs text-muted-foreground flex items-center gap-1 mt-1">
                      <Loader2 className="h-3 w-3 animate-spin" /> Генерация...
                    </p>
                  )}
                  {doc.status === "done" && (
                    <p className="text-xs text-primary flex items-center gap-1 mt-1">
                      <CheckCircle2 className="h-3 w-3" /> Готов
                    </p>
                  )}
                  {doc.status === "error" && (
                    <p className="text-xs text-destructive mt-1">{doc.error}</p>
                  )}
                </div>
                <div className="flex gap-2 shrink-0">
                  {doc.status === "idle" || doc.status === "error" ? (
                    <Button size="sm" variant="outline" onClick={() => generateDocument(idx)} disabled={!companyData || generatingAll}>
                      <FileText className="h-4 w-4 mr-1" />
                      Создать
                    </Button>
                  ) : null}
                  {doc.status === "done" && doc.document && (
                    <>
                      <Button size="sm" variant="ghost" onClick={() => setPreviewDoc(doc)}>
                        <Eye className="h-4 w-4" />
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => downloadDocx(doc.document!)}>
                        <Download className="h-4 w-4" />
                      </Button>
                    </>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {requiredDocs.length === 0 && (
          <Card>
            <CardContent className="py-12 text-center space-y-3">
              <FileText className="h-10 w-10 mx-auto text-muted-foreground" />
              <p className="font-medium">Нет документов для генерации</p>
              <p className="text-sm text-muted-foreground">Для выбранного типа участника не найдены требуемые документы</p>
            </CardContent>
          </Card>
        )}

        {/* Bottom navigation */}
        <div className="flex justify-between pt-4 border-t">
          <Link to={`/analysis/${id}/bid-amount?type=${participantType}`}>
            <Button variant="outline" className="gap-2">
              <ArrowLeft className="h-4 w-4" />
              Назад к сумме заявки
            </Button>
          </Link>
        </div>
      </div>

      {/* Preview Dialog */}
      <Dialog open={!!previewDoc} onOpenChange={() => setPreviewDoc(null)}>
        <DialogContent className="max-w-3xl max-h-[80vh]">
          <DialogHeader>
            <DialogTitle>{previewDoc?.document?.title}</DialogTitle>
          </DialogHeader>
          <ScrollArea className="max-h-[60vh] pr-4">
            <div className="space-y-4 text-sm">
              {previewDoc?.document?.sections.map((section, idx) => (
                <div key={idx}>
                  {section.heading && <h3 className="font-bold mb-2">{section.heading}</h3>}
                  <div className="whitespace-pre-wrap">{section.content}</div>
                </div>
              ))}
              {previewDoc?.document?.signature_block && (
                <div className="mt-8 pt-4 border-t whitespace-pre-wrap">
                  {previewDoc.document.signature_block}
                </div>
              )}
            </div>
          </ScrollArea>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setPreviewDoc(null)}>Закрыть</Button>
            {previewDoc?.document && (
              <Button onClick={() => downloadDocx(previewDoc.document!)} className="gap-2">
                <Download className="h-4 w-4" />
                Скачать DOCX
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
};

export default DocumentGeneration;
