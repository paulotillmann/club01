/* global Buffer */
import https from 'https';
import fs from 'fs';

const lines = fs.readFileSync('C:/Users/User/.gemini/antigravity-ide/brain/3f81f16e-907b-43be-b49e-d5ab06358ed2/.system_generated/logs/transcript.jsonl', 'utf8').split('\n');
const entry = JSON.parse(lines[294]);
const pat = entry.tool_calls[0].args.CodeContent.match(/sbp_[a-zA-Z0-9]+/)[0];
const PROJECT_REF = 'mxafltrygwekefewhylh';

async function apiRequest(path, method = 'GET', body = null) {
  return new Promise((resolve, reject) => {
    const postData = body ? JSON.stringify(body) : null;
    const req = https.request({
      hostname: 'api.supabase.com',
      path: `/v1/projects/${PROJECT_REF}${path}`,
      method,
      headers: {
        'Authorization': `Bearer ${pat}`,
        'Content-Type': 'application/json',
        ...(postData ? { 'Content-Length': Buffer.byteLength(postData) } : {})
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
    if (postData) req.write(postData);
    req.end();
  });
}

async function runSql(query) {
  const res = await apiRequest('/database/query', 'POST', { query });
  return res;
}

async function step1_AuditAndCreateAndReschedule() {
  console.log("=========================================================================");
  console.log("=== CLUB 01 — FASE 6.3-H ETAPA 4: ORQUESTRAÇÃO DE REMARCAÇÃO ===");
  console.log("=========================================================================\n");

  // 1. Auditoria Prévia
  console.log("1. AUDITORIA INICIAL...");
  const secrets = await apiRequest('/secrets');
  const safeSecrets = Array.isArray(secrets) ? secrets.filter(s => s.name.startsWith('WHATSAPP_') || s.name.startsWith('EVOLUTION_')).map(s => ({ name: s.name, exists: true })) : secrets;
  console.log("   Secrets:", safeSecrets);

  const cronJobs = await runSql(`SELECT jobid, schedule, command, active FROM cron.job;`);
  console.log("   Cron Jobs ativos:", cronJobs?.length || 0);
  if (cronJobs && cronJobs.length > 0) {
    throw new Error("ABORTANDO: Existem jobs ativos em cron.job!");
  }

  // 2. Criação Oficial do Agendamento Fictício (29/10/2026 às 15:00)
  console.log("\n2. CRIANDO AGENDAMENTO FICTÍCIO OFICIAL VIA RPC (29/10/2026 15:00)...");
  const bookRes = await runSql(`
    SELECT public.book_appointment_online(
      'CLIENTE TESTE CLUB 01',
      '5534988322462',
      'barber-homologacao-f63h',
      ARRAY['srv-homologacao-f63h']::text[],
      '2026-10-29T15:00:00'
    ) as result;
  `);
  console.log("   Resultado do book_appointment_online:", JSON.stringify(bookRes, null, 2));

  const resultObj = bookRes[0]?.result;
  if (!resultObj || !resultObj.success || !resultObj.appointment_id) {
    throw new Error("Falha ao criar agendamento inicial via RPC: " + JSON.stringify(bookRes));
  }
  const apptId = resultObj.appointment_id;
  console.log(`   ✓ Agendamento criado com sucesso! appointment_id = ${apptId}`);

  // 3. Validação do Agendamento Inicial e Ocupação do Slot 15:00
  console.log("\n3. VALIDANDO AGENDAMENTO INICIAL E OCUPAÇÃO DO SLOT 15:00...");
  const apptCheck = await runSql(`
    SELECT id, client_id, barber_id, service_id, appointment_time, status 
    FROM public.appointments WHERE id = '${apptId}';
  `);
  console.log("   Dados do agendamento:", apptCheck);

  const slot15Check = await runSql(`
    SELECT * FROM public.get_occupied_slots()
    WHERE barber_id = 'barber-homologacao-f63h' AND appointment_time = '2026-10-29T15:00:00';
  `);
  console.log("   Slot 15:00 em get_occupied_slots (deve constar 1 registro):", slot15Check);

  // 4. Neutralização Preventiva das Notificações Iniciais (A Etapa 4 homologa exclusivamente o evento de remarcação)
  console.log("\n4. NEUTRALIZANDO PREVENTIVAMENTE AS NOTIFICAÇÕES INICIAIS DA CRIAÇÃO...");
  const neutralInit = await runSql(`
    UPDATE public.notification_queue
    SET status = 'cancelled',
        last_error = 'Neutralizado preventivamente: Etapa 4 homologa exclusivamente o evento de remarcação'
    WHERE appointment_id = '${apptId}'
      AND event_type = 'new_appointment'
    RETURNING id, event_type, recipient_type, status;
  `);
  console.log("   Notificações iniciais neutralizadas:", neutralInit);

  // 5. Execução Oficial da Remarcação (29/10/2026 às 16:00)
  console.log("\n5. EXECUTANDO REMARCAÇÃO OFICIAL (NOVO HORÁRIO: 29/10/2026 16:00)...");
  const reschedUpdate = await runSql(`
    UPDATE public.appointments
    SET appointment_time = '2026-10-29T16:00:00'
    WHERE id = '${apptId}'
    RETURNING id, appointment_time, status, barber_id;
  `);
  console.log("   Resultado do UPDATE em appointments:", reschedUpdate);

  // 6. Validação dos Horários (15:00 Liberado, 16:00 Ocupado)
  console.log("\n6. VALIDANDO LIBERAÇÃO DO SLOT 15:00 E OCUPAÇÃO DO SLOT 16:00...");
  const occupiedSlots = await runSql(`
    SELECT * FROM public.get_occupied_slots()
    WHERE barber_id = 'barber-homologacao-f63h' 
      AND appointment_time IN ('2026-10-29T15:00:00', '2026-10-29T16:00:00')
    ORDER BY appointment_time;
  `);
  console.log("   Slots ocupados em get_occupied_slots (deve constar apenas 16:00):", occupiedSlots);

  // 7. Validação dos Lembretes (Antigo cancelado, Novo programado para 15:30)
  console.log("\n7. VALIDANDO LEMBRETES DE 30 MINUTOS...");
  const remindersCheck = await runSql(`
    SELECT id, event_type, scheduled_for, status, last_error
    FROM public.notification_queue
    WHERE appointment_id = '${apptId}' AND event_type = 'reminder_30m'
    ORDER BY scheduled_for ASC;
  `);
  console.log("   Lembretes vinculados ao agendamento:", JSON.stringify(remindersCheck, null, 2));

  // 8. Consulta das Notificações de Remarcação Geradas pelo Trigger
  console.log("\n8. CONSULTANDO NOTIFICAÇÕES DE REMARCAÇÃO GERADAS PELO TRIGGER...");
  const reschedNotifs = await runSql(`
    SELECT id, appointment_id, event_type, recipient_type, recipient_phone, recipient_name,
           status, scheduled_for, idempotency_key, content
    FROM public.notification_queue
    WHERE appointment_id = '${apptId}' AND event_type = 'reschedule'
    ORDER BY recipient_type ASC;
  `);
  console.log("   Notificações de Remarcação:", JSON.stringify(reschedNotifs, null, 2));

  // 9. Neutralização da Notificação de Remarcação para o Barbeiro
  console.log("\n9. NEUTRALIZANDO NOTIFICAÇÃO DO BARBEIRO PARA SEGURANÇA...");
  const isolateBarber = await runSql(`
    UPDATE public.notification_queue
    SET status = 'cancelled',
        last_error = 'Isolado preventivamente: envio restrito exclusivamente ao cliente na Fase 6.3-H'
    WHERE appointment_id = '${apptId}'
      AND event_type = 'reschedule'
      AND recipient_type = 'barber'
    RETURNING id, recipient_type, status;
  `);
  console.log("   Notificação do barbeiro isolada:", isolateBarber);

  // 10. Identificação da Notificação Candidata Oficial de Remarcação do Cliente
  const candidateClient = reschedNotifs.find(n => n.recipient_type === 'client');
  console.log("\n10. NOTIFICAÇÃO CANDIDATA OFICIAL (CLIENTE):");
  console.log("    ID:", candidateClient?.id);
  console.log("    Destinatário:", candidateClient?.recipient_phone);
  console.log("    Status:", candidateClient?.status);
  console.log("    Conteúdo:\n" + candidateClient?.content);

  return {
    appointment_id: apptId,
    candidate_notification_id: candidateClient?.id
  };
}

step1_AuditAndCreateAndReschedule()
  .then(res => {
    fs.writeFileSync('c:/club01/scratch/.fase6_3h_etapa4_ids.json', JSON.stringify(res, null, 2));
    console.log("\n✓ Etapa de preparação e remarcação concluída com sucesso!");
  })
  .catch(console.error);
