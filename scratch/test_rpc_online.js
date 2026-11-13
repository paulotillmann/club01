import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = "https://mxafltrygwekefewhylh.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im14YWZsdHJ5Z3dla2VmZXdoeWxoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIzMzg5NDksImV4cCI6MjEwNzkxNDk0OX0.ofwowT3V8qNGD9QSM32sRJY7PkwQ8viPmG3b42r3gG4";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function testRpc() {
  const { data, error } = await supabase.rpc('book_appointment_online', {
    p_name: 'TEST QA',
    p_phone: '11999999999',
    p_barber_id: 'barber-dummy',
    p_service_ids: ['srv-corte'],
    p_appointment_time: '2026-10-25T14:00'
  });
  console.log('Result:', { data, error });
}

testRpc().catch(console.error);
