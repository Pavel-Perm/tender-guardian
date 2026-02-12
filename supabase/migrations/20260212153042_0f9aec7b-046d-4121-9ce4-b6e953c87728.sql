
-- Table to store bid amounts per analysis
CREATE TABLE public.bid_amounts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  analysis_id UUID NOT NULL REFERENCES public.analyses(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  amount NUMERIC(18,2) NOT NULL,
  vat_rate TEXT NOT NULL,
  vat_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
  total_with_vat NUMERIC(18,2) NOT NULL,
  amount_words TEXT,
  vat_amount_words TEXT,
  total_words TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(analysis_id)
);

ALTER TABLE public.bid_amounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own bid amounts"
  ON public.bid_amounts FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own bid amounts"
  ON public.bid_amounts FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own bid amounts"
  ON public.bid_amounts FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own bid amounts"
  ON public.bid_amounts FOR DELETE
  USING (auth.uid() = user_id);

CREATE TRIGGER update_bid_amounts_updated_at
  BEFORE UPDATE ON public.bid_amounts
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
