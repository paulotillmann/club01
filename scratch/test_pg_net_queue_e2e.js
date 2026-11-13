/* global Buffer, process */
import https from 'https';
import fs from 'fs';

const PROJECT_REF = 'mxafltrygwekefewhylh';
const LOGS_FILE = 'C:/Users/User/.gemini/antigravity-ide/brain/3f81f16e-907b-43be-b49e-d5ab06358ed2/.system_generated/logs/transcript.jsonl';
const cronSecret = fs.readFileSync('c:/club01/scratch/.cron_secret_tmp', 'utf8').trim();

function getAccessToken() {
  const content = fs.readFileSync(LOGS_FILE, 'utf8');
  const lines = content.split('\n');
  const match = lines[294].match(/sbp_[a-zA-Z0-9]+/);
  return match ? match[0] : null;
}

function runSql(query) {
  const token = getAccessToken();
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({ query });
    const req = https.request({
      hostname: 'api.supabase.com',
      port: 443,
      path: `/v1/projects/${PROJECT_REF}/database/query`,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          resolve(data);
        }
      });
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

const sleep = (ms) => new Promise(res => setTimeout(res, ms));

async function main() {
  console.log("=== TESTE CONTROLADO DO AGENDADOR VIA PG_NET NO SUPABASE DEV ===");
  const testId = 'TEST_F63F_' + Date.now();

  // 1. Inserir dados fictícios
  await runSql(`
    INSERT INTO public.barbers (id, name, phone) 
    VALUES ('${testId}_b', 'Barbeiro Teste', '34988880000') ON CONFLICT DO NOTHING;

    INSERT INTO public.customers (id, name, phone) 
    VALUES ('${testId}_c', 'Cliente Teste', '34999990000') ON CONFLICT DO NOTHING;

    INSERT INTO public.services (id, name, duration_minutes, price, restricted_access) 
    VALUES ('${testId}_s', 'Corte Teste', 30, 50.00, false) ON CONFLICT DO NOTHING;

    INSERT INTO public.appointments (id, barber_id, client_id, service_id, appointment_time, status)
    VALUES ('${testId}_a', '${testId}_b', '${testId}_c', '${testId}_s', now() + interval '2 hours', 'confirmed') ON CONFLICT DO NOTHING;

    DELETE FROM public.notification_queue WHERE appointment_id = '${testId}_a';

    -- Inserir 2 itens pendentes com agendamento no passado (elegíveis imediatamente)
    INSERT INTO public.notification_queue (id, appointment_id, event_type, recipient_type, recipient_phone, recipient_name, content, scheduled_for, status)
    VALUES 
      ('${testId}_n1', '${testId}_a', 'new_appointment', 'client', '34999990000', 'Cliente Teste 1', 'Mensagem 1', now() - interval '2 minutes', 'pending'),
      ('${testId}_n2', '${testId}_a', 'new_appointment', 'client', '34999990000', 'Cliente Teste 2', 'Mensagem 2', now() - interval '2 minutes', 'pending');
  `);
  console.log("Dados fictícios inseridos.");

  // 2. Chamar net.http_post como o pg_cron faz
  console.log("Acionando pg_net...");
  const triggerRes = await runSql(`
    SELECT net.http_post(
      url := 'https://${PROJECT_REF}.supabase.co/functions/v1/process-notifications',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', '${cronSecret}'
      ),
      body := jsonb_build_object('batch_size', 5),
      timeout_milliseconds := 5000
    ) as req_id;
  `);
  console.log("pg_net disparado, req_id:", triggerRes);

  // Aguardar 4 segundos para a Edge Function processar e net registrar a resposta
  console.log("Aguardando 4 segundos para resposta...");
  await sleep(4000);

  // 3. Checar resposta do pg_net
  const netResp = await runSql(`
    SELECT id, status_code, content, timed_out, error_msg, created 
    FROM net._http_response 
    ORDER BY id DESC LIMIT 1;
  `);
  console.log("Resposta HTTP no pg_net:", JSON.stringify(netResp, null, 2));

  // 4. Checar notification_queue
  const queueRes = await runSql(`
    SELECT id, status, attempts, external_id, last_error, processed_at 
    FROM public.notification_queue 
    WHERE appointment_id = '${testId}_a';
  `);
  console.log("Estado em notification_queue:", JSON.stringify(queueRes, null, 2));

  // 5. Checar whatsapp_logs
  const logsRes = await runSql(`
    SELECT id, message_type, phone, status, sent_at 
    FROM public.whatsapp_logs 
    WHERE id LIKE '${testId}%';
  `);
  console.log("Estado em whatsapp_logs:", JSON.stringify(logsRes, null, 2));

  // 6. Limpeza completa
  await runSql(`
    DELETE FROM public.whatsapp_logs WHERE id LIKE '${testId}%';
    DELETE FROM public.notification_queue WHERE appointment_id = '${testId}_a';
    DELETE FROM public.appointments WHERE id = '${testId}_a';
    DELETE FROM public.customers WHERE id = '${testId}_c';
    DELETE FROM public.barbers WHERE id = '${testId}_b';
    DELETE FROM public.services WHERE id = '${testId}_s';
  `);
  console.log("Limpeza de registros fictícios concluída.");
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
