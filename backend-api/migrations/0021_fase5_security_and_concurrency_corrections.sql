-- ==============================================================================
-- PROJETO: CLUB 01 BARBER STUDIO
-- FASE 5.3: MIGRATION CONSOLIDADA DE SEGURANÇA, CONCORRÊNCIA, INTEGRIDADE E ESTOQUE
-- Versão: 4.0 (Revisada em 2026-10-19: Preço Oficial do Banco, Agrupamento de Produtos Duplicados, Privacidade e Locks)
-- Arquivo: 0021_fase5_security_and_concurrency_corrections.sql
-- 
-- STATUS: VALIDADA LOCALMENTE EM POSTGRESQL ISOLADO (NÃO EXECUTADA NO SUPABASE REMOTO)
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. CONSTRAINT DE SEGURANÇA: Prevenção de Estoque Negativo em public.products
-- ------------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'products_stock_non_negative'
  ) THEN
    ALTER TABLE public.products
    ADD CONSTRAINT products_stock_non_negative CHECK (stock_quantity >= 0);
  END IF;
END $$;

-- ------------------------------------------------------------------------------
-- 2. TRIGGER PL/pgSQL: Baixa, Estorno e Bloqueio Pessimista de Linha no Estoque
--    Trata: INSERT (baixa), UPDATE com mesmo produto ou troca de produto, e DELETE
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_sale_item_stock()
RETURNS TRIGGER AS $$
DECLARE
  v_current_stock INTEGER;
  v_new_stock INTEGER;
  v_first_prod TEXT;
  v_second_prod TEXT;
