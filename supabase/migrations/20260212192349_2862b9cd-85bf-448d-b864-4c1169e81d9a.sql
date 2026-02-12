
-- Table for persisting generated bid documents
CREATE TABLE public.generated_documents (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  analysis_id uuid NOT NULL REFERENCES public.analyses(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  doc_name text NOT NULL,
  participant_type text NOT NULL,
  status text NOT NULL DEFAULT 'idle',
  title text,
  sections jsonb DEFAULT '[]'::jsonb,
  signature_block text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Unique constraint: one document per analysis + participant type + doc name
CREATE UNIQUE INDEX idx_generated_documents_unique 
  ON public.generated_documents(analysis_id, participant_type, doc_name);

-- Enable RLS
ALTER TABLE public.generated_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own generated documents"
  ON public.generated_documents FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own generated documents"
  ON public.generated_documents FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own generated documents"
  ON public.generated_documents FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own generated documents"
  ON public.generated_documents FOR DELETE
  USING (auth.uid() = user_id);

-- Auto-update updated_at
CREATE TRIGGER update_generated_documents_updated_at
  BEFORE UPDATE ON public.generated_documents
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
