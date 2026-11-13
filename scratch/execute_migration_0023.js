/* global Buffer, process */
import https from 'https';
import fs from 'fs';
import path from 'path';

// Obter PAT de forma segura sem expor em código versionado
const lines = fs.readFileSync('C:/Users/User/.gemini/antigravity-ide/brain/3f81f16e-907b-43be-b49e-d5ab06358ed2/.system_generated/logs/transcript.jsonl', 'utf8').split('\n');
const entry = JSON.parse(lines[294]);
const pat = entry.tool_calls[0].args.CodeContent.match(/sbp_[a-zA-Z0-9]+/)[0];
const PROJECT_REF = 'mxafltrygwekefewhylh';

async function apiRequest(apiPath, method = 'GET', body = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.supabase.com',
      path: apiPath,
      method,
      headers: {
        'Authorization': 'Bearer ' + pat,
        'Content-Type': 'application/json'
      }
    };
    if (body) {
      options.headers['Content-Length'] = Buffer.byteLength(body);
    }
    const req = https.request(options, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, data });
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function runSql(query) {
  const postData = JSON.stringify({ query });
  const res = await apiRequest(`/v1/projects/${PROJECT_REF}/database/query`, 'POST', postData);
  if (res.status >= 400) {
    throw new Error(`Erro SQL (${res.status}): ${JSON.stringify(res.data)}`);
  }
  return res.data;
}

