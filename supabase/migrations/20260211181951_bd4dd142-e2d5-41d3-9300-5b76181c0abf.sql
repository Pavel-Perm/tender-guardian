
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS okpo text,
  ADD COLUMN IF NOT EXISTS okato text,
  ADD COLUMN IF NOT EXISTS oktmo text,
  ADD COLUMN IF NOT EXISTS bank_inn text,
  ADD COLUMN IF NOT EXISTS bank_kpp text;
