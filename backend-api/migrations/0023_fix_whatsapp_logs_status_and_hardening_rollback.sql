-- ==============================================================================
-- PROJETO: CLUB 01 BARBER STUDIO
-- FASE 6.3: ROLLBACK DA MIGRATION 0023
-- Arquivo: 0023_fix_whatsapp_logs_status_and_hardening_rollback.sql
-- ==============================================================================

-- 1. Normalizar registros de notification_queue antes de reverter a constraint
UPDATE public.notification_queue
SET status = 'failed'
WHERE status = 'unknown';

ALTER TABLE public.notification_queue DROP CONSTRAINT IF EXISTS notification_queue_status_check;
ALTER TABLE public.notification_queue 
  ADD CONSTRAINT notification_queue_status_check 
  CHECK (status IN ('pending', 'processing', 'sent', 'failed', 'cancelled', 'skipped', 'simulated'));

-- 2. Normalizar registros de whatsapp_logs sem falsificar envios como 'sent'
-- Mensagens simuladas e indeterminadas são marcadas como 'failed' com sent_at = NULL
UPDATE public.whatsapp_logs
SET status = 'failed',
    sent_at = NULL
WHERE status IN ('simulated', 'unknown', 'cancelled', 'skipped');

UPDATE public.whatsapp_logs
SET message_type = 'confirmation'
WHERE message_type = 'reschedule';

-- 3. Restaurar constraints originais de whatsapp_logs
ALTER TABLE public.whatsapp_logs DROP CONSTRAINT IF EXISTS whatsapp_logs_status_check;
ALTER TABLE public.whatsapp_logs 
  ADD CONSTRAINT whatsapp_logs_status_check 
  CHECK (status IN ('pending', 'sent', 'failed'));

ALTER TABLE public.whatsapp_logs DROP CONSTRAINT IF EXISTS whatsapp_logs_message_type_check;
ALTER TABLE public.whatsapp_logs 
  ADD CONSTRAINT whatsapp_logs_message_type_check 
  CHECK (message_type IN ('confirmation', 'reminder', 'cancellation'));

-- 4. Restaurar RPC record_notification_result da versão 0022
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
