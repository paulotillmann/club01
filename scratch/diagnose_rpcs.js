import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = "https://mxafltrygwekefewhylh.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im14YWZsdHJ5Z3dla2VmZXdoeWxoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIzMzg5NDksImV4cCI6MjEwNzkxNDk0OX0.ofwowT3V8qNGD9QSM32sRJY7PkwQ8viPmG3b42r3gG4";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function diagnoseRpcs() {
  console.log("=== DIAGNÓSTICO PROFUNDO DE RPCS NO SUPABASE ===");

  const rpcList = [
    { name: 'get_occupied_slots', params: {} },
    { name: 'get_email_by_phone', params: { p_phone: '11999999999' } },
    { name: 'book_appointment_atomic', params: { p_client_id: 'dummy', p_barber_id: 'dummy', p_service_id: 'dummy', p_appointment_time: '2026-10-25T14:00' } },
    { name: 'book_appointment_online', params: { p_name: 'TEST', p_phone: '11999999999', p_barber_id: 'dummy', p_service_ids: ['srv-1'], p_appointment_time: '2026-10-25T14:00' } },
    { name: 'create_sale_atomic', params: { p_appointment_id: null, p_customer_id: null, p_payment_method: 'dinheiro', p_items: [] } }
  ];

  for (const rpc of rpcList) {
    try {
      const res = await supabase.rpc(rpc.name, rpc.params);
      console.log(`\nRPC: ${rpc.name}`);
      console.log(`- Status: ${res.error ? 'ERRO (' + res.error.code + ')' : 'SUCESSO'}`);
      if (res.error) {
        console.log(`- Código: ${res.error.code}`);
        console.log(`- Mensagem: ${res.error.message}`);
        console.log(`- Detalhes: ${res.error.details}`);
        console.log(`- Hint: ${res.error.hint}`);
      } else {
        console.log(`- Retorno:`, res.data);
      }
    } catch (err) {
      console.log(`- Exceção:`, err.message);
    }
  }
}

diagnoseRpcs().catch(console.error);
