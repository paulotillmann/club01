-- ==============================================================================
-- PROJETO: CLUB 01 BARBER STUDIO
-- FASE 6: FILA DE NOTIFICAÇÕES WHATSAPP E TRIGGERS TRANSACIONAIS
-- Arquivo: 0022_notification_queue_and_triggers.sql
-- 
-- STATUS: PREPARADA LOCALMENTE (AGUARDANDO AUTORIZAÇÃO PARA SUPABASE REMOTO)
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. TABELA: public.notification_queue (Fila de Notificações com Ciclo de Vida)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.notification_queue (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  appointment_id TEXT NOT NULL REFERENCES public.appointments(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN ('new_appointment', 'reminder_30m', 'cancellation', 'reschedule')),
  recipient_type TEXT NOT NULL CHECK (recipient_type IN ('client', 'barber', 'old_barber', 'new_barber')),
  recipient_phone TEXT NOT NULL,
  recipient_name TEXT NOT NULL,
  content TEXT NOT NULL,
  scheduled_for TIMESTAMPTZ NOT NULL DEFAULT now(),
  status TEXT NOT NULL CHECK (status IN ('pending', 'processing', 'sent', 'failed', 'cancelled', 'skipped', 'simulated')) DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  last_error TEXT,
  processed_at TIMESTAMPTZ,
  external_id TEXT,
  idempotency_key TEXT UNIQUE,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Índices otimizados para alto desempenho e busca eficiente da fila
CREATE INDEX IF NOT EXISTS idx_notif_queue_pending_sched 
  ON public.notification_queue (scheduled_for ASC) 
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_notif_queue_appointment_id 
  ON public.notification_queue (appointment_id);

CREATE INDEX IF NOT EXISTS idx_notif_queue_status 
  ON public.notification_queue (status);

CREATE INDEX IF NOT EXISTS idx_notif_queue_idempotency 
  ON public.notification_queue (idempotency_key);

-- ------------------------------------------------------------------------------
-- 2. SEGURANÇA E RLS: public.notification_queue
-- ------------------------------------------------------------------------------
ALTER TABLE public.notification_queue ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' 
      AND tablename = 'notification_queue' 
      AND policyname = 'Admin e Secretário consultam fila de notificações'
  ) THEN
    CREATE POLICY "Admin e Secretário consultam fila de notificações"
      ON public.notification_queue FOR SELECT
      USING (public.current_user_role() IN ('admin', 'secretario'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' 
      AND tablename = 'notification_queue' 
      AND policyname = 'Service Role gerencia fila de notificações'
  ) THEN
    CREATE POLICY "Service Role gerencia fila de notificações"
      ON public.notification_queue FOR ALL
      USING (auth.role() = 'service_role');
  END IF;
END $$;

-- ------------------------------------------------------------------------------
-- 3. FUNÇÃO AUXILIAR: Formatação de Data e Horário em America/Sao_Paulo
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.format_appointment_dt(p_timestamp_str TEXT)
RETURNS RECORD AS $$
DECLARE
  v_ts TIMESTAMPTZ;
  v_res RECORD;
BEGIN
  IF p_timestamp_str ~ 'Z$' OR p_timestamp_str ~ '[+-]\d{2}(:\d{2})?$' THEN
    v_ts := p_timestamp_str::timestamptz;
  ELSE
    v_ts := (replace(p_timestamp_str, 'T', ' ')::timestamp) AT TIME ZONE 'America/Sao_Paulo';
  END IF;
  
  SELECT 
    to_char(v_ts AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY') AS data_fmt,
    to_char(v_ts AT TIME ZONE 'America/Sao_Paulo', 'HH24:MI') AS hora_fmt
  INTO v_res;
  
  RETURN v_res;
EXCEPTION WHEN OTHERS THEN
  SELECT 'Data a confirmar' AS data_fmt, 'Horário a confirmar' AS hora_fmt INTO v_res;
  RETURN v_res;
END;
$$ LANGUAGE plpgsql STABLE SET search_path = public;

-- ------------------------------------------------------------------------------
-- 4. FUNÇÃO AUXILIAR: Obter Nomes dos Serviços Agrupados
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_appointment_service_names(p_appointment_id TEXT, p_primary_service_id TEXT)
RETURNS TEXT AS $$
DECLARE
  v_names TEXT;
BEGIN
  SELECT string_agg(s.name, ' + ' ORDER BY s.name)
  INTO v_names
  FROM public.appointment_services aps
  JOIN public.services s ON aps.service_id = s.id
  WHERE aps.appointment_id = p_appointment_id;

  IF v_names IS NULL OR v_names = '' THEN
    SELECT name INTO v_names FROM public.services WHERE id = p_primary_service_id;
  END IF;

  RETURN COALESCE(v_names, 'Procedimento Padrão');
END;
$$ LANGUAGE plpgsql STABLE SET search_path = public;

-- ------------------------------------------------------------------------------
-- 5. TRIGGER PRINCIPAL: Gerador Transacional de Notificações
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_appointment_notifications()
RETURNS TRIGGER AS $$
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
  v_lead_minutes INTEGER;
BEGIN
  -- 1. IDENTIFICAR SE É BLOQUEIO ADMINISTRATIVO DE AGENDA
  -- Bloqueios administrativos não geram notificações para clientes
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

  -- Se for bloqueio administrativo, aborta geração de notificações
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

  -- ============================================================================
  -- EVENTO 1: NOVO AGENDAMENTO (INSERT com status 'confirmed')
  -- ============================================================================
  IF (TG_OP = 'INSERT') THEN
    IF NEW.status = 'confirmed' THEN
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
        -- Registra falha de validação para barbeiro sem telefone cadastrado
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

      -- MENSAGEM 3: Programação do Lembrete de 30 Minutos para o Cliente
      -- Horário programado: 30 minutos antes do atendimento em America/Sao_Paulo
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
          -- Agendamento criado com menos de 30 minutos de antecedência: marca como skipped
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
          -- Lembrete programado para exatamente 30 minutos antes
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
      -- 1. Invalidar lembretes futuros pendentes
      UPDATE public.notification_queue
      SET status = 'cancelled',
          last_error = 'Agendamento cancelado pelo usuário/administrador',
          updated_at = v_now
      WHERE appointment_id = NEW.id
        AND status = 'pending'
        AND event_type = 'reminder_30m';

      -- 2. Mensagem de Cancelamento para o Cliente
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

      -- 3. Mensagem de Cancelamento para o Barbeiro
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
      -- 1. Invalidar lembretes programados para o horário antigo
      UPDATE public.notification_queue
      SET status = 'cancelled',
          last_error = 'Horário ou profissional remarcado',
          updated_at = v_now
      WHERE appointment_id = NEW.id
        AND status = 'pending'
        AND event_type = 'reminder_30m';

      -- 2. Mensagem de Atualização de Horário para o Cliente
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

      -- 3. Tratamento de Profissional: se houve troca de barbeiro
      IF (NEW.barber_id <> OLD.barber_id) THEN
        -- Recuperar dados do barbeiro antigo
        SELECT COALESCE(name, 'Profissional'), COALESCE(phone, '')
        INTO v_old_barber_name, v_old_barber_phone
        FROM public.barbers
        WHERE id = OLD.barber_id;

        -- Notificar barbeiro antigo sobre a retirada do atendimento
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

        -- Notificar novo barbeiro sobre o atendimento atribuído a ele
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
        -- Mesmo barbeiro, apenas data ou horário mudou
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

      -- 4. Programar novo lembrete de 30 minutos para o novo horário
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
      -- Se houver lembrete pendente residual, cancela para não enviar após conclusão
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
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Garantir existência do trigger na tabela public.appointments
DROP TRIGGER IF EXISTS trigger_appointment_notifications ON public.appointments;

CREATE TRIGGER trigger_appointment_notifications
AFTER INSERT OR UPDATE ON public.appointments
FOR EACH ROW EXECUTE FUNCTION public.handle_appointment_notifications();

-- ------------------------------------------------------------------------------
-- 6. RPC: dequeue_notifications_for_processing (Concorrência Segura SKIP LOCKED)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.dequeue_notifications_for_processing(p_batch_size INTEGER DEFAULT 10)
RETURNS SETOF public.notification_queue AS $$
BEGIN
  RETURN QUERY
  WITH candidates AS (
    SELECT id
    FROM public.notification_queue
    WHERE (
      (status = 'pending' AND scheduled_for <= now())
      OR (status = 'processing' AND updated_at < now() - interval '5 minutes' AND attempts < max_attempts)
    )
    ORDER BY scheduled_for ASC
    LIMIT p_batch_size
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.notification_queue q
  SET status = 'processing',
      attempts = q.attempts + 1,
      updated_at = now()
  FROM candidates c
  WHERE q.id = c.id
  RETURNING q.*;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION public.dequeue_notifications_for_processing(INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.dequeue_notifications_for_processing(INTEGER) TO service_role;

-- ------------------------------------------------------------------------------
-- 7. RPC: record_notification_result (Finalização e Sincronização com Logs)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_notification_result(
  p_id TEXT,
  p_status TEXT,
  p_external_id TEXT DEFAULT NULL,
  p_error TEXT DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS VOID AS $$
DECLARE
  v_rec public.notification_queue%ROWTYPE;
  v_legacy_msg_type TEXT;
  v_legacy_status TEXT;
BEGIN
  -- Atualizar item na fila
  UPDATE public.notification_queue
  SET status = p_status,
      external_id = COALESCE(p_external_id, external_id),
      last_error = p_error,
      processed_at = now(),
      metadata = metadata || p_metadata,
      updated_at = now()
  WHERE id = p_id
  RETURNING * INTO v_rec;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- Sincronizar com tabela legado whatsapp_logs para consulta unificada no frontend
  v_legacy_msg_type := CASE 
    WHEN v_rec.event_type = 'new_appointment' THEN 'confirmation'
    WHEN v_rec.event_type = 'reminder_30m' THEN 'reminder'
    WHEN v_rec.event_type = 'cancellation' THEN 'cancellation'
    ELSE 'confirmation'
  END;

  v_legacy_status := CASE
    WHEN p_status IN ('sent', 'simulated') THEN 'sent'
    WHEN p_status = 'pending' THEN 'pending'
    ELSE 'failed'
  END;

  INSERT INTO public.whatsapp_logs (
    id, appointment_id, message_type, phone, status, scheduled_time, sent_at, created_at
  ) VALUES (
    v_rec.id,
    v_rec.appointment_id,
    v_legacy_msg_type,
    v_rec.recipient_phone,
    v_legacy_status,
    v_rec.scheduled_for,
    CASE WHEN p_status IN ('sent', 'simulated') THEN now() ELSE NULL END,
    v_rec.created_at
  )
  ON CONFLICT (id) DO UPDATE SET
    status = EXCLUDED.status,
    sent_at = EXCLUDED.sent_at;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION public.record_notification_result(TEXT, TEXT, TEXT, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_notification_result(TEXT, TEXT, TEXT, TEXT, JSONB) TO service_role;
