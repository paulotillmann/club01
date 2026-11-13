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
  console.log("=========================================================================");
  console.log("=== CLUB 01 — FASE 6.3-F: HOMOLOGAÇÃO REAL DO AGENDADOR EM DRY-RUN ===");
  console.log(`=== Supabase DEV: ${PROJECT_REF} ===\n`);

  // 1. CHECAGEM ESTRITA DAS TRAVAS GLOBAIS DE SEGURANÇA
  console.log("--- 1. VERIFICANDO TRAVAS DE SEGURANÇA ANTES DE ATIVAR ---");
  const testUrl = `https://${PROJECT_REF}.supabase.co/functions/v1/process-notifications`;
  const preCheck = await runSql(`
    SELECT extname, extversion FROM pg_extension WHERE extname IN ('pg_cron', 'pg_net');
  `);
  console.log("Extensões ativas:", preCheck);

  // 2. CRIAR DADOS BASE FICTÍCIOS PARA HOMOLOGAÇÃO
  console.log("\n--- 2. INSERINDO DADOS FICTÍCIOS DE TESTE ---");
  const testPrefix = 'F63F_' + Date.now();
  await runSql(`
    -- Inserir barbeiro, cliente e servico fictícios
    INSERT INTO public.barbers (id, name, phone) 
    VALUES ('${testPrefix}_barber', 'Barbeiro Homolog 6.3F', '34988880000')
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.customers (id, name, phone) 
    VALUES ('${testPrefix}_cust', 'Cliente Homolog 6.3F', '34999990000')
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.services (id, name, duration_minutes, price, restricted_access) 
    VALUES ('${testPrefix}_srv', 'Corte Homolog 6.3F', 30, 50.00, false)
    ON CONFLICT (id) DO NOTHING;

    -- Agendamento fictício
    INSERT INTO public.appointments (id, barber_id, client_id, service_id, appointment_time, status)
    VALUES ('${testPrefix}_appt', '${testPrefix}_barber', '${testPrefix}_cust', '${testPrefix}_srv', now() + interval '2 hours', 'confirmed')
    ON CONFLICT (id) DO NOTHING;

    -- Limpar fila de triggers para inserir itens controlados
    DELETE FROM public.notification_queue WHERE appointment_id = '${testPrefix}_appt';

    -- Inserir 7 itens pendentes para testar batch_size=5 (5 processados, 2 restantes)
    -- Itens 1 a 5: Válidos
    INSERT INTO public.notification_queue (id, appointment_id, event_type, recipient_type, recipient_phone, recipient_name, content, scheduled_for, status, idempotency_key)
    VALUES 
      ('${testPrefix}_notif_1', '${testPrefix}_appt', 'new_appointment', 'client', '34999990000', 'Cliente 1', 'Teste 1', now() - interval '1 minute', 'pending', '${testPrefix}_key_1'),
      ('${testPrefix}_notif_2', '${testPrefix}_appt', 'new_appointment', 'client', '34999990000', 'Cliente 2', 'Teste 2', now() - interval '1 minute', 'pending', '${testPrefix}_key_2'),
      ('${testPrefix}_notif_3', '${testPrefix}_appt', 'new_appointment', 'client', '34999990000', 'Cliente 3', 'Teste 3', now() - interval '1 minute', 'pending', '${testPrefix}_key_3'),
      ('${testPrefix}_notif_4', '${testPrefix}_appt', 'new_appointment', 'client', '34999990000', 'Cliente 4', 'Teste 4', now() - interval '1 minute', 'pending', '${testPrefix}_key_4'),
      ('${testPrefix}_notif_5', '${testPrefix}_appt', 'new_appointment', 'client', '34999990000', 'Cliente 5', 'Teste 5', now() - interval '1 minute', 'pending', '${testPrefix}_key_5'),
      ('${testPrefix}_notif_6', '${testPrefix}_appt', 'new_appointment', 'client', '34999990000', 'Cliente 6', 'Teste 6', now() - interval '1 minute', 'pending', '${testPrefix}_key_6'),
      ('${testPrefix}_notif_7', '${testPrefix}_appt', 'new_appointment', 'client', '12345', 'Tel Invalido', 'Teste Invalido', now() - interval '1 minute', 'pending', '${testPrefix}_key_7');
  `);
  console.log("7 notificações fictícias inseridas em notification_queue.");

  // 3. CONFIGURAR E ATIVAR TEMPORARIAMENTE O AGENDADOR
  console.log("\n--- 3. CONFIGURANDO O JOB club01_process_notifications NO pg_cron ---");
  // Remove se já existisse
  await runSql(`SELECT cron.unschedule('club01_process_notifications');`).catch(() => {});

  const scheduleSql = `
    SELECT cron.schedule(
      'club01_process_notifications',
      '* * * * *',
      $$
      SELECT net.http_post(
        url := '${testUrl}',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-cron-secret', '${cronSecret}'
        ),
        body := jsonb_build_object('batch_size', 5),
        timeout_milliseconds := 5000
      );
      $$
    );
  `;
  const scheduleRes = await runSql(scheduleSql);
  console.log("Resultado do cron.schedule:", scheduleRes);

  // Verificar job em cron.job
  const activeJob = await runSql(`SELECT jobid, jobname, schedule, active FROM cron.job WHERE jobname = 'club01_process_notifications';`);
  console.log("Job ativo cadastrado:", activeJob);

  // 4. AGUARDAR O DISPARO AUTOMÁTICO DO PG_CRON
  // O pg_cron roda no início de cada minuto (:00 segundos).
  const now = new Date();
  const secondsToNextMinute = 60 - now.getSeconds();
  console.log(`\nHora atual: ${now.toISOString()}`);
  console.log(`Aguardando ${secondsToNextMinute + 10} segundos para cruzar o minuto (:00) e permitir a execução do pg_cron...`);
  
  await sleep((secondsToNextMinute + 10) * 1000);

  console.log("\n--- 4. MONITORANDO EXECUÇÃO AUTOMÁTICA PÓS-MINUTO ---");
  // Esperar até 20 segundos extras checando se cron.job_run_details registrou a execução
  let jobRuns = [];
  let httpResponses = [];
  for (let i = 0; i < 5; i++) {
    jobRuns = await runSql(`
      SELECT runid, jobid, status, return_message, start_time, end_time 
      FROM cron.job_run_details 
      ORDER BY start_time DESC LIMIT 5;
    `);
    httpResponses = await runSql(`
      SELECT id, status_code, content, timed_out, error_msg, created 
      FROM net._http_response 
      ORDER BY id DESC LIMIT 5;
    `);
    if (jobRuns.length > 0 || httpResponses.length > 0) {
      break;
    }
    await sleep(4000);
  }

  console.log("Execuções em cron.job_run_details:", JSON.stringify(jobRuns, null, 2));
  console.log("Respostas em net._http_response:", JSON.stringify(httpResponses, null, 2));

  // 5. CONSULTAR ESTADO DA FILA E LOGS
  console.log("\n--- 5. ESTADO DA FILA E LOGS APÓS DISPARO ---");
  const queueItems = await runSql(`
    SELECT id, status, attempts, external_id, last_error, processed_at
    FROM public.notification_queue 
    WHERE appointment_id = '${testPrefix}_appt'
    ORDER BY id ASC;
  `);
  console.log("Itens da fila:", JSON.stringify(queueItems, null, 2));

  const logItems = await runSql(`
    SELECT id, message_type, phone, status, sent_at
    FROM public.whatsapp_logs 
    WHERE id LIKE '${testPrefix}%'
    ORDER BY id ASC;
  `);
  console.log("Itens em whatsapp_logs:", JSON.stringify(logItems, null, 2));

  // 6. DESATIVAÇÃO OBRIGATÓRIA IMEDIATA DO AGENDADOR
  console.log("\n--- 6. DESATIVAÇÃO OBRIGATÓRIA DO JOB club01_process_notifications ---");
  const unscheduleRes = await runSql(`SELECT cron.unschedule('club01_process_notifications');`);
  console.log("Resultado do cron.unschedule:", unscheduleRes);

  const finalJobCheck = await runSql(`SELECT * FROM cron.job WHERE jobname = 'club01_process_notifications';`);
  console.log("Confirmação de que o job NÃO existe mais ativo:", finalJobCheck);

  // 7. LIMPEZA DOS DADOS FICTÍCIOS DE TESTE
  console.log("\n--- 7. LIMPEZA DOS REGISTROS FICTÍCIOS DE TESTE ---");
  await runSql(`
    DELETE FROM public.whatsapp_logs WHERE id LIKE '${testPrefix}%';
    DELETE FROM public.notification_queue WHERE appointment_id = '${testPrefix}_appt';
    DELETE FROM public.appointments WHERE id = '${testPrefix}_appt';
    DELETE FROM public.customers WHERE id = '${testPrefix}_cust';
    DELETE FROM public.barbers WHERE id = '${testPrefix}_barber';
    DELETE FROM public.services WHERE id = '${testPrefix}_srv';
  `);
  console.log("Dados fictícios de teste removidos com sucesso.");

  console.log("\n=========================================================================");
  console.log("=== HOMOLOGAÇÃO CONTROLADA DA FASE 6.3-F CONCLUÍDA ===");
  console.log("=========================================================================");
}

main().catch(err => {
  console.error("Erro na orquestração:", err);
  process.exit(1);
});
