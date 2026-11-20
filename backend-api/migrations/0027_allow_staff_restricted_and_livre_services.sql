-- Migration: 0027_allow_staff_restricted_and_livre_services.sql
-- Permite que a equipe autenticada (admin, secretario, barber) agende e remarque
-- serviços restritos (restricted_access = true) e serviços com duração 0 (Livre),
-- mantendo o bloqueio estrito para agendamentos públicos (anon/cliente).

CREATE OR REPLACE FUNCTION public.book_appointment_online(
  p_name text,
  p_phone text,
  p_barber_id text,
  p_service_ids text[],
  p_appointment_time text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_client_id TEXT;
  v_clean_phone TEXT;
  v_primary_service_id TEXT;
  v_primary_service_name TEXT;
  v_all_services_text TEXT;
  v_total_duration INTEGER := 0;
  v_start_time TIMESTAMP;
  v_end_time TIMESTAMP;
  v_dow INTEGER;
  v_closing_hour INTEGER := 20;
  v_opening_hour INTEGER := 9;
  v_min_lead_min INTEGER := 30;
  v_setting_val TEXT;
  v_conflict_count INTEGER := 0;
  v_appointment_id TEXT;
  v_sid TEXT;
  v_srv_rec RECORD;
  v_barber_exists BOOLEAN;
  v_has_specialties BOOLEAN;
  v_barber_executes_service BOOLEAN;
  v_caller_role TEXT;
  v_is_staff BOOLEAN := false;
BEGIN
  -- 1. Validação de parâmetros obrigatórios
  IF p_barber_id IS NULL OR p_appointment_time IS NULL OR p_service_ids IS NULL OR array_length(p_service_ids, 1) = 0 THEN
    RAISE EXCEPTION 'PARAMETROS_INVALIDOS: Profissional, data/horário e ao menos um serviço são obrigatórios.';
  END IF;

  IF p_name IS NULL OR trim(p_name) = '' THEN
    RAISE EXCEPTION 'PARAMETROS_INVALIDOS: O nome do cliente é obrigatório.';
  END IF;

  v_clean_phone := regexp_replace(COALESCE(p_phone, ''), '\D', '', 'g');
  IF length(v_clean_phone) < 10 THEN
    RAISE EXCEPTION 'PARAMETROS_INVALIDOS: Telefone / WhatsApp inválido (mínimo de 10 dígitos).';
  END IF;

  v_caller_role := public.current_user_role();
  v_is_staff := COALESCE(v_caller_role, '') IN ('admin', 'secretario', 'barber');

  -- 2. Concorrência: Lock transacional exclusivo por profissional
  PERFORM pg_advisory_xact_lock(hashtext('barber_booking_' || p_barber_id));

  -- 3. Validação do Profissional (deve existir e estar ativo)
  SELECT EXISTS(
    SELECT 1 FROM public.barbers WHERE id = p_barber_id AND COALESCE(is_active, true) = true
  ) INTO v_barber_exists;
  IF NOT v_barber_exists THEN
    RAISE EXCEPTION 'PROFISSIONAL_INVALIDO: O profissional selecionado não existe ou não está ativo para agendamentos.';
  END IF;

  -- Verificar se o barbeiro possui especialidades registradas
  SELECT EXISTS(SELECT 1 FROM public.barber_services WHERE barber_id = p_barber_id) INTO v_has_specialties;

  -- 4. Validação Estrita dos Serviços Selecionados
  v_primary_service_id := p_service_ids[1];
  FOREACH v_sid IN ARRAY p_service_ids LOOP
    SELECT id, name, duration_minutes, price, restricted_access
    INTO v_srv_rec
    FROM public.services
    WHERE id = v_sid;

    IF v_srv_rec.id IS NULL THEN
      RAISE EXCEPTION 'SERVICO_INVALIDO: O serviço solicitado (%) não existe no catálogo.', v_sid;
    END IF;

    -- REGRA DE SEGURANÇA: Rejeição de serviços restritos apenas para agendamento público (não-staff)
    IF v_srv_rec.restricted_access = true AND NOT v_is_staff THEN
      RAISE EXCEPTION 'SERVICO_RESTRITO: O serviço "%" é exclusivo para agendamento interno e não está disponível online.', v_srv_rec.name;
    END IF;

    IF v_srv_rec.duration_minutes IS NULL OR v_srv_rec.duration_minutes < 0 THEN
      RAISE EXCEPTION 'DURACAO_INVALIDA: A duração do serviço "%" é inválida.', v_srv_rec.name;
    END IF;

    -- REGRA: Verificar se o barbeiro executa o serviço (caso tenha especialidades vinculadas)
    IF v_has_specialties THEN
      SELECT EXISTS(
        SELECT 1 FROM public.barber_services 
        WHERE barber_id = p_barber_id AND service_id = v_sid
      ) INTO v_barber_executes_service;

      IF NOT v_barber_executes_service THEN
        RAISE EXCEPTION 'PROFISSIONAL_NAO_HABILITADO: O profissional selecionado não realiza o procedimento "%".', v_srv_rec.name;
      END IF;
    END IF;

    v_total_duration := v_total_duration + v_srv_rec.duration_minutes;
  END LOOP;

  -- 5. Tratamento de Horários e Expediente
  BEGIN
    v_start_time := p_appointment_time::timestamp;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'DATA_INVALIDA: Formato de data/horário inválido (esperado YYYY-MM-DDTHH:mm).';
  END;

  v_end_time := v_start_time + (v_total_duration || ' minutes')::interval;
  v_dow := EXTRACT(DOW FROM v_start_time);

  IF v_dow = 0 THEN
    RAISE EXCEPTION 'FORA_DO_EXPEDIENTE: O CLUB 01 não realiza atendimentos aos domingos.';
  END IF;

  IF v_dow = 6 THEN
    v_opening_hour := 8;
    v_closing_hour := CASE WHEN v_is_staff THEN 21 ELSE 19 END;
  ELSE
    v_opening_hour := 9;
    v_closing_hour := CASE WHEN v_is_staff THEN 23 ELSE 20 END;
  END IF;

  SELECT value INTO v_setting_val FROM public.settings WHERE key = 'shop_opening_hour';
  IF v_setting_val ~ '^\d+$' THEN v_opening_hour := v_setting_val::integer; END IF;

  IF NOT v_is_staff THEN
    SELECT value INTO v_setting_val FROM public.settings WHERE key = 'shop_closing_hour';
    IF v_setting_val ~ '^\d+$' THEN v_closing_hour := v_setting_val::integer; END IF;
  END IF;

  IF EXTRACT(HOUR FROM v_start_time) < v_opening_hour THEN
    RAISE EXCEPTION 'FORA_DO_EXPEDIENTE: O atendimento não pode iniciar antes das %:00.', v_opening_hour;
  END IF;

  IF v_end_time > (date_trunc('day', v_start_time) + (v_closing_hour || ' hours')::interval) THEN
    RAISE EXCEPTION 'FORA_DO_EXPEDIENTE: A duração total (% min) ultrapassa o horário de encerramento das %:00.', v_total_duration, v_closing_hour;
  END IF;

  IF NOT v_is_staff THEN
    SELECT value INTO v_setting_val FROM public.settings WHERE key = 'min_lead_time_minutes';
    IF v_setting_val ~ '^\d+$' THEN v_min_lead_min := v_setting_val::integer; END IF;

    IF v_start_time < (now() AT TIME ZONE 'America/Sao_Paulo' + (v_min_lead_min || ' minutes')::interval) THEN
      RAISE EXCEPTION 'ANTECEDENCIA_MINIMA: O agendamento exige uma antecedência mínima de % minutos.', v_min_lead_min;
    END IF;
  END IF;

  -- 6. Validação de Conflito de Horário e Sobreposição (serviços Livre = 0 min não ocupam horário)
  IF v_total_duration > 0 THEN
    WITH existing_appt_durations AS (
      SELECT 
        a.id,
        a.appointment_time,
        COALESCE(
          (
            SELECT SUM(COALESCE(s_multi.duration_minutes, 30))
            FROM public.appointment_services aps
            JOIN public.services s_multi ON aps.service_id = s_multi.id
            WHERE aps.appointment_id = a.id
          ),
          s_single.duration_minutes,
          30
        )::integer AS appt_total_duration
      FROM public.appointments a
      LEFT JOIN public.services s_single ON a.service_id = s_single.id
      WHERE a.barber_id = p_barber_id
        AND (
          a.status IN ('confirmed', 'pending')
          OR (a.status = 'cancelled' AND a.cancellation_reason IS NOT NULL AND a.cancellation_reason <> '')
        )
    )
    SELECT COUNT(*) INTO v_conflict_count
    FROM existing_appt_durations ead
    WHERE ead.appt_total_duration > 0
      AND ead.appointment_time::timestamp < v_end_time
      AND (ead.appointment_time::timestamp + (ead.appt_total_duration || ' minutes')::interval) > v_start_time;

    IF v_conflict_count > 0 THEN
      RAISE EXCEPTION 'HORARIO_INDISPONIVEL: O profissional já possui um agendamento ou bloqueio no intervalo selecionado.';
    END IF;
  END IF;

  -- 7. Resolução / Cadastro do Cliente
  SELECT id INTO v_client_id
  FROM public.customers
  WHERE regexp_replace(phone, '\D', '', 'g') = v_clean_phone
  LIMIT 1;

  IF v_client_id IS NULL THEN
    v_client_id := gen_random_uuid()::text;
    INSERT INTO public.customers (id, name, phone)
    VALUES (v_client_id, UPPER(TRIM(p_name)), v_clean_phone);
  END IF;

  -- 8. Inserção do Agendamento Principal
  v_appointment_id := gen_random_uuid()::text;

  INSERT INTO public.appointments (
    id, client_id, barber_id, service_id, appointment_time, status
  ) VALUES (
    v_appointment_id, v_client_id, p_barber_id, v_primary_service_id, p_appointment_time, 'confirmed'
  );

  -- 9. Inserção de Múltiplos Serviços
  FOREACH v_sid IN ARRAY p_service_ids LOOP
    INSERT INTO public.appointment_services (appointment_id, service_id)
    VALUES (v_appointment_id, v_sid)
    ON CONFLICT DO NOTHING;
  END LOOP;

  -- 10. Sincronizar o conteúdo das notificações pendentes com todos os serviços inseridos
  IF array_length(p_service_ids, 1) > 1 THEN
    SELECT name INTO v_primary_service_name FROM public.services WHERE id = v_primary_service_id;
    v_all_services_text := public.get_appointment_service_names(v_appointment_id, v_primary_service_id);
    IF v_primary_service_name IS NOT NULL AND v_all_services_text IS NOT NULL AND v_all_services_text <> v_primary_service_name THEN
      UPDATE public.notification_queue
      SET content = replace(content, '✂️ Serviço: ' || v_primary_service_name, '✂️ Serviço: ' || v_all_services_text),
          updated_at = now()
      WHERE appointment_id = v_appointment_id
        AND status = 'pending'
        AND content LIKE '%✂️ Serviço: ' || v_primary_service_name || '%';
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'appointment_id', v_appointment_id,
    'client_id', v_client_id,
    'barber_id', p_barber_id,
    'appointment_time', p_appointment_time,
    'duration_minutes', v_total_duration
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.reschedule_appointment_online(
  p_appointment_id text,
  p_new_appointment_time text,
  p_new_barber_id text DEFAULT NULL::text,
  p_service_ids text[] DEFAULT NULL::text[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_old_appt RECORD;
  v_caller_uid UUID;
  v_caller_role TEXT;
  v_target_barber_id TEXT;
  v_start_time TIMESTAMP;
  v_end_time TIMESTAMP;
  v_dow INTEGER;
  v_opening_hour INTEGER;
  v_closing_hour INTEGER;
  v_setting_val TEXT;
  v_min_lead_min INTEGER := 30;
  v_total_duration INTEGER := 0;
  v_total_price NUMERIC(10, 2) := 0;
  v_active_service_ids TEXT[];
  v_sid TEXT;
  v_srv_rec RECORD;
  v_barber_executes_service BOOLEAN;
  v_conflict_count INTEGER := 0;
  v_primary_service_id TEXT;
  v_is_staff BOOLEAN;
BEGIN
  -- 1. Validação de parâmetros obrigatórios
  IF p_appointment_id IS NULL OR trim(p_appointment_id) = '' THEN
    RAISE EXCEPTION 'PARAMETROS_INVALIDOS: O identificador do agendamento é obrigatório.';
  END IF;

  IF p_new_appointment_time IS NULL OR trim(p_new_appointment_time) = '' THEN
    RAISE EXCEPTION 'PARAMETROS_INVALIDOS: O novo horário de agendamento é obrigatório.';
  END IF;

  -- 2. Confirmar a existência do agendamento
  SELECT a.id, a.client_id, a.barber_id, a.service_id, a.appointment_time, a.status, a.cancellation_reason
  INTO v_old_appt
  FROM public.appointments a
  WHERE a.id = p_appointment_id;

  IF v_old_appt.id IS NULL THEN
    RAISE EXCEPTION 'AGENDAMENTO_NAO_ENCONTRADO: O agendamento % não foi encontrado.', p_appointment_id;
  END IF;

  -- 3. Validar status do agendamento
  IF v_old_appt.status = 'cancelled' THEN
    RAISE EXCEPTION 'AGENDAMENTO_CANCELADO: Não é permitido remarcar um agendamento já cancelado.';
  END IF;

  IF v_old_appt.status = 'completed' THEN
    RAISE EXCEPTION 'AGENDAMENTO_CONCLUIDO: Não é permitido remarcar um agendamento já concluído.';
  END IF;

  -- 4. Validação de Autenticação e Autorização
  v_caller_uid := auth.uid();
  IF v_caller_uid IS NULL THEN
    RAISE EXCEPTION 'ACESSO_NEGADO: A remarcação de agendamentos exige autenticação segura no sistema.';
  END IF;

  v_caller_role := public.current_user_role();
  v_is_staff := COALESCE(v_caller_role, '') IN ('admin', 'secretario', 'barber');

  IF p_new_barber_id IS NOT NULL AND trim(p_new_barber_id) <> '' THEN
    v_target_barber_id := p_new_barber_id;
  ELSE
    v_target_barber_id := v_old_appt.barber_id;
  END IF;

  IF v_caller_role IN ('admin', 'secretario') THEN
    NULL;
  ELSIF v_caller_role = 'barber' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.barbers
      WHERE id = v_old_appt.barber_id
        AND (user_id = v_caller_uid::text OR user_id = (SELECT id::text FROM public.users WHERE auth_user_id = v_caller_uid LIMIT 1))
    ) THEN
      RAISE EXCEPTION 'ACESSO_NEGADO: Barbeiros só podem remarcar agendamentos atribuídos à sua própria agenda.';
    END IF;

    IF v_target_barber_id <> v_old_appt.barber_id THEN
      RAISE EXCEPTION 'ACESSO_NEGADO: Barbeiros não possuem permissão para transferir agendamentos para outros profissionais.';
    END IF;
  ELSE
    IF NOT (
      v_old_appt.client_id = v_caller_uid::text
      OR EXISTS (
        SELECT 1
        FROM public.customers c
        JOIN public.users u ON pg_catalog.regexp_replace(c.phone, '\D', '', 'g') = pg_catalog.regexp_replace(u.phone, '\D', '', 'g')
        WHERE (u.auth_user_id = v_caller_uid OR u.id = v_caller_uid::text)
          AND c.id = v_old_appt.client_id
      )
    ) THEN
      RAISE EXCEPTION 'ACESSO_NEGADO: Você não possui autorização para remarcar agendamentos de outros clientes.';
    END IF;

    IF v_target_barber_id <> v_old_appt.barber_id THEN
      RAISE EXCEPTION 'ACESSO_NEGADO: A alteração de profissional é restrita à administração.';
    END IF;
  END IF;

  -- 5. Validar Existência e Ativação do Profissional de Destino
  IF NOT EXISTS (SELECT 1 FROM public.barbers WHERE id = v_target_barber_id AND COALESCE(is_active, true) = true) THEN
    RAISE EXCEPTION 'PROFISSIONAL_INVALIDO: O profissional selecionado não existe ou não está ativo para atendimentos.';
  END IF;

  -- 6. Locks Transacionais Determinísticos por Profissional
  IF v_old_appt.barber_id = v_target_barber_id THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('barber_booking_' || v_target_barber_id));
  ELSE
    IF v_old_appt.barber_id < v_target_barber_id THEN
      PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('barber_booking_' || v_old_appt.barber_id));
      PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('barber_booking_' || v_target_barber_id));
    ELSE
      PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('barber_booking_' || v_target_barber_id));
      PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('barber_booking_' || v_old_appt.barber_id));
    END IF;
  END IF;

  -- 7. Determinação e Validação dos Serviços
  IF p_service_ids IS NOT NULL AND array_length(p_service_ids, 1) > 0 THEN
    v_active_service_ids := p_service_ids;
  ELSE
    SELECT array_agg(service_id) INTO v_active_service_ids
    FROM public.appointment_services
    WHERE appointment_id = p_appointment_id;

    IF v_active_service_ids IS NULL OR array_length(v_active_service_ids, 1) = 0 THEN
      IF v_old_appt.service_id IS NOT NULL THEN
        v_active_service_ids := ARRAY[v_old_appt.service_id];
      END IF;
    END IF;
  END IF;

  IF v_active_service_ids IS NULL OR array_length(v_active_service_ids, 1) = 0 THEN
    RAISE EXCEPTION 'SERVICO_INVALIDO: O agendamento não possui serviços vinculados válidos.';
  END IF;

  v_primary_service_id := v_active_service_ids[1];

  FOREACH v_sid IN ARRAY v_active_service_ids LOOP
    SELECT id, name, duration_minutes, price, restricted_access
    INTO v_srv_rec
    FROM public.services
    WHERE id = v_sid;

    IF v_srv_rec.id IS NULL THEN
      RAISE EXCEPTION 'SERVICO_INVALIDO: O serviço solicitado (%) não existe no catálogo.', v_sid;
    END IF;

    IF v_srv_rec.restricted_access = true AND NOT v_is_staff THEN
      RAISE EXCEPTION 'SERVICO_RESTRITO: O serviço "%" é exclusivo para agendamento interno e não está disponível online.', v_srv_rec.name;
    END IF;

    IF v_srv_rec.duration_minutes IS NULL OR v_srv_rec.duration_minutes < 0 THEN
      RAISE EXCEPTION 'DURACAO_INVALIDA: A duração do serviço "%" é inválida.', v_srv_rec.name;
    END IF;

    SELECT EXISTS(
      SELECT 1 FROM public.barber_services
      WHERE barber_id = v_target_barber_id AND service_id = v_sid
    ) INTO v_barber_executes_service;

    IF NOT v_barber_executes_service THEN
      RAISE EXCEPTION 'PROFISSIONAL_NAO_HABILITADO: O profissional selecionado não realiza o procedimento "%".', v_srv_rec.name;
    END IF;

    v_total_duration := v_total_duration + v_srv_rec.duration_minutes;
    v_total_price := v_total_price + COALESCE(v_srv_rec.price, 0);
  END LOOP;

  -- 8. Validação de Formato, Expediente e Antecedência
  BEGIN
    v_start_time := p_new_appointment_time::timestamp;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'DATA_INVALIDA: Formato de data/horário inválido (esperado YYYY-MM-DDTHH:mm).';
  END;

  v_end_time := v_start_time + (v_total_duration || ' minutes')::interval;
  v_dow := EXTRACT(DOW FROM v_start_time);

  IF v_dow = 0 THEN
    RAISE EXCEPTION 'FORA_DO_EXPEDIENTE: O CLUB 01 não realiza atendimentos aos domingos.';
  END IF;

  IF v_dow = 6 THEN
    v_opening_hour := 8;
    v_closing_hour := CASE WHEN v_is_staff THEN 21 ELSE 19 END;
  ELSE
    v_opening_hour := 9;
    v_closing_hour := CASE WHEN v_is_staff THEN 23 ELSE 20 END;
  END IF;

  SELECT value INTO v_setting_val FROM public.settings WHERE key = 'shop_opening_hour';
  IF v_setting_val ~ '^\d+$' THEN v_opening_hour := v_setting_val::integer; END IF;

  IF NOT v_is_staff THEN
    SELECT value INTO v_setting_val FROM public.settings WHERE key = 'shop_closing_hour';
    IF v_setting_val ~ '^\d+$' THEN v_closing_hour := v_setting_val::integer; END IF;
  END IF;

  IF EXTRACT(HOUR FROM v_start_time) < v_opening_hour THEN
    RAISE EXCEPTION 'FORA_DO_EXPEDIENTE: O atendimento não pode iniciar antes das %:00.', v_opening_hour;
  END IF;

  IF v_end_time > (pg_catalog.date_trunc('day', v_start_time) + (v_closing_hour || ' hours')::interval) THEN
    RAISE EXCEPTION 'FORA_DO_EXPEDIENTE: A duração total (% min) ultrapassa o horário de encerramento das %:00.', v_total_duration, v_closing_hour;
  END IF;

  IF NOT v_is_staff THEN
    SELECT value INTO v_setting_val FROM public.settings WHERE key = 'min_lead_time_minutes';
    IF v_setting_val ~ '^\d+$' THEN v_min_lead_min := v_setting_val::integer; END IF;

    IF v_start_time < (pg_catalog.now() AT TIME ZONE 'America/Sao_Paulo' + (v_min_lead_min || ' minutes')::interval) THEN
      RAISE EXCEPTION 'ANTECEDENCIA_MINIMA: A remarcação exige uma antecedência mínima de % minutos.', v_min_lead_min;
    END IF;
  END IF;

  -- 9. Validação de Conflito de Horário (serviços Livre = 0 min não ocupam horário)
  IF v_total_duration > 0 THEN
    WITH existing_appt_durations AS (
      SELECT
        a.id,
        a.appointment_time,
        COALESCE(
          (
            SELECT sum(COALESCE(s_multi.duration_minutes, 30))
            FROM public.appointment_services aps
            JOIN public.services s_multi ON aps.service_id = s_multi.id
            WHERE aps.appointment_id = a.id
          ),
          s_single.duration_minutes,
          30
        )::integer AS appt_total_duration
      FROM public.appointments a
      LEFT JOIN public.services s_single ON a.service_id = s_single.id
      WHERE a.barber_id = v_target_barber_id
        AND a.id <> p_appointment_id
        AND (
          a.status IN ('confirmed', 'pending')
          OR (a.status = 'cancelled' AND a.client_id = 'cust-bloqueio-sistema' AND a.cancellation_reason IS NOT NULL)
        )
    )
    SELECT COUNT(*) INTO v_conflict_count
    FROM existing_appt_durations ead
    WHERE ead.appt_total_duration > 0
      AND ead.appointment_time::timestamp < v_end_time
      AND (ead.appointment_time::timestamp + (ead.appt_total_duration || ' minutes')::interval) > v_start_time;

    IF v_conflict_count > 0 THEN
      RAISE EXCEPTION 'HORARIO_INDISPONIVEL: O profissional já possui um agendamento ou bloqueio no intervalo selecionado.';
    END IF;
  END IF;

  -- 10. Atualização Atômica de appointments, appointment_services e caixa
  PERFORM pg_catalog.set_config('club01.in_reschedule_rpc', 'true', true);

  UPDATE public.appointments
  SET appointment_time = p_new_appointment_time,
      barber_id = v_target_barber_id,
      service_id = v_primary_service_id,
      status = 'confirmed',
      updated_at = pg_catalog.now()
  WHERE id = p_appointment_id;

  PERFORM pg_catalog.set_config('club01.in_reschedule_rpc', 'false', true);

  IF p_service_ids IS NOT NULL AND array_length(p_service_ids, 1) > 0 THEN
    DELETE FROM public.appointment_services WHERE appointment_id = p_appointment_id;
    FOREACH v_sid IN ARRAY p_service_ids LOOP
      INSERT INTO public.appointment_services (appointment_id, service_id)
      VALUES (p_appointment_id, v_sid)
      ON CONFLICT DO NOTHING;
    END LOOP;
  END IF;

  UPDATE public.caixa
  SET amount = v_total_price,
      barber_id = v_target_barber_id,
      date = split_part(p_new_appointment_time, 'T', 1)
  WHERE (appointment_id = p_appointment_id OR id = 'cx-srv-' || p_appointment_id)
    AND COALESCE(category, '') NOT IN ('Venda de Produtos', 'Produto')
    AND id NOT LIKE 'caixa-sale-%';

  RETURN pg_catalog.jsonb_build_object(
    'success', true,
    'appointment_id', p_appointment_id,
    'barber_id', v_target_barber_id,
    'appointment_time', p_new_appointment_time,
    'duration_minutes', v_total_duration,
    'total_price', v_total_price,
    'service_ids', v_active_service_ids,
    'message', 'Agendamento remarcado com sucesso.'
  );
END;
$function$;

