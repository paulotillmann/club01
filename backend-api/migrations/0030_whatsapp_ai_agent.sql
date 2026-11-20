-- ==============================================================================
-- PROJETO: CLUB 01 BARBER STUDIO
-- MIGRATION 0030: AGENTE DE IA DE ATENDIMENTO WHATSAPP (EVOLUTION API + GEMINI)
-- ==============================================================================
-- Estrutura:
-- 1. public.whatsapp_ai_config    -> Configuracoes gerenciaveis pelo admin
-- 2. public.whatsapp_ai_internal  -> Segredo interno de webhook (apenas service_role)
-- 3. public.whatsapp_ai_sessions  -> Controle atomico de cooldown e pausa humana
-- 4. public.whatsapp_ai_logs      -> Auditoria e idempotencia por message_id
-- 5. RPCs atomicas (SECURITY DEFINER, restritas a service_role)

-- pgcrypto ja esta habilitada no schema extensions do Supabase

-- ------------------------------------------------------------------------------
-- 1. TABELA: public.whatsapp_ai_config (single-row config)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.whatsapp_ai_config (
  id TEXT PRIMARY KEY DEFAULT 'default' CHECK (id = 'default'),
  enabled BOOLEAN NOT NULL DEFAULT true,
  cooldown_hours INTEGER NOT NULL DEFAULT 12 CHECK (cooldown_hours >= 1 AND cooldown_hours <= 168),
  booking_url TEXT NOT NULL DEFAULT 'https://club01.paulo-tech-nocode.workers.dev',
  system_prompt TEXT NOT NULL,
  fallback_message TEXT NOT NULL,
  webhook_url TEXT,
  webhook_configured_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.whatsapp_ai_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admin gerencia configuracao do agente IA" ON public.whatsapp_ai_config;
CREATE POLICY "Admin gerencia configuracao do agente IA"
  ON public.whatsapp_ai_config
  FOR ALL
  USING (public.current_user_role() = 'admin')
  WITH CHECK (public.current_user_role() = 'admin');

DROP POLICY IF EXISTS "Service Role gerencia configuracao do agente IA" ON public.whatsapp_ai_config;
CREATE POLICY "Service Role gerencia configuracao do agente IA"
  ON public.whatsapp_ai_config
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

INSERT INTO public.whatsapp_ai_config (
  id,
  enabled,
  cooldown_hours,
  booking_url,
  system_prompt,
  fallback_message
) VALUES (
  'default',
  true,
  12,
  'https://club01.paulo-tech-nocode.workers.dev',
  'Você é o assistente virtual de recepção da barbearia CLUB 01 Barber Studio no WhatsApp.
Seu objetivo é dar boas-vindas calorosas, educadas e naturais em português do Brasil, adaptando brevemente a saudação ao que o cliente enviou, e informar de forma clara que os agendamentos são feitos diretamente pelo nosso site oficial.

Regras obrigatórias:
- Sempre dê boas-vindas à CLUB 01 Barber Studio.
- Sempre informe o link oficial de agendamento exatamente como fornecido no contexto.
- Seja objetivo e amigável (máximo de 3 parágrafos curtos, estilo conversa natural de WhatsApp, podendo usar 1 ou 2 emojis discretos como 💈✂️).
- Se o cliente enviou uma mensagem de áudio, reconheça educadamente que recebeu o áudio e direcione para o link de agendamento.
- Nunca invente preços, lista de serviços, promoções ou horários disponíveis de barbeiros.
- Só mencione o endereço ou o horário de funcionamento da barbearia se o cliente tiver perguntado sobre isso na mensagem.
- Caso o cliente tenha uma dúvida específica que exija atendimento humano, informe que a equipe retornará assim que possível e reforçe o link para agilizar o agendamento.',
  'Olá! 👋 Seja muito bem-vindo(a) à *CLUB 01 Barber Studio*! 💈

Para agendar seu horário com praticidade, acesse nosso site oficial de agendamentos:
https://club01.paulo-tech-nocode.workers.dev

Se precisar de ajuda com algo específico, nossa equipe responderá por aqui assim que possível. Esperamos você! ✂️'
)
ON CONFLICT (id) DO NOTHING;

-- ------------------------------------------------------------------------------
-- 2. TABELA INTERNA: public.whatsapp_ai_internal (ZERO acesso publico/frontend)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.whatsapp_ai_internal (
  id TEXT PRIMARY KEY DEFAULT 'default' CHECK (id = 'default'),
  webhook_secret TEXT NOT NULL DEFAULT encode(extensions.gen_random_bytes(24), 'hex'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.whatsapp_ai_internal ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.whatsapp_ai_internal FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.whatsapp_ai_internal TO service_role;

DROP POLICY IF EXISTS "Apenas Service Role acessa whatsapp_ai_internal" ON public.whatsapp_ai_internal;
CREATE POLICY "Apenas Service Role acessa whatsapp_ai_internal"
  ON public.whatsapp_ai_internal
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

INSERT INTO public.whatsapp_ai_internal (id)
VALUES ('default')
ON CONFLICT (id) DO NOTHING;

-- ------------------------------------------------------------------------------
-- 3. TABELA: public.whatsapp_ai_sessions (controle atomico de cooldown)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.whatsapp_ai_sessions (
  phone TEXT PRIMARY KEY,
  remote_jid TEXT NOT NULL,
  customer_name TEXT,
  last_ai_reply_at TIMESTAMPTZ,
  last_human_reply_at TIMESTAMPTZ,
  cooldown_until TIMESTAMPTZ NOT NULL,
  last_message_id TEXT,
  total_replies INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_ai_sessions_cooldown
  ON public.whatsapp_ai_sessions (cooldown_until DESC);

ALTER TABLE public.whatsapp_ai_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admin e Secretario consultam sessoes do agente IA" ON public.whatsapp_ai_sessions;
CREATE POLICY "Admin e Secretario consultam sessoes do agente IA"
  ON public.whatsapp_ai_sessions
  FOR SELECT
  USING (public.current_user_role() = ANY (ARRAY['admin'::text, 'secretario'::text]));

DROP POLICY IF EXISTS "Service Role gerencia sessoes do agente IA" ON public.whatsapp_ai_sessions;
CREATE POLICY "Service Role gerencia sessoes do agente IA"
  ON public.whatsapp_ai_sessions
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- ------------------------------------------------------------------------------
-- 4. TABELA: public.whatsapp_ai_logs (auditoria e deduplicacao por message_id)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.whatsapp_ai_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id TEXT,
  phone TEXT NOT NULL,
  remote_jid TEXT,
  customer_name TEXT,
  message_type TEXT NOT NULL,
  incoming_text TEXT,
  ai_response TEXT,
  status TEXT NOT NULL CHECK (
    status IN (
      'sent_ai',
      'sent_fallback',
      'skipped_cooldown',
      'skipped_disabled',
      'skipped_ignored',
      'paused_human',
      'failed'
    )
  ),
  model_used TEXT,
  error_detail TEXT,
  external_message_id TEXT,
  latency_ms INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_whatsapp_ai_logs_message_id_unique
  ON public.whatsapp_ai_logs (message_id)
  WHERE message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_whatsapp_ai_logs_created_at
  ON public.whatsapp_ai_logs (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_whatsapp_ai_logs_phone
  ON public.whatsapp_ai_logs (phone);

CREATE INDEX IF NOT EXISTS idx_whatsapp_ai_logs_status
  ON public.whatsapp_ai_logs (status);

CREATE INDEX IF NOT EXISTS idx_whatsapp_ai_logs_external_msg_id
  ON public.whatsapp_ai_logs (external_message_id)
  WHERE external_message_id IS NOT NULL;

ALTER TABLE public.whatsapp_ai_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admin e Secretario consultam logs do agente IA" ON public.whatsapp_ai_logs;
CREATE POLICY "Admin e Secretario consultam logs do agente IA"
  ON public.whatsapp_ai_logs
  FOR SELECT
  USING (public.current_user_role() = ANY (ARRAY['admin'::text, 'secretario'::text]));

DROP POLICY IF EXISTS "Service Role gerencia logs do agente IA" ON public.whatsapp_ai_logs;
CREATE POLICY "Service Role gerencia logs do agente IA"
  ON public.whatsapp_ai_logs
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- ------------------------------------------------------------------------------
-- 5. RPC ATOMICA: claim_whatsapp_ai_cooldown
-- Evita condicao de corrida quando o cliente envia varias mensagens seguidas
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_whatsapp_ai_cooldown(
  p_phone TEXT,
  p_remote_jid TEXT,
  p_customer_name TEXT DEFAULT NULL,
  p_message_id TEXT DEFAULT NULL,
  p_cooldown_hours INTEGER DEFAULT 12
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now TIMESTAMPTZ := now();
  v_safe_hours INTEGER := GREATEST(1, LEAST(COALESCE(p_cooldown_hours, 12), 168));
  v_new_cooldown TIMESTAMPTZ := v_now + make_interval(hours => v_safe_hours);
  v_existing public.whatsapp_ai_sessions%ROWTYPE;
  v_already_logged BOOLEAN := false;
BEGIN
  IF p_phone IS NULL OR trim(p_phone) = '' THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'invalid_phone');
  END IF;

  -- Trava transacional por telefone para evitar corrida entre webhooks paralelos
  PERFORM pg_advisory_xact_lock(hashtext('whatsapp_ai_phone:' || p_phone));

  -- Verifica idempotencia por message_id
  IF p_message_id IS NOT NULL AND trim(p_message_id) <> '' THEN
    SELECT EXISTS (
      SELECT 1 FROM public.whatsapp_ai_logs WHERE message_id = p_message_id
    ) INTO v_already_logged;

    IF v_already_logged THEN
      RETURN jsonb_build_object('allowed', false, 'reason', 'duplicate_message');
    END IF;
  END IF;

  SELECT *
    INTO v_existing
    FROM public.whatsapp_ai_sessions
   WHERE phone = p_phone
   FOR UPDATE;

  IF FOUND THEN
    IF p_message_id IS NOT NULL AND v_existing.last_message_id = p_message_id THEN
      RETURN jsonb_build_object('allowed', false, 'reason', 'duplicate_message');
    END IF;

    IF v_existing.cooldown_until > v_now THEN
      UPDATE public.whatsapp_ai_sessions
         SET remote_jid = COALESCE(NULLIF(p_remote_jid, ''), remote_jid),
             customer_name = COALESCE(NULLIF(p_customer_name, ''), customer_name),
             updated_at = v_now
       WHERE phone = p_phone;

      RETURN jsonb_build_object(
        'allowed', false,
        'reason', 'cooldown_active',
        'cooldown_until', v_existing.cooldown_until,
        'last_human_reply_at', v_existing.last_human_reply_at
      );
    END IF;

    UPDATE public.whatsapp_ai_sessions
       SET remote_jid = COALESCE(NULLIF(p_remote_jid, ''), remote_jid),
           customer_name = COALESCE(NULLIF(p_customer_name, ''), customer_name),
           last_ai_reply_at = v_now,
           cooldown_until = v_new_cooldown,
           last_message_id = COALESCE(NULLIF(p_message_id, ''), last_message_id),
           total_replies = total_replies + 1,
           updated_at = v_now
     WHERE phone = p_phone;

    RETURN jsonb_build_object(
      'allowed', true,
      'reason', 'claimed_existing',
      'cooldown_until', v_new_cooldown,
      'previous_cooldown_until', v_existing.cooldown_until
    );
  ELSE
    INSERT INTO public.whatsapp_ai_sessions (
      phone,
      remote_jid,
      customer_name,
      last_ai_reply_at,
      cooldown_until,
      last_message_id,
      total_replies,
      created_at,
      updated_at
    ) VALUES (
      p_phone,
      COALESCE(NULLIF(p_remote_jid, ''), p_phone),
      NULLIF(p_customer_name, ''),
      v_now,
      v_new_cooldown,
      NULLIF(p_message_id, ''),
      1,
      v_now,
      v_now
    );

    RETURN jsonb_build_object(
      'allowed', true,
      'reason', 'claimed_new',
      'cooldown_until', v_new_cooldown,
      'previous_cooldown_until', NULL
    );
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_whatsapp_ai_cooldown(TEXT, TEXT, TEXT, TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_whatsapp_ai_cooldown(TEXT, TEXT, TEXT, TEXT, INTEGER) TO service_role;

-- ------------------------------------------------------------------------------
-- 6. RPC: release_whatsapp_ai_cooldown (rollback se envio na Evolution falhar)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.release_whatsapp_ai_cooldown(
  p_phone TEXT,
  p_previous_cooldown_until TIMESTAMPTZ DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_phone IS NULL OR trim(p_phone) = '' THEN
    RETURN;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('whatsapp_ai_phone:' || p_phone));

  UPDATE public.whatsapp_ai_sessions
     SET cooldown_until = COALESCE(p_previous_cooldown_until, now() - interval '1 second'),
         total_replies = GREATEST(0, total_replies - 1),
         updated_at = now()
   WHERE phone = p_phone;
END;
$$;

REVOKE ALL ON FUNCTION public.release_whatsapp_ai_cooldown(TEXT, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_whatsapp_ai_cooldown(TEXT, TIMESTAMPTZ) TO service_role;

-- ------------------------------------------------------------------------------
-- 7. RPC: record_whatsapp_human_reply (pausa IA quando equipe responde manual)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_whatsapp_human_reply(
  p_phone TEXT,
  p_remote_jid TEXT,
  p_cooldown_hours INTEGER DEFAULT 12
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now TIMESTAMPTZ := now();
  v_safe_hours INTEGER := GREATEST(1, LEAST(COALESCE(p_cooldown_hours, 12), 168));
  v_new_cooldown TIMESTAMPTZ := v_now + make_interval(hours => v_safe_hours);
  v_existing public.whatsapp_ai_sessions%ROWTYPE;
BEGIN
  IF p_phone IS NULL OR trim(p_phone) = '' THEN
    RETURN jsonb_build_object('updated', false, 'reason', 'invalid_phone');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('whatsapp_ai_phone:' || p_phone));

  SELECT *
    INTO v_existing
    FROM public.whatsapp_ai_sessions
   WHERE phone = p_phone
   FOR UPDATE;

  -- Ignora eco imediato (ate 30s) da propria resposta do agente IA
  IF FOUND AND v_existing.last_ai_reply_at IS NOT NULL
     AND v_existing.last_ai_reply_at > (v_now - interval '30 seconds') THEN
    RETURN jsonb_build_object('updated', false, 'reason', 'recent_ai_echo');
  END IF;

  INSERT INTO public.whatsapp_ai_sessions (
    phone,
    remote_jid,
    last_human_reply_at,
    cooldown_until,
    created_at,
    updated_at
  ) VALUES (
    p_phone,
    COALESCE(NULLIF(p_remote_jid, ''), p_phone),
    v_now,
    v_new_cooldown,
    v_now,
    v_now
  )
  ON CONFLICT (phone) DO UPDATE
    SET remote_jid = COALESCE(NULLIF(EXCLUDED.remote_jid, ''), public.whatsapp_ai_sessions.remote_jid),
        last_human_reply_at = v_now,
        cooldown_until = GREATEST(public.whatsapp_ai_sessions.cooldown_until, v_new_cooldown),
        updated_at = v_now;

  RETURN jsonb_build_object(
    'updated', true,
    'cooldown_until', v_new_cooldown
  );
END;
$$;

REVOKE ALL ON FUNCTION public.record_whatsapp_human_reply(TEXT, TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_whatsapp_human_reply(TEXT, TEXT, INTEGER) TO service_role;
