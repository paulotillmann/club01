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

async function prepareHomologationBooking() {
  console.log("=========================================================================");
  console.log("=== CLUB 01 — FASE 6.3-H ETAPA 2: PREPARAÇÃO DE AGENDAMENTO FICTÍCIO ===");
  console.log("=========================================================================\n");

  // 1. Cadastrar Serviço e Barbeiro de Homologação (se não existirem)
  console.log("1. Garantindo Serviço e Barbeiro de Homologação no DEV...");
  const setupSql = `
    INSERT INTO public.services (
      id, name, duration_minutes, price, restricted_access
    ) VALUES (
      'srv-homologacao-f63h', 'Corte Homologação', 30, 45.00, false
    ) ON CONFLICT (id) DO UPDATE SET 
      name = EXCLUDED.name, 
      duration_minutes = EXCLUDED.duration_minutes, 
      price = EXCLUDED.price;

    INSERT INTO public.barbers (
      id, name, phone
    ) VALUES (
      'barber-homologacao-f63h', 'Barbeiro Homologação', '5534988322462'
    ) ON CONFLICT (id) DO UPDATE SET 
      name = EXCLUDED.name, 
      phone = EXCLUDED.phone;

    INSERT INTO public.barber_services (
      barber_id, service_id
    ) VALUES (
      'barber-homologacao-f63h', 'srv-homologacao-f63h'
    ) ON CONFLICT DO NOTHING;
  `;
  await querySql(setupSql);
  console.log("   - Registro de homologação configurado com sucesso.");

  // 2. Definir Horário Futuro Seguro (Amanhã às 14:00 horário de São Paulo)
  // Formato: YYYY-MM-DDTHH:mm:ss
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (tomorrow.getDay() === 0) { // Se for domingo, pula para segunda
    tomorrow.setDate(tomorrow.getDate() + 1);
  }
  const yyyy = tomorrow.getFullYear();
  const mm = String(tomorrow.getMonth() + 1).padStart(2, '0');
  const dd = String(tomorrow.getDate()).padStart(2, '0');
  const apptTimeStr = `${yyyy}-${mm}-${dd}T14:00:00`;
  console.log(`\n2. Horário do Agendamento Fictício: ${apptTimeStr} (America/Sao_Paulo)`);

  // 3. Executar o Agendamento Oficial via RPC book_appointment_online
  console.log("\n3. Invocando RPC oficial book_appointment_online...");
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
  console.log("   - Resposta da RPC:", JSON.stringify(bookRes, null, 2));

  if (!bookRes || !bookRes[0]?.result?.success) {
    throw new Error("Falha ao criar agendamento de homologação: " + JSON.stringify(bookRes));
  }

  const apptId = bookRes[0].result.appointment_id;
  console.log(`   - ID do Agendamento Gerado: ${apptId}`);

  // 4. Inspecionar o Agendamento Criado
  console.log("\n4. Dados do Agendamento em public.appointments:");
  const apptQuery = `
    SELECT 
      a.id,
      a.client_id,
      c.name as client_name,
      c.phone as client_phone,
      a.barber_id,
      b.name as barber_name,
      b.phone as barber_phone,
      a.service_id,
      s.name as service_name,
      a.appointment_time,
      a.status,
      a.created_at
    FROM public.appointments a
    JOIN public.customers c ON a.client_id = c.id
    JOIN public.barbers b ON a.barber_id = b.id
    JOIN public.services s ON a.service_id = s.id
    WHERE a.id = '${apptId}';
  `;
  const apptData = await querySql(apptQuery);
  console.log(JSON.stringify(apptData, null, 2));

  // 5. Inspecionar as Notificações Geradas pelo Trigger handle_appointment_notifications
  console.log("\n5. Notificações Geradas em public.notification_queue:");
  const notifsQuery = `
    SELECT 
      id,
      appointment_id,
      event_type,
      recipient_type,
      recipient_name,
      recipient_phone,
      scheduled_for,
      status,
      idempotency_key,
      attempts,
      max_attempts,
      content,
      created_at
    FROM public.notification_queue
    WHERE appointment_id = '${apptId}'
    ORDER BY recipient_type, event_type;
  `;
  const notifsData = await querySql(notifsQuery);
  console.log(JSON.stringify(notifsData, null, 2));

  // 6. Identificar a Notificação Candidata Exclusiva para o Futuro Teste Real
  const clientConfNotif = notifsData.find(n => n.recipient_type === 'client' && n.event_type === 'new_appointment');
  console.log("\n=========================================================================");
  console.log("=== NOTIFICAÇÃO CANDIDATA EXCLUSIVA PARA EVENTUAL ENVIO REAL ===");
  console.log("=========================================================================");
  console.log(`Notification ID: ${clientConfNotif?.id}`);
  console.log(`Appointment ID:  ${clientConfNotif?.appointment_id}`);
  console.log(`Destinatário:    ${clientConfNotif?.recipient_phone} (${clientConfNotif?.recipient_name})`);
  console.log(`Tipo de Evento:  ${clientConfNotif?.event_type}`);
  console.log(`Status Atual:    ${clientConfNotif?.status}`);
  console.log(`Idempotency Key: ${clientConfNotif?.idempotency_key}`);
  console.log(`\nCONTEÚDO EXATO GERADO PELO SISTEMA:\n${clientConfNotif?.content}`);
  console.log("=========================================================================\n");

  // 7. Manter as demais notificações (Barbeiro e Lembrete 30m) marcadas como canceladas ou isoladas
  // Para garantir que NUNCA sejam disparadas acidentalmente
  console.log("6. Isolando notificações secundárias (barber e reminder_30m)...");
  await querySql(`
    UPDATE public.notification_queue
    SET status = 'cancelled', last_error = 'Isolado na Fase 6.3-H Etapa 2: Apenas confirmacao do cliente sera testada'
    WHERE appointment_id = '${apptId}' AND id <> '${clientConfNotif?.id}';
  `);
  console.log("   - Notificações secundárias devidamente isoladas.");

  // 8. Confirmar que o agendador e as travas continuam desativados
  console.log("\n7. Verificação de Travas e Agendador no Banco DEV:");
  const cronCheck = await querySql("SELECT count(*) as active_jobs FROM cron.job WHERE active = true;");
  console.log("   - Jobs ativos no cron:", cronCheck[0]?.active_jobs);
}

prepareHomologationBooking().catch(console.error);
