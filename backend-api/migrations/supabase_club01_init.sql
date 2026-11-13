-- ==============================================================================
-- PROJETO: CLUB 01 BARBER STUDIO
-- FASE 2: ESTRUTURA COMPLETA SUPABASE POSTGRESQL
-- Data: 2026-10-18
-- Descrição: Migração consolidada e unificada para Supabase PostgreSQL (13 tabelas,
--            tipos estritos, constraints, índices, triggers PL/pgSQL, RLS e Auth).
-- ==============================================================================

-- 0. Extensões recomendadas
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ------------------------------------------------------------------------------
-- FUNÇÃO AUXILIAR: Atualização automática de updated_at
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_current_timestamp_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ==============================================================================
-- 1. TABELA: users (Perfis de Usuários do Sistema)
-- Vinculada opcionalmente ao auth.users do Supabase Auth
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.users (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  auth_user_id UUID UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  phone TEXT UNIQUE,
  email TEXT UNIQUE,
  role TEXT NOT NULL CHECK (role IN ('client', 'barber', 'admin', 'secretario')) DEFAULT 'client',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_users_role ON public.users(role);
CREATE INDEX IF NOT EXISTS idx_users_phone ON public.users(phone);
CREATE INDEX IF NOT EXISTS idx_users_email ON public.users(email);
CREATE INDEX IF NOT EXISTS idx_users_auth_id ON public.users(auth_user_id);

CREATE TRIGGER trigger_set_users_updated_at
BEFORE UPDATE ON public.users
FOR EACH ROW EXECUTE FUNCTION public.set_current_timestamp_updated_at();

-- ==============================================================================
-- 2. TABELA: customers (Cadastro de Clientes)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.customers (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name TEXT NOT NULL,
  address TEXT,
  phone TEXT NOT NULL,
  birth_date TEXT,
  photo TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_customers_phone ON public.customers(phone);
CREATE INDEX IF NOT EXISTS idx_customers_name ON public.customers(name);

CREATE TRIGGER trigger_set_customers_updated_at
BEFORE UPDATE ON public.customers
FOR EACH ROW EXECUTE FUNCTION public.set_current_timestamp_updated_at();

-- ==============================================================================
-- 3. TABELA: barbers (Profissionais Barbeiros)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.barbers (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  photo TEXT,
  birth_date TEXT,
  specialty TEXT,
  hired_at TEXT,
  service_commission NUMERIC(5, 2) NOT NULL DEFAULT 0.00,
  product_commission NUMERIC(5, 2) NOT NULL DEFAULT 0.00,
  user_id TEXT REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_barbers_user_id ON public.barbers(user_id);

CREATE TRIGGER trigger_set_barbers_updated_at
BEFORE UPDATE ON public.barbers
FOR EACH ROW EXECUTE FUNCTION public.set_current_timestamp_updated_at();

-- ==============================================================================
-- 4. TABELA: services (Catálogo de Serviços)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.services (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name TEXT NOT NULL,
  description TEXT,
  duration_minutes INTEGER NOT NULL DEFAULT 30 CHECK (duration_minutes > 0),
  price NUMERIC(10, 2) NOT NULL DEFAULT 0.00 CHECK (price >= 0),
  restricted_access BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_services_restricted ON public.services(restricted_access);

CREATE TRIGGER trigger_set_services_updated_at
BEFORE UPDATE ON public.services
FOR EACH ROW EXECUTE FUNCTION public.set_current_timestamp_updated_at();

-- ==============================================================================
-- 5. TABELA: barber_services (Relacionamento N:N Barbeiros <-> Serviços)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.barber_services (
  barber_id TEXT NOT NULL REFERENCES public.barbers(id) ON DELETE CASCADE,
  service_id TEXT NOT NULL REFERENCES public.services(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (barber_id, service_id)
);

CREATE INDEX IF NOT EXISTS idx_barber_services_service ON public.barber_services(service_id);

-- ==============================================================================
-- 6. TABELA: appointments (Agendamentos)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.appointments (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  client_id TEXT NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
  barber_id TEXT NOT NULL REFERENCES public.barbers(id) ON DELETE RESTRICT,
  service_id TEXT NOT NULL REFERENCES public.services(id) ON DELETE RESTRICT,
  appointment_time TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'confirmed', 'completed', 'cancelled', 'absent')) DEFAULT 'confirmed',
  cancellation_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_appointments_client_id ON public.appointments(client_id);
CREATE INDEX IF NOT EXISTS idx_appointments_barber_id ON public.appointments(barber_id);
CREATE INDEX IF NOT EXISTS idx_appointments_service_id ON public.appointments(service_id);
CREATE INDEX IF NOT EXISTS idx_appointments_time ON public.appointments(appointment_time);
CREATE INDEX IF NOT EXISTS idx_appointments_status ON public.appointments(status);

CREATE TRIGGER trigger_set_appointments_updated_at
BEFORE UPDATE ON public.appointments
FOR EACH ROW EXECUTE FUNCTION public.set_current_timestamp_updated_at();

-- ==============================================================================
-- 7. TABELA: appointment_services (Múltiplos Serviços por Agendamento N:N)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.appointment_services (
  appointment_id TEXT NOT NULL REFERENCES public.appointments(id) ON DELETE CASCADE,
  service_id TEXT NOT NULL REFERENCES public.services(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (appointment_id, service_id)
);

CREATE INDEX IF NOT EXISTS idx_appointment_services_service ON public.appointment_services(service_id);

-- ==============================================================================
-- 8. TABELA: products (Catálogo de Produtos e Estoque)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.products (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name TEXT NOT NULL,
  description TEXT,
  supplier TEXT,
  supplier_contact_name TEXT,
  supplier_contact_phone TEXT,
  cost_price NUMERIC(10, 2) NOT NULL DEFAULT 0.00 CHECK (cost_price >= 0),
  sale_price NUMERIC(10, 2) NOT NULL DEFAULT 0.00 CHECK (sale_price >= 0),
  stock_quantity INTEGER NOT NULL DEFAULT 0,
  photo TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_products_name ON public.products(name);

CREATE TRIGGER trigger_set_products_updated_at
BEFORE UPDATE ON public.products
FOR EACH ROW EXECUTE FUNCTION public.set_current_timestamp_updated_at();

-- ==============================================================================
-- 9. TABELA: sales (Cabeçalho de Vendas)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.sales (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  appointment_id TEXT REFERENCES public.appointments(id) ON DELETE SET NULL,
  customer_id TEXT REFERENCES public.customers(id) ON DELETE SET NULL,
  sale_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  payment_method TEXT NOT NULL CHECK (payment_method IN ('PIX', 'CARTAO_CREDITO', 'CARTAO_DEBITO', 'DINHEIRO', 'A_PRAZO')),
  total_amount NUMERIC(10, 2) NOT NULL DEFAULT 0.00 CHECK (total_amount >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sales_appointment ON public.sales(appointment_id);
CREATE INDEX IF NOT EXISTS idx_sales_customer ON public.sales(customer_id);
CREATE INDEX IF NOT EXISTS idx_sales_date ON public.sales(sale_date);

CREATE TRIGGER trigger_set_sales_updated_at
BEFORE UPDATE ON public.sales
FOR EACH ROW EXECUTE FUNCTION public.set_current_timestamp_updated_at();

-- ==============================================================================
-- 10. TABELA: sale_items (Itens de Cada Venda)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.sale_items (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  sale_id TEXT NOT NULL REFERENCES public.sales(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price NUMERIC(10, 2) NOT NULL CHECK (unit_price >= 0),
  total_price NUMERIC(10, 2) NOT NULL CHECK (total_price >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sale_items_sale ON public.sale_items(sale_id);
CREATE INDEX IF NOT EXISTS idx_sale_items_product ON public.sale_items(product_id);

-- TRIGGER PL/pgSQL: Baixa e Estorno Automático de Estoque
CREATE OR REPLACE FUNCTION public.handle_sale_item_stock()
RETURNS TRIGGER AS $$
BEGIN
  IF (TG_OP = 'INSERT') THEN
    UPDATE public.products
    SET stock_quantity = stock_quantity - NEW.quantity,
        updated_at = now()
    WHERE id = NEW.product_id;
    RETURN NEW;
  ELSIF (TG_OP = 'UPDATE') THEN
    UPDATE public.products
    SET stock_quantity = stock_quantity + OLD.quantity - NEW.quantity,
        updated_at = now()
    WHERE id = NEW.product_id;
    RETURN NEW;
  ELSIF (TG_OP = 'DELETE') THEN
    UPDATE public.products
    SET stock_quantity = stock_quantity + OLD.quantity,
        updated_at = now()
    WHERE id = OLD.product_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_sale_item_stock ON public.sale_items;
CREATE TRIGGER trigger_sale_item_stock
AFTER INSERT OR UPDATE OR DELETE ON public.sale_items
FOR EACH ROW EXECUTE FUNCTION public.handle_sale_item_stock();

-- ==============================================================================
-- 11. TABELA: caixa (Fluxo Financeiro de Receitas e Despesas)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.caixa (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  type TEXT NOT NULL CHECK (type IN ('receita', 'despesa')),
  description TEXT NOT NULL,
  amount NUMERIC(10, 2) NOT NULL CHECK (amount >= 0),
  category TEXT NOT NULL,
  payment_method TEXT,
  appointment_id TEXT REFERENCES public.appointments(id) ON DELETE SET NULL,
  barber_id TEXT REFERENCES public.barbers(id) ON DELETE SET NULL,
  date TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_caixa_date ON public.caixa(date);
CREATE INDEX IF NOT EXISTS idx_caixa_type ON public.caixa(type);
CREATE INDEX IF NOT EXISTS idx_caixa_appointment ON public.caixa(appointment_id);
CREATE INDEX IF NOT EXISTS idx_caixa_barber ON public.caixa(barber_id);

CREATE TRIGGER trigger_set_caixa_updated_at
BEFORE UPDATE ON public.caixa
FOR EACH ROW EXECUTE FUNCTION public.set_current_timestamp_updated_at();

-- ==============================================================================
-- 12. TABELA: settings (Configurações Chave-Valor da Barbearia)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER trigger_set_settings_updated_at
BEFORE UPDATE ON public.settings
FOR EACH ROW EXECUTE FUNCTION public.set_current_timestamp_updated_at();

-- ==============================================================================
-- 13. TABELA: whatsapp_logs (Histórico de Notificações)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.whatsapp_logs (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  appointment_id TEXT NOT NULL REFERENCES public.appointments(id) ON DELETE CASCADE,
  message_type TEXT NOT NULL CHECK (message_type IN ('confirmation', 'reminder', 'cancellation')),
  phone TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'sent', 'failed')) DEFAULT 'pending',
  scheduled_time TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_logs_appointment ON public.whatsapp_logs(appointment_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_logs_status ON public.whatsapp_logs(status);

-- ==============================================================================
-- CONFIGURAÇÕES INICIAIS (SEED NEUTRO - CLUB 01 BARBER STUDIO)
-- ==============================================================================
INSERT INTO public.settings (key, value) VALUES
  ('shop_name', 'CLUB 01 Barber Studio'),
  ('min_lead_time_minutes', '30'),
  ('inactivity_minutes', '5')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

-- ==============================================================================
-- INTEGRAÇÃO COM SUPABASE AUTH (TRIGGER DE NOVO USUÁRIO)
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.users (id, auth_user_id, name, email, phone, role)
  VALUES (
    NEW.id::text,
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'name', NEW.email, 'Usuário'),
    NEW.email,
    NEW.phone,
    COALESCE(NEW.raw_user_meta_data->>'role', 'client')
  )
  ON CONFLICT (id) DO UPDATE
  SET email = EXCLUDED.email,
      phone = COALESCE(EXCLUDED.phone, public.users.phone),
      auth_user_id = EXCLUDED.auth_user_id,
      updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger disparado no cadastro via Supabase Auth
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user();

-- ==============================================================================
-- FUNÇÃO AUXILIAR PARA CONSULTA DE ROLE NO RLS
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS TEXT AS $$
  SELECT role FROM public.users
  WHERE auth_user_id = auth.uid() OR id = auth.uid()::text
  LIMIT 1;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- ==============================================================================
-- ROW LEVEL SECURITY (RLS) - ATIVAÇÃO E POLÍTICAS
-- ==============================================================================
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.barbers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.services ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.barber_services ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.appointment_services ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sale_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.caixa ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_logs ENABLE ROW LEVEL SECURITY;

-- 1. Políticas para services
CREATE POLICY "Serviços públicos visíveis para todos"
ON public.services FOR SELECT
USING (restricted_access = false OR auth.role() = 'authenticated');

CREATE POLICY "Admin gerencia serviços"
ON public.services FOR ALL
USING (public.current_user_role() = 'admin');

-- 2. Políticas para barbers e barber_services
CREATE POLICY "Barbeiros visíveis para todos"
ON public.barbers FOR SELECT
USING (true);

CREATE POLICY "Admin gerencia barbeiros"
ON public.barbers FOR ALL
USING (public.current_user_role() IN ('admin', 'secretario'));

CREATE POLICY "Especialidades de barbeiros visíveis para todos"
ON public.barber_services FOR SELECT
USING (true);

CREATE POLICY "Admin gerencia especialidades de barbeiros"
ON public.barber_services FOR ALL
USING (public.current_user_role() IN ('admin', 'secretario'));

-- 3. Políticas para customers
CREATE POLICY "Público e autenticado podem cadastrar cliente"
ON public.customers FOR INSERT
WITH CHECK (true);

CREATE POLICY "Equipe visualiza clientes"
ON public.customers FOR SELECT
USING (public.current_user_role() IN ('admin', 'secretario', 'barber'));

CREATE POLICY "Equipe gerencia clientes"
ON public.customers FOR UPDATE
USING (public.current_user_role() IN ('admin', 'secretario'));

-- 4. Políticas para appointments e appointment_services
CREATE POLICY "Público pode criar agendamento"
ON public.appointments FOR INSERT
WITH CHECK (true);

CREATE POLICY "Público consulta horários ocupados"
ON public.appointments FOR SELECT
USING (status IN ('confirmed', 'pending') OR auth.role() = 'authenticated');

CREATE POLICY "Equipe gerencia agendamentos"
ON public.appointments FOR ALL
USING (
  public.current_user_role() IN ('admin', 'secretario')
  OR (public.current_user_role() = 'barber' AND barber_id IN (
    SELECT id FROM public.barbers WHERE user_id = auth.uid()::text
  ))
);

CREATE POLICY "Público pode inserir múltiplos serviços no agendamento"
ON public.appointment_services FOR INSERT
WITH CHECK (true);

CREATE POLICY "Leitura de múltiplos serviços de agendamentos"
ON public.appointment_services FOR SELECT
USING (true);

-- 5. Políticas para products
CREATE POLICY "Equipe visualiza produtos"
ON public.products FOR SELECT
USING (public.current_user_role() IN ('admin', 'secretario', 'barber'));

CREATE POLICY "Admin gerencia produtos"
ON public.products FOR ALL
USING (public.current_user_role() = 'admin');

-- 6. Políticas para sales e sale_items
CREATE POLICY "Equipe visualiza e cria vendas"
ON public.sales FOR SELECT
USING (public.current_user_role() IN ('admin', 'secretario', 'barber'));

CREATE POLICY "Equipe insere vendas"
ON public.sales FOR INSERT
WITH CHECK (public.current_user_role() IN ('admin', 'secretario', 'barber'));

CREATE POLICY "Admin gerencia vendas"
ON public.sales FOR ALL
USING (public.current_user_role() = 'admin');

CREATE POLICY "Equipe visualiza itens de venda"
ON public.sale_items FOR SELECT
USING (public.current_user_role() IN ('admin', 'secretario', 'barber'));

CREATE POLICY "Equipe insere itens de venda"
ON public.sale_items FOR INSERT
WITH CHECK (public.current_user_role() IN ('admin', 'secretario', 'barber'));

CREATE POLICY "Admin gerencia itens de venda"
ON public.sale_items FOR ALL
USING (public.current_user_role() = 'admin');

-- 7. Políticas para caixa
CREATE POLICY "Admin e Secretário acessam todo o caixa"
ON public.caixa FOR ALL
USING (public.current_user_role() IN ('admin', 'secretario'));

CREATE POLICY "Barbeiro consulta seus próprios lançamentos no caixa"
ON public.caixa FOR SELECT
USING (
  public.current_user_role() = 'barber'
  AND barber_id IN (SELECT id FROM public.barbers WHERE user_id = auth.uid()::text)
);

-- 8. Políticas para settings
CREATE POLICY "Configurações públicas para leitura"
ON public.settings FOR SELECT
USING (true);

CREATE POLICY "Admin atualiza configurações"
ON public.settings FOR ALL
USING (public.current_user_role() = 'admin');

-- 9. Políticas para users
CREATE POLICY "Usuário consulta seu próprio perfil"
ON public.users FOR SELECT
USING (auth_user_id = auth.uid() OR public.current_user_role() = 'admin');

CREATE POLICY "Admin gerencia usuários"
ON public.users FOR ALL
USING (public.current_user_role() = 'admin');

-- 10. Políticas para whatsapp_logs
CREATE POLICY "Admin e Secretário consultam logs de whatsapp"
ON public.whatsapp_logs FOR SELECT
USING (public.current_user_role() IN ('admin', 'secretario'));