BEGIN
  -- CENÁRIO 1: Inserção de novo item de venda
  IF (TG_OP = 'INSERT') THEN
    IF NEW.quantity <= 0 THEN
      RAISE EXCEPTION 'QUANTIDADE_INVALIDA: A quantidade vendida deve ser maior que zero.';
    END IF;

    -- Bloqueio pessimista da linha do produto na transação atual (evita race condition)
    SELECT stock_quantity INTO v_current_stock
    FROM public.products
    WHERE id = NEW.product_id
    FOR UPDATE;

    IF v_current_stock IS NULL THEN
      RAISE EXCEPTION 'PRODUTO_NAO_ENCONTRADO: O produto % não existe.', NEW.product_id;
    END IF;

    IF v_current_stock < NEW.quantity THEN
      RAISE EXCEPTION 'ESTOQUE_INSUFICIENTE: Saldo disponível em estoque (%) é insuficiente para atender a baixa de % unidades do produto %.', v_current_stock, NEW.quantity, NEW.product_id;
    END IF;

    UPDATE public.products
    SET stock_quantity = stock_quantity - NEW.quantity,
        updated_at = now()
    WHERE id = NEW.product_id;
    RETURN NEW;

  -- CENÁRIO 2: Atualização de item de venda existente
  ELSIF (TG_OP = 'UPDATE') THEN
    IF NEW.quantity <= 0 THEN
      RAISE EXCEPTION 'QUANTIDADE_INVALIDA: A nova quantidade deve ser maior que zero.';
    END IF;

    -- Sub-caso A: Mesmo produto, alteração de quantidade ou preço
    IF (OLD.product_id = NEW.product_id) THEN
      IF (OLD.quantity = NEW.quantity) THEN
        -- Alteração apenas de preço ou metadados: estoque inalterado
        RETURN NEW;
      ELSIF (NEW.quantity > OLD.quantity) THEN
        -- Aumento da quantidade vendida: debitar diferença adicional
        SELECT stock_quantity INTO v_current_stock
        FROM public.products
        WHERE id = NEW.product_id
        FOR UPDATE;

        IF v_current_stock < (NEW.quantity - OLD.quantity) THEN
          RAISE EXCEPTION 'ESTOQUE_INSUFICIENTE: Saldo disponível (%) é insuficiente para o acréscimo de % unidades.', v_current_stock, (NEW.quantity - OLD.quantity);
        END IF;

        UPDATE public.products
        SET stock_quantity = stock_quantity - (NEW.quantity - OLD.quantity),
            updated_at = now()
        WHERE id = NEW.product_id;
        RETURN NEW;
      ELSE
        -- Redução da quantidade vendida: estornar diferença
        UPDATE public.products
        SET stock_quantity = stock_quantity + (OLD.quantity - NEW.quantity),
            updated_at = now()
        WHERE id = NEW.product_id;
        RETURN NEW;
      END IF;

    -- Sub-caso B: Troca de produto no item (OLD.product_id <> NEW.product_id)
    ELSE
      -- Bloquear ambos os produtos em ordem lexicográfica determinística para prevenir DEADLOCK
      v_first_prod := LEAST(OLD.product_id, NEW.product_id);
      v_second_prod := GREATEST(OLD.product_id, NEW.product_id);

      PERFORM 1 FROM public.products WHERE id = v_first_prod FOR UPDATE;
      PERFORM 1 FROM public.products WHERE id = v_second_prod FOR UPDATE;

      -- 1. Devolver a quantidade antiga ao estoque do produto original
      UPDATE public.products
      SET stock_quantity = stock_quantity + OLD.quantity,
          updated_at = now()
      WHERE id = OLD.product_id;

      -- 2. Verificar saldo do novo produto
      SELECT stock_quantity INTO v_new_stock
      FROM public.products
      WHERE id = NEW.product_id;

      IF v_new_stock IS NULL THEN
        RAISE EXCEPTION 'PRODUTO_NAO_ENCONTRADO: O novo produto % não existe.', NEW.product_id;
      END IF;

      IF v_new_stock < NEW.quantity THEN
        RAISE EXCEPTION 'ESTOQUE_INSUFICIENTE: Saldo disponível do novo produto (%) é insuficiente para a quantidade de % unidades.', v_new_stock, NEW.quantity;
      END IF;

      -- 3. Debitar a quantidade do novo produto
      UPDATE public.products
      SET stock_quantity = stock_quantity - NEW.quantity,
          updated_at = now()
      WHERE id = NEW.product_id;

      RETURN NEW;
    END IF;

  -- CENÁRIO 3: Exclusão do item de venda (estorno total ao estoque)
  ELSIF (TG_OP = 'DELETE') THEN
    SELECT stock_quantity INTO v_current_stock
    FROM public.products
    WHERE id = OLD.product_id
    FOR UPDATE;

    UPDATE public.products
    SET stock_quantity = stock_quantity + OLD.quantity,
        updated_at = now()
    WHERE id = OLD.product_id;
    RETURN OLD;
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Garantir existência do trigger associado na tabela public.sale_items
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trigger_sale_item_stock'
  ) THEN
    CREATE TRIGGER trigger_sale_item_stock
    AFTER INSERT OR UPDATE OR DELETE ON public.sale_items
    FOR EACH ROW EXECUTE FUNCTION public.handle_sale_item_stock();
  END IF;
END $$;

-- ------------------------------------------------------------------------------
-- 3. RPC: create_sale_atomic com Autorização Estrita, Preço Não Negativo e Locks
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_sale_atomic(
  p_appointment_id TEXT,
  p_customer_id TEXT,
  p_payment_method TEXT,
  p_items JSONB,
  p_register_in_caixa BOOLEAN DEFAULT true
)
RETURNS JSONB AS $$
DECLARE
  v_caller_id UUID;
  v_caller_role TEXT;
  v_sale_id TEXT;
  v_total NUMERIC(10,2) := 0.00;
  v_item RECORD;
  v_item_total NUMERIC(10,2);
  v_current_stock INTEGER;
  v_official_price NUMERIC(10,2);
  v_normalized_payment TEXT;
