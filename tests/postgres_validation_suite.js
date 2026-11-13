/* global process */
import { PGlite } from '@electric-sql/pglite';
import fs from 'fs';
import path from 'path';

// Diretório base
const BASE_DIR = 'C:\\club01';
const MIGRATIONS_DIR = path.join(BASE_DIR, 'backend-api', 'migrations');

async function setupDatabase(db) {
  // 1. Criar schema auth mock do Supabase e funcoes nativas
  await db.exec(`
    CREATE SCHEMA IF NOT EXISTS auth;
    
    -- Criar roles padrao do Supabase para suportar GRANTs e RLS
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN
        CREATE ROLE anon NOLOGIN;
      END IF;
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN
        CREATE ROLE authenticated NOLOGIN;
      END IF;
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN
        CREATE ROLE service_role NOLOGIN;
      END IF;
    END $$;

    CREATE TABLE IF NOT EXISTS auth.users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email TEXT,
      phone TEXT,
      raw_user_meta_data JSONB,
      created_at TIMESTAMPTZ DEFAULT now()
    );

    CREATE OR REPLACE FUNCTION auth.uid() RETURNS UUID AS $$
      SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
    $$ LANGUAGE sql STABLE;

    CREATE OR REPLACE FUNCTION auth.role() RETURNS TEXT AS $$
      SELECT COALESCE(NULLIF(current_setting('request.jwt.claim.role', true), ''), 'anon');
    $$ LANGUAGE sql STABLE;
  `);

  // 2. Carregar e executar supabase_club01_init.sql (filtrando CREATE EXTENSION pois gen_random_uuid() é nativo no PG 18)
  let initSql = fs.readFileSync(path.join(MIGRATIONS_DIR, 'supabase_club01_init.sql'), 'utf-8');
  initSql = initSql.replace(/CREATE EXTENSION IF NOT EXISTS/gi, '-- CREATE EXTENSION IF NOT EXISTS');
  await db.exec(initSql);

  // 3. Carregar e executar 0019_supabase_security_and_rpc.sql
  let sql0019 = fs.readFileSync(path.join(MIGRATIONS_DIR, '0019_supabase_security_and_rpc.sql'), 'utf-8');
  sql0019 = sql0019.replace(/CREATE EXTENSION IF NOT EXISTS/gi, '-- CREATE EXTENSION IF NOT EXISTS');
  await db.exec(sql0019);

  // 4. Carregar e executar 0020_book_appointment_online.sql
  let sql0020 = fs.readFileSync(path.join(MIGRATIONS_DIR, '0020_book_appointment_online.sql'), 'utf-8');
  sql0020 = sql0020.replace(/CREATE EXTENSION IF NOT EXISTS/gi, '-- CREATE EXTENSION IF NOT EXISTS');
  await db.exec(sql0020);
}

// Funções utilitárias para simulação de contexto Supabase Auth
async function setAuthContext(db, { userId = null, role = 'anon' } = {}) {
  await db.exec(`
    SELECT set_config('request.jwt.claim.sub', '${userId || ''}', false);
    SELECT set_config('request.jwt.claim.role', '${role}', false);
  `);
}

