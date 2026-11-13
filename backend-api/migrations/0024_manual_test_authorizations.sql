-- ==============================================================================
-- PROJETO: CLUB 01 BARBER STUDIO
-- FASE: 6.3-C2 — MIGRATION 0024
-- OBJETIVO: CONTROLE PERSISTENTE E ATÔMICO DE AUTORIZAÇÃO DE TESTE MANUAL ÚNICO
-- Arquivo: backend-api/migrations/0024_manual_test_authorizations.sql
-- ==============================================================================

BEGIN;

-- 1. TABELA DE AUTORIZAÇÃO DE TESTE MANUAL
CREATE TABLE IF NOT EXISTS public.manual_test_authorizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  authorization_code TEXT NOT NULL UNIQUE,
  target_recipient TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'authorized' CHECK (status IN ('authorized', 'consumed', 'failed', 'unknown')),
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

-- 2. HABILITAR RLS E BLINDAR ACESSO
ALTER TABLE public.manual_test_authorizations ENABLE ROW LEVEL SECURITY;

-- Revogar todos os privilégios diretos de roles públicas e de cliente
REVOKE ALL ON TABLE public.manual_test_authorizations FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.manual_test_authorizations TO service_role;

-- 3. RPC ATÔMICA PARA CONSUMO DE AUTORIZAÇÃO ÚNICA (FOR UPDATE)
CREATE OR REPLACE FUNCTION public.consume_manual_test_authorization(
  p_code TEXT,
  p_recipient TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rec RECORD;
  v_norm_recipient TEXT;
  v_norm_target TEXT;
BEGIN
  -- Normalização de caracteres numéricos
  v_norm_recipient := regexp_replace(COALESCE(p_recipient, ''), '\D', '', 'g');

  -- Seleção com lock pessimista exclusivo para impedir qualquer concorrência
  SELECT * INTO v_rec
  FROM public.manual_test_authorizations
  WHERE authorization_code = p_code
  FOR UPDATE;

  -- 1. Verificar se a autorização existe
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'AUTORIZACAO_NAO_ENCONTRADA',
      'error', 'Código de autorização não encontrado ou inexistente.'
    );
  END IF;

  -- 2. Verificar se já foi consumida ou invalidada
  IF v_rec.status <> 'authorized' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'AUTORIZACAO_JA_CONSUMIDA',
      'error', format('Esta autorização já foi consumida anteriormente com status %s em %s.', v_rec.status, v_rec.consumed_at)
    );
  END IF;

  -- 3. Validação rigorosa de correspondência com o destinatário autorizado
  v_norm_target := regexp_replace(COALESCE(v_rec.target_recipient, ''), '\D', '', 'g');
  IF v_norm_recipient <> v_norm_target THEN
    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'DESTINATARIO_DIVERGENTE',
      'error', 'O destinatário informado não coincide rigorosamente com o destinatário cadastrado na autorização.'
    );
  END IF;

  -- 4. Consumo atômico e irreversível da autorização
  UPDATE public.manual_test_authorizations
  SET 
    status = 'consumed',
    consumed_at = timezone('utc', now()),
    metadata = v_rec.metadata || jsonb_build_object('consumed_by_rpc_at', timezone('utc', now()))
  WHERE id = v_rec.id;

  RETURN jsonb_build_object(
    'success', true,
    'authorization_id', v_rec.id,
    'target_recipient', v_rec.target_recipient,
    'consumed_at', timezone('utc', now())
  );
END;
$$;

-- 4. BLINDAGEM DE PRIVILÉGIOS DA RPC
REVOKE ALL ON FUNCTION public.consume_manual_test_authorization(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_manual_test_authorization(TEXT, TEXT) TO service_role;

COMMIT;
