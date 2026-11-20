-- Migration: 0028_recurring_appointments.sql
-- Suporte completo a Agendamentos Recorrentes:
-- 1. Coluna recurrence_id em public.appointments
-- 2. Ajuste na trigger handle_appointment_notifications para omitir confirmação imediata em série recorrente (mantendo lembrete 30m)
-- 3. RPC book_recurring_appointments (pula datas com conflito ou domingo)
-- 4. RPC cancel_recurring_appointments (cancela "apenas este" ou "este e os próximos")

ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS recurrence_id TEXT;

CREATE INDEX IF NOT EXISTS idx_appointments_recurrence_id
  ON public.appointments(recurrence_id);

-- Atualizar trigger para respeitar club01.skip_immediate_notif em criações recorrentes
CREATE OR REPLACE FUNCTION public.handle_appointment_notifications()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_client_name TEXT := 'Cliente';
  v_client_phone TEXT := '';
  v_barber_name TEXT := 'Profissional';
  v_barber_phone TEXT := '';
  v_old_barber_name TEXT := '';
  v_old_barber_phone TEXT := '';
  v_services_text TEXT := '';
  v_dt_rec RECORD;
  v_scheduled_reminder TIMESTAMPTZ;
  v_now TIMESTAMPTZ := now();
  v_is_admin_block BOOLEAN := false;
  v_skip_immediate BOOLEAN := false;
