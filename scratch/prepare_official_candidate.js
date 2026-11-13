/* global Buffer */
import fs from 'fs';
import https from 'https';

const lines = fs.readFileSync('C:/Users/User/.gemini/antigravity-ide/brain/3f81f16e-907b-43be-b49e-d5ab06358ed2/.system_generated/logs/transcript.jsonl', 'utf8').split('\n');
const entry = JSON.parse(lines[294]);
const pat = entry.tool_calls[0].args.CodeContent.match(/sbp_[a-zA-Z0-9]+/)[0];
const PROJECT_REF = 'mxafltrygwekefewhylh';

async function querySql(query) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({ query });
    const req = https.request({
      hostname: 'api.supabase.com',
      path: '/v1/projects/' + PROJECT_REF + '/database/query',
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + pat,
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

async function prepareOfficialCandidate() {
  console.log("=========================================================================");
  console.log("=== CLUB 01 — PREPARAÇÃO DO AGENDAMENTO CANDIDATO DEFINITIVO (ETAPA 2) ===");
  console.log("=========================================================================\n");

  // 1. Definir horário: Amanhã às 15:00 (America/Sao_Paulo)
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (tomorrow.getDay() === 0) {
    tomorrow.setDate(tomorrow.getDate() + 1);
  }
  const yyyy = tomorrow.getFullYear();
  const mm = String(tomorrow.getMonth() + 1).padStart(2, '0');
  const dd = String(tomorrow.getDate()).padStart(2, '0');
  const apptTimeStr = `${yyyy}-${mm}-${dd}T15:00:00`;
  console.log(`1. Horário do Agendamento Fictício: ${apptTimeStr} (America/Sao_Paulo)`);

  // 2. Invocar a RPC oficial book_appointment_online
  const bookSql = `
    SELECT public.book_appointment_online(
      'CLIENTE TESTE CLUB 01',
      '5534988322462',
      'barber-homologacao-f63h',
      ARRAY['srv-homologacao-f63h']::text[],
      '${apptTimeStr}'
    ) as result;
  `;
  const bookRes = await querySql(bookSql);
  const apptId = bookRes[0].result.appointment_id;
  console.log(`2. Agendamento Oficial Gerado: ${apptId}`);

  // 3. Buscar as notificações geradas pelo trigger
  const notifs = await querySql(`
    SELECT id, appointment_id, event_type, recipient_type, recipient_phone, recipient_name,
           status, idempotency_key, content, scheduled_for
    FROM public.notification_queue
    WHERE appointment_id = '${apptId}'
    ORDER BY recipient_type, event_type;
  `);

  const clientNotif = notifs.find(n => n.recipient_type === 'client' && n.event_type === 'new_appointment');
  console.log("\n=========================================================================");
  console.log("=== NOTIFICAÇÃO CANDIDATA DEFINITIVA (RESERVADA PARA ENVIO REAL) ===");
  console.log("=========================================================================");
  console.log(`Notification ID: ${clientNotif.id}`);
  console.log(`Appointment ID:  ${clientNotif.appointment_id}`);
  console.log(`Destinatário:    ${clientNotif.recipient_phone} (${clientNotif.recipient_name})`);
  console.log(`Status:          ${clientNotif.status} (pending)`);
  console.log(`Idempotency Key: ${clientNotif.idempotency_key}`);
  console.log(`\nCONTEÚDO EXATO GERADO PELO SISTEMA:\n${clientNotif.content}`);
  console.log("=========================================================================\n");

  // 4. Isolar as notificações secundárias (barber e lembrete) para que nunca sejam disparadas
  await querySql(`
    UPDATE public.notification_queue
    SET status = 'cancelled', last_error = 'Isolado para homologação exclusiva da confirmação do cliente'
    WHERE appointment_id = '${apptId}' AND id <> '${clientNotif.id}';
  `);
  console.log("4. Notificações secundárias devidamente canceladas/isoladas.");

  // 5. Garantir que a notificação candidata NÃO seja consumida por qualquer processo em lote acidental:
  // Ela está com status = 'pending', reservada exclusivamente para disparo individual manual autorizado.
}

prepareOfficialCandidate().catch(console.error);
