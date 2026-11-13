-- ==============================================================================
-- PROJETO: CLUB 01 BARBER STUDIO
-- ROLLBACK DA MIGRATION 0021 (ESPECÍFICO PARA O BASELINE REMOTO REAL)
-- Target: Supabase ID mxafltrygwekefewhylh
-- Data: 2026-10-19
-- Contexto: No Supabase remoto mxafltrygwekefewhylh, a migration 0020 NUNCA foi
--           aplicada (book_appointment_online não existia).
--           Portanto, este script restaura o banco EXATAMENTE ao baseline pré-0021:
--           1. Remove book_appointment_online (que foi criada apenas na 0021).
--           2. Restaura create_sale_atomic para a versão 0019.
--           3. Restaura book_appointment_atomic para a versão 0019.
--           4. Restaura handle_sale_item_stock para a versão 0019.
-- ==============================================================================

BEGIN;

-- ------------------------------------------------------------------------------
-- 1. DROP da RPC book_appointment_online (inexistente no baseline remoto pré-0021)
-- ------------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.book_appointment_online(TEXT, TEXT, TEXT, TEXT[], TEXT);

-- ------------------------------------------------------------------------------
-- 2. Restauração de handle_sale_item_stock (Versão 0019)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_sale_item_stock()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.products
    SET stock_quantity = stock_quantity - NEW.quantity
    WHERE id = NEW.product_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.products
    SET stock_quantity = stock_quantity + OLD.quantity
    WHERE id = OLD.product_id;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.product_id = OLD.product_id THEN
      UPDATE public.products
      SET stock_quantity = stock_quantity - (NEW.quantity - OLD.quantity)
      WHERE id = NEW.product_id;
    ELSE
      UPDATE public.products
      SET stock_quantity = stock_quantity + OLD.quantity
      WHERE id = OLD.product_id;
      UPDATE public.products
      SET stock_quantity = stock_quantity - NEW.quantity
      WHERE id = NEW.product_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY INVOKER SET search_path = public;

-- ------------------------------------------------------------------------------
-- 3. Restauração de create_sale_atomic (Versão 0019)
-- ------------------------------------------------------------------------------
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
  v_item JSONB;
  v_product_id TEXT;
  v_quantity INT;
  v_unit_price NUMERIC(10,2);
  v_item_total NUMERIC(10,2);
  v_total_amount NUMERIC(10,2) := 0;
  v_current_stock INT;
  v_payment_method_norm TEXT;
