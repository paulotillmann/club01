/* global process */
import { PGlite } from '@electric-sql/pglite';
import fs from 'fs';
import path from 'path';

const BASE_DIR = 'C:\\club01';
const MIGRATIONS_DIR = path.join(BASE_DIR, 'backend-api', 'migrations');

async function runConcurrencySuite() {
  console.log('================================================================');
  console.log(' TESTES REAIS DE CONCORRÊNCIA E TRANSAÇÕES PARALELAS NO POSTGRESQL');
  console.log('================================================================\n');

  const db = new PGlite();

  // 1. Setup do schema completo com migration 0021
  await db.exec(`
    CREATE SCHEMA IF NOT EXISTS auth;
    DO $$ BEGIN
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
    END $$;
    CREATE TABLE IF NOT EXISTS auth.users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email TEXT,
      phone TEXT,
      raw_user_meta_data JSONB,
      created_at TIMESTAMPTZ DEFAULT now()
    );
    CREATE OR REPLACE FUNCTION auth.uid() RETURNS UUID AS $$ SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid; $$ LANGUAGE sql STABLE;
    CREATE OR REPLACE FUNCTION auth.role() RETURNS TEXT AS $$ SELECT COALESCE(NULLIF(current_setting('request.jwt.claim.role', true), ''), 'anon'); $$ LANGUAGE sql STABLE;
  `);

  let initSql = fs.readFileSync(path.join(MIGRATIONS_DIR, 'supabase_club01_init.sql'), 'utf-8');
  initSql = initSql.replace(/CREATE EXTENSION IF NOT EXISTS/gi, '-- CREATE EXTENSION IF NOT EXISTS');
  await db.exec(initSql);

  const sql0021 = fs.readFileSync(path.join(MIGRATIONS_DIR, '0021_fase5_security_and_concurrency_corrections.sql'), 'utf-8');
  await db.exec(sql0021);

  // Inserir massa para concorrência
  const adminId = '11111111-1111-4111-a111-111111111111';
  await db.exec(`
    INSERT INTO auth.users (id, email) VALUES ('${adminId}', 'admin@club01.com.br');
    UPDATE public.users SET role = 'admin' WHERE auth_user_id = '${adminId}';

    INSERT INTO public.barbers (id, name, phone) VALUES
      ('b-carlos', 'Carlos Concorrente', '34999990001'),
      ('b-andre', 'André Paralelo', '34999990002');

    INSERT INTO public.services (id, name, duration_minutes, price, restricted_access) VALUES
      ('s-corte', 'Corte Concorrencia', 30, 50.00, false),
      ('s-barba', 'Barba Concorrencia', 30, 40.00, false);

    INSERT INTO public.barber_services (barber_id, service_id) VALUES
      ('b-carlos', 's-corte'),
      ('b-carlos', 's-barba'),
      ('b-andre', 's-corte');

    INSERT INTO public.products (id, name, sale_price, stock_quantity) VALUES
      ('prod-corrida', 'Pomada Concorrente', 60.00, 5); -- Estoque 5
  `);

  const results = [];

  // ----------------------------------------------------------------------------
  // CENÁRIO C1: Duas vendas simultâneas competindo por estoque limitado (5 unidades)
  // Venda 1 pede 3 unidades. Venda 2 pede 3 unidades. Total 6 > 5.
  // ----------------------------------------------------------------------------
  console.log('--- CENÁRIO C1: Vendas Simultâneas Disputando Saldo (3 + 3 vs 5 disponíveis) ---');
  await db.exec(`SELECT set_config('request.jwt.claim.sub', '${adminId}', false); SELECT set_config('request.jwt.claim.role', 'authenticated', false);`);

  const v1Promise = db.query(`
    SELECT public.create_sale_atomic(NULL, NULL, 'pix', '[{"product_id": "prod-corrida", "quantity": 3}]'::jsonb, true) as res;
  `).then(r => ({ success: true, res: r.rows[0].res })).catch(e => ({ success: false, err: e.message }));

  const v2Promise = db.query(`
    SELECT public.create_sale_atomic(NULL, NULL, 'dinheiro', '[{"product_id": "prod-corrida", "quantity": 3}]'::jsonb, true) as res;
  `).then(r => ({ success: true, res: r.rows[0].res })).catch(e => ({ success: false, err: e.message }));

  const [sale1, sale2] = await Promise.all([v1Promise, v2Promise]);

  const stockCheck = await db.query(`SELECT stock_quantity FROM public.products WHERE id = 'prod-corrida';`);
  const finalStock = stockCheck.rows[0].stock_quantity;

  const successCount = (sale1.success ? 1 : 0) + (sale2.success ? 1 : 0);
  const failureCount = (!sale1.success ? 1 : 0) + (!sale2.success ? 1 : 0);

  if (successCount === 1 && failureCount === 1 && finalStock === 2) {
    console.log(`✅ [PASS] Concorrência de Estoque: Exatamente 1 venda confirmou, 1 falhou por estoque insuficiente. Saldo final exato: 2.`);
    results.push({ test: 'Concorrência de Estoque (Race Condition 3+3 vs 5)', result: 'APROVADO' });
  } else {
    console.error(`❌ [FAIL] Falha na corrida de estoque: Success=${successCount}, Fail=${failureCount}, Stock=${finalStock}`);
    results.push({ test: 'Concorrência de Estoque (Race Condition 3+3 vs 5)', result: 'FALHOU' });
  }

  // ----------------------------------------------------------------------------
  // CENÁRIO C2: Dois agendamentos simultâneos no mesmo horário para o mesmo barbeiro
  // Ambos disputam 2026-10-27T10:00 com b-carlos
  // ----------------------------------------------------------------------------
  console.log('\n--- CENÁRIO C2: Agendamentos Simultâneos no Mesmo Slot e Mesmo Barbeiro ---');
  await db.exec(`SELECT set_config('request.jwt.claim.sub', '', false); SELECT set_config('request.jwt.claim.role', 'anon', false);`);

  const appt1Promise = db.query(`
    SELECT public.book_appointment_online('Cliente Alfa', '34991112233', 'b-carlos', ARRAY['s-corte'], '2026-10-27T10:00') as res;
  `).then(r => ({ success: true, res: r.rows[0].res })).catch(e => ({ success: false, err: e.message }));

  const appt2Promise = db.query(`
    SELECT public.book_appointment_online('Cliente Beta', '34994445566', 'b-carlos', ARRAY['s-corte'], '2026-10-27T10:00') as res;
  `).then(r => ({ success: true, res: r.rows[0].res })).catch(e => ({ success: false, err: e.message }));

  const [apptRes1, apptRes2] = await Promise.all([appt1Promise, appt2Promise]);

  const apptSuccess = (apptRes1.success ? 1 : 0) + (apptRes2.success ? 1 : 0);
  const apptFail = (!apptRes1.success ? 1 : 0) + (!apptRes2.success ? 1 : 0);

  // Verificar contagem no banco
  const apptDbCount = await db.query(`
    SELECT COUNT(*) as c FROM public.appointments WHERE barber_id = 'b-carlos' AND appointment_time = '2026-10-27T10:00';
  `);

  if (apptSuccess === 1 && apptFail === 1 && Number(apptDbCount.rows[0].c) === 1) {
    console.log(`✅ [PASS] Concorrência de Agendamento: Exatamente 1 reserva confirmada, a outra rejeitada por HORARIO_INDISPONIVEL. Sem sobreposição no banco.`);
    results.push({ test: 'Concorrência de Agendamento (Same Slot Race)', result: 'APROVADO' });
  } else {
    console.error(`❌ [FAIL] Falha no lock de agendamento: Success=${apptSuccess}, Fail=${apptFail}, Count=${apptDbCount.rows[0].c}`);
    results.push({ test: 'Concorrência de Agendamento (Same Slot Race)', result: 'FALHOU' });
  }

  // ----------------------------------------------------------------------------
  // CENÁRIO C3: Agendamentos simultâneos para profissionais distintos
  // ----------------------------------------------------------------------------
  console.log('\n--- CENÁRIO C3: Agendamentos Simultâneos para Barbeiros Diferentes ---');
  const apptCarlos = db.query(`
    SELECT public.book_appointment_online('Cliente Gama', '34997778899', 'b-carlos', ARRAY['s-corte'], '2026-10-27T14:00') as res;
  `).then(r => ({ success: true, res: r.rows[0].res })).catch(e => ({ success: false, err: e.message }));

  const apptAndre = db.query(`
    SELECT public.book_appointment_online('Cliente Delta', '34998889900', 'b-andre', ARRAY['s-corte'], '2026-10-27T14:00') as res;
  `).then(r => ({ success: true, res: r.rows[0].res })).catch(e => ({ success: false, err: e.message }));

  const [resCarlos, resAndre] = await Promise.all([apptCarlos, apptAndre]);

  if (resCarlos.success && resAndre.success) {
    console.log(`✅ [PASS] Barbeiros distintos agendados simultaneamente às 14:00 sem bloqueio mútuo.`);
    results.push({ test: 'Agendamentos Simultâneos em Barbeiros Distintos', result: 'APROVADO' });
  } else {
    console.error(`❌ [FAIL] Barbeiros distintos conflitaram: Carlos=${resCarlos.success}, Andre=${resAndre.success}`);
    results.push({ test: 'Agendamentos Simultâneos em Barbeiros Distintos', result: 'FALHOU' });
  }

  // ----------------------------------------------------------------------------
  // CENÁRIO C4: Trigger de UPDATE com troca de produto e estorno
  // ----------------------------------------------------------------------------
  console.log('\n--- CENÁRIO C4: Trigger em UPDATE de Item de Venda (Troca de Produto) ---');
  // Cadastrar produto B com estoque 10
  await db.exec(`
    INSERT INTO public.products (id, name, sale_price, stock_quantity) VALUES
      ('prod-troca-a', 'Produto A', 30.00, 10),
      ('prod-troca-b', 'Produto B', 40.00, 10);
  `);

  // Inserir venda com 3 unidades do produto A (estoque de A vai de 10 para 7)
  await db.exec(`
    INSERT INTO public.sales (id, payment_method, total_amount) VALUES ('sale-troca-1', 'PIX', 90.00);
    INSERT INTO public.sale_items (id, sale_id, product_id, quantity, unit_price, total_price)
    VALUES ('item-troca-1', 'sale-troca-1', 'prod-troca-a', 3, 30.00, 90.00);
  `);

  const stockA1 = (await db.query(`SELECT stock_quantity FROM public.products WHERE id = 'prod-troca-a';`)).rows[0].stock_quantity;
  console.log(`Estoque Produto A após inserção: ${stockA1} (esperado 7)`);

  // Atualizar item trocando de Produto A para Produto B (4 unidades de B)
  // Esperado: Produto A volta de 7 para 10 (+3). Produto B vai de 10 para 6 (-4).
  await db.exec(`
    UPDATE public.sale_items
    SET product_id = 'prod-troca-b', quantity = 4, unit_price = 40.00, total_price = 160.00
    WHERE id = 'item-troca-1';
  `);

  const stockA2 = (await db.query(`SELECT stock_quantity FROM public.products WHERE id = 'prod-troca-a';`)).rows[0].stock_quantity;
  const stockB2 = (await db.query(`SELECT stock_quantity FROM public.products WHERE id = 'prod-troca-b';`)).rows[0].stock_quantity;

  if (stockA2 === 10 && stockB2 === 6) {
    console.log(`✅ [PASS] Troca de Produto no Item: Estoque de A estornado para 10, estoque de B debitado para 6.`);
    results.push({ test: 'Trigger de Estoque em UPDATE (Troca de Produto)', result: 'APROVADO' });
  } else {
    console.error(`❌ [FAIL] Estoque incorreto na troca: A=${stockA2} (esp 10), B=${stockB2} (esp 6)`);
    results.push({ test: 'Trigger de Estoque em UPDATE (Troca de Produto)', result: 'FALHOU' });
  }

  // ----------------------------------------------------------------------------
  // CENÁRIO C5: Trigger de DELETE de item de venda (Estorno total)
  // ----------------------------------------------------------------------------
  console.log('\n--- CENÁRIO C5: Trigger em DELETE de Item de Venda (Estorno Total) ---');
  // Deletar item-troca-1 (que atualmente tem 4 unidades de B)
  // Esperado: Produto B volta de 6 para 10 (+4)
  await db.exec(`DELETE FROM public.sale_items WHERE id = 'item-troca-1';`);
  const stockB3 = (await db.query(`SELECT stock_quantity FROM public.products WHERE id = 'prod-troca-b';`)).rows[0].stock_quantity;

  if (stockB3 === 10) {
    console.log(`✅ [PASS] Exclusão de Item de Venda: Estoque de B estornado integralmente de 6 para 10.`);
    results.push({ test: 'Trigger de Estoque em DELETE (Estorno Total)', result: 'APROVADO' });
  } else {
    console.error(`❌ [FAIL] Falha no estorno via DELETE: B=${stockB3} (esp 10)`);
    results.push({ test: 'Trigger de Estoque em DELETE (Estorno Total)', result: 'FALHOU' });
  }

  console.log('\n================================================================');
  console.log(` RESUMO DOS TESTES DE CONCORRÊNCIA E TRANSAÇÕES PARALELAS:`);
  console.log(` Total executados: ${results.length}`);
  const pass = results.filter(r => r.result === 'APROVADO').length;
  const fail = results.filter(r => r.result !== 'APROVADO').length;
  console.log(` Aprovados: ${pass} | Reprovados: ${fail}`);
  console.log('================================================================\n');

  if (fail > 0) process.exit(1);
}

runConcurrencySuite().catch(err => {
  console.error('ERRO FATAL EM CONCORRÊNCIA:', err);
  process.exit(1);
});
