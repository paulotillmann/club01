-- ==============================================================================
-- PROJETO: CLUB 01 BARBER STUDIO
-- ROLLBACK: 0025_reschedule_appointment_online_rollback.sql
-- FASE 6.4.2 — ETAPA 1B: ROLLBACK SEGURO E PROCEDIMENTO CONTROLADO DE RECUPERAÇÃO
-- ==============================================================================
-- ATENÇÃO ARQUITETURAL:
-- A concessão indiscriminada de "GRANT UPDATE ON public.appointments TO authenticated"
-- em um rollback automático reintroduz a vulnerabilidade de manipulação direta de horários
-- e double booking.
-- CLASSIFICAÇÃO: ROLLBACK AUTOMÁTICO NÃO SEGURO — EXIGE PROCEDIMENTO CONTROLADO DE RECUPERAÇÃO.
-- Em ambiente produtivo ou homologado, este script deve ser acompanhado do Procedimento
-- de Restauração de Baseline Documentado.
-- ==============================================================================

-- 1. Remover as policies criadas na migration 0025
DROP POLICY IF EXISTS "Cliente visualiza seus próprios dados" ON public.customers;
DROP POLICY IF EXISTS "Cliente cancela seus próprios agendamentos" ON public.appointments;

-- 2. Remover trigger defensivo e função de controle de conflito e transição
DROP TRIGGER IF EXISTS trigger_check_appointment_update_conflict ON public.appointments;
DROP FUNCTION IF EXISTS public.check_appointment_update_conflict();

-- 3. Remover a RPC reschedule_appointment_online
DROP FUNCTION IF EXISTS public.reschedule_appointment_online(TEXT, TEXT, TEXT, TEXT[]);
DROP FUNCTION IF EXISTS public.reschedule_appointment_online(TEXT, TEXT, TEXT, TEXT[], TEXT);

-- 4. Preservação de Privilégios Mínimos (NÃO conceder UPDATE amplo irrestrito)
-- Assegura que o papel authenticated mantenha apenas UPDATE nas colunas necessárias
-- sem conceder acesso a colunas críticas até a restauração assistida de backup
GRANT UPDATE (status, cancellation_reason, updated_at) ON public.appointments TO authenticated;
REVOKE UPDATE, DELETE ON public.appointment_services FROM authenticated;

