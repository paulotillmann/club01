-- ==============================================================================
-- PROJETO: CLUB 01 BARBER STUDIO
-- FASE 6.3: CORREÇÃO DE AUDITORIA DE STATUS EM WHATSAPP_LOGS E HARDENING DE RPCS
-- Arquivo: 0023_fix_whatsapp_logs_status_and_hardening.sql
-- 
-- OBJETIVO:
-- 1. Separar formalmente 'simulated', 'sent', 'failed' e 'unknown' na fila e nos logs.
-- 2. Impedir que simulações (DRY-RUN) preencham sent_at ou sejam gravadas como 'sent'.
-- 3. Suportar evento 'reschedule' na tabela whatsapp_logs.
-- 4. Hardening de permissões: revogar EXECUTE de anon e authenticated nas RPCs de background.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. ATUALIZAR CONSTRAINTS DA TABELA public.notification_queue
-- ------------------------------------------------------------------------------
ALTER TABLE public.notification_queue DROP CONSTRAINT IF EXISTS notification_queue_status_check;

ALTER TABLE public.notification_queue 
  ADD CONSTRAINT notification_queue_status_check 
  CHECK (status IN ('pending', 'processing', 'sent', 'failed', 'cancelled', 'skipped', 'simulated', 'unknown'));

-- ------------------------------------------------------------------------------
-- 2. ATUALIZAR CONSTRAINTS DA TABELA public.whatsapp_logs
-- ------------------------------------------------------------------------------
ALTER TABLE public.whatsapp_logs DROP CONSTRAINT IF EXISTS whatsapp_logs_status_check;

ALTER TABLE public.whatsapp_logs 
  ADD CONSTRAINT whatsapp_logs_status_check 
  CHECK (status IN ('pending', 'sent', 'simulated', 'failed', 'unknown', 'cancelled', 'skipped'));

ALTER TABLE public.whatsapp_logs DROP CONSTRAINT IF EXISTS whatsapp_logs_message_type_check;

ALTER TABLE public.whatsapp_logs 
  ADD CONSTRAINT whatsapp_logs_message_type_check 
  CHECK (message_type IN ('confirmation', 'reminder', 'cancellation', 'reschedule'));

-- ------------------------------------------------------------------------------
-- 3. ATUALIZAR RPC public.record_notification_result (SEM FALSO 'SENT' EM DRY-RUN)
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
  v_sent_timestamp TIMESTAMPTZ;
BEGIN
  -- 1. Atualizar registro na fila de notificações
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

  -- 2. Mapeamento preciso do tipo de evento
  v_legacy_msg_type := CASE 
    WHEN v_rec.event_type = 'new_appointment' THEN 'confirmation'
    WHEN v_rec.event_type = 'reminder_30m' THEN 'reminder'
    WHEN v_rec.event_type = 'cancellation' THEN 'cancellation'
    WHEN v_rec.event_type = 'reschedule' THEN 'reschedule'
    ELSE 'confirmation'
  END;

  -- 3. Mapeamento estrito de status: 'simulated' NUNCA vira 'sent'
  v_legacy_status := CASE
    WHEN p_status = 'sent' THEN 'sent'
    WHEN p_status = 'simulated' THEN 'simulated'
    WHEN p_status = 'pending' THEN 'pending'
    WHEN p_status = 'cancelled' THEN 'cancelled'
    WHEN p_status = 'skipped' THEN 'skipped'
    WHEN p_status = 'unknown' THEN 'unknown'
    ELSE 'failed'
  END;

  -- 4. sent_at é preenchido ESTRITAMENTE para envios reais confirmados ('sent')
  -- Mensagens simuladas em DRY-RUN permanecem com sent_at = NULL
  v_sent_timestamp := CASE 
    WHEN p_status = 'sent' THEN now() 
    ELSE NULL 
  END;

  -- 5. Sincronização auditável com a tabela whatsapp_logs
  INSERT INTO public.whatsapp_logs (
    id, appointment_id, message_type, phone, status, scheduled_time, sent_at, created_at
  ) VALUES (
    v_rec.id,
    v_rec.appointment_id,
    v_legacy_msg_type,
    v_rec.recipient_phone,
    v_legacy_status,
    v_rec.scheduled_for,
    v_sent_timestamp,
    v_rec.created_at
  )
  ON CONFLICT (id) DO UPDATE SET
    status = EXCLUDED.status,
    sent_at = EXCLUDED.sent_at;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ------------------------------------------------------------------------------
-- 4. HARDENING DE PERMISSÕES DAS RPCS DE BACKGROUND
-- ------------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.dequeue_notifications_for_processing(INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.dequeue_notifications_for_processing(INTEGER) FROM anon;
REVOKE ALL ON FUNCTION public.dequeue_notifications_for_processing(INTEGER) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.dequeue_notifications_for_processing(INTEGER) TO service_role;

REVOKE ALL ON FUNCTION public.record_notification_result(TEXT, TEXT, TEXT, TEXT, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_notification_result(TEXT, TEXT, TEXT, TEXT, JSONB) FROM anon;
REVOKE ALL ON FUNCTION public.record_notification_result(TEXT, TEXT, TEXT, TEXT, JSONB) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.record_notification_result(TEXT, TEXT, TEXT, TEXT, JSONB) TO service_role;
