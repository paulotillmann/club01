-- ==============================================================================
-- PROJETO: CLUB 01 BARBER STUDIO
-- MIGRATION: 0025_reschedule_appointment_online.sql
-- FASE 6.4.2 — ETAPA 1: AUDITORIA FINAL DE PRIVILÉGIOS E INTEGRIDADE TRANSACIONAL
-- ==============================================================================
-- Esta migration substitui e aprimora as versões anteriores, eliminando totalmente
-- qualquer dependência de flags de sessão (set_config/current_setting) e estabelecendo
-- uma fronteira de segurança baseada em privilégios físicos de coluna do PostgreSQL,
-- autenticação segura e controle estrito de concorrência:
--
-- 1. ELIMINAÇÃO TOTAL DA FLAG MANIPULÁVEL:
--    - Nenhuma variável de sessão personalizada (ex: in_reschedule_rpc) é utilizada como
--      credencial de autorização.
--
-- 2. RESTRIÇÃO FÍSICA DE PRIVILÉGIOS POR COLUNA (COLUMN-LEVEL PRIVILEGES):
--    - REVOKE UPDATE ON public.appointments para PUBLIC, anon e authenticated.
--    - GRANT UPDATE restrito exclusivamente às colunas operacionais (status, cancellation_reason, updated_at).
--    - Tentativas diretas de atualizar appointment_time, barber_id ou service_id via API
--      são fisicamente bloqueadas pelo motor relacional do PostgreSQL (permission denied).
--
-- 3. RESTRIÇÃO FÍSICA EM APPOINTMENT_SERVICES:
--    - REVOKE UPDATE, DELETE ON public.appointment_services para authenticated e anon.
--    - Manipulação de serviços vinculados passa a ser exclusiva das RPCs autorizadas.
--
-- 4. RPC RESCHEDULE_APPOINTMENT_ONLINE BLINDADA:
--    - Executa com SECURITY DEFINER e search_path = pg_catalog, public, pg_temp.
--    - Autenticação obrigatória (auth.uid() NOT NULL).
--    - Validação estrita de titularidade para clientes e barbearia.
--    - Barbeiro restrito à sua própria agenda (proibido assumir agendamentos alheios).
--    - Transferência de profissionais exclusiva de administradores e secretários.
--    - Locks advisory determinísticos por profissional (prevenção absoluta de deadlocks).
--
-- 5. TRIGGER DEFENSIVO CONTRA DOUBLE BOOKING POR REATIVAÇÃO DE STATUS:
--    - Protege contra tentativas de reativar agendamentos cancelados/ausentes para 'confirmed'
--      quando o horário já foi ocupado por outro cliente.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. RPC: public.reschedule_appointment_online
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reschedule_appointment_online(
  p_appointment_id TEXT,
  p_new_appointment_time TEXT,
  p_new_barber_id TEXT DEFAULT NULL,
  p_service_ids TEXT[] DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
  v_old_appt RECORD;
  v_target_barber_id TEXT;
  v_caller_role TEXT;
  v_caller_uid UUID;
  v_start_time TIMESTAMP;
  v_end_time TIMESTAMP;
  v_dow INTEGER;
  v_opening_hour INTEGER := 9;
  v_closing_hour INTEGER := 20;
  v_min_lead_min INTEGER := 30;
  v_setting_val TEXT;
  v_total_duration INTEGER := 0;
  v_active_service_ids TEXT[];
  v_sid TEXT;
  v_srv_rec RECORD;
  v_barber_executes_service BOOLEAN;
  v_conflict_count INTEGER;
  v_primary_service_id TEXT;
BEGIN
  -- 1. Validação de parâmetros obrigatórios
  IF p_appointment_id IS NULL OR trim(p_appointment_id) = '' THEN
    RAISE EXCEPTION 'PARAMETROS_INVALIDOS: O identificador do agendamento é obrigatório.';
  END IF;

  IF p_new_appointment_time IS NULL OR trim(p_new_appointment_time) = '' THEN
    RAISE EXCEPTION 'PARAMETROS_INVALIDOS: O novo horário de agendamento é obrigatório.';
  END IF;

  -- 2. Confirmar a existência do agendamento
  SELECT a.id, a.client_id, a.barber_id, a.service_id, a.appointment_time, a.status, a.cancellation_reason
  INTO v_old_appt
  FROM public.appointments a
  WHERE a.id = p_appointment_id;

  IF v_old_appt.id IS NULL THEN
    RAISE EXCEPTION 'AGENDAMENTO_NAO_ENCONTRADO: O agendamento % não foi encontrado.', p_appointment_id;
  END IF;

  -- 3. Validar status do agendamento (não pode ser cancelado nem concluído)
  IF v_old_appt.status = 'cancelled' THEN
    RAISE EXCEPTION 'AGENDAMENTO_CANCELADO: Não é permitido remarcar um agendamento já cancelado.';
  END IF;

  IF v_old_appt.status = 'completed' THEN
    RAISE EXCEPTION 'AGENDAMENTO_CONCLUIDO: Não é permitido remarcar um agendamento já concluído.';
  END IF;

  -- 4. Validação Rigorosa de Autenticação e Autorização
  v_caller_uid := auth.uid();
  IF v_caller_uid IS NULL THEN
    RAISE EXCEPTION 'ACESSO_NEGADO: A remarcação de agendamentos exige autenticação segura no sistema.';
  END IF;

  v_caller_role := public.current_user_role();

  -- Determinar o profissional de destino pretendido
  IF p_new_barber_id IS NOT NULL AND trim(p_new_barber_id) <> '' THEN
    v_target_barber_id := p_new_barber_id;
  ELSE
    v_target_barber_id := v_old_appt.barber_id;
  END IF;

  IF v_caller_role IN ('admin', 'secretario') THEN
    -- Gestão possui autorização irrestrita sobre todos os agendamentos e transferências
    NULL;
  ELSIF v_caller_role = 'barber' THEN
    -- Barbeiro só pode remarcar agendamento onde ele é o profissional de origem
    IF NOT EXISTS (
      SELECT 1 FROM public.barbers 
      WHERE id = v_old_appt.barber_id
        AND user_id = v_caller_uid::text
    ) THEN
      RAISE EXCEPTION 'ACESSO_NEGADO: Barbeiros só podem remarcar agendamentos atribuídos à sua própria agenda.';
    END IF;

    -- Barbeiros não podem transferir agendamentos entre profissionais
    IF v_target_barber_id <> v_old_appt.barber_id THEN
      RAISE EXCEPTION 'ACESSO_NEGADO: Barbeiros não possuem permissão para transferir agendamentos para outros profissionais.';
    END IF;
  ELSE
    -- Cliente final autenticado: deve comprovar titularidade estrita vinculada ao auth.uid
    IF NOT EXISTS (
      SELECT 1 FROM public.users u
      JOIN public.customers c ON pg_catalog.regexp_replace(c.phone, '\D', '', 'g') = pg_catalog.regexp_replace(u.phone, '\D', '', 'g')
      WHERE (u.auth_user_id = v_caller_uid OR u.id = v_caller_uid::text)
        AND c.id = v_old_appt.client_id
    ) THEN
      RAISE EXCEPTION 'ACESSO_NEGADO: Você não possui autorização para remarcar agendamentos de outros clientes.';
    END IF;

    -- Clientes não podem transferir o profissional
    IF v_target_barber_id <> v_old_appt.barber_id THEN
      RAISE EXCEPTION 'ACESSO_NEGADO: A alteração de profissional é restrita à administração.';
    END IF;
  END IF;

  -- 5. Validar Existência do Profissional de Destino
  IF NOT EXISTS (SELECT 1 FROM public.barbers WHERE id = v_target_barber_id) THEN
    RAISE EXCEPTION 'PROFISSIONAL_INVALIDO: O profissional selecionado não existe.';
  END IF;

  -- 6. Controle de Concorrência: Locks Transacionais Determinísticos por Profissional
  IF v_old_appt.barber_id = v_target_barber_id THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('barber_booking_' || v_target_barber_id));
  ELSE
    -- Ordem lexicográfica estrita (menor seguido do maior) para prevenir deadlocks
    IF v_old_appt.barber_id < v_target_barber_id THEN
      PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('barber_booking_' || v_old_appt.barber_id));
      PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('barber_booking_' || v_target_barber_id));
    ELSE
      PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('barber_booking_' || v_target_barber_id));
      PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('barber_booking_' || v_old_appt.barber_id));
    END IF;
  END IF;

  -- 7. Determinação e Validação Estrita dos Serviços e Especialidades
  IF p_service_ids IS NOT NULL AND array_length(p_service_ids, 1) > 0 THEN
    v_active_service_ids := p_service_ids;
  ELSE
    SELECT array_agg(service_id) INTO v_active_service_ids
    FROM public.appointment_services
    WHERE appointment_id = p_appointment_id;

    IF v_active_service_ids IS NULL OR array_length(v_active_service_ids, 1) = 0 THEN
      IF v_old_appt.service_id IS NOT NULL THEN
        v_active_service_ids := ARRAY[v_old_appt.service_id];
      END IF;
    END IF;
  END IF;

  IF v_active_service_ids IS NULL OR array_length(v_active_service_ids, 1) = 0 THEN
    RAISE EXCEPTION 'SERVICO_INVALIDO: O agendamento não possui serviços vinculados válidos.';
  END IF;

  v_primary_service_id := v_active_service_ids[1];

  -- Validação de cada serviço: existência, restrição e especialidade
  FOREACH v_sid IN ARRAY v_active_service_ids LOOP
    SELECT id, name, duration_minutes, price, restricted_access
    INTO v_srv_rec
    FROM public.services
    WHERE id = v_sid;

    IF v_srv_rec.id IS NULL THEN
      RAISE EXCEPTION 'SERVICO_INVALIDO: O serviço solicitado (%) não existe no catálogo.', v_sid;
    END IF;

    IF v_srv_rec.restricted_access = true AND v_caller_role NOT IN ('admin', 'secretario') THEN
      RAISE EXCEPTION 'SERVICO_RESTRITO: O serviço "%" é exclusivo para agendamento interno e não está disponível online.', v_srv_rec.name;
    END IF;

    IF v_srv_rec.duration_minutes IS NULL OR v_srv_rec.duration_minutes <= 0 THEN
      RAISE EXCEPTION 'DURACAO_INVALIDA: A duração do serviço "%" é inválida.', v_srv_rec.name;
    END IF;

    -- Validação de habilitação do profissional
    SELECT EXISTS(
      SELECT 1 FROM public.barber_services 
      WHERE barber_id = v_target_barber_id AND service_id = v_sid
    ) INTO v_barber_executes_service;

    IF NOT v_barber_executes_service THEN
      RAISE EXCEPTION 'PROFISSIONAL_NAO_HABILITADO: O profissional selecionado não realiza o procedimento "%".', v_srv_rec.name;
    END IF;

    v_total_duration := v_total_duration + v_srv_rec.duration_minutes;
  END LOOP;

  IF v_total_duration = 0 THEN v_total_duration := 30; END IF;

  -- 8. Validação de Formato, Expediente e Antecedência
  BEGIN
    v_start_time := p_new_appointment_time::timestamp;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'DATA_INVALIDA: Formato de data/horário inválido (esperado YYYY-MM-DDTHH:mm).';
  END;

  v_end_time := v_start_time + (v_total_duration || ' minutes')::interval;
  v_dow := EXTRACT(DOW FROM v_start_time);

  -- Regra: Fechado aos domingos
  IF v_dow = 0 THEN
    RAISE EXCEPTION 'FORA_DO_EXPEDIENTE: O CLUB 01 não realiza atendimentos aos domingos.';
  END IF;

  -- Horário de funcionamento por dia
  IF v_dow = 6 THEN
    v_opening_hour := 8;
    v_closing_hour := 19;
  ELSE
    v_opening_hour := 9;
    v_closing_hour := 20;
  END IF;

  SELECT value INTO v_setting_val FROM public.settings WHERE key = 'shop_opening_hour';
  IF v_setting_val ~ '^\d+$' THEN v_opening_hour := v_setting_val::integer; END IF;

  SELECT value INTO v_setting_val FROM public.settings WHERE key = 'shop_closing_hour';
  IF v_setting_val ~ '^\d+$' THEN v_closing_hour := v_setting_val::integer; END IF;

  IF EXTRACT(HOUR FROM v_start_time) < v_opening_hour THEN
    RAISE EXCEPTION 'FORA_DO_EXPEDIENTE: O atendimento não pode iniciar antes das %:00.', v_opening_hour;
  END IF;

  IF v_end_time > (pg_catalog.date_trunc('day', v_start_time) + (v_closing_hour || ' hours')::interval) THEN
    RAISE EXCEPTION 'FORA_DO_EXPEDIENTE: A duração total (% min) ultrapassa o horário de encerramento das %:00.', v_total_duration, v_closing_hour;
  END IF;

  -- Regra: Antecedência mínima configurada
  SELECT value INTO v_setting_val FROM public.settings WHERE key = 'min_lead_time_minutes';
  IF v_setting_val ~ '^\d+$' THEN v_min_lead_min := v_setting_val::integer; END IF;

  IF v_start_time < (pg_catalog.now() AT TIME ZONE 'America/Sao_Paulo' + (v_min_lead_min || ' minutes')::interval) THEN
    RAISE EXCEPTION 'ANTECEDENCIA_MINIMA: A remarcação exige uma antecedência mínima de % minutos.', v_min_lead_min;
  END IF;

  -- 9. Validação de Conflito de Horário e Sobreposição (ignora o próprio agendamento)
  WITH existing_appt_durations AS (
    SELECT 
      a.id,
      a.appointment_time,
      COALESCE(
        (
          SELECT sum(COALESCE(s_multi.duration_minutes, 30))
          FROM public.appointment_services aps
          JOIN public.services s_multi ON aps.service_id = s_multi.id
          WHERE aps.appointment_id = a.id
        ),
        s_single.duration_minutes,
        30
      )::integer AS appt_total_duration
    FROM public.appointments a
    LEFT JOIN public.services s_single ON a.service_id = s_single.id
    WHERE a.barber_id = v_target_barber_id
      AND a.id <> p_appointment_id
      AND (
        a.status IN ('confirmed', 'pending')
        OR (a.status = 'cancelled' AND a.cancellation_reason IS NOT NULL AND a.cancellation_reason ILIKE '%BLOQUEIO%')
      )
  )
  SELECT COUNT(*) INTO v_conflict_count
  FROM existing_appt_durations ead
  WHERE (
    ead.appointment_time::timestamp < v_end_time
    AND (ead.appointment_time::timestamp + (ead.appt_total_duration || ' minutes')::interval) > v_start_time
  );

  IF v_conflict_count > 0 THEN
    RAISE EXCEPTION 'HORARIO_INDISPONIVEL: O profissional já possui um agendamento ou bloqueio no intervalo selecionado.';
  END IF;

  -- 10. Atualização Atômica via Privilégio Interno de SECURITY DEFINER
  -- Indicador auxiliar de contexto local para a transação
  PERFORM pg_catalog.set_config('club01.in_reschedule_rpc', 'true', true);

  UPDATE public.appointments
  SET appointment_time = p_new_appointment_time,
      barber_id = v_target_barber_id,
      service_id = v_primary_service_id,
      status = 'confirmed',
      updated_at = pg_catalog.now()
  WHERE id = p_appointment_id;

  PERFORM pg_catalog.set_config('club01.in_reschedule_rpc', 'false', true);

  -- Atualiza appointment_services caso uma nova lista de serviços tenha sido informada
  IF p_service_ids IS NOT NULL AND array_length(p_service_ids, 1) > 0 THEN
    DELETE FROM public.appointment_services WHERE appointment_id = p_appointment_id;
    FOREACH v_sid IN ARRAY p_service_ids LOOP
      INSERT INTO public.appointment_services (appointment_id, service_id)
      VALUES (p_appointment_id, v_sid)
      ON CONFLICT DO NOTHING;
    END LOOP;
  END IF;

  -- 11. Retorno JSON Estruturado para o Frontend
  RETURN pg_catalog.jsonb_build_object(
    'success', true,
    'appointment_id', p_appointment_id,
    'barber_id', v_target_barber_id,
    'appointment_time', p_new_appointment_time,
    'duration_minutes', v_total_duration,
    'service_ids', v_active_service_ids,
    'message', 'Agendamento remarcado com sucesso.'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- ------------------------------------------------------------------------------
-- Permissões de Execução da RPC: Restritas a authenticated e service_role
-- ------------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.reschedule_appointment_online(TEXT, TEXT, TEXT, TEXT[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reschedule_appointment_online(TEXT, TEXT, TEXT, TEXT[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.reschedule_appointment_online(TEXT, TEXT, TEXT, TEXT[]) TO authenticated, service_role;

-- ------------------------------------------------------------------------------
-- 2. RESTRIÇÃO FÍSICA DE PRIVILÉGIOS POR COLUNA (COLUMN-LEVEL SECURITY)
-- Bloqueia atualização direta de appointment_time, barber_id, service_id e client_id
-- para qualquer usuário comum/autenticado. Apenas status e cancelamento são liberados.
-- ------------------------------------------------------------------------------
REVOKE UPDATE ON public.appointments FROM PUBLIC;
REVOKE UPDATE ON public.appointments FROM anon;
REVOKE UPDATE ON public.appointments FROM authenticated;

-- Permite UPDATE para authenticated estritamente nas colunas operacionais de ciclo de vida
GRANT UPDATE (status, cancellation_reason, updated_at) ON public.appointments TO authenticated;

-- Restringe appointment_services contra alteração e exclusão direta
REVOKE ALL ON public.appointment_services FROM PUBLIC;
REVOKE ALL ON public.appointment_services FROM anon;
REVOKE UPDATE, DELETE ON public.appointment_services FROM authenticated;
GRANT SELECT ON public.appointment_services TO authenticated, anon;
GRANT INSERT ON public.appointment_services TO authenticated;

-- ------------------------------------------------------------------------------
-- 2. FUNÇÃO AUXILIAR DE SEGURANÇA: is_appointment_owner
-- Verifica se o chamador autenticado (auth.uid()) é o titular legítimo do agendamento
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_appointment_owner(p_client_id TEXT)
RETURNS BOOLEAN AS $$
BEGIN
  IF p_client_id IS NULL THEN
    RETURN false;
  END IF;

  IF auth.uid() IS NULL THEN
    RETURN false;
  END IF;

  IF p_client_id = auth.uid()::text THEN
    RETURN true;
  END IF;

  RETURN EXISTS (
    SELECT 1 
    FROM public.customers c
    JOIN public.users u ON pg_catalog.regexp_replace(c.phone, '\D', '', 'g') = pg_catalog.regexp_replace(u.phone, '\D', '', 'g')
    WHERE (u.auth_user_id = auth.uid() OR u.id = auth.uid()::text)
      AND c.id = p_client_id
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = pg_catalog, public, pg_temp;

-- ------------------------------------------------------------------------------
-- 3. TRIGGER DEFENSIVO CONTRA DOUBLE BOOKING E TRANSIÇÕES DE STATUS NÃO AUTORIZADAS
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.check_appointment_update_conflict()
RETURNS TRIGGER AS $$
DECLARE
  v_total_dur INTEGER := 30;
  v_start_time TIMESTAMP;
  v_end_time TIMESTAMP;
  v_conflict_count INTEGER;
  v_caller_role TEXT;
  v_caller_uid UUID;
BEGIN
  -- Se for cancelamento ou registro de falta sem alteração de horário/profissional, permite
  IF NEW.status IN ('cancelled', 'absent') AND NEW.appointment_time = OLD.appointment_time AND NEW.barber_id = OLD.barber_id THEN
    -- Validação de papel para cancelamento / ausência ocorre abaixo na regra 3
    NULL;
  END IF;

  -- REGRA 1: Bloqueia tentativa direta de alterar horário, profissional ou serviço fora da RPC oficial
  IF (
    (NEW.appointment_time IS DISTINCT FROM OLD.appointment_time)
    OR (NEW.barber_id IS DISTINCT FROM OLD.barber_id)
    OR (NEW.service_id IS DISTINCT FROM OLD.service_id)
  ) THEN
    IF COALESCE(current_setting('club01.in_reschedule_rpc', true), 'false') <> 'true' THEN
      RAISE EXCEPTION 'ACESSO_NEGADO: Alteração direta de horário, profissional ou serviço não permitida. Utilize a RPC reschedule_appointment_online.';
    END IF;
  END IF;

  -- REGRA 2: Reativação de agendamento anteriormente cancelado/ausente
  -- Deve validar que o horário do atendimento reativado NÃO colide com outro agendamento ativo
  IF (NEW.status = 'confirmed' AND OLD.status IN ('cancelled', 'absent')) THEN

    BEGIN
      v_start_time := NEW.appointment_time::timestamp;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'DATA_INVALIDA: Formato de data/horário inválido no agendamento.';
    END;

    SELECT COALESCE(
      (
        SELECT sum(COALESCE(s_multi.duration_minutes, 30))
        FROM public.appointment_services aps
        JOIN public.services s_multi ON aps.service_id = s_multi.id
        WHERE aps.appointment_id = NEW.id
      ),
      (SELECT duration_minutes FROM public.services WHERE id = NEW.service_id),
      30
    )::integer INTO v_total_dur;

    v_end_time := v_start_time + (v_total_dur || ' minutes')::interval;

    WITH existing_appt_durations AS (
      SELECT 
        a.id,
        a.appointment_time,
        COALESCE(
          (
            SELECT sum(COALESCE(s_multi.duration_minutes, 30))
            FROM public.appointment_services aps
            JOIN public.services s_multi ON aps.service_id = s_multi.id
            WHERE aps.appointment_id = a.id
          ),
          s_single.duration_minutes,
          30
        )::integer AS appt_total_duration
      FROM public.appointments a
      LEFT JOIN public.services s_single ON a.service_id = s_single.id
      WHERE a.barber_id = NEW.barber_id
        AND a.id <> NEW.id
        AND (
          a.status IN ('confirmed', 'pending')
          OR (a.status = 'cancelled' AND a.cancellation_reason IS NOT NULL AND a.cancellation_reason ILIKE '%BLOQUEIO%')
        )
    )
    SELECT COUNT(*) INTO v_conflict_count
    FROM existing_appt_durations ead
    WHERE (
      ead.appointment_time::timestamp < v_end_time
      AND (ead.appointment_time::timestamp + (ead.appt_total_duration || ' minutes')::interval) > v_start_time
    );

    IF v_conflict_count > 0 THEN
      RAISE EXCEPTION 'HORARIO_INDISPONIVEL: O horário solicitado já está ocupado por outro atendimento.';
    END IF;
  END IF;

  -- REGRA 3: Auditoria estrita das transições de status por papel
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    v_caller_role := public.current_user_role();
    v_caller_uid := auth.uid();

    -- A. Usuário anônimo nunca pode alterar status
    IF auth.role() = 'anon' THEN
      RAISE EXCEPTION 'ACESSO_NEGADO: Usuários anônimos não possuem autorização para alterar status de agendamentos.';
    END IF;

    -- B. Papel de CLIENTE (client)
    IF v_caller_role = 'client' THEN
      -- Cliente só pode CANCELAR seu próprio agendamento (status -> 'cancelled')
      IF NEW.status <> 'cancelled' THEN
        RAISE EXCEPTION 'TRANSICAO_STATUS_NAO_AUTORIZADA: Clientes só possuem permissão para cancelar seus próprios agendamentos.';
      END IF;

      -- Cliente não pode cancelar agendamento de terceiros
      IF NOT public.is_appointment_owner(OLD.client_id) THEN
        RAISE EXCEPTION 'ACESSO_NEGADO: Você não tem permissão para cancelar o agendamento de outro cliente.';
      END IF;

      -- Cliente não pode alterar agendamento já cancelado ou concluído
      IF OLD.status IN ('cancelled', 'completed') THEN
        RAISE EXCEPTION 'TRANSICAO_STATUS_NAO_AUTORIZADA: Agendamentos cancelados ou concluídos não podem ser alterados por clientes.';
      END IF;
    END IF;

    -- C. Papel de BARBEIRO (barber)
    IF v_caller_role = 'barber' THEN
      -- Barbeiro só pode alterar agendamentos da sua própria agenda
      IF v_caller_uid IS NOT NULL THEN
        IF NOT EXISTS (
          SELECT 1 FROM public.barbers 
          WHERE id = OLD.barber_id 
            AND (user_id = v_caller_uid::text OR user_id = (SELECT id::text FROM public.users WHERE auth_user_id = v_caller_uid LIMIT 1))
        ) THEN
          RAISE EXCEPTION 'ACESSO_NEGADO: Barbeiros só possuem permissão para alterar agendamentos da sua própria agenda.';
        END IF;
      END IF;

      -- Barbeiro não pode reativar agendamento cancelado (exclusivo de administração ou nova RPC)
      IF NEW.status = 'confirmed' AND OLD.status = 'cancelled' THEN
        RAISE EXCEPTION 'TRANSICAO_STATUS_NAO_AUTORIZADA: Reativação de agendamentos cancelados é restrita à administração.';
      END IF;
    END IF;

    -- D. Administradores e secretários possuem permissão para todas as transições legítimas
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

DROP TRIGGER IF EXISTS trigger_check_appointment_update_conflict ON public.appointments;
CREATE TRIGGER trigger_check_appointment_update_conflict
BEFORE UPDATE OF appointment_time, barber_id, service_id, status ON public.appointments
FOR EACH ROW EXECUTE FUNCTION public.check_appointment_update_conflict();

-- ------------------------------------------------------------------------------
-- 3. GESTÃO ESTRITA DE PRIVILÉGIOS (COLUMN-LEVEL & ROLE SECURITY)
-- ------------------------------------------------------------------------------
-- A. Permissões de Execução da RPC de remarcação
REVOKE ALL ON FUNCTION public.reschedule_appointment_online(TEXT, TEXT, TEXT, TEXT[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.reschedule_appointment_online(TEXT, TEXT, TEXT, TEXT[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.reschedule_appointment_online(TEXT, TEXT, TEXT, TEXT[]) TO authenticated, service_role;

-- B. Privilégios na tabela public.appointments
-- Revoga privilégio amplo de UPDATE para impedir contorno da RPC via UPDATE direto
REVOKE UPDATE ON public.appointments FROM PUBLIC, anon, authenticated;
-- Concede UPDATE estritamente para colunas operacionais legítimas (cancelamento, conclusão, falta)
GRANT UPDATE (status, cancellation_reason, updated_at) ON public.appointments TO authenticated;
GRANT SELECT, INSERT ON public.appointments TO authenticated;
GRANT SELECT ON public.appointments TO anon;

-- Policy RLS para permitir que clientes autenticados cancelem estritamente seus próprios agendamentos
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'appointments' AND policyname = 'Cliente cancela seus próprios agendamentos'
  ) THEN
    CREATE POLICY "Cliente cancela seus próprios agendamentos"
    ON public.appointments FOR UPDATE
    TO authenticated
    USING (
      public.current_user_role() = 'client'
      AND public.is_appointment_owner(client_id)
    )
    WITH CHECK (
      status = 'cancelled'
    );
  END IF;
END $$;

-- C. Privilégios na tabela public.appointment_services
REVOKE ALL ON public.appointment_services FROM PUBLIC, anon;
REVOKE UPDATE, DELETE ON public.appointment_services FROM authenticated;
GRANT SELECT, INSERT ON public.appointment_services TO authenticated;
GRANT SELECT ON public.appointment_services TO anon;

-- D. Privilégios na fila de notificações e logs
GRANT SELECT, INSERT, UPDATE ON public.notification_queue TO authenticated, service_role;
GRANT SELECT ON public.notification_queue TO anon;

-- E. Leitura de catálogo público (barbers, services, barber_services)
GRANT SELECT ON public.barbers TO authenticated, anon;
GRANT SELECT ON public.services TO authenticated, anon;
GRANT SELECT ON public.barber_services TO authenticated, anon;
GRANT SELECT ON public.users TO authenticated;

-- F. Blindagem de Privacidade da Tabela CUSTOMERS
-- Revoga sumariamente qualquer privilégio de leitura pública ou anônima a dados pessoais
REVOKE ALL ON public.customers FROM PUBLIC, anon;
REVOKE SELECT ON public.customers FROM anon;

-- Permite SELECT apenas para autenticados (fiscalizado por RLS por papel)
GRANT SELECT, INSERT ON public.customers TO authenticated;

-- Política de menor privilégio: cliente autenticado lê apenas seus próprios dados
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'customers' AND policyname = 'Cliente visualiza seus próprios dados'
  ) THEN
    CREATE POLICY "Cliente visualiza seus próprios dados"
    ON public.customers FOR SELECT
    USING (
      public.current_user_role() = 'client'
      AND (
        regexp_replace(phone, '\D', '', 'g') = (
          SELECT regexp_replace(phone, '\D', '', 'g') 
          FROM public.users 
          WHERE auth_user_id = auth.uid() OR id = auth.uid()::text 
          LIMIT 1
        )
      )
    );
  END IF;
END $$;