BEGIN
  v_payment_method_norm := UPPER(TRIM(p_payment_method));
  IF v_payment_method_norm NOT IN ('PIX', 'CARTAO_CREDITO', 'CARTAO_DEBITO', 'DINHEIRO', 'A_PRAZO') THEN
    RAISE EXCEPTION 'METODO_PAGAMENTO_INVALIDO: %', p_payment_method;
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_product_id := v_item->>'product_id';
    v_quantity := (v_item->>'quantity')::INT;
    v_unit_price := (v_item->>'unit_price')::NUMERIC(10,2);
    v_item_total := v_quantity * v_unit_price;
    v_total_amount := v_total_amount + v_item_total;

    SELECT stock_quantity INTO v_current_stock
    FROM public.products
    WHERE id = v_product_id;

    IF v_current_stock IS NULL THEN
      RAISE EXCEPTION 'PRODUTO_NAO_ENCONTRADO: %', v_product_id;
    END IF;

    IF v_current_stock < v_quantity THEN
      RAISE EXCEPTION 'ESTOQUE_INSUFICIENTE: Produto % tem % em estoque, solicitado %', 
        v_product_id, v_current_stock, v_quantity;
    END IF;
  END LOOP;

  v_sale_id := 'sale-' || substr(md5(random()::text || clock_timestamp()::text), 1, 16);

  INSERT INTO public.sales (id, appointment_id, customer_id, total_amount, payment_method, status)
  VALUES (v_sale_id, p_appointment_id, p_customer_id, v_total_amount, v_payment_method_norm, 'completed');

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_product_id := v_item->>'product_id';
    v_quantity := (v_item->>'quantity')::INT;
    v_unit_price := (v_item->>'unit_price')::NUMERIC(10,2);
    v_item_total := v_quantity * v_unit_price;

    INSERT INTO public.sale_items (id, sale_id, product_id, quantity, unit_price, total_price)
    VALUES (
      'item-' || substr(md5(random()::text || clock_timestamp()::text), 1, 16),
      v_sale_id,
      v_product_id,
      v_quantity,
      v_unit_price,
      v_item_total
    );
  END LOOP;

  IF p_register_in_caixa AND v_total_amount > 0 THEN
    INSERT INTO public.caixa (id, type, description, amount, payment_method, appointment_id)
    VALUES (
      'cx-' || substr(md5(random()::text || clock_timestamp()::text), 1, 16),
      'receita',
      'Venda de produtos' || CASE WHEN p_appointment_id IS NOT NULL THEN ' (Agendamento)' ELSE '' END,
      v_total_amount,
      v_payment_method_norm,
      p_appointment_id
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'sale_id', v_sale_id,
    'total_amount', v_total_amount,
    'items_count', jsonb_array_length(p_items)
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION public.create_sale_atomic(TEXT, TEXT, TEXT, JSONB, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_sale_atomic(TEXT, TEXT, TEXT, JSONB, BOOLEAN) TO authenticated, service_role;

-- ------------------------------------------------------------------------------
-- 4. Restauração de book_appointment_atomic (Versão 0019)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.book_appointment_atomic(
  p_client_id TEXT,
  p_barber_id TEXT,
  p_service_id TEXT,
  p_appointment_time TEXT,
  p_service_ids TEXT[] DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
  v_appt_id TEXT;
  v_s_id TEXT;
  v_conflict_count INT;
  v_service_duration INT := 30;
  v_total_duration INT := 0;
  v_parsed_time TIMESTAMPTZ;
  v_end_time TIMESTAMPTZ;
BEGIN
  v_parsed_time := p_appointment_time::TIMESTAMPTZ;

  IF p_service_ids IS NOT NULL AND array_length(p_service_ids, 1) > 0 THEN
    SELECT COALESCE(SUM(duration_minutes), 30) INTO v_total_duration
    FROM public.services
    WHERE id = ANY(p_service_ids);
  ELSE
    SELECT COALESCE(duration_minutes, 30) INTO v_total_duration
    FROM public.services
    WHERE id = p_service_id;
  END IF;

  IF v_total_duration <= 0 THEN v_total_duration := 30; END IF;
  v_end_time := v_parsed_time + (v_total_duration || ' minutes')::INTERVAL;

  PERFORM pg_advisory_xact_lock(hashtext('barber_booking_' || p_barber_id));

  SELECT COUNT(*) INTO v_conflict_count
  FROM public.appointments a
  WHERE a.barber_id = p_barber_id
    AND a.status NOT IN ('cancelled', 'completed')
    AND (
      (a.appointment_time::TIMESTAMPTZ, a.appointment_time::TIMESTAMPTZ + '30 minutes'::INTERVAL)
      OVERLAPS
      (v_parsed_time, v_end_time)
    );

  IF v_conflict_count > 0 THEN
    RAISE EXCEPTION 'HORARIO_INDISPONIVEL: Já existe um agendamento para este barbeiro neste intervalo.';
  END IF;

  v_appt_id := 'appt-' || substr(md5(random()::text || clock_timestamp()::text), 1, 16);

  INSERT INTO public.appointments (id, client_id, barber_id, service_id, appointment_time, status)
  VALUES (v_appt_id, p_client_id, p_barber_id, p_service_id, p_appointment_time, 'confirmed');

  IF p_service_ids IS NOT NULL AND array_length(p_service_ids, 1) > 0 THEN
    FOREACH v_s_id IN ARRAY p_service_ids
    LOOP
      INSERT INTO public.appointment_services (id, appointment_id, service_id)
      VALUES (
        'as-' || substr(md5(random()::text || clock_timestamp()::text), 1, 16),
        v_appt_id,
        v_s_id
      );
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'appointment_id', v_appt_id,
    'appointment_time', p_appointment_time,
    'total_duration_minutes', v_total_duration
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION public.book_appointment_atomic(TEXT, TEXT, TEXT, TEXT, TEXT[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.book_appointment_atomic(TEXT, TEXT, TEXT, TEXT, TEXT[]) TO authenticated, service_role;

COMMIT;
