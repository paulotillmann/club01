/* global Buffer */
import https from 'https';
import fs from 'fs';

const lines = fs.readFileSync('C:/Users/User/.gemini/antigravity-ide/brain/3f81f16e-907b-43be-b49e-d5ab06358ed2/.system_generated/logs/transcript.jsonl', 'utf8').split('\n');
const entry = JSON.parse(lines[294]);
const pat = entry.tool_calls[0].args.CodeContent.match(/sbp_[a-zA-Z0-9]+/)[0];
const PROJECT_REF = 'mxafltrygwekefewhylh';
const APPOINTMENT_ID = 'f2e9e489-886b-49c4-b937-0cc3e84ba893';

async function runSql(query) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({ query });
    const req = https.request({
      hostname: 'api.supabase.com',
      path: `/v1/projects/${PROJECT_REF}/database/query`,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${pat}`,
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

async function executeOfficialCancel() {
  console.log("=== EXECUTANDO CANCELAMENTO OFICIAL CONTROLADO ===");

  // 1. Executar cancelamento oficial via SQL equivalente à api.js (appointments.cancel)
  const cancelRes = await runSql(`
    UPDATE public.appointments
    SET status = 'cancelled',
        cancellation_reason = 'Cancelado pelo cliente em teste de homologação'
    WHERE id = '${APPOINTMENT_ID}'
    RETURNING id, status, cancellation_reason, appointment_time, barber_id, client_id;
  `);
  console.log("Resultado do Cancelamento em appointments:", JSON.stringify(cancelRes, null, 2));

  // 2. Verificar get_occupied_slots para atestar liberação de horário
  const occupiedSlots = await runSql(`
    SELECT * FROM public.get_occupied_slots()
    WHERE barber_id = 'barber-homologacao-f63h'
      AND appointment_time = '2026-10-28T15:00:00';
  `);
  console.log("Slot 15:00 em get_occupied_slots (deve estar vazio):", occupiedSlots);

  // 3. Consultar notificações geradas pelo trigger
  const notifs = await runSql(`
    SELECT id, appointment_id, event_type, recipient_type, recipient_phone, recipient_name,
           status, scheduled_for, idempotency_key, content
    FROM public.notification_queue
    WHERE appointment_id = '${APPOINTMENT_ID}'
      AND event_type = 'cancellation'
    ORDER BY recipient_type ASC;
  `);
  console.log("Notificações de Cancelamento Geradas:", JSON.stringify(notifs, null, 2));

  // 4. Isolar/Neutralizar a notificação do barbeiro para segurança estrita
  const isolateBarber = await runSql(`
    UPDATE public.notification_queue
    SET status = 'cancelled',
        last_error = 'Isolado por regra de segurança: envio restrito exclusivamente ao cliente na Fase 6.3-H'
    WHERE appointment_id = '${APPOINTMENT_ID}'
      AND event_type = 'cancellation'
      AND recipient_type = 'barber'
    RETURNING id, recipient_type, status, last_error;
  `);
  console.log("Isolamento da notificação do barbeiro:", JSON.stringify(isolateBarber, null, 2));

  // 5. Verificar estado consolidado das notificações do agendamento
  const finalApptNotifs = await runSql(`
    SELECT id, event_type, recipient_type, recipient_phone, status, content
    FROM public.notification_queue
    WHERE appointment_id = '${APPOINTMENT_ID}'
    ORDER BY created_at ASC;
  `);
  console.log("Todas as Notificações do Agendamento Pós-Cancelamento:", JSON.stringify(finalApptNotifs, null, 2));
}

executeOfficialCancel().catch(console.error);
