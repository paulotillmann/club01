/**
 * ==============================================================================
 * PROJETO: CLUB 01 BARBER STUDIO
 * FASE 6.4.2 — ETAPA 1: TESTE DE CONCORRÊNCIA COM DUAS CONEXÕES POSTGRESQL INDEPENDENTES
 * ==============================================================================
 * Este script implementa o teste de concorrência real utilizando duas conexões
 * físicas (pg.Client) com sessões e backend_pids distintos, executando
 * transações explicitamente sobrepostas para comprovar a eficácia dos
 * advisory locks determinísticos da RPC public.reschedule_appointment_online.
 *
 * STATUS: PREPARADO / NÃO EXECUTADO EM BANCO REMOTO
 * (Em estrita conformidade com as Seções 2 e 12: sem autorização para escrita no Supabase DEV)
 * ==============================================================================
 */

import pg from 'pg';
const { Client } = pg;

/* global process */
async function runRealConcurrencyTest() {
  console.log('================================================================');
  console.log(' TESTE DE CONCORRÊNCIA: DUAS CONEXÕES POSTGRESQL INDEPENDENTES');
  console.log(' RPC: public.reschedule_appointment_online');
  console.log('================================================================\n');

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.log('[INFO] DATABASE_URL não configurada ou ambiente remoto não autorizado nesta etapa.');
    console.log('[STATUS] CLASSIFICAÇÃO: NÃO EXECUTADO (Aguardando homologação remota autorizada).');
    return {
      status: 'NAO_EXECUTADO',
      reason: 'Sem autorização para escrita remota ou sem banco local físico configurado.'
    };
  }

  const client1 = new Client({ connectionString });
  const client2 = new Client({ connectionString });

  try {
    await client1.connect();
    await client2.connect();

    // 1. Confirmar PIDs distintos das sessões físicas
    const pid1Res = await client1.query('SELECT pg_backend_pid() as pid;');
    const pid2Res = await client2.query('SELECT pg_backend_pid() as pid;');
    const pid1 = pid1Res.rows[0].pid;
    const pid2 = pid2Res.rows[0].pid;

    console.log(`[OK] Sessão 1 conectada no backend PID: ${pid1}`);
    console.log(`[OK] Sessão 2 conectada no backend PID: ${pid2}`);

    if (pid1 === pid2) {
      throw new Error('Falha: As conexões compartilham o mesmo backend PID.');
    }

    const targetSlot = '2026-12-15T15:00:00';
    const barberId = 'barber-diego';

    console.log(`[TESTE] Disparando 2 transações concorrentes sobrepostas para o mesmo slot (${targetSlot})...`);

    // Iniciar transações independentes
    await client1.query('BEGIN;');
    await client2.query('BEGIN;');

    const t1 = client1.query(`
      SELECT public.reschedule_appointment_online('appt-real-1', '${targetSlot}', '${barberId}') as res;
    `);

    const t2 = client2.query(`
      SELECT public.reschedule_appointment_online('appt-real-2', '${targetSlot}', '${barberId}') as res;
    `);

    const results = await Promise.allSettled([t1, t2]);

    const fulfilled = results.filter(r => r.status === 'fulfilled');
    const rejected = results.filter(r => r.status === 'rejected');

    console.log(`[RESULTADO] Sucessos: ${fulfilled.length} | Rejeições: ${rejected.length}`);

    if (fulfilled.length === 1 && rejected.length === 1) {
      console.log('[SUCESSO] Concorrência bloqueada com sucesso pelo advisory lock!');
      console.log(`[MOTIVO REJEIÇÃO] ${rejected[0].reason?.message}`);
    } else {
      console.error('[FALHA] Comportamento inesperado: ambos passaram ou ambos falharam.');
    }

    // Rollback para garantir que o banco permaneça imutável
    await client1.query('ROLLBACK;');
    await client2.query('ROLLBACK;');

    return {
      status: 'EXECUTADO_COM_SUCESSO',
      pid1,
      pid2,
      fulfilled: fulfilled.length,
      rejected: rejected.length
    };
  } catch (err) {
    console.error('[ERRO]', err.message);
    await client1.query('ROLLBACK;').catch(() => {});
    await client2.query('ROLLBACK;').catch(() => {});
    return { status: 'ERRO', message: err.message };
  } finally {
    await client1.end().catch(() => {});
    await client2.end().catch(() => {});
  }
}

if (process.argv[1]?.endsWith('postgres_reschedule_concurrency_real.js')) {
  runRealConcurrencyTest();
}

export { runRealConcurrencyTest };
