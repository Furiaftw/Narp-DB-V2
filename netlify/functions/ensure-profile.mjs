import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_DATABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } }
);

export default async (req) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const authHeader = req.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: 'Missing auth token' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const token = authHeader.slice(7);
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) {
    return new Response(JSON.stringify({ error: 'Invalid token' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { data: existing } = await supabase
    .from('profiles')
    .select('id, email, full_name, avatar_url, role')
    .eq('id', user.id)
    .maybeSingle();

  if (existing) {
    return new Response(JSON.stringify(existing), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let role = 'user';
  const { data: wl } = await supabase
    .from('whitelist')
    .select('role')
    .eq('email', user.email.toLowerCase())
    .maybeSingle();

  if (wl) {
    role = wl.role;
    await supabase.from('whitelist').delete().eq('email', user.email.toLowerCase());
  }

  const meta = user.user_metadata || {};
  const profile = {
    id: user.id,
    email: user.email,
    full_name: meta.full_name || meta.name || '',
    avatar_url: meta.avatar_url || meta.picture || '',
    role,
  };

  const { data, error } = await supabase
    .from('profiles')
    .upsert(profile)
    .select()
    .single();

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify(data), {
    headers: { 'Content-Type': 'application/json' },
  });
};

export const config = { path: '/.netlify/functions/ensure-profile' };