BEGIN
  -- 1. Validação de Autorização: Apenas admin e secretário podem registrar vendas
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'NAO_AUTORIZADO: Operação restrita a usuários autenticados.';
  END IF;

  v_caller_role := public.current_user_role();
  IF v_caller_role NOT IN ('admin', 'secretario') THEN
    RAISE EXCEPTION 'ACESSO_NEGADO: Apenas administradores e secretários possuem permissão para registrar vendas e movimentações financeiras.';
  END IF;

  -- 2. Validação dos Parâmetros
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'PARAMETROS_INVALIDOS: A venda deve conter pelo menos um produto.';
  END IF;

  -- Normalização de método de pagamento (compatibilidade com CHECK constraint de public.sales e frontend)
  v_normalized_payment := UPPER(TRIM(COALESCE(p_payment_method, '')));
  IF v_normalized_payment = 'OUTRO' THEN
    v_normalized_payment := 'A_PRAZO';
  END IF;

  IF v_normalized_payment NOT IN ('PIX', 'CARTAO_CREDITO', 'CARTAO_DEBITO', 'DINHEIRO', 'A_PRAZO') THEN
    RAISE EXCEPTION 'METODO_PAGAMENTO_INVALIDO: O método de pagamento informado não é válido.';
  END IF;

  -- Validação de existência do cliente se fornecido
  IF p_customer_id IS NOT NULL AND p_customer_id <> '' THEN
    IF NOT EXISTS (SELECT 1 FROM public.customers WHERE id = p_customer_id) THEN
      RAISE EXCEPTION 'CLIENTE_INVALIDO: O cliente informado não existe na base cadastral.';
    END IF;
  END IF;

  -- Validação de existência do agendamento se fornecido
  IF p_appointment_id IS NOT NULL AND p_appointment_id <> '' THEN
    IF NOT EXISTS (SELECT 1 FROM public.appointments WHERE id = p_appointment_id) THEN
      RAISE EXCEPTION 'AGENDAMENTO_INVALIDO: O agendamento informado não foi localizado.';
    END IF;
  END IF;

  v_sale_id := gen_random_uuid()::text;

  -- 3. AGRUPAR PRODUTOS REPETIDOS, TRAVAR EM ORDEM DETERMINÍSTICA E VALIDAR PREÇO OFICIAL
  -- Agrupa os itens por product_id para somar quantidades e prevenir race conditions/duplicatas
  FOR v_item IN 
    SELECT 
      product_id,
      SUM(quantity)::integer AS total_quantity
    FROM jsonb_to_recordset(p_items) AS x(product_id TEXT, quantity INTEGER, unit_price NUMERIC)
    GROUP BY product_id
    ORDER BY product_id ASC -- Trava determinística para prevenir DEADLOCK
  LOOP
    IF v_item.product_id IS NULL OR TRIM(v_item.product_id) = '' THEN
      RAISE EXCEPTION 'PARAMETROS_INVALIDOS: Identificador de produto inválido.';
    END IF;

    IF v_item.total_quantity IS NULL OR v_item.total_quantity <= 0 THEN
      RAISE EXCEPTION 'QUANTIDADE_INVALIDA: A quantidade do produto % deve ser maior que zero.', v_item.product_id;
    END IF;

    -- Bloqueio pessimista de linha (FOR UPDATE) e obtenção de preço oficial e estoque do produto
    SELECT stock_quantity, sale_price INTO v_current_stock, v_official_price
    FROM public.products
    WHERE id = v_item.product_id
    FOR UPDATE;

    IF v_current_stock IS NULL THEN
      RAISE EXCEPTION 'PRODUTO_NAO_ENCONTRADO: O produto % não existe no catálogo.', v_item.product_id;
    END IF;

    IF v_official_price IS NULL OR v_official_price < 0 THEN
      RAISE EXCEPTION 'PRECO_INVALIDO: O preço oficial do produto % é inválido ou negativo.', v_item.product_id;
    END IF;

    -- Validação do estoque somado total contra o saldo disponível
    IF v_current_stock < v_item.total_quantity THEN
      RAISE EXCEPTION 'ESTOQUE_INSUFICIENTE: Saldo disponível (%) é inferior à quantidade solicitada (%) para o produto %.', v_current_stock, v_item.total_quantity, v_item.product_id;
    END IF;

    -- Não confia no unit_price enviado pelo frontend: calcula o total estritamente com base no sale_price oficial
    v_total := v_total + (v_item.total_quantity * v_official_price);
  END LOOP;

  -- 4. Criar registro da venda
  INSERT INTO public.sales (id, appointment_id, customer_id, payment_method, total_amount)
  VALUES (v_sale_id, p_appointment_id, p_customer_id, v_normalized_payment, v_total);

  -- 5. Inserir itens consolidados (o trigger handle_sale_item_stock confirmará a baixa exata)
  FOR v_item IN 
    SELECT 
      product_id,
      SUM(quantity)::integer AS total_quantity
    FROM jsonb_to_recordset(p_items) AS x(product_id TEXT, quantity INTEGER, unit_price NUMERIC)
    GROUP BY product_id
    ORDER BY product_id ASC
  LOOP
    SELECT sale_price INTO v_official_price
    FROM public.products
    WHERE id = v_item.product_id;

    v_item_total := v_item.total_quantity * v_official_price;

    INSERT INTO public.sale_items (id, sale_id, product_id, quantity, unit_price, total_price)
    VALUES (gen_random_uuid()::text, v_sale_id, v_item.product_id, v_item.total_quantity, v_official_price, v_item_total);
  END LOOP;

  -- 6. Lançamento opcional no caixa operacional
  IF p_register_in_caixa AND v_total > 0 THEN
    INSERT INTO public.caixa (
      id, type, description, amount, category, payment_method, appointment_id, date
    ) VALUES (
      gen_random_uuid()::text,
      'receita',
      'Venda de Produtos (Balcão)',
      v_total,
      'Venda de Produtos',
      p_payment_method,
      p_appointment_id,
      to_char(now() AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD')
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'sale_id', v_sale_id,
    'total_amount', v_total
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION public.create_sale_atomic(TEXT, TEXT, TEXT, JSONB, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_sale_atomic(TEXT, TEXT, TEXT, JSONB, BOOLEAN) TO authenticated, service_role;

-- ------------------------------------------------------------------------------
-- 4. RPC: book_appointment_online com Validação Estrita de Serviços Restritos,
--    Habilitação de Barbeiros, Duração Acumulada de Múltiplos Serviços e Locks
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.book_appointment_online(
  p_name TEXT,
  p_phone TEXT,
  p_barber_id TEXT,
  p_service_ids TEXT[],
  p_appointment_time TEXT
)
RETURNS JSONB AS $$
DECLARE
  v_client_id TEXT;
  v_clean_phone TEXT;
  v_primary_service_id TEXT;
  v_total_duration INTEGER := 0;
  v_start_time TIMESTAMP;
  v_end_time TIMESTAMP;
  v_dow INTEGER;
  v_closing_hour INTEGER := 20;
  v_opening_hour INTEGER := 9;
  v_min_lead_min INTEGER := 30;
  v_setting_val TEXT;
  v_conflict_count INTEGER;
  v_appointment_id TEXT;
  v_sid TEXT;
  v_srv_rec RECORD;
  v_barber_exists BOOLEAN;
  v_has_specialties BOOLEAN;
  v_barber_executes_service BOOLEAN;
BEGIN
  -- 1. Validação de parâmetros obrigatórios
  IF p_barber_id IS NULL OR p_appointment_time IS NULL OR p_service_ids IS NULL OR array_length(p_service_ids, 1) = 0 THEN
    RAISE EXCEPTION 'PARAMETROS_INVALIDOS: Profissional, data/horário e ao menos um serviço são obrigatórios.';
  END IF;

  IF p_name IS NULL OR trim(p_name) = '' THEN
    RAISE EXCEPTION 'PARAMETROS_INVALIDOS: O nome do cliente é obrigatório.';
  END IF;

  v_clean_phone := regexp_replace(COALESCE(p_phone, ''), '\D', '', 'g');
  IF length(v_clean_phone) < 10 THEN
    RAISE EXCEPTION 'PARAMETROS_INVALIDOS: Telefone / WhatsApp inválido (mínimo de 10 dígitos).';
  END IF;

  -- 2. Concorrência: Lock transacional exclusivo por profissional
  PERFORM pg_advisory_xact_lock(hashtext('barber_booking_' || p_barber_id));

  -- 3. Validação do Profissional
  SELECT EXISTS(SELECT 1 FROM public.barbers WHERE id = p_barber_id) INTO v_barber_exists;
  IF NOT v_barber_exists THEN
    RAISE EXCEPTION 'PROFISSIONAL_INVALIDO: O profissional selecionado não existe.';
  END IF;

  -- Verificar se o barbeiro possui especialidades registradas
  SELECT EXISTS(SELECT 1 FROM public.barber_services WHERE barber_id = p_barber_id) INTO v_has_specialties;

  -- 4. Validação Estrita dos Serviços Selecionados (SEM FALLBACK PARA RESTRITOS!)
  v_primary_service_id := p_service_ids[1];
  FOREACH v_sid IN ARRAY p_service_ids LOOP
    SELECT id, name, duration_minutes, price, restricted_access
    INTO v_srv_rec
    FROM public.services
    WHERE id = v_sid;

    IF v_srv_rec.id IS NULL THEN
      RAISE EXCEPTION 'SERVICO_INVALIDO: O serviço solicitado (%) não existe no catálogo.', v_sid;
    END IF;

    -- REGRA DE SEGURANÇA: Rejeição absoluta de serviços restritos para agendamento público
    IF v_srv_rec.restricted_access = true THEN
      RAISE EXCEPTION 'SERVICO_RESTRITO: O serviço "%" é exclusivo para agendamento interno e não está disponível online.', v_srv_rec.name;
    END IF;

    IF v_srv_rec.duration_minutes IS NULL OR v_srv_rec.duration_minutes <= 0 THEN
      RAISE EXCEPTION 'DURACAO_INVALIDA: A duração do serviço "%" é inválida.', v_srv_rec.name;
    END IF;

    -- REGRA: Verificar se o barbeiro executa o serviço (caso tenha especialidades vinculadas)
    IF v_has_specialties THEN
      SELECT EXISTS(
        SELECT 1 FROM public.barber_services 
        WHERE barber_id = p_barber_id AND service_id = v_sid
      ) INTO v_barber_executes_service;

      IF NOT v_barber_executes_service THEN
        RAISE EXCEPTION 'PROFISSIONAL_NAO_HABILITADO: O profissional selecionado não realiza o procedimento "%".', v_srv_rec.name;
      END IF;
    END IF;

    v_total_duration := v_total_duration + v_srv_rec.duration_minutes;
  END LOOP;

  -- 5. Tratamento de Horários e Expediente
  BEGIN
    v_start_time := p_appointment_time::timestamp;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'DATA_INVALIDA: Formato de data/horário inválido (esperado YYYY-MM-DDTHH:mm).';
  END;

  v_end_time := v_start_time + (v_total_duration || ' minutes')::interval;
  v_dow := EXTRACT(DOW FROM v_start_time); -- 0 = Domingo, 6 = Sábado

  -- Regra: Fechado aos domingos
  IF v_dow = 0 THEN
    RAISE EXCEPTION 'FORA_DO_EXPEDIENTE: O CLUB 01 não realiza atendimentos aos domingos.';
  END IF;

  -- Regra: Horário de expediente (configurável via settings ou padrão)
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

  IF v_end_time > (date_trunc('day', v_start_time) + (v_closing_hour || ' hours')::interval) THEN
    RAISE EXCEPTION 'FORA_DO_EXPEDIENTE: A duração total (% min) ultrapassa o horário de encerramento das %:00.', v_total_duration, v_closing_hour;
  END IF;

  -- Regra: Antecedência mínima configurada em settings
  SELECT value INTO v_setting_val FROM public.settings WHERE key = 'min_lead_time_minutes';
  IF v_setting_val ~ '^\d+$' THEN v_min_lead_min := v_setting_val::integer; END IF;

  IF v_start_time < (now() AT TIME ZONE 'America/Sao_Paulo' + (v_min_lead_min || ' minutes')::interval) THEN
    RAISE EXCEPTION 'ANTECEDENCIA_MINIMA: O agendamento exige uma antecedência mínima de % minutos.', v_min_lead_min;
  END IF;

  -- 6. Validação de Conflito de Horário e Sobreposição com MÚLTIPLOS SERVIÇOS EXISTENTES
  -- Calcula a duração total real de cada agendamento ativo via appointment_services
  WITH existing_appt_durations AS (
    SELECT 
      a.id,
      a.appointment_time,
      COALESCE(
        -- 1. Se tem múltiplos serviços na tabela de associação, soma a duração de todos
        (
          SELECT SUM(COALESCE(s_multi.duration_minutes, 30))
          FROM public.appointment_services aps
          JOIN public.services s_multi ON aps.service_id = s_multi.id
          WHERE aps.appointment_id = a.id
        ),
        -- 2. Fallback para agendamento legado que possui apenas service_id principal
        s_single.duration_minutes,
        -- 3. Fallback de contingência
        30
      )::integer AS appt_total_duration
    FROM public.appointments a
    LEFT JOIN public.services s_single ON a.service_id = s_single.id
    WHERE a.barber_id = p_barber_id
      AND (
        a.status IN ('confirmed', 'pending')
        OR (a.status = 'cancelled' AND a.cancellation_reason IS NOT NULL AND a.cancellation_reason <> '')
      )
  )
  SELECT COUNT(*) INTO v_conflict_count
  FROM existing_appt_durations ead
  WHERE (
    -- Sobreposição de intervalos: início1 < fim2 AND fim1 > início2
    ead.appointment_time::timestamp < v_end_time
    AND (ead.appointment_time::timestamp + (ead.appt_total_duration || ' minutes')::interval) > v_start_time
  );

  IF v_conflict_count > 0 THEN
    RAISE EXCEPTION 'HORARIO_INDISPONIVEL: O profissional já possui um agendamento ou bloqueio no intervalo selecionado.';
  END IF;

  -- 7. Resolução / Cadastro do Cliente com Proteção de Privacidade
  SELECT id INTO v_client_id
  FROM public.customers
  WHERE regexp_replace(phone, '\D', '', 'g') = v_clean_phone
  LIMIT 1;

  IF v_client_id IS NULL THEN
    v_client_id := gen_random_uuid()::text;
    INSERT INTO public.customers (id, name, phone)
    VALUES (v_client_id, UPPER(TRIM(p_name)), v_clean_phone);
  END IF;
  -- Se o cliente já existir pelo telefone, reutiliza o cadastro existente sem sobrescrever o nome preexistente, protegendo a privacidade dos dados.

  -- 8. Inserção do Agendamento Principal
  v_appointment_id := gen_random_uuid()::text;

  INSERT INTO public.appointments (
    id, client_id, barber_id, service_id, appointment_time, status
  ) VALUES (
    v_appointment_id, v_client_id, p_barber_id, v_primary_service_id, p_appointment_time, 'confirmed'
  );

  -- 9. Inserção de Múltiplos Serviços
  FOREACH v_sid IN ARRAY p_service_ids LOOP
    INSERT INTO public.appointment_services (appointment_id, service_id)
    VALUES (v_appointment_id, v_sid)
    ON CONFLICT DO NOTHING;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'appointment_id', v_appointment_id,
    'client_id', v_client_id,
    'barber_id', p_barber_id,
    'appointment_time', p_appointment_time,
    'duration_minutes', v_total_duration
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION public.book_appointment_online(TEXT, TEXT, TEXT, TEXT[], TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.book_appointment_online(TEXT, TEXT, TEXT, TEXT[], TEXT) TO anon, authenticated, service_role;

-- ------------------------------------------------------------------------------
-- 5. RPC: book_appointment_atomic com Concorrência e Múltiplos Serviços
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.book_appointment_atomic(
  p_client_id TEXT,
  p_barber_id TEXT,
  p_service_id TEXT,
  p_appointment_time TEXT,
  p_service_ids TEXT[] DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
  v_caller_role TEXT;
  v_conflict_count INTEGER;
  v_appointment_id TEXT;
  v_sid TEXT;
  v_total_duration INTEGER := 0;
  v_dur INTEGER;
  v_start_time TIMESTAMP;
  v_end_time TIMESTAMP;
  v_active_service_ids TEXT[];
BEGIN
  IF p_client_id IS NULL OR p_barber_id IS NULL OR p_service_id IS NULL OR p_appointment_time IS NULL THEN
    RAISE EXCEPTION 'PARAMETROS_INVALIDOS: Cliente, profissional, serviço e data/horário são obrigatórios.';
  END IF;

  -- 1. Validação de Autorização: apenas equipe autenticada
  v_caller_role := public.current_user_role();
  IF v_caller_role NOT IN ('admin', 'secretario', 'barber') THEN
    RAISE EXCEPTION 'ACESSO_NEGADO: Apenas a equipe autenticada possui permissão para este agendamento.';
  END IF;

  -- Barbeiro só pode agendar para si mesmo
  IF v_caller_role = 'barber' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.barbers WHERE id = p_barber_id AND user_id = auth.uid()::text
    ) THEN
      RAISE EXCEPTION 'ACESSO_NEGADO: Barbeiros só podem agendar na sua própria agenda.';
    END IF;
  END IF;

  -- 2. Concorrência: Lock transacional por barbeiro
  PERFORM pg_advisory_xact_lock(hashtext('barber_booking_' || p_barber_id));

  IF p_service_ids IS NOT NULL AND array_length(p_service_ids, 1) > 0 THEN
    v_active_service_ids := p_service_ids;
  ELSE
    v_active_service_ids := ARRAY[p_service_id];
  END IF;

  -- Calcular duração acumulada
  FOREACH v_sid IN ARRAY v_active_service_ids LOOP
    SELECT duration_minutes INTO v_dur FROM public.services WHERE id = v_sid;
    IF v_dur IS NULL THEN
      RAISE EXCEPTION 'SERVICO_INVALIDO: O serviço % não existe.', v_sid;
    END IF;
    v_total_duration := v_total_duration + v_dur;
  END LOOP;
  IF v_total_duration = 0 THEN v_total_duration := 30; END IF;

  v_start_time := p_appointment_time::timestamp;
  v_end_time := v_start_time + (v_total_duration || ' minutes')::interval;

  -- 3. Verificar conflito e sobreposição considerando duração real de múltiplos serviços
  WITH existing_appt_durations AS (
    SELECT 
      a.id,
      a.appointment_time,
      COALESCE(
        (
          SELECT SUM(COALESCE(s_multi.duration_minutes, 30))
          FROM public.appointment_services aps
          JOIN public.services s_multi ON aps.service_id = s_multi.id
          WHERE aps.appointment_id = a.id
        ),
        s_single.duration_minutes,
        30
      )::integer AS appt_total_duration
    FROM public.appointments a
    LEFT JOIN public.services s_single ON a.service_id = s_single.id
    WHERE a.barber_id = p_barber_id
      AND (
        a.status IN ('confirmed', 'pending')
        OR (a.status = 'cancelled' AND a.cancellation_reason IS NOT NULL AND a.cancellation_reason <> '')
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

  v_appointment_id := gen_random_uuid()::text;

  INSERT INTO public.appointments (
    id, client_id, barber_id, service_id, appointment_time, status
  ) VALUES (
    v_appointment_id, p_client_id, p_barber_id, p_service_id, p_appointment_time, 'confirmed'
  );

  FOREACH v_sid IN ARRAY v_active_service_ids LOOP
    INSERT INTO public.appointment_services (appointment_id, service_id)
    VALUES (v_appointment_id, v_sid)
    ON CONFLICT DO NOTHING;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'appointment_id', v_appointment_id,
    'status', 'confirmed',
    'appointment_time', p_appointment_time,
    'duration_minutes', v_total_duration
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION public.book_appointment_atomic(TEXT, TEXT, TEXT, TEXT, TEXT[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.book_appointment_atomic(TEXT, TEXT, TEXT, TEXT, TEXT[]) TO authenticated, service_role;
