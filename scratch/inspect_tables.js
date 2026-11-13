import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = "https://mxafltrygwekefewhylh.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im14YWZsdHJ5Z3dla2VmZXdoeWxoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIzMzg5NDksImV4cCI6MjEwNzkxNDk0OX0.ofwowT3V8qNGD9QSM32sRJY7PkwQ8viPmG3b42r3gG4";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function inspectTables() {
  const { data: settings } = await supabase.from('settings').select('*');
  console.log('Settings:', settings);

  const { data: services, count } = await supabase.from('services').select('*', { count: 'exact' });
  console.log('Services count:', count, 'data:', services);

  const { data: barbers, count: bCount } = await supabase.from('barbers').select('*', { count: 'exact' });
  console.log('Barbers count:', bCount, 'data:', barbers);
}

inspectTables().catch(console.error);
