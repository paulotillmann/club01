-- ==============================================================================
-- PROJETO: CLUB 01 BARBER STUDIO
-- FASE: 6.3-C2 — ROLLBACK DA MIGRATION 0024
-- ==============================================================================

BEGIN;

DROP FUNCTION IF EXISTS public.consume_manual_test_authorization(TEXT, TEXT);
DROP TABLE IF EXISTS public.manual_test_authorizations;

COMMIT;