BEGIN
  -- 1. IDENTIFICAR SE É BLOQUEIO ADMINISTRATIVO DE AGENDA
  IF NEW.client_id = 'cust-bloqueio-sistema' 
     OR (NEW.cancellation_reason IS NOT NULL AND NEW.cancellation_reason ILIKE '%BLOQUEIO%') THEN
    v_is_admin_block := true;
  END IF;

  -- 2. RECUPERAR DADOS DO CLIENTE
  SELECT COALESCE(name, 'Cliente'), COALESCE(phone, '')
  INTO v_client_name, v_client_phone
  FROM public.customers
  WHERE id = NEW.client_id;

  IF v_client_name ILIKE '%BLOQUEIO DE AGENDA%' THEN
    v_is_admin_block := true;
  END IF;

  IF v_is_admin_block THEN
    RETURN NEW;
  END IF;

  -- 3. RECUPERAR DADOS DO PROFISSIONAL (BARBEIRO)
  SELECT COALESCE(name, 'Profissional'), COALESCE(phone, '')
  INTO v_barber_name, v_barber_phone
  FROM public.barbers
  WHERE id = NEW.barber_id;

  -- 4. FORMATAR SERVIÇOS E DATA/HORA
  v_services_text := public.get_appointment_service_names(NEW.id, NEW.service_id);
  v_dt_rec := public.format_appointment_dt(NEW.appointment_time);

  v_skip_immediate := COALESCE(current_setting('club01.skip_immediate_notif', true), '') = 'true';

  -- ============================================================================
  -- EVENTO 1: NOVO AGENDAMENTO (INSERT com status 'confirmed')
  -- ============================================================================
  IF (TG_OP = 'INSERT') THEN
    IF NEW.status = 'confirmed' THEN
      IF NOT v_skip_immediate THEN
        -- MENSAGEM 1: Confirmação para o Cliente
        IF v_client_phone <> '' THEN
          INSERT INTO public.notification_queue (
            appointment_id, event_type, recipient_type, recipient_phone, recipient_name,
            content, scheduled_for, idempotency_key, metadata
          ) VALUES (
            NEW.id,
            'new_appointment',
            'client',
            v_client_phone,
            v_client_name,
            'Olá, ' || v_client_name || '! 💈' || E'\n\n' ||
            'Seu agendamento no CLUB 01 Barber Studio foi confirmado!' || E'\n\n' ||
            '✂️ Serviço: ' || v_services_text || E'\n' ||
            '👤 Profissional: ' || v_barber_name || E'\n' ||
            '📅 Data: ' || v_dt_rec.data_fmt || E'\n' ||
            '🕒 Horário: ' || v_dt_rec.hora_fmt || E'\n\n' ||
            'Esperamos por você!',
            v_now,
            'new_appt_client_' || NEW.id,
            jsonb_build_object('client_id', NEW.client_id, 'barber_id', NEW.barber_id)
          ) ON CONFLICT (idempotency_key) DO NOTHING;
        END IF;

        -- MENSAGEM 2: Aviso de Novo Agendamento para o Barbeiro
        IF v_barber_phone <> '' THEN
          INSERT INTO public.notification_queue (
            appointment_id, event_type, recipient_type, recipient_phone, recipient_name,
            content, scheduled_for, idempotency_key, metadata
          ) VALUES (
            NEW.id,
            'new_appointment',
            'barber',
            v_barber_phone,
            v_barber_name,
            'Olá, ' || v_barber_name || '! 💈' || E'\n\n' ||
            'Você recebeu um novo agendamento no CLUB 01 Barber Studio.' || E'\n\n' ||
            '👤 Cliente: ' || v_client_name || E'\n' ||
            '✂️ Serviço: ' || v_services_text || E'\n' ||
            '📅 Data: ' || v_dt_rec.data_fmt || E'\n' ||
            '🕒 Horário: ' || v_dt_rec.hora_fmt,
            v_now,
            'new_appt_barber_' || NEW.id,
            jsonb_build_object('client_id', NEW.client_id, 'barber_id', NEW.barber_id)
          ) ON CONFLICT (idempotency_key) DO NOTHING;
        ELSE
          INSERT INTO public.notification_queue (
            appointment_id, event_type, recipient_type, recipient_phone, recipient_name,
            content, scheduled_for, status, last_error, idempotency_key
          ) VALUES (
            NEW.id,
            'new_appointment',
            'barber',
            'SEM_TELEFONE',
            v_barber_name,
            'Aviso de agendamento não enviado: barbeiro sem telefone cadastrado.',
            v_now,
            'failed',
            'Barbeiro sem telefone cadastrado na base',
            'new_appt_barber_' || NEW.id
          ) ON CONFLICT (idempotency_key) DO NOTHING;
        END IF;
      END IF;

      -- MENSAGEM 3: Programação do Lembrete de 30 Minutos para o Cliente
      BEGIN
        IF NEW.appointment_time ~ 'Z$' OR NEW.appointment_time ~ '[+-]\d{2}(:\d{2})?$' THEN
          v_scheduled_reminder := NEW.appointment_time::timestamptz - interval '30 minutes';
        ELSE
          v_scheduled_reminder := ((replace(NEW.appointment_time, 'T', ' ')::timestamp) AT TIME ZONE 'America/Sao_Paulo') - interval '30 minutes';
        END IF;
      EXCEPTION WHEN OTHERS THEN
        v_scheduled_reminder := v_now - interval '1 hour';
      END;

      IF v_client_phone <> '' THEN
        IF v_scheduled_reminder <= v_now THEN
          INSERT INTO public.notification_queue (
            appointment_id, event_type, recipient_type, recipient_phone, recipient_name,
            content, scheduled_for, status, last_error, idempotency_key
          ) VALUES (
            NEW.id,
            'reminder_30m',
            'client',
            v_client_phone,
            v_client_name,
            'Lembrete de 30 min não aplicável (agendamento criado com menos de 30 min de antecedência).',
            v_now,
            'skipped',
            'Criado com menos de 30 minutos de antecedência; lembrete não aplicável',
            'reminder_30m_client_' || NEW.id || '_' || extract(epoch from v_scheduled_reminder)::bigint
          ) ON CONFLICT (idempotency_key) DO NOTHING;
        ELSE
          INSERT INTO public.notification_queue (
            appointment_id, event_type, recipient_type, recipient_phone, recipient_name,
            content, scheduled_for, status, idempotency_key, metadata
          ) VALUES (
            NEW.id,
            'reminder_30m',
            'client',
            v_client_phone,
            v_client_name,
            'Olá, ' || v_client_name || '! 💈' || E'\n\n' ||
            'Passando para lembrar que seu horário no CLUB 01 Barber Studio está chegando!' || E'\n\n' ||
            '✂️ Serviço: ' || v_services_text || E'\n' ||
            '👤 Profissional: ' || v_barber_name || E'\n' ||
            '📅 Data: ' || v_dt_rec.data_fmt || E'\n' ||
            '🕒 Horário: ' || v_dt_rec.hora_fmt || E'\n\n' ||
            'Faltam aproximadamente 30 minutos para o seu atendimento.' || E'\n\n' ||
            'Até já!',
            v_scheduled_reminder,
            'pending',
            'reminder_30m_client_' || NEW.id || '_' || extract(epoch from v_scheduled_reminder)::bigint,
            jsonb_build_object('client_id', NEW.client_id, 'barber_id', NEW.barber_id)
          ) ON CONFLICT (idempotency_key) DO NOTHING;
        END IF;
      END IF;

    END IF;
    RETURN NEW;
  END IF;

  -- ============================================================================
  -- EVENTO 2: CANCELAMENTO (UPDATE para status = 'cancelled')
  -- ============================================================================
  IF (TG_OP = 'UPDATE') THEN
    IF (NEW.status = 'cancelled' AND OLD.status <> 'cancelled') THEN
      UPDATE public.notification_queue
      SET status = 'cancelled',
          last_error = 'Agendamento cancelado pelo usuário/administrador',
          updated_at = v_now
      WHERE appointment_id = NEW.id
        AND status = 'pending'
        AND event_type = 'reminder_30m';

      IF v_client_phone <> '' THEN
        INSERT INTO public.notification_queue (
          appointment_id, event_type, recipient_type, recipient_phone, recipient_name,
          content, scheduled_for, idempotency_key, metadata
        ) VALUES (
          NEW.id,
          'cancellation',
          'client',
          v_client_phone,
          v_client_name,
          'Olá, ' || v_client_name || '.' || E'\n\n' ||
          'Seu agendamento no CLUB 01 Barber Studio foi cancelado.' || E'\n\n' ||
          '✂️ Serviço: ' || v_services_text || E'\n' ||
          '📅 Data: ' || v_dt_rec.data_fmt || E'\n' ||
          '🕒 Horário: ' || v_dt_rec.hora_fmt || E'\n\n' ||
          'Para marcar um novo horário, acesse nossos canais de atendimento.',
          v_now,
          'cancel_client_' || NEW.id || '_' || extract(epoch from v_now)::bigint,
          jsonb_build_object('cancellation_reason', NEW.cancellation_reason)
        ) ON CONFLICT (idempotency_key) DO NOTHING;
      END IF;

      IF v_barber_phone <> '' THEN
        INSERT INTO public.notification_queue (
          appointment_id, event_type, recipient_type, recipient_phone, recipient_name,
          content, scheduled_for, idempotency_key, metadata
        ) VALUES (
          NEW.id,
          'cancellation',
          'barber',
          v_barber_phone,
          v_barber_name,
          'Olá, ' || v_barber_name || '! 💈' || E'\n\n' ||
          'O atendimento do cliente ' || v_client_name || ' agendado para ' ||
          v_dt_rec.data_fmt || ' às ' || v_dt_rec.hora_fmt || ' foi cancelado.',
          v_now,
          'cancel_barber_' || NEW.id || '_' || extract(epoch from v_now)::bigint,
          jsonb_build_object('cancellation_reason', NEW.cancellation_reason)
        ) ON CONFLICT (idempotency_key) DO NOTHING;
      END IF;

      RETURN NEW;
    END IF;

    -- ==========================================================================
    -- EVENTO 3: REMARCAÇÃO (Alteração de Data, Horário ou Profissional)
    -- ==========================================================================
    IF (NEW.status = 'confirmed' AND (
      NEW.appointment_time <> OLD.appointment_time OR 
      NEW.barber_id <> OLD.barber_id
    )) THEN
      UPDATE public.notification_queue
      SET status = 'cancelled',
          last_error = 'Horário ou profissional remarcado',
          updated_at = v_now
      WHERE appointment_id = NEW.id
        AND status = 'pending'
        AND event_type = 'reminder_30m';

      IF v_client_phone <> '' THEN
        INSERT INTO public.notification_queue (
          appointment_id, event_type, recipient_type, recipient_phone, recipient_name,
          content, scheduled_for, idempotency_key, metadata
        ) VALUES (
          NEW.id,
          'reschedule',
          'client',
          v_client_phone,
          v_client_name,
          'Olá, ' || v_client_name || '! 💈' || E'\n\n' ||
          'Seu agendamento no CLUB 01 Barber Studio foi remarcado!' || E'\n\n' ||
          '✂️ Serviço: ' || v_services_text || E'\n' ||
          '👤 Profissional: ' || v_barber_name || E'\n' ||
          '📅 Data: ' || v_dt_rec.data_fmt || E'\n' ||
          '🕒 Horário: ' || v_dt_rec.hora_fmt || E'\n\n' ||
          'Esperamos por você!',
          v_now,
          'resched_client_' || NEW.id || '_' || extract(epoch from v_now)::bigint,
          jsonb_build_object('old_time', OLD.appointment_time, 'new_time', NEW.appointment_time)
        ) ON CONFLICT (idempotency_key) DO NOTHING;
      END IF;

      IF (NEW.barber_id <> OLD.barber_id) THEN
        SELECT COALESCE(name, 'Profissional'), COALESCE(phone, '')
        INTO v_old_barber_name, v_old_barber_phone
        FROM public.barbers
        WHERE id = OLD.barber_id;

        IF v_old_barber_phone <> '' THEN
          INSERT INTO public.notification_queue (
            appointment_id, event_type, recipient_type, recipient_phone, recipient_name,
            content, scheduled_for, idempotency_key, metadata
          ) VALUES (
            NEW.id,
            'reschedule',
            'old_barber',
            v_old_barber_phone,
            v_old_barber_name,
            'Olá, ' || v_old_barber_name || '! 💈' || E'\n\n' ||
            'O atendimento do cliente ' || v_client_name || ' agendado para ' ||
            v_dt_rec.data_fmt || ' às ' || v_dt_rec.hora_fmt || ' foi transferido para outro profissional.',
            v_now,
            'resched_old_barber_' || NEW.id || '_' || extract(epoch from v_now)::bigint,
            jsonb_build_object('old_barber_id', OLD.barber_id, 'new_barber_id', NEW.barber_id)
          ) ON CONFLICT (idempotency_key) DO NOTHING;
        END IF;

        IF v_barber_phone <> '' THEN
          INSERT INTO public.notification_queue (
            appointment_id, event_type, recipient_type, recipient_phone, recipient_name,
            content, scheduled_for, idempotency_key, metadata
          ) VALUES (
            NEW.id,
            'reschedule',
            'new_barber',
            v_barber_phone,
            v_barber_name,
            'Olá, ' || v_barber_name || '! 💈' || E'\n\n' ||
            'Você recebeu um novo agendamento no CLUB 01 Barber Studio.' || E'\n\n' ||
            '👤 Cliente: ' || v_client_name || E'\n' ||
            '✂️ Serviço: ' || v_services_text || E'\n' ||
            '📅 Data: ' || v_dt_rec.data_fmt || E'\n' ||
            '🕒 Horário: ' || v_dt_rec.hora_fmt,
            v_now,
            'resched_new_barber_' || NEW.id || '_' || extract(epoch from v_now)::bigint,
            jsonb_build_object('old_barber_id', OLD.barber_id, 'new_barber_id', NEW.barber_id)
          ) ON CONFLICT (idempotency_key) DO NOTHING;
        END IF;
      ELSE
        IF v_barber_phone <> '' THEN
          INSERT INTO public.notification_queue (
            appointment_id, event_type, recipient_type, recipient_phone, recipient_name,
            content, scheduled_for, idempotency_key, metadata
          ) VALUES (
            NEW.id,
            'reschedule',
            'barber',
            v_barber_phone,
            v_barber_name,
            'Olá, ' || v_barber_name || '! 💈' || E'\n\n' ||
            'O horário do cliente ' || v_client_name || ' foi alterado para ' ||
            v_dt_rec.data_fmt || ' às ' || v_dt_rec.hora_fmt || '.',
            v_now,
            'resched_barber_' || NEW.id || '_' || extract(epoch from v_now)::bigint,
            jsonb_build_object('old_time', OLD.appointment_time, 'new_time', NEW.appointment_time)
          ) ON CONFLICT (idempotency_key) DO NOTHING;
        END IF;
      END IF;

      BEGIN
        IF NEW.appointment_time ~ 'Z$' OR NEW.appointment_time ~ '[+-]\d{2}(:\d{2})?$' THEN
          v_scheduled_reminder := NEW.appointment_time::timestamptz - interval '30 minutes';
        ELSE
          v_scheduled_reminder := ((replace(NEW.appointment_time, 'T', ' ')::timestamp) AT TIME ZONE 'America/Sao_Paulo') - interval '30 minutes';
        END IF;
      EXCEPTION WHEN OTHERS THEN
        v_scheduled_reminder := v_now - interval '1 hour';
      END;

      IF v_client_phone <> '' THEN
        IF v_scheduled_reminder <= v_now THEN
          INSERT INTO public.notification_queue (
            appointment_id, event_type, recipient_type, recipient_phone, recipient_name,
            content, scheduled_for, status, last_error, idempotency_key
          ) VALUES (
            NEW.id,
            'reminder_30m',
            'client',
            v_client_phone,
            v_client_name,
            'Lembrete de 30 min não aplicável (remarcado com menos de 30 min de antecedência).',
            v_now,
            'skipped',
            'Remarcado com menos de 30 minutos de antecedência; lembrete não aplicável',
            'reminder_30m_client_' || NEW.id || '_' || extract(epoch from v_scheduled_reminder)::bigint
          ) ON CONFLICT (idempotency_key) DO NOTHING;
        ELSE
          INSERT INTO public.notification_queue (
            appointment_id, event_type, recipient_type, recipient_phone, recipient_name,
            content, scheduled_for, status, idempotency_key, metadata
          ) VALUES (
            NEW.id,
            'reminder_30m',
            'client',
            v_client_phone,
            v_client_name,
            'Olá, ' || v_client_name || '! 💈' || E'\n\n' ||
            'Passando para lembrar que seu horário no CLUB 01 Barber Studio está chegando!' || E'\n\n' ||
            '✂️ Serviço: ' || v_services_text || E'\n' ||
            '👤 Profissional: ' || v_barber_name || E'\n' ||
            '📅 Data: ' || v_dt_rec.data_fmt || E'\n' ||
            '🕒 Horário: ' || v_dt_rec.hora_fmt || E'\n\n' ||
            'Faltam aproximadamente 30 minutos para o seu atendimento.' || E'\n\n' ||
            'Até já!',
            v_scheduled_reminder,
            'pending',
            'reminder_30m_client_' || NEW.id || '_' || extract(epoch from v_scheduled_reminder)::bigint,
            jsonb_build_object('client_id', NEW.client_id, 'barber_id', NEW.barber_id)
          ) ON CONFLICT (idempotency_key) DO NOTHING;
        END IF;
      END IF;

      RETURN NEW;
    END IF;

    -- ==========================================================================
    -- EVENTO 4: ATENDIMENTO CONCLUÍDO (status = 'completed')
    -- ==========================================================================
    IF (NEW.status = 'completed' AND OLD.status <> 'completed') THEN
      UPDATE public.notification_queue
      SET status = 'cancelled',
          last_error = 'Atendimento já concluído',
          updated_at = v_now
      WHERE appointment_id = NEW.id
        AND status = 'pending'
        AND event_type = 'reminder_30m';

      RETURN NEW;
    END IF;

  END IF;

  RETURN NEW;
