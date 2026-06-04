import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const DEV_EMAIL = 'dev-preview@narp.local';
const DEV_USERNAME = 'DevMode';

export default async (req) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Server-side guard: only active when EXPERIMENTAL_MODE=true is set in Netlify env vars
  const experimentalMode =
    (typeof Netlify !== 'undefined' && Netlify.env.get('EXPERIMENTAL_MODE')) ||
    process.env.EXPERIMENTAL_MODE;

  if (experimentalMode !== 'true') {
    return new Response(
      JSON.stringify({ error: 'Dev login is not enabled in this environment' }),
      { status: 403, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const supabaseUrl =
    (typeof Netlify !== 'undefined' &&
      (Netlify.env.get('VITE_SUPABASE_URL') ||
        Netlify.env.get('SUPABASE_DATABASE_URL') ||
        Netlify.env.get('VITE_SUPABASE_DATABASE_URL'))) ||
    process.env.VITE_SUPABASE_URL ||
    process.env.SUPABASE_DATABASE_URL ||
    process.env.VITE_SUPABASE_DATABASE_URL;

  const supabaseServiceKey =
    (typeof Netlify !== 'undefined' && Netlify.env.get('SUPABASE_SERVICE_ROLE_KEY')) ||
    process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    return new Response(
      JSON.stringify({ error: 'Server configuration error: missing environment variables' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }

  try {
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const securePassword = crypto.randomBytes(16).toString('hex');

    const { data: { users }, error: listError } = await supabaseAdmin.auth.admin.listUsers({ perPage: 1000, page: 1 });
    if (listError) {
      return new Response(
        JSON.stringify({ error: `Supabase listUsers failed: ${listError.message}` }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const existingUser = users.find(
      (u) => u.email && u.email.toLowerCase() === DEV_EMAIL.toLowerCase()
    );

    if (existingUser) {
      const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(
        existingUser.id,
        { password: securePassword }
      );
      if (updateError) {
        return new Response(
          JSON.stringify({ error: `Failed to update dev account: ${updateError.message}` }),
          { status: 500, headers: { 'Content-Type': 'application/json' } }
        );
      }
    } else {
      const { error: createError } = await supabaseAdmin.auth.admin.createUser({
        email: DEV_EMAIL,
        password: securePassword,
        email_confirm: true,
        user_metadata: {
          preferred_username: DEV_USERNAME,
          avatar_url: null,
          provider: 'dev',
          providers: ['dev'],
        },
      });
      if (createError) {
        return new Response(
          JSON.stringify({ error: `Failed to create dev account: ${createError.message}` }),
          { status: 500, headers: { 'Content-Type': 'application/json' } }
        );
      }
      // Wait for the DB trigger to create the profile row
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    // Always ensure dev account has 'owner' role and correct username
    const { error: roleError } = await supabaseAdmin
      .from('profiles')
      .update({ role: 'owner', username: DEV_USERNAME })
      .eq('email', DEV_EMAIL);

    if (roleError) {
      console.warn(`[dev-login] Failed to set owner role: ${roleError.message}`);
    }

    return new Response(JSON.stringify({ email: DEV_EMAIL, password: securePassword }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: `Internal server error: ${err.message}` }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

export const config = { path: '/.netlify/functions/dev-login' };
