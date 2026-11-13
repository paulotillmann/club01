-- Migration 0020: RPC para agendamento online público atômico (com criação/resolução de cliente e proteção contra conflito)
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