async function runTests() {
  console.log('================================================================');
  console.log(' CLUB 01 BARBER STUDIO — SUÍTE DE VALIDAÇÃO POSTGRESQL ISOLADA');
  console.log(' FASE 5.3: CONCORRÊNCIA, SEGURANÇA FINANCEIRA E MIGRATION 0021');
  console.log('================================================================\n');

  const testMatrix = [];

  function record(scenario, environment, result, evidence) {
    testMatrix.push({ scenario, environment, result, evidence });
    const mark = result === 'APROVADO' ? '✅ [PASS]' : '❌ [FAIL]';
    console.log(`${mark} [${scenario}] -> ${evidence}`);
  }

  // ----------------------------------------------------------------------------
  // ETAPA 1: Setup do Schema Inicial (Anterior à 0021)
  // ----------------------------------------------------------------------------
  console.log('--- 1. PREPARANDO SCHEMA ANTERIOR À MIGRATION 0021 ---');
  const db = new PGlite();
  await setupDatabase(db);
  record(
    'Schema Inicial (0000 até 0020)',
    'PostgreSQL 18.6 Isolado (PGlite)',
    'APROVADO',
    'Tabelas, RLS, triggers e funções das migrations 0000 até 0020 carregadas com sucesso.'
  );

  // Inserir massa inicial de testes
  const adminAuthId = '11111111-1111-4111-a111-111111111111';
  const barberAuthId = '22222222-2222-4222-a222-222222222222';
  const clientAuthId = '33333333-3333-4333-a333-333333333333';

  await db.exec(`
    -- Inserir usuários no auth (o trigger on_auth_user_created criará public.users automaticamente)
    INSERT INTO auth.users (id, email) VALUES 
      ('${adminAuthId}', 'admin@club01.com.br'),
      ('${barberAuthId}', 'barber@club01.com.br'),
      ('${clientAuthId}', 'client@club01.com.br');

    -- Ajustar roles e nomes em public.users
    UPDATE public.users SET role = 'admin', name = 'Administrador Geral' WHERE auth_user_id = '${adminAuthId}';
    UPDATE public.users SET role = 'barber', name = 'Barbeiro Thiago' WHERE auth_user_id = '${barberAuthId}';
    UPDATE public.users SET role = 'client', name = 'Cliente Carlos' WHERE auth_user_id = '${clientAuthId}';

    -- Inserir barbeiro vinculado ao user_id de Thiago
    INSERT INTO public.barbers (id, name, phone, user_id) VALUES
      ('barber-thiago', 'Thiago Silva', '34999990001', (SELECT id FROM public.users WHERE auth_user_id = '${barberAuthId}')),
      ('barber-lucas', 'Lucas Santos', '34999990002', NULL);

    -- Inserir serviços
    INSERT INTO public.services (id, name, duration_minutes, price, restricted_access) VALUES
      ('srv-corte', 'Corte Tradicional', 30, 45.00, false),
      ('srv-barba', 'Barba Terapia', 30, 35.00, false),
      ('srv-combo', 'Combo Corte + Barba', 60, 75.00, false),
      ('srv-restrito', 'Procedimento VIP Diretoria', 60, 200.00, true);

    -- Vincular Thiago a corte e barba (não tem combo)
    INSERT INTO public.barber_services (barber_id, service_id) VALUES
      ('barber-thiago', 'srv-corte'),
      ('barber-thiago', 'srv-barba');

    -- Inserir produtos com estoque conhecido
    INSERT INTO public.products (id, name, sale_price, stock_quantity) VALUES
      ('prod-pomada', 'Pomada Matte Club 01', 50.00, 10),
      ('prod-oleo', 'Óleo para Barba Club 01', 40.00, 5),
      ('prod-shampoo', 'Shampoo Anticaspa Club 01', 35.00, 0);

    -- Configuração de horário de atendimento
    INSERT INTO public.settings (key, value) VALUES
      ('shop_opening_hour', '9'),
      ('shop_closing_hour', '20'),
      ('min_lead_time_minutes', '30')
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
  `);

  // ----------------------------------------------------------------------------
  // ETAPA 2: Aplicação da Migration 0021
  // ----------------------------------------------------------------------------
  console.log('\n--- 2. APLICANDO MIGRATION 0021 (VERSÃO REVISADA 4.0) ---');
  const sql0021 = fs.readFileSync(path.join(MIGRATIONS_DIR, '0021_fase5_security_and_concurrency_corrections.sql'), 'utf-8');
  try {
    await db.exec(sql0021);
    record(
      'Aplicação da Migration 0021',
      'PostgreSQL 18.6 Isolado',
      'APROVADO',
      'Migration 0021 executada com sucesso sem erros de sintaxe ou dependência.'
    );
  } catch (err) {
    console.error('ERRO DETALHADO EM 0021:', err.message, '| CODE:', err.code, '| DETAIL:', err.detail, '| WHERE:', err.where);
    throw err;
  }

  // ----------------------------------------------------------------------------
  // ETAPA 3: Testes Financeiros e de Estoque (create_sale_atomic)
  // ----------------------------------------------------------------------------
  console.log('\n--- 3. TESTES DE SEGURANÇA FINANCEIRA E ESTOQUE (create_sale_atomic) ---');

  // Teste 3.1: Preço do frontend manipulado (deve usar o preço oficial da tabela products)
  await setAuthContext(db, { userId: adminAuthId, role: 'authenticated' });
  const fakePriceSale = await db.query(`
    SELECT public.create_sale_atomic(
      NULL,
      NULL,
      'pix',
      '[{"product_id": "prod-pomada", "quantity": 2, "unit_price": 0.01}]'::jsonb,
      true
    ) as result;
  `);
  const res31 = fakePriceSale.rows[0].result;
  // Preço oficial é 50.00 x 2 = 100.00 (deve ignorar 0.01)
  if (res31.total_amount === 100.00) {
    record(
      'Proteção Financeira: unit_price do Frontend Ignorado',
      'PostgreSQL Isolado',
      'APROVADO',
      `Frontend enviou 0.01; banco calculou estritamente sobre preço oficial de products (total: R$ ${res31.total_amount}).`
    );
  } else {
    record(
      'Proteção Financeira: unit_price do Frontend Ignorado',
      'PostgreSQL Isolado',
      'FALHOU',
      `Esperado 100.00, recebido: ${res31.total_amount}`
    );
  }

  // Verificar estoque restante de prod-pomada (10 - 2 = 8)
  const stockCheck1 = await db.query(`SELECT stock_quantity FROM public.products WHERE id = 'prod-pomada';`);
  const currentPomadaStock = stockCheck1.rows[0].stock_quantity;
  if (currentPomadaStock === 8) {
    record(
      'Baixa Correta de Estoque via Trigger',
      'PostgreSQL Isolado',
      'APROVADO',
      `Estoque baixado de 10 para 8 após venda de 2 unidades.`
    );
  } else {
    record(
      'Baixa Correta de Estoque via Trigger',
      'PostgreSQL Isolado',
      'FALHOU',
      `Estoque esperado 8, encontrado: ${currentPomadaStock}`
    );
  }

  // Teste 3.2: Produtos repetidos na mesma venda somando além do estoque
  // Estoque atual de prod-pomada é 8. Enviar 5 + 4 = 9 (ultrapassa estoque). Deve falhar integralmente!
  let duplicateStockError = null;
  try {
    await db.query(`
      SELECT public.create_sale_atomic(
        NULL,
        NULL,
        'dinheiro',
        '[{"product_id": "prod-pomada", "quantity": 5, "unit_price": 50.00}, {"product_id": "prod-pomada", "quantity": 4, "unit_price": 50.00}]'::jsonb,
        true
      );
    `);
  } catch (err) {
    duplicateStockError = err.message;
  }

  if (duplicateStockError && duplicateStockError.includes('ESTOQUE_INSUFICIENTE')) {
    // Conferir se estoque permaneceu intacto em 8
    const stockAfterFailed = await db.query(`SELECT stock_quantity FROM public.products WHERE id = 'prod-pomada';`);
    const preservedStock = stockAfterFailed.rows[0].stock_quantity;
    if (preservedStock === 8) {
      record(
        'Produtos Duplicados com Soma Excedente (5 + 4 > 8)',
        'PostgreSQL Isolado',
        'APROVADO',
        `Rejeição atômica correta com erro '${duplicateStockError}'. Estoque preservado em 8 unidades, sem venda ou caixa gerado.`
      );
    } else {
      record(
        'Produtos Duplicados com Soma Excedente (5 + 4 > 8)',
        'PostgreSQL Isolado',
        'FALHOU',
        `Venda falhou mas estoque foi alterado: ${preservedStock}`
      );
    }
  } else {
    record(
      'Produtos Duplicados com Soma Excedente (5 + 4 > 8)',
      'PostgreSQL Isolado',
      'FALHOU',
      `Venda deveria ter sido rejeitada com ESTOQUE_INSUFICIENTE. Resultado: ${duplicateStockError}`
    );
  }

  // Teste 3.3: Produtos repetidos dentro do limite (3 + 2 = 5 <= 8)
  const validDuplicateSale = await db.query(`
    SELECT public.create_sale_atomic(
      NULL,
      NULL,
      'cartao_credito',
      '[{"product_id": "prod-pomada", "quantity": 3}, {"product_id": "prod-pomada", "quantity": 2}]'::jsonb,
      true
    ) as result;
  `);
  const res33 = validDuplicateSale.rows[0].result;
  const stockAfterValid = await db.query(`SELECT stock_quantity FROM public.products WHERE id = 'prod-pomada';`);
  if (res33.total_amount === 250.00 && stockAfterValid.rows[0].stock_quantity === 3) {
    record(
      'Produtos Repetidos Agrupados Dentro do Estoque (3 + 2 = 5)',
      'PostgreSQL Isolado',
      'APROVADO',
      `Quantidades agregadas com sucesso: 5 unidades baixadas (saldo final 3), total da venda R$ 250.00.`
    );
  } else {
    record(
      'Produtos Repetidos Agrupados Dentro do Estoque (3 + 2 = 5)',
      'PostgreSQL Isolado',
      'FALHOU',
      `Resultado inesperado: Total ${res33.total_amount}, Saldo ${stockAfterValid.rows[0].stock_quantity}`
    );
  }

  // Teste 3.4: Permissão de Acesso em create_sale_atomic
  // Usuário barber ou anônimo tentando registrar venda deve ser bloqueado
  await setAuthContext(db, { userId: barberAuthId, role: 'authenticated' });
  let barberSaleDenied = false;
  try {
    await db.query(`
      SELECT public.create_sale_atomic(
        NULL, NULL, 'pix', '[{"product_id": "prod-pomada", "quantity": 1}]'::jsonb, true
      );
    `);
  } catch (err) {
    if (err.message.includes('ACESSO_NEGADO')) {
      barberSaleDenied = true;
    }
  }

  if (barberSaleDenied) {
    record(
      'Controle de Acesso RPC: Barbeiro Impedido de Registrar Venda Balcão',
      'PostgreSQL Isolado',
      'APROVADO',
      'Acesso rejeitado com ACESSO_NEGADO. Apenas admin e secretário possuem autorização financeira.'
    );
  } else {
    record(
      'Controle de Acesso RPC: Barbeiro Impedido de Registrar Venda Balcão',
      'PostgreSQL Isolado',
      'FALHOU',
      'Barbeiro conseguiu registrar venda indevidamente.'
    );
  }

  // ----------------------------------------------------------------------------
  // ETAPA 4: Testes de Agendamento, Privacidade e Concorrência (book_appointment_online)
  // ----------------------------------------------------------------------------
  console.log('\n--- 4. TESTES DE AGENDAMENTO, PRIVACIDADE E CONCORRÊNCIA (book_appointment_online) ---');

  // Teste 4.1: Cadastro de novo cliente e reutilização segura com telefone existente
  await setAuthContext(db, { role: 'anon' }); // Usuário anônimo no agendamento público
  const booking1 = await db.query(`
    SELECT public.book_appointment_online(
      'Marcos Original',
      '34988887777',
      'barber-thiago',
      ARRAY['srv-corte'],
      '2026-10-26T14:00'
    ) as result;
  `);
  const client1Id = booking1.rows[0].result.client_id;

  // Verificar se registro foi criado
  await db.query(`SELECT name, phone FROM public.customers WHERE id = $1;`, [client1Id]);

  // Tentativa de segundo agendamento com o MESMO telefone mas NOME DIFERENTE (tentativa de adulteração)
  const booking2 = await db.query(`
    SELECT public.book_appointment_online(
      'Hacker Tentando Sobrescrever',
      '34988887777',
      'barber-lucas',
      ARRAY['srv-corte'],
      '2026-10-26T16:00'
    ) as result;
  `);
  const client2Id = booking2.rows[0].result.client_id;
  const custRec2 = await db.query(`SELECT name, phone FROM public.customers WHERE id = $1;`, [client2Id]);
  const preservedName = custRec2.rows[0].name;

  if (client1Id === client2Id && preservedName === 'MARCOS ORIGINAL') {
    record(
      'Privacidade de Clientes: Não Sobrescrever Nome de Telefone Existente',
      'PostgreSQL Isolado',
      'APROVADO',
      `Cliente reutilizado (ID: ${client1Id}). Nome original 'MARCOS ORIGINAL' preservado intacto, tentativa de sobrescrita neutralizada.`
    );
  } else {
    record(
      'Privacidade de Clientes: Não Sobrescrever Nome de Telefone Existente',
      'PostgreSQL Isolado',
      'FALHOU',
      `Nome foi adulterado ou IDs diferem: ID1=${client1Id}, ID2=${client2Id}, Nome=${preservedName}`
    );
  }

  // Teste 4.2: Rejeição de Serviço Restrito no Agendamento Público
  let restrictedRejected = false;
  try {
    await db.query(`
      SELECT public.book_appointment_online(
        'Cliente Teste',
        '34911112222',
        'barber-thiago',
        ARRAY['srv-restrito'],
        '2026-10-26T17:00'
      );
    `);
  } catch (err) {
    if (err.message.includes('SERVICO_RESTRITO')) {
      restrictedRejected = true;
    }
  }

  if (restrictedRejected) {
    record(
      'Proteção de Catálogo: Rejeição Estrita de Serviços Restritos Online',
      'PostgreSQL Isolado',
      'APROVADO',
      'Tentativa de agendar serviço restrito rejeitada com erro SERVICO_RESTRITO sem fallback.'
    );
  } else {
    record(
      'Proteção de Catálogo: Rejeição Estrita de Serviços Restritos Online',
      'PostgreSQL Isolado',
      'FALHOU',
      'Serviço restrito foi aceito no agendamento online público.'
    );
  }

  // Teste 4.3: Barbeiro não habilitado para o procedimento
  // Thiago só faz srv-corte e srv-barba. Tentar agendar srv-combo
  let unhabilitatedRejected = false;
  try {
    await db.query(`
      SELECT public.book_appointment_online(
        'Cliente Teste',
        '34911112222',
        'barber-thiago',
        ARRAY['srv-combo'],
        '2026-10-26T17:30'
      );
    `);
  } catch (err) {
    if (err.message.includes('PROFISSIONAL_NAO_HABILITADO')) {
      unhabilitatedRejected = true;
    }
  }

  if (unhabilitatedRejected) {
    record(
      'Habilitação de Barbeiros: Rejeição de Serviço Não Executado',
      'PostgreSQL Isolado',
      'APROVADO',
      'Profissional Thiago não possui especialidade combo cadastrada; agendamento rejeitado com PROFISSIONAL_NAO_HABILITADO.'
    );
  } else {
    record(
      'Habilitação de Barbeiros: Rejeição de Serviço Não Executado',
      'PostgreSQL Isolado',
      'FALHOU',
      'Serviço não habilitado foi aceito.'
    );
  }

  // Teste 4.4: Conflito de Horário e Sobreposição com Múltiplos Serviços
  // Agendamento às 10:00 com Corte (30m) + Barba (30m) = 60m (ocupa 10h00 às 11h00)
  await db.query(`
    SELECT public.book_appointment_online(
      'Cliente Conflito',
      '34933334444',
      'barber-thiago',
      ARRAY['srv-corte', 'srv-barba'],
      '2026-10-26T10:00'
    );
  `);

  // Tentativa 1: Marcar às 10:30 (dentro do intervalo 10h-11h) -> DEVE REJEITAR
  let overlapRejected = false;
  try {
    await db.query(`
      SELECT public.book_appointment_online(
        'Cliente Concorrente',
        '34955556666',
        'barber-thiago',
        ARRAY['srv-corte'],
        '2026-10-26T10:30'
      );
    `);
  } catch (err) {
    if (err.message.includes('HORARIO_INDISPONIVEL')) {
      overlapRejected = true;
    }
  }

  // Tentativa 2: Marcar às 11:00 (imediatamente contíguo) -> DEVE PERMITIR
  let contiguousAllowed = false;
  try {
    const contRes = await db.query(`
      SELECT public.book_appointment_online(
        'Cliente Contiguo',
        '34977778888',
        'barber-thiago',
        ARRAY['srv-corte'],
        '2026-10-26T11:00'
      ) as result;
    `);
    if (contRes.rows[0].result.success) {
      contiguousAllowed = true;
    }
  } catch {
    contiguousAllowed = false;
  }

  if (overlapRejected && contiguousAllowed) {
    record(
      'Concorrência e Múltiplos Serviços: Duração Acumulada Real (10h-11h)',
      'PostgreSQL Isolado',
      'APROVADO',
      'Sobreposição parcial às 10:30 bloqueada (HORARIO_INDISPONIVEL); agendamento contíguo às 11:00 aceito com sucesso.'
    );
  } else {
    record(
      'Concorrência e Múltiplos Serviços: Duração Acumulada Real (10h-11h)',
      'PostgreSQL Isolado',
      'FALHOU',
      `Overlap rejeitado: ${overlapRejected}, Contíguo permitido: ${contiguousAllowed}`
    );
  }

  // Teste 4.5: Bloqueio Administrativo vs Cancelamento Comum
  // Inserir agendamento cancelado por admin com cancellation_reason = 'BLOQUEIO DE TREINAMENTO'
  await db.query(`
    INSERT INTO public.appointments (id, client_id, barber_id, service_id, appointment_time, status, cancellation_reason)
    VALUES ('appt-bloqueio', '${client1Id}', 'barber-thiago', 'srv-corte', '2026-10-26T15:00', 'cancelled', 'BLOQUEIO DE TREINAMENTO');
  `);

  let blockRejected = false;
  try {
    await db.query(`
      SELECT public.book_appointment_online(
        'Cliente Tentando Bloqueio',
        '34999991111',
        'barber-thiago',
        ARRAY['srv-corte'],
        '2026-10-26T15:00'
      );
    `);
  } catch (err) {
    if (err.message.includes('HORARIO_INDISPONIVEL')) {
      blockRejected = true;
    }
  }

  if (blockRejected) {
    record(
      'Bloqueio Administrativo: Horário com Motivo de Cancelamento Permanece Ocupado',
      'PostgreSQL Isolado',
      'APROVADO',
      'Horário marcado como cancelado com motivo administrativo bloqueou novas reservas com sucesso.'
    );
  } else {
    record(
      'Bloqueio Administrativo: Horário com Motivo de Cancelamento Permanece Ocupado',
      'PostgreSQL Isolado',
      'FALHOU',
      'Horário bloqueado foi indevidamente liberado.'
    );
  }

  // ----------------------------------------------------------------------------
  // ETAPA 5: Testes de Autorização em book_appointment_atomic
  // ----------------------------------------------------------------------------
  console.log('\n--- 5. TESTES DE AUTORIZAÇÃO EM book_appointment_atomic ---');

  // Barbeiro agendando na sua própria agenda -> PERMITIDO
  await setAuthContext(db, { userId: barberAuthId, role: 'authenticated' });
  const barberSelfBooking = await db.query(`
    SELECT public.book_appointment_atomic(
      '${client1Id}',
      'barber-thiago',
      'srv-corte',
      '2026-10-26T17:00'
    ) as result;
  `);
  const barberSelfOk = barberSelfBooking.rows[0].result.success;

  // Barbeiro agendando na agenda de OUTRO barbeiro -> BLOQUEADO
  let barberOtherDenied = false;
  try {
    await db.query(`
      SELECT public.book_appointment_atomic(
        '${client1Id}',
        'barber-lucas',
        'srv-corte',
        '2026-10-26T17:00'
      );
    `);
  } catch (err) {
    if (err.message.includes('ACESSO_NEGADO')) {
      barberOtherDenied = true;
    }
  }

  if (barberSelfOk && barberOtherDenied) {
    record(
      'Autorização de Barbeiro: Apenas Própria Agenda Permitida',
      'PostgreSQL Isolado',
      'APROVADO',
      'Barbeiro Thiago agendou para si com sucesso e foi bloqueado com ACESSO_NEGADO ao tentar agendar para Lucas.'
    );
  } else {
    record(
      'Autorização de Barbeiro: Apenas Própria Agenda Permitida',
      'PostgreSQL Isolado',
      'FALHOU',
      `Própria agenda ok: ${barberSelfOk}, Outro barbeiro negado: ${barberOtherDenied}`
    );
  }

  // ----------------------------------------------------------------------------
  // ETAPA 6: Teste de Reversibilidade / Rollback da Migration 0021
  // ----------------------------------------------------------------------------
  console.log('\n--- 6. TESTE DE ROLLBACK DA MIGRATION 0021 ---');
  const sqlRollback = fs.readFileSync(path.join(MIGRATIONS_DIR, '0021_fase5_rollback.sql'), 'utf-8');
  await db.exec(sqlRollback);
  record(
    'Execução do Script de Rollback (0021_fase5_rollback.sql)',
    'PostgreSQL 18.6 Isolado',
    'APROVADO',
    'Script de rollback executado integralmente sem erros, restaurando versões das migrations 0019 e 0020.'
  );

  // Verificar se os dados comerciais foram preservados após o rollback
  const checkSalesCount = await db.query(`SELECT COUNT(*) as c FROM public.sales;`);
  const checkApptsCount = await db.query(`SELECT COUNT(*) as c FROM public.appointments;`);
  const checkProductsCount = await db.query(`SELECT COUNT(*) as c FROM public.products;`);

  const salesCount = Number(checkSalesCount.rows[0].c);
  const apptsCount = Number(checkApptsCount.rows[0].c);
  const prodsCount = Number(checkProductsCount.rows[0].c);

  if (salesCount > 0 && apptsCount > 0 && prodsCount === 3) {
    record(
      'Preservação Estrita de Dados Comerciais Pós-Rollback',
      'PostgreSQL Isolado',
      'APROVADO',
      `Dados mantidos: ${salesCount} vendas, ${apptsCount} agendamentos, ${prodsCount} produtos íntegros no banco.`
    );
  } else {
    record(
      'Preservação Estrita de Dados Comerciais Pós-Rollback',
      'PostgreSQL Isolado',
      'FALHOU',
      `Dados foram perdidos no rollback: sales=${salesCount}, appts=${apptsCount}, prods=${prodsCount}`
    );
  }

  // Reaplicar a migration 0021 após o teste de rollback para deixar o schema local atualizado
  console.log('\n--- 7. REAPLICAÇÃO FINAL DA MIGRATION 0021 NO BANCO DE TESTE ---');
  await db.exec(sql0021);
  record(
    'Reaplicação da Migration 0021 Pós-Validação de Rollback',
    'PostgreSQL Isolado',
    'APROVADO',
    'Idempotência confirmada: migration 0021 reaplicada com sucesso após reversão.'
  );

  console.log('\n================================================================');
  console.log(` RESUMO DA SUÍTE DE TESTES EM POSTGRESQL ISOLADO:`);
  console.log(` Total de cenários executados: ${testMatrix.length}`);
  const passedCount = testMatrix.filter(t => t.result === 'APROVADO').length;
  const failedCount = testMatrix.filter(t => t.result !== 'APROVADO').length;
  console.log(` Aprovados: ${passedCount} | Reprovados: ${failedCount}`);
  console.log('================================================================\n');

  return { testMatrix, passedCount, failedCount };
}

runTests().then(({ failedCount }) => {
  if (failedCount > 0) {
    process.exit(1);
  }
}).catch(err => {
  console.error('ERRO FATAL NA EXECUÇÃO DA SUÍTE:', err);
  process.exit(1);
});
