-- ==============================================================================
-- PROJETO: CLUB 01 BARBER STUDIO
-- FASE 6: ROLLBACK DA FILA DE NOTIFICAÇÕES WHATSAPP E TRIGGERS
-- Arquivo: 0022_notification_queue_rollback.sql
-- ==============================================================================

-- 1. Remover RPCs
DROP FUNCTION IF EXISTS public.record_notification_result(TEXT, TEXT, TEXT, TEXT, JSONB);
DROP FUNCTION IF EXISTS public.dequeue_notifications_for_processing(INTEGER);

-- 2. Remover Trigger e Função de Agendamentos
DROP TRIGGER IF EXISTS trigger_appointment_notifications ON public.appointments;
DROP FUNCTION IF EXISTS public.handle_appointment_notifications();
DROP FUNCTION IF EXISTS public.get_appointment_service_names(TEXT, TEXT);
DROP FUNCTION IF EXISTS public.format_appointment_dt(TEXT);

-- 3. Remover Políticas e Tabela
DROP TABLE IF EXISTS public.notification_queue CASCADE;
