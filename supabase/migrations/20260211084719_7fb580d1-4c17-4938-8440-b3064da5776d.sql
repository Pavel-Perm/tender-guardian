
-- Таблица для хранения реквизитов организаций/ИП/самозанятых
CREATE TABLE public.companies (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  
  -- Основные реквизиты
  inn TEXT NOT NULL,
  kpp TEXT,
  ogrn TEXT,
  full_name TEXT NOT NULL,
  short_name TEXT,
  legal_address TEXT,
  actual_address TEXT,
  
  -- Руководитель
  director_name TEXT,
  director_position TEXT,
  
  -- Контакты
  phone TEXT,
  email TEXT,
  
  -- Банковские реквизиты
  bank_name TEXT,
  bank_bik TEXT,
  bank_account TEXT,       -- расчётный счёт
  bank_corr_account TEXT,  -- корреспондентский счёт
  
  -- Дополнительные
  okved TEXT,              -- основной ОКВЭД
  tax_system TEXT,         -- система налогообложения
  vat_rate TEXT,           -- ставка НДС
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Уникальный индекс: один ИНН на одного пользователя
CREATE UNIQUE INDEX idx_companies_user_inn ON public.companies (user_id, inn);

-- Индекс для быстрого поиска по ИНН
CREATE INDEX idx_companies_inn ON public.companies (inn);

-- Enable RLS
ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Users can view own companies"
ON public.companies FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own companies"
ON public.companies FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own companies"
ON public.companies FOR UPDATE
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own companies"
ON public.companies FOR DELETE
USING (auth.uid() = user_id);

-- Trigger for updated_at
CREATE TRIGGER update_companies_updated_at
BEFORE UPDATE ON public.companies
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();
