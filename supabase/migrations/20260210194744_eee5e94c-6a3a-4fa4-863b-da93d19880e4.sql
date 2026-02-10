CREATE POLICY "Users can delete own analysis documents"
ON public.analysis_required_documents
FOR DELETE
USING (EXISTS (
  SELECT 1 FROM analyses
  WHERE analyses.id = analysis_required_documents.analysis_id
    AND analyses.user_id = auth.uid()
));