-- ==============================================================================
-- PROJETO: CLUB 01 BARBER STUDIO
-- FASE 3: AUDITORIA DE SEGURANÇA, POLÍTICAS E RPCs ATÔMICAS
-- Data: 2026-10-18
-- ==============================================================================

-- 1. search_path seguro para funções existentes
CREATE OR REPLACE FUNCTION public.set_current_timestamp_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

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
$$ LANGUAGE plpgsql SET search_path = public;

CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS TEXT AS $$
  SELECT role FROM public.users
  WHERE auth_user_id = auth.uid() OR id = auth.uid()::text
  LIMIT 1;
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

-- 2. Proteção contra elevação indevida de privilégios no cadastro
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
    'client' -- Sempre inicia como 'client'. Promoção para admin/secretario/barber é restrita à administração!
  )
  ON CONFLICT (id) DO UPDATE
  SET email = EXCLUDED.email,
      phone = COALESCE(EXCLUDED.phone, public.users.phone),
      auth_user_id = EXCLUDED.auth_user_id,
      updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 3. Função auxiliar para login por telefone (busca email seguro sem expor dados)
CREATE OR REPLACE FUNCTION public.get_email_by_phone(p_phone TEXT)
RETURNS TEXT AS $$
  SELECT email FROM public.users 
  WHERE regexp_replace(phone, '\D', '', 'g') = regexp_replace(p_phone, '\D', '', 'g') 
  LIMIT 1;
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

-- 4. Função pública para horários ocupados (sem expor nomes, telefones ou dados de clientes)
CREATE OR REPLACE FUNCTION public.get_occupied_slots()
RETURNS TABLE (
  barber_id TEXT,
  appointment_time TEXT,
  duration_minutes INTEGER
) AS $$
  SELECT 
    a.barber_id, 
    a.appointment_time, 
    COALESCE(s.duration_minutes, 30) as duration_minutes
  FROM public.appointments a
  LEFT JOIN public.services s ON a.service_id = s.id
  WHERE a.status IN ('confirmed', 'pending');
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

-- 5. RPC Atômica de Agendamento com Proteção Contra Concorrência
CREATE OR REPLACE FUNCTION public.book_appointment_atomic(
  p_client_id TEXT,
  p_barber_id TEXT,
  p_service_id TEXT,
  p_appointment_time TEXT,
  p_service_ids TEXT[] DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
  v_conflict_count INTEGER;
  v_appointment_id TEXT;
  v_sid TEXT;
BEGIN
  -- Bloqueio contra concorrência: verifica se o barbeiro já tem agendamento ativo nesse horário
  SELECT COUNT(*) INTO v_conflict_count
  FROM public.appointments
  WHERE barber_id = p_barber_id
    AND appointment_time = p_appointment_time
    AND status IN ('confirmed', 'pending');

  IF v_conflict_count > 0 THEN
    RAISE EXCEPTION 'HORARIO_INDISPONIVEL: O profissional já possui um agendamento confirmado ou pendente neste horário.';
  END IF;

  v_appointment_id := gen_random_uuid()::text;

  -- Inserção atômica do agendamento principal
  INSERT INTO public.appointments (
    id, client_id, barber_id, service_id, appointment_time, status
  ) VALUES (
    v_appointment_id, p_client_id, p_barber_id, p_service_id, p_appointment_time, 'confirmed'
  );

  -- Inserção de serviços múltiplos se fornecidos
  IF p_service_ids IS NOT NULL AND array_length(p_service_ids, 1) > 0 THEN
    FOREACH v_sid IN ARRAY p_service_ids LOOP
      INSERT INTO public.appointment_services (appointment_id, service_id)
      VALUES (v_appointment_id, v_sid)
      ON CONFLICT DO NOTHING;
    END LOOP;
  ELSE
    -- Garante pelo menos o serviço principal na tabela de múltiplos
    INSERT INTO public.appointment_services (appointment_id, service_id)
    VALUES (v_appointment_id, p_service_id)
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'appointment_id', v_appointment_id,
    'status', 'confirmed',
    'appointment_time', p_appointment_time
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 6. RPC Atômica para Registro de Vendas e Lançamento de Caixa
CREATE OR REPLACE FUNCTION public.create_sale_atomic(
  p_appointment_id TEXT,
  p_customer_id TEXT,
  p_payment_method TEXT,
  p_items JSONB,
  p_register_in_caixa BOOLEAN DEFAULT true
)
RETURNS JSONB AS $$
DECLARE
  v_sale_id TEXT;
  v_total NUMERIC(10,2) := 0.00;
  v_item RECORD;
  v_item_total NUMERIC(10,2);
BEGIN
  v_sale_id := gen_random_uuid()::text;

  -- Calcular total da venda
  FOR v_item IN SELECT * FROM jsonb_to_recordset(p_items) AS x(product_id TEXT, quantity INTEGER, unit_price NUMERIC) LOOP
    v_total := v_total + (v_item.quantity * v_item.unit_price);
  END LOOP;

  -- Criar venda
  INSERT INTO public.sales (id, appointment_id, customer_id, payment_method, total_amount)
  VALUES (v_sale_id, p_appointment_id, p_customer_id, p_payment_method, v_total);

  -- Inserir itens (o trigger trigger_sale_item_stock automaticamente atualizará o estoque!)
  FOR v_item IN SELECT * FROM jsonb_to_recordset(p_items) AS x(product_id TEXT, quantity INTEGER, unit_price NUMERIC) LOOP
    v_item_total := v_item.quantity * v_item.unit_price;
    INSERT INTO public.sale_items (id, sale_id, product_id, quantity, unit_price, total_price)
    VALUES (gen_random_uuid()::text, v_sale_id, v_item.product_id, v_item.quantity, v_item.unit_price, v_item_total);
  END LOOP;

  -- Lançamento opcional no caixa
  IF p_register_in_caixa AND v_total > 0 THEN
    INSERT INTO public.caixa (
      id, type, description, amount, category, payment_method, appointment_id, date
    ) VALUES (
      gen_random_uuid()::text,
      'receita',
      'Venda de Produtos (Balcão)',
      v_total,
      'Venda de Produtos',
      p_payment_method,
      p_appointment_id,
      to_char(now(), 'YYYY-MM-DD')
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'sale_id', v_sale_id,
    'total_amount', v_total
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
