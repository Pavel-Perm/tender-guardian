
-- Table for storing required participation documents extracted by AI
CREATE TABLE public.analysis_required_documents (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  analysis_id UUID NOT NULL REFERENCES public.analyses(id) ON DELETE CASCADE,
  category TEXT NOT NULL, -- 'enterprise', 'ip', 'self_employed'
  documents JSONB NOT NULL DEFAULT '[]'::jsonb, -- array of document descriptions
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.analysis_required_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own analysis documents"
ON public.analysis_required_documents FOR SELECT
USING (EXISTS (
  SELECT 1 FROM public.analyses WHERE analyses.id = analysis_required_documents.analysis_id AND analyses.user_id = auth.uid()
));

CREATE POLICY "Service role can insert"
ON public.analysis_required_documents FOR INSERT
WITH CHECK (true);

CREATE INDEX idx_analysis_required_documents_analysis_id ON public.analysis_required_documents(analysis_id);
