
DROP POLICY "Service role can insert" ON public.analysis_required_documents;

CREATE POLICY "Users can insert own analysis documents"
ON public.analysis_required_documents FOR INSERT
WITH CHECK (EXISTS (
  SELECT 1 FROM public.analyses WHERE analyses.id = analysis_required_documents.analysis_id AND analyses.user_id = auth.uid()
));
