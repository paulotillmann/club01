-- ==============================================================================
-- PROJETO: CLUB 01 BARBER STUDIO
-- FASE 5.3: SCRIPT DE ROLLBACK / REVERSÃO EXATA DA MIGRATION 0021
-- Versão: 4.0 (Revisada em 2026-10-19: Restaura versões da migration 0019 e 0020 preservando dados)
-- Arquivo: 0021_fase5_rollback.sql
-- ==============================================================================

-- 1. Remover constraint de estoque não negativo se necessário reverter
ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_stock_non_negative;

-- 2. Restaurar trigger original de handle_sale_item_stock (versão da migration 0019)
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

-- 3. Restaurar RPC book_appointment_atomic original (versão da migration 0019)
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
  SELECT COUNT(*) INTO v_conflict_count
  FROM public.appointments
  WHERE barber_id = p_barber_id
    AND appointment_time = p_appointment_time
    AND status IN ('confirmed', 'pending');

  IF v_conflict_count > 0 THEN
    RAISE EXCEPTION 'HORARIO_INDISPONIVEL: O profissional já possui um agendamento confirmado ou pendente neste horário.';
  END IF;

  v_appointment_id := gen_random_uuid()::text;

  INSERT INTO public.appointments (
    id, client_id, barber_id, service_id, appointment_time, status
  ) VALUES (
    v_appointment_id, p_client_id, p_barber_id, p_service_id, p_appointment_time, 'confirmed'
  );

  IF p_service_ids IS NOT NULL AND array_length(p_service_ids, 1) > 0 THEN
    FOREACH v_sid IN ARRAY p_service_ids LOOP
      INSERT INTO public.appointment_services (appointment_id, service_id)
      VALUES (v_appointment_id, v_sid)
      ON CONFLICT DO NOTHING;
    END LOOP;
  ELSE
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

-- 4. Restaurar RPC book_appointment_online (versão original da migration 0020)
CREATE OR REPLACE FUNCTION public.book_appointment_online(
  p_name TEXT,
  p_phone TEXT,
  p_barber_id TEXT,
  p_service_ids TEXT[],
  p_appointment_time TEXT
)
RETURNS JSONB AS $$
DECLARE
  v_client_id TEXT;
  v_clean_phone TEXT;
  v_primary_service_id TEXT;
  v_conflict_count INTEGER;
  v_appointment_id TEXT;
  v_sid TEXT;
BEGIN
  IF p_barber_id IS NULL OR p_appointment_time IS NULL OR p_service_ids IS NULL OR array_length(p_service_ids, 1) = 0 THEN
    RAISE EXCEPTION 'PARAMETROS_INVALIDOS: Profissional, data/horário e ao menos um serviço são obrigatórios.';
  END IF;

  v_clean_phone := regexp_replace(COALESCE(p_phone, ''), '\D', '', 'g');
  v_primary_service_id := p_service_ids[1];

  -- 1. Resolver ou criar cliente
  IF v_clean_phone <> '' THEN
    SELECT id INTO v_client_id
    FROM public.customers
    WHERE regexp_replace(phone, '\D', '', 'g') = v_clean_phone
    LIMIT 1;
  END IF;

  IF v_client_id IS NOT NULL THEN
    UPDATE public.customers
    SET name = COALESCE(NULLIF(UPPER(TRIM(p_name)), ''), name),
        phone = COALESCE(NULLIF(TRIM(p_phone), ''), phone),
        updated_at = now()
    WHERE id = v_client_id;
  ELSE
    v_client_id := gen_random_uuid()::text;
    INSERT INTO public.customers (id, name, phone)
    VALUES (
      v_client_id,
      COALESCE(NULLIF(UPPER(TRIM(p_name)), ''), 'CLIENTE SEM NOME'),
      COALESCE(NULLIF(TRIM(p_phone), ''), v_clean_phone)
    );
  END IF;

  -- 2. Verificar conflito de horário para o profissional
  SELECT COUNT(*) INTO v_conflict_count
  FROM public.appointments
  WHERE barber_id = p_barber_id
    AND appointment_time = p_appointment_time
    AND status IN ('confirmed', 'pending');

  IF v_conflict_count > 0 THEN
    RAISE EXCEPTION 'HORARIO_INDISPONIVEL: O profissional já possui um agendamento ativo neste horário.';
  END IF;

  -- 3. Criar agendamento
  v_appointment_id := gen_random_uuid()::text;

  INSERT INTO public.appointments (
    id, client_id, barber_id, service_id, appointment_time, status
  ) VALUES (
    v_appointment_id, v_client_id, p_barber_id, v_primary_service_id, p_appointment_time, 'confirmed'
  );

  -- 4. Inserir múltiplos serviços
  FOREACH v_sid IN ARRAY p_service_ids LOOP
    INSERT INTO public.appointment_services (appointment_id, service_id)
    VALUES (v_appointment_id, v_sid)
    ON CONFLICT DO NOTHING;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'appointment_id', v_appointment_id,
    'client_id', v_client_id,
    'barber_id', p_barber_id,
    'appointment_time', p_appointment_time
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION public.book_appointment_online(TEXT, TEXT, TEXT, TEXT[], TEXT) TO anon, authenticated, service_role;


-- 5. Restaurar create_sale_atomic anterior (versão da migration 0019)
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

  FOR v_item IN SELECT * FROM jsonb_to_recordset(p_items) AS x(product_id TEXT, quantity INTEGER, unit_price NUMERIC) LOOP
    v_total := v_total + (v_item.quantity * v_item.unit_price);
  END LOOP;

  INSERT INTO public.sales (id, appointment_id, customer_id, payment_method, total_amount)
  VALUES (v_sale_id, p_appointment_id, p_customer_id, p_payment_method, v_total);

  FOR v_item IN SELECT * FROM jsonb_to_recordset(p_items) AS x(product_id TEXT, quantity INTEGER, unit_price NUMERIC) LOOP
    v_item_total := v_item.quantity * v_item.unit_price;
    INSERT INTO public.sale_items (id, sale_id, product_id, quantity, unit_price, total_price)
    VALUES (gen_random_uuid()::text, v_sale_id, v_item.product_id, v_item.quantity, v_item.unit_price, v_item_total);
  END LOOP;

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

GRANT EXECUTE ON FUNCTION public.create_sale_atomic(TEXT, TEXT, TEXT, JSONB, BOOLEAN) TO authenticated, service_role;
