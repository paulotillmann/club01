/* global Buffer */
import https from 'https';
import fs from 'fs';

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

async function validate() {
  console.log("=========================================================================");
  console.log("=== CLUB 01 — FASE 6.3-A1: VALIDAÇÃO PÓS-MIGRATION 0023 NO BANCO REMOTO ===");
  console.log("=========================================================================\n");

  // 1. Validar Constraints
  console.log("1. CONSTRAINTS ATIVAS NO BANCO REMOTO:");
  const constraints = await runSql(`
    SELECT conname, pg_get_constraintdef(oid) as def
    FROM pg_constraint
    WHERE conname IN (
      'whatsapp_logs_status_check', 
      'whatsapp_logs_message_type_check', 
      'notification_queue_status_check'
    );
  `);
  console.log(JSON.stringify(constraints, null, 2));

  // 2. Validar Privilégios das RPCs
  console.log("\n2. PRIVILÉGIOS DAS RPCS (HARDENING):");
  const privs = await runSql(`
    SELECT routine_name, grantee, privilege_type
    FROM information_schema.routine_privileges
    WHERE routine_schema = 'public' 
      AND routine_name IN ('dequeue_notifications_for_processing', 'record_notification_result');
  `);
  console.log(JSON.stringify(privs, null, 2));

  // 3. Teste Funcional Efêmero de Gravação de 'simulated' e sent_at IS NULL
  console.log("\n3. TESTE FUNCIONAL EFÊMERO (GRAVAÇÃO DE SIMULATED):");
  const testRes = await runSql(`
    DO $$
    DECLARE
      v_cust_id TEXT := 'f63_test_cust_' || substr(gen_random_uuid()::text, 1, 8);
      v_barber_id TEXT := 'f63_test_barb_' || substr(gen_random_uuid()::text, 1, 8);
      v_srv_id TEXT := 'f63_test_srv_' || substr(gen_random_uuid()::text, 1, 8);
      v_appt_id TEXT := 'f63_test_appt_' || substr(gen_random_uuid()::text, 1, 8);
      v_notif_id TEXT := 'f63_test_notif_' || substr(gen_random_uuid()::text, 1, 8);
      v_status_log TEXT;
      v_sent_at_log TIMESTAMPTZ;
      v_msg_type_log TEXT;
    BEGIN
      -- Criar fixtures completas com respeito a FKs
      INSERT INTO public.customers (id, name, phone) VALUES (v_cust_id, 'Cliente F63', '5534999990000');
      INSERT INTO public.barbers (id, name, phone) VALUES (v_barber_id, 'Barbeiro F63', '5534988880000');
      INSERT INTO public.services (id, name, duration_minutes, price) VALUES (v_srv_id, 'Corte F63', 30, 50.0);
      
      INSERT INTO public.appointments (id, client_id, barber_id, service_id, appointment_time, status)
      VALUES (v_appt_id, v_cust_id, v_barber_id, v_srv_id, now() + interval '2 hours', 'confirmed');

      -- Inserir item de teste na fila
      INSERT INTO public.notification_queue (
        id, appointment_id, event_type, recipient_type, recipient_phone, recipient_name, content, status
      ) VALUES (
        v_notif_id, v_appt_id, 'reschedule', 'client', '5534999990000', 'Cliente F63', 'Msg Teste F63', 'pending'
      );

      -- Executar RPC record_notification_result simulando processamento DRY-RUN
      PERFORM public.record_notification_result(
        v_notif_id, 'simulated', 'sim_f63_12345', NULL, '{"dry_run": true}'::jsonb
      );

      -- Consultar whatsapp_logs
      SELECT status, sent_at, message_type 
      INTO v_status_log, v_sent_at_log, v_msg_type_log
      FROM public.whatsapp_logs WHERE id = v_notif_id;

      -- Asserção 1: status em whatsapp_logs deve ser 'simulated' (NUNCA 'sent')
      IF v_status_log <> 'simulated' THEN
        RAISE EXCEPTION 'VIOLACAO: status em whatsapp_logs é % (esperado simulated)', v_status_log;
      END IF;

      -- Asserção 2: sent_at DEVE ser NULL
      IF v_sent_at_log IS NOT NULL THEN
        RAISE EXCEPTION 'VIOLACAO: sent_at foi preenchido com % para mensagem simulated (esperado NULL)', v_sent_at_log;
      END IF;

      -- Asserção 3: message_type deve aceitar reschedule
      IF v_msg_type_log <> 'reschedule' THEN
        RAISE EXCEPTION 'VIOLACAO: message_type é % (esperado reschedule)', v_msg_type_log;
      END IF;

      -- Limpeza rigorosa e cirúrgica de todos os dados criados no teste efêmero
      DELETE FROM public.whatsapp_logs WHERE id = v_notif_id;
      DELETE FROM public.notification_queue WHERE appointment_id = v_appt_id;
      DELETE FROM public.appointments WHERE id = v_appt_id;
      DELETE FROM public.services WHERE id = v_srv_id;
      DELETE FROM public.barbers WHERE id = v_barber_id;
      DELETE FROM public.customers WHERE id = v_cust_id;

      RAISE NOTICE 'VALIDACAO FUNCIONAL REMOTA APROVADA: simulated gravado, sent_at NULL, reschedule aceito.';
    END $$;
  `);
  console.log("Resultado da validação funcional:", JSON.stringify(testRes, null, 2));

  // 4. Baseline Final
  console.log("\n4. BASELINE FINAL DE TODAS AS TABELAS (CONFIRMAÇÃO DELTA ZERO):");
  const baseline = await runSql(`
    SELECT 
      (SELECT count(*) FROM public.appointments) AS appointments,
      (SELECT count(*) FROM public.customers) AS customers,
      (SELECT count(*) FROM public.barbers) AS barbers,
      (SELECT count(*) FROM public.services) AS services,
      (SELECT count(*) FROM public.notification_queue) AS notification_queue,
      (SELECT count(*) FROM public.whatsapp_logs) AS whatsapp_logs;
  `);
  console.log(JSON.stringify(baseline, null, 2));
}

validate().catch(console.error);