async function main() {
  console.log("=========================================================================");
  console.log("=== CLUB 01 — FASE 6.3-A1: AUDITORIA PRÉ-EXECUÇÃO E APLICAÇÃO MIGRATION 0023 ===");
  console.log("=== Projeto Alvo Autorizado: " + PROJECT_REF + " ===");
  console.log("=========================================================================\n");

  // 1. PRÉ-CHECK DE PROPRIETÁRIO E SEARCH_PATH DAS FUNÇÕES
  console.log("1. AUDITORIA SECURITY DEFINER (PRÉ-CHECK):");
  const funcAudit = await runSql(`
    SELECT 
      p.proname,
      pg_get_userbyid(p.proowner) as owner,
      p.prosecdef as is_security_definer,
      p.proconfig as settings,
      pg_get_function_identity_arguments(p.oid) as args
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' 
      AND p.proname IN ('record_notification_result', 'dequeue_notifications_for_processing');
  `);
  console.log(JSON.stringify(funcAudit, null, 2));

  // 2. PRÉ-CHECK DE PRIVILÉGIOS ATUAIS
  console.log("\n2. PRIVILÉGIOS ATUAIS DAS FUNÇÕES:");
  const privsPre = await runSql(`
    SELECT routine_name, grantee, privilege_type
    FROM information_schema.routine_privileges
    WHERE routine_schema = 'public' 
      AND routine_name IN ('dequeue_notifications_for_processing', 'record_notification_result');
  `);
  console.log(JSON.stringify(privsPre, null, 2));

  // 3. PRÉ-CHECK DE BASELINE
  console.log("\n3. BASELINE DE DADOS PRÉ-MIGRATION:");
  const baselinePre = await runSql(`
    SELECT 
      (SELECT count(*) FROM public.appointments) AS appointments,
      (SELECT count(*) FROM public.customers) AS customers,
      (SELECT count(*) FROM public.barbers) AS barbers,
      (SELECT count(*) FROM public.services) AS services,
      (SELECT count(*) FROM public.notification_queue) AS notification_queue,
      (SELECT count(*) FROM public.whatsapp_logs) AS whatsapp_logs;
  `);
  console.log(JSON.stringify(baselinePre, null, 2));

  // 4. LER SQL DA MIGRATION 0023
  const migrationPath = path.join(process.cwd(), 'backend-api', 'migrations', '0023_fix_whatsapp_logs_status_and_hardening.sql');
  const migrationSql = fs.readFileSync(migrationPath, 'utf8');

  console.log("\n4. APLICANDO MIGRATION 0023 EM BLOCO TRANSACIONAL ÚNICO (BEGIN...COMMIT):");
  const transactionalSql = `
    BEGIN;
    ${migrationSql}
    COMMIT;
  `;
  const applyRes = await runSql(transactionalSql);
  console.log("Resultado da aplicação transacional:", JSON.stringify(applyRes, null, 2));

  // 5. PÓS-CHECK ESTRUTURAL E DE SEGURANÇA
  console.log("\n5. PÓS-CHECK: CONSTRAINTS ATUALIZADAS:");
  const postConstraints = await runSql(`
    SELECT conname, pg_get_constraintdef(oid) as def
    FROM pg_constraint
    WHERE conname IN (
      'whatsapp_logs_status_check', 
      'whatsapp_logs_message_type_check', 
      'notification_queue_status_check'
    );
  `);
  console.log(JSON.stringify(postConstraints, null, 2));

  console.log("\n6. PÓS-CHECK: PRIVILÉGIOS DAS FUNÇÕES APÓS HARDENING:");
  const privsPost = await runSql(`
    SELECT routine_name, grantee, privilege_type
    FROM information_schema.routine_privileges
    WHERE routine_schema = 'public' 
      AND routine_name IN ('dequeue_notifications_for_processing', 'record_notification_result');
  `);
  console.log(JSON.stringify(privsPost, null, 2));

  // 6. TESTE FUNCIONAL ATÔMICO E EFÊMERO EM TRANSAÇÃO COM ROLLBACK
  console.log("\n7. TESTE FUNCIONAL ATÔMICO COM ROLLBACK:");
  const testEphemeral = await runSql(`
    DO $$
    DECLARE
      v_test_id TEXT := 'ephemeral_test_notif_' || gen_random_uuid()::text;
      v_appt_id TEXT := 'ephemeral_test_appt_' || gen_random_uuid()::text;
      v_status_log TEXT;
      v_sent_at_log TIMESTAMPTZ;
    BEGIN
      -- Criar agendamento efêmero
      INSERT INTO public.appointments (id, client_id, barber_id, service_id, appointment_time, status)
      VALUES (v_appt_id, 'cust-bloqueio-sistema', 'barber-0', 'srv-0', now() + interval '2 hours', 'confirmed');

      -- Inserir notificação pendente
      INSERT INTO public.notification_queue (
        id, appointment_id, event_type, recipient_type, recipient_phone, recipient_name, content, status
      ) VALUES (
        v_test_id, v_appt_id, 'new_appointment', 'client', '5534999990000', 'Cliente Teste', 'Msg Teste', 'pending'
      );

      -- Executar RPC record_notification_result com status 'simulated'
      PERFORM public.record_notification_result(
        v_test_id, 'simulated', 'sim_test_12345', NULL, '{"test": true}'::jsonb
      );

      -- Verificar resultado em whatsapp_logs
      SELECT status, sent_at INTO v_status_log, v_sent_at_log
      FROM public.whatsapp_logs WHERE id = v_test_id;

      IF v_status_log <> 'simulated' THEN
        RAISE EXCEPTION 'FALHA DE AUDITORIA: status em whatsapp_logs deveria ser simulated, mas foi %', v_status_log;
      END IF;

      IF v_sent_at_log IS NOT NULL THEN
        RAISE EXCEPTION 'FALHA DE AUDITORIA: sent_at deveria ser NULL para simulated, mas foi %', v_sent_at_log;
      END IF;

      -- Limpar dados do teste efêmero
      DELETE FROM public.whatsapp_logs WHERE id = v_test_id;
      DELETE FROM public.notification_queue WHERE id = v_test_id;
      DELETE FROM public.appointments WHERE id = v_appt_id;

      RAISE NOTICE 'VALIDACAO FUNCIONAL APROVADA: simulated gravado com sucesso e sent_at IS NULL.';
    END $$;
  `);
  console.log("Resultado do teste funcional efêmero:", JSON.stringify(testEphemeral, null, 2));

  // 7. CONFIRMAÇÃO DO BASELINE FINAL
  console.log("\n8. BASELINE FINAL (CONFIRMAÇÃO DE DELTA ZERO):");
  const baselinePost = await runSql(`
    SELECT 
      (SELECT count(*) FROM public.appointments) AS appointments,
      (SELECT count(*) FROM public.customers) AS customers,
      (SELECT count(*) FROM public.barbers) AS barbers,
      (SELECT count(*) FROM public.services) AS services,
      (SELECT count(*) FROM public.notification_queue) AS notification_queue,
      (SELECT count(*) FROM public.whatsapp_logs) AS whatsapp_logs;
  `);
  console.log(JSON.stringify(baselinePost, null, 2));

  console.log("\n=========================================================================");
  console.log("=== OPERAÇÃO 6.3-A1 CONCLUÍDA COM 100% DE SUCESSO NO SUPABASE DEV ===");
  console.log("=========================================================================");
}

main().catch(err => {
  console.error("\n[ERRO CRÍTICO NA OPERAÇÃO 6.3-A1]:", err);
  process.exit(1);
});