END;
$function$;

-- RPC: book_recurring_appointments (equipe autenticada)
CREATE OR REPLACE FUNCTION public.book_recurring_appointments(
  p_name TEXT,
  p_phone TEXT,
  p_barber_id TEXT,
  p_service_ids TEXT[],
  p_appointment_times TEXT[]
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_caller_role TEXT;
  v_client_id TEXT;
  v_clean_phone TEXT;
  v_primary_service_id TEXT;
  v_total_duration INTEGER := 0;
  v_sid TEXT;
  v_srv_rec RECORD;
  v_barber_exists BOOLEAN;
  v_has_specialties BOOLEAN;
  v_barber_executes_service BOOLEAN;
  v_recurrence_id TEXT;
  v_appt_time_str TEXT;
  v_start_time TIMESTAMP;
  v_end_time TIMESTAMP;
  v_dow INTEGER;
  v_opening_hour INTEGER;
  v_closing_hour INTEGER;
  v_setting_val TEXT;
  v_conflict_count INTEGER;
  v_appointment_id TEXT;
  v_created_dates TEXT[] := ARRAY[]::TEXT[];
  v_skipped_dates JSONB := '[]'::jsonb;
  v_skip_reason TEXT;
BEGIN
  -- 1. Autorização: apenas equipe autenticada
  v_caller_role := public.current_user_role();
  IF COALESCE(v_caller_role, '') NOT IN ('admin', 'secretario', 'barber') THEN
    RAISE EXCEPTION 'ACESSO_NEGADO: Apenas a equipe autenticada possui permissão para agendamentos recorrentes.';
  END IF;

  IF p_barber_id IS NULL OR p_service_ids IS NULL OR array_length(p_service_ids, 1) IS NULL OR p_appointment_times IS NULL OR array_length(p_appointment_times, 1) IS NULL THEN
    RAISE EXCEPTION 'PARAMETROS_INVALIDOS: Profissional, serviços e ao menos uma data/horário são obrigatórios.';
  END IF;

  IF array_length(p_appointment_times, 1) > 60 THEN
    RAISE EXCEPTION 'LIMITE_RECORRENCIA: Máximo de 60 ocorrências por agendamento recorrente.';
  END IF;

  IF p_name IS NULL OR trim(p_name) = '' THEN
    RAISE EXCEPTION 'PARAMETROS_INVALIDOS: O nome do cliente é obrigatório.';
  END IF;

  v_clean_phone := regexp_replace(COALESCE(p_phone, ''), '\D', '', 'g');
  IF length(v_clean_phone) < 10 THEN
    RAISE EXCEPTION 'PARAMETROS_INVALIDOS: Telefone / WhatsApp inválido (mínimo de 10 dígitos).';
  END IF;

  -- 2. Lock transacional exclusivo por profissional
  PERFORM pg_advisory_xact_lock(hashtext('barber_booking_' || p_barber_id));

  -- 3. Validar Profissional
  SELECT EXISTS(
    SELECT 1 FROM public.barbers WHERE id = p_barber_id AND COALESCE(is_active, true) = true
  ) INTO v_barber_exists;
  IF NOT v_barber_exists THEN
    RAISE EXCEPTION 'PROFISSIONAL_INVALIDO: O profissional selecionado não existe ou não está ativo para agendamentos.';
  END IF;

  SELECT EXISTS(SELECT 1 FROM public.barber_services WHERE barber_id = p_barber_id) INTO v_has_specialties;

  -- 4. Validar Serviços (aceita restritos e duração 0 = Livre para equipe)
  v_primary_service_id := p_service_ids[1];
  FOREACH v_sid IN ARRAY p_service_ids LOOP
    SELECT id, name, duration_minutes, price, restricted_access
    INTO v_srv_rec
    FROM public.services
    WHERE id = v_sid;

    IF v_srv_rec.id IS NULL THEN
      RAISE EXCEPTION 'SERVICO_INVALIDO: O serviço solicitado (%) não existe no catálogo.', v_sid;
    END IF;

    IF v_srv_rec.duration_minutes IS NULL OR v_srv_rec.duration_minutes < 0 THEN
      RAISE EXCEPTION 'DURACAO_INVALIDA: A duração do serviço "%" é inválida.', v_srv_rec.name;
    END IF;

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

  -- 5. Resolver / Cadastrar Cliente
  SELECT id INTO v_client_id
  FROM public.customers
  WHERE regexp_replace(phone, '\D', '', 'g') = v_clean_phone
  LIMIT 1;

  IF v_client_id IS NULL THEN
    v_client_id := gen_random_uuid()::text;
    INSERT INTO public.customers (id, name, phone)
    VALUES (v_client_id, UPPER(TRIM(p_name)), v_clean_phone);
  END IF;

  -- 6. Configurar omissão da confirmação imediata no WhatsApp (mantendo lembrete 30m)
  PERFORM pg_catalog.set_config('club01.skip_immediate_notif', 'true', true);

  v_recurrence_id := gen_random_uuid()::text;

  -- 7. Iterar sobre as datas geradas, pulando dias com conflito ou fechados
  FOREACH v_appt_time_str IN ARRAY p_appointment_times LOOP
    v_skip_reason := NULL;

    BEGIN
      v_start_time := v_appt_time_str::timestamp;
    EXCEPTION WHEN OTHERS THEN
      v_skip_reason := 'Formato de data/horário inválido';
    END;

    IF v_skip_reason IS NULL THEN
      v_end_time := v_start_time + (v_total_duration || ' minutes')::interval;
      v_dow := EXTRACT(DOW FROM v_start_time);

      IF v_dow = 0 THEN
        v_skip_reason := 'Domingo (barbearia fechada)';
      ELSE
        IF v_dow = 6 THEN
          v_opening_hour := 8;
          v_closing_hour := 21;
        ELSE
          v_opening_hour := 9;
          v_closing_hour := 23;
        END IF;

        SELECT value INTO v_setting_val FROM public.settings WHERE key = 'shop_opening_hour';
        IF v_setting_val ~ '^\d+$' THEN v_opening_hour := v_setting_val::integer; END IF;

        IF EXTRACT(HOUR FROM v_start_time) < v_opening_hour THEN
          v_skip_reason := 'Antes do horário de abertura';
        ELSIF v_end_time > (date_trunc('day', v_start_time) + (v_closing_hour || ' hours')::interval) THEN
          v_skip_reason := 'Ultrapassa o horário de encerramento';
        END IF;
      END IF;
    END IF;

    IF v_skip_reason IS NULL AND v_total_duration > 0 THEN
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
        v_skip_reason := 'Horário já ocupado';
      END IF;
    END IF;

    IF v_skip_reason IS NOT NULL THEN
      v_skipped_dates := v_skipped_dates || jsonb_build_object(
        'appointment_time', v_appt_time_str,
        'reason', v_skip_reason
      );
      CONTINUE;
    END IF;

    v_appointment_id := gen_random_uuid()::text;

    INSERT INTO public.appointments (
      id, client_id, barber_id, service_id, appointment_time, status, recurrence_id
    ) VALUES (
      v_appointment_id, v_client_id, p_barber_id, v_primary_service_id, v_appt_time_str, 'confirmed', v_recurrence_id
    );

    FOREACH v_sid IN ARRAY p_service_ids LOOP
      INSERT INTO public.appointment_services (appointment_id, service_id)
      VALUES (v_appointment_id, v_sid)
      ON CONFLICT DO NOTHING;
    END LOOP;

    v_created_dates := array_append(v_created_dates, v_appt_time_str);
  END LOOP;

  PERFORM pg_catalog.set_config('club01.skip_immediate_notif', 'false', true);

  IF COALESCE(array_length(v_created_dates, 1), 0) = 0 THEN
    RAISE EXCEPTION 'NENHUM_HORARIO_DISPONIVEL: Todas as datas selecionadas na recorrência estão ocupadas ou indisponíveis.';
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'recurrence_id', v_recurrence_id,
    'created_count', array_length(v_created_dates, 1),
    'skipped_count', jsonb_array_length(v_skipped_dates),
    'created_dates', to_jsonb(v_created_dates),
    'skipped_dates', v_skipped_dates
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.book_recurring_appointments(TEXT, TEXT, TEXT, TEXT[], TEXT[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.book_recurring_appointments(TEXT, TEXT, TEXT, TEXT[], TEXT[]) TO authenticated, service_role;

-- RPC: cancel_recurring_appointments (cancela "apenas este" ou "este e os próximos")
CREATE OR REPLACE FUNCTION public.cancel_recurring_appointments(
  p_appointment_id TEXT,
  p_scope TEXT DEFAULT 'single',
  p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_caller_role TEXT;
  v_caller_uid UUID;
  v_target RECORD;
  v_cancelled_ids TEXT[];
BEGIN
  v_caller_uid := auth.uid();
  v_caller_role := public.current_user_role();
  IF v_caller_uid IS NULL OR COALESCE(v_caller_role, '') NOT IN ('admin', 'secretario', 'barber') THEN
    RAISE EXCEPTION 'ACESSO_NEGADO: Apenas a equipe autenticada pode cancelar agendamentos por esta rotina.';
  END IF;

  SELECT id, barber_id, appointment_time, recurrence_id, status
  INTO v_target
  FROM public.appointments
  WHERE id = p_appointment_id;

  IF v_target.id IS NULL THEN
    RAISE EXCEPTION 'AGENDAMENTO_NAO_ENCONTRADO: O agendamento solicitado não foi encontrado.';
  END IF;

  IF v_caller_role = 'barber' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.barbers
      WHERE id = v_target.barber_id
        AND (user_id = v_caller_uid::text OR user_id = (SELECT id::text FROM public.users WHERE auth_user_id = v_caller_uid LIMIT 1))
    ) THEN
      RAISE EXCEPTION 'ACESSO_NEGADO: Barbeiros só podem cancelar agendamentos da própria agenda.';
    END IF;
  END IF;

  IF p_scope = 'future' AND v_target.recurrence_id IS NOT NULL THEN
    WITH updated AS (
      UPDATE public.appointments
      SET status = 'cancelled',
          cancellation_reason = COALESCE(p_reason, cancellation_reason),
          updated_at = now()
      WHERE recurrence_id = v_target.recurrence_id
        AND appointment_time >= v_target.appointment_time
        AND status NOT IN ('cancelled', 'completed')
      RETURNING id
    )
    SELECT array_agg(id) INTO v_cancelled_ids FROM updated;
  ELSE
    WITH updated AS (
      UPDATE public.appointments
      SET status = 'cancelled',
          cancellation_reason = COALESCE(p_reason, cancellation_reason),
          updated_at = now()
      WHERE id = p_appointment_id
        AND status <> 'cancelled'
      RETURNING id
    )
    SELECT array_agg(id) INTO v_cancelled_ids FROM updated;
  END IF;

  IF v_cancelled_ids IS NOT NULL AND array_length(v_cancelled_ids, 1) > 0 THEN
    DELETE FROM public.caixa
    WHERE (
      appointment_id = ANY(v_cancelled_ids)
      OR id = ANY(SELECT 'cx-srv-' || unnest(v_cancelled_ids))
    )
      AND COALESCE(category, '') NOT IN ('Venda de Produtos', 'Produto')
      AND id NOT LIKE 'caixa-sale-%';
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'cancelled_count', COALESCE(array_length(v_cancelled_ids, 1), 0)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.cancel_recurring_appointments(TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancel_recurring_appointments(TEXT, TEXT, TEXT) TO authenticated, service_role;

