import { useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { AppLayout } from "@/components/AppLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { Upload, File, X, Loader2, FileSearch } from "lucide-react";

const NewAnalysis = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [title, setTitle] = useState("");
  const [procurementType, setProcurementType] = useState<string>("44-fz");
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState("");

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const dropped = Array.from(e.dataTransfer.files);
    setFiles((prev) => [...prev, ...dropped]);
  }, []);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setFiles((prev) => [...prev, ...Array.from(e.target.files!)]);
    }
  };

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return bytes + " Б";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " КБ";
    return (bytes / (1024 * 1024)).toFixed(1) + " МБ";
  };

  const sanitizeFileName = (name: string): string => {
    const map: Record<string, string> = {
      'а':'a','б':'b','в':'v','г':'g','д':'d','е':'e','ё':'yo','ж':'zh','з':'z','и':'i',
      'й':'y','к':'k','л':'l','м':'m','н':'n','о':'o','п':'p','р':'r','с':'s','т':'t',
      'у':'u','ф':'f','х':'kh','ц':'ts','ч':'ch','ш':'sh','щ':'shch','ъ':'','ы':'y',
      'ь':'','э':'e','ю':'yu','я':'ya',
      'А':'A','Б':'B','В':'V','Г':'G','Д':'D','Е':'E','Ё':'Yo','Ж':'Zh','З':'Z','И':'I',
      'Й':'Y','К':'K','Л':'L','М':'M','Н':'N','О':'O','П':'P','Р':'R','С':'S','Т':'T',
      'У':'U','Ф':'F','Х':'Kh','Ц':'Ts','Ч':'Ch','Ш':'Sh','Щ':'Shch','Ъ':'','Ы':'Y',
      'Ь':'','Э':'E','Ю':'Yu','Я':'Ya',
    };
    return name.replace(/[^\x00-\x7F]/g, (ch) => map[ch] || '_');
  };

  const handleSubmit = async () => {
    if (files.length === 0) {
      toast({ title: "Загрузите файлы", description: "Необходимо добавить документы для анализа.", variant: "destructive" });
      return;
    }

    setUploading(true);
    setStage("Создание анализа...");
    setProgress(5);

    try {
      // Create analysis record
      const { data: analysis, error: createError } = await supabase
        .from("analyses")
        .insert({
          user_id: user!.id,
          title: title || "Без названия",
          procurement_type: procurementType as any,
          status: "uploading" as any,
        })
        .select()
        .single();

      if (createError) throw createError;

      // Upload files
      setStage("Загрузка файлов...");
      const totalFiles = files.length;
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const safeName = sanitizeFileName(file.name);
        const filePath = `${user!.id}/${analysis.id}/${Date.now()}_${safeName}`;

        const { error: uploadError } = await supabase.storage
          .from("documents")
          .upload(filePath, file);

        if (uploadError) throw uploadError;

        await supabase.from("analysis_files").insert({
          analysis_id: analysis.id,
          file_name: file.name,
          file_path: filePath,
          file_size: file.size,
          file_type: file.type,
        });

        setProgress(10 + Math.round((i + 1) / totalFiles * 30));
      }

      // Update status to processing
      await supabase.from("analyses").update({ status: "processing" as any }).eq("id", analysis.id);

      // Trigger AI analysis
      setStage("Анализ документов — подождите, это может занять пару минут...");
      setProgress(50);

      const { data: analyzeResult, error: analyzeError } = await supabase.functions.invoke("analyze-tender", {
        body: { analysisId: analysis.id },
      });

      if (analyzeError) {
        let errMsg = "Ошибка при анализе";
        try {
          // analyzeResult may contain parsed body on some SDK versions
          if (analyzeResult?.error) {
            errMsg = analyzeResult.error;
          } else if (analyzeError.context) {
            // Try to parse context body
            const ctx = analyzeError.context;
            if (typeof ctx === 'object' && ctx.body) {
              const body = typeof ctx.body === 'string' ? JSON.parse(ctx.body) : ctx.body;
              if (body?.error) errMsg = body.error;
            } else if (typeof ctx === 'string') {
              const parsed = JSON.parse(ctx);
              if (parsed?.error) errMsg = parsed.error;
            }
          }
        } catch {
          // If parsing fails, try the message
          if (analyzeError.message && analyzeError.message !== 'Edge Function returned a non-2xx status code') {
            errMsg = analyzeError.message;
          }
        }
        throw new Error(errMsg);
      }

      setStage("Анализ завершён!");
      setProgress(100);

      toast({ title: "Анализ завершён", description: "Результаты проверки готовы." });
      navigate(`/analysis/${analysis.id}`);
    } catch (error: any) {
      console.error("Analysis error:", error);
      toast({ title: "Ошибка", description: error.message || "Произошла ошибка при анализе", variant: "destructive" });
      setUploading(false);
      setProgress(0);
      setStage("");
    }
  };

  return (
    <AppLayout>
      <div className="max-w-2xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Новый анализ</h1>
          <p className="text-muted-foreground">Загрузите тендерную документацию для проверки</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Параметры закупки</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Название тендера (опционально)</Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Например: Закупка оборудования #123" disabled={uploading} />
            </div>
            <div className="space-y-2">
              <Label>Тип закупки</Label>
              <Select value={procurementType} onValueChange={setProcurementType} disabled={uploading}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="44-fz">44-ФЗ</SelectItem>
                  <SelectItem value="223-fz">223-ФЗ</SelectItem>
                  <SelectItem value="commercial">Коммерческая закупка</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Документы</CardTitle>
            <CardDescription>PDF, Word, Excel, изображения, ZIP-архивы</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {!uploading && (
              <div
                onDrop={handleDrop}
                onDragOver={(e) => e.preventDefault()}
                className="border-2 border-dashed rounded-lg p-8 text-center transition-colors hover:border-primary hover:bg-primary/5 cursor-pointer"
                onClick={() => document.getElementById("file-input")?.click()}
              >
                <Upload className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
                <p className="font-medium">Перетащите файлы сюда</p>
                <p className="text-sm text-muted-foreground mt-1">или нажмите для выбора</p>
                <input
                  id="file-input"
                  type="file"
                  multiple
                  accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,.zip"
                  onChange={handleFileSelect}
                  className="hidden"
                />
              </div>
            )}

            {files.length > 0 && (
              <div className="space-y-2">
                {files.map((file, i) => (
                  <div key={i} className="flex items-center justify-between rounded-md border p-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <File className="h-4 w-4 text-muted-foreground shrink-0" />
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{file.name}</p>
                        <p className="text-xs text-muted-foreground">{formatSize(file.size)}</p>
                      </div>
                    </div>
                    {!uploading && (
                      <Button variant="ghost" size="sm" onClick={() => removeFile(i)}>
                        <X className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                ))}
                <p className="text-sm text-muted-foreground">
                  {files.length} файл(ов), {formatSize(files.reduce((s, f) => s + f.size, 0))}
                </p>
              </div>
            )}

            {uploading && (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin text-primary" />
                  <span className="text-sm font-medium">{stage}</span>
                </div>
                <Progress value={progress} className="h-2" />
              </div>
            )}

            <Button onClick={handleSubmit} disabled={uploading || files.length === 0} className="w-full gap-2" size="lg">
              {uploading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {stage}
                </>
              ) : (
                <>
                  <FileSearch className="h-4 w-4" />
                  Начать анализ
                </>
              )}
            </Button>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
};

export default NewAnalysis;
