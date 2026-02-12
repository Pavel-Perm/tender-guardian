import { useEffect, useState, useCallback } from "react";
import { useParams, Link, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { AppLayout } from "@/components/AppLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ArrowLeft, FileText, Loader2, Download, Eye, ChevronRight, CheckCircle2, AlertCircle, FileDown } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, BorderStyle } from "docx";
import { saveAs } from "file-saver";

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
  const [tenderContext, setTenderContext] = useState("");
  const [analysisTitle, setAnalysisTitle] = useState("");
  const [previewDoc, setPreviewDoc] = useState<DocState | null>(null);
  const [generatingAll, setGeneratingAll] = useState(false);

  // Load data
  useEffect(() => {
    const fetchData = async () => {
      if (!id || !user) return;
      
      const [docsRes, resultsRes, analysisRes, companyRes] = await Promise.all([
        supabase.from("analysis_required_documents").select("category, documents").eq("analysis_id", id),
        supabase.from("analysis_results").select("block_name, details, risk_description").eq("analysis_id", id).order("block_order"),
        supabase.from("analyses").select("title, procurement_type").eq("id", id).single(),
        supabase.from("companies").select("*").eq("user_id", user.id).order("updated_at", { ascending: false }).limit(1).maybeSingle(),
      ]);

      if (analysisRes.data) setAnalysisTitle(analysisRes.data.title);

      // Get documents for the selected participant type
      const categoryDocs = docsRes.data?.find(d => d.category === participantType);
      const docs = (categoryDocs?.documents as string[]) || [];
      setRequiredDocs(docs);
      setDocStates(docs.map(name => ({ name, status: "idle" })));

      // Build tender context from analysis results
      if (resultsRes.data) {
        const context = resultsRes.data
          .filter(r => r.details)
          .map(r => `${r.block_name}: ${r.details}`)
          .join("\n");
        setTenderContext(context);
      }

      // Company data
      if (companyRes.data) {
        setCompanyData({ ...companyRes.data, participantType });
      }

      setLoading(false);
    };
    fetchData();
  }, [id, user, participantType]);

  const generateDocument = useCallback(async (docIndex: number) => {
    const docName = docStates[docIndex].name;
    
    setDocStates(prev => prev.map((d, i) => i === docIndex ? { ...d, status: "generating" } : d));

    try {
      const { data, error } = await supabase.functions.invoke("generate-bid-documents", {
        body: {
          analysisId: id,
          documentName: docName,
          companyData,
          tenderContext: tenderContext.slice(0, 10000), // Limit context size
        },
      });

      if (error) {
        let errMsg = "Ошибка генерации";
        try {
          if (data?.error) errMsg = data.error;
        } catch {}
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
  }, [docStates, id, companyData, tenderContext, toast]);

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

  const downloadDocx = async (doc: GeneratedDocument) => {
    const children: Paragraph[] = [];

    // Title
    children.push(new Paragraph({
      children: [new TextRun({ text: doc.title, bold: true, size: 28, font: "Times New Roman" })],
      alignment: AlignmentType.CENTER,
      spacing: { after: 300 },
    }));

    // Sections
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

    // Signature block
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
          <Link to={`/analysis/${id}/bid-preparation?type=${participantType}`}>
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

        {/* Company info card */}
        {companyData && (
          <Card className="bg-muted/30">
            <CardContent className="pt-4">
              <div className="flex items-center gap-2 mb-2">
                <CheckCircle2 className="h-4 w-4 text-primary" />
                <span className="font-medium text-sm">Данные участника загружены</span>
              </div>
              <p className="text-sm text-muted-foreground">{companyData.full_name} • ИНН {companyData.inn}</p>
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
          <Link to={`/analysis/${id}/bid-preparation?type=${participantType}`}>
            <Button variant="outline" className="gap-2">
              <ArrowLeft className="h-4 w-4" />
              Назад к реквизитам
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
