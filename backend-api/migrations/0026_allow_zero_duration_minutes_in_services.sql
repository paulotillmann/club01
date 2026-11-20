-- Migration: 0026_allow_zero_duration_minutes_in_services.sql
-- Permitir duracao 0 (Livre) para procedimentos especiais no cadastro de servicos

ALTER TABLE public.services 
  DROP CONSTRAINT IF EXISTS services_duration_minutes_check;

ALTER TABLE public.services 
  ADD CONSTRAINT services_duration_minutes_check 
  CHECK (duration_minutes >= 0);

