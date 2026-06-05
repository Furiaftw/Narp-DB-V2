import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_DATABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } }
);

const MAX_PDF_BYTES = 8 * 1024 * 1024; // 8 MB — Discord webhook file limit
const PDF_TIMEOUT_MS = 7000;

/** Extract the Google Docs export-as-PDF URL from any Google Docs share link. */
function googleExportUrl(url) {
  if (!url) return null;
  const m = url.match(/docs\.google\.com\/document\/d\/([A-Za-z0-9_-]+)/);
  return m ? `https://docs.google.com/document/d/${m[1]}/export?format=pdf` : null;
}

/** Fetch a PDF from Google Docs. Returns a Buffer or null on any failure. */
async function fetchGoogleDocPDF(url) {
  const exportUrl = googleExportUrl(url);
  if (!exportUrl) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PDF_TIMEOUT_MS);

  try {
    const res = await fetch(exportUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; NARP-DB/1.0)',
      },
      redirect: 'follow',
    });

    if (!res.ok) return null;

    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('pdf') && !contentType.includes('octet-stream')) {
      // Google returned an HTML page (e.g. virus-scan warning) — skip
      return null;
    }

    // Stream into a buffer, aborting if it exceeds the size limit
    const reader = res.body.getReader();
    const chunks = [];
    let total = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > MAX_PDF_BYTES) { reader.cancel(); return null; }
      chunks.push(value);
    }

    return Buffer.concat(chunks.map(c => Buffer.from(c)));
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export default async (req) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Auth check
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

  let body;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { threadId, payload, docUrl, docName, chatTranscript } = body;

  if (!payload) {
    return new Response(JSON.stringify({ error: 'Missing payload' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Build Discord webhook URL
  const webhookBase = process.env.DISCORD_LOG_WEBHOOK_URL || process.env.VITE_DISCORD_LOG_WEBHOOK_URL;
  if (!webhookBase) {
    return new Response(JSON.stringify({ error: 'Webhook URL not configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  const sep = webhookBase.includes('?') ? '&' : '?';
  const threadParam = threadId ? `?thread_id=${threadId}` : '';
  const webhookUrl = `${webhookBase}${threadId ? `?thread_id=${threadId}&wait=true` : '?wait=true'}`;

  // Fetch PDF (best-effort — failures are silently skipped)
  const [pdfBuffer] = await Promise.all([
    fetchGoogleDocPDF(docUrl),
  ]);

  const nameSlug = (docName || 'entry').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'entry';
  const hasFiles = pdfBuffer || chatTranscript;

  let discordRes;
  if (hasFiles) {
    const form = new FormData();
    form.append('payload_json', JSON.stringify(payload));

    let fileIndex = 0;
    if (pdfBuffer) {
      form.append(
        `files[${fileIndex++}]`,
        new Blob([pdfBuffer], { type: 'application/pdf' }),
        `${nameSlug}.pdf`
      );
    }
    if (chatTranscript) {
      form.append(
        `files[${fileIndex++}]`,
        new Blob([chatTranscript], { type: 'text/plain' }),
        `transcript-${nameSlug}.txt`
      );
    }

    discordRes = await fetch(webhookUrl, { method: 'POST', body: form });
  } else {
    discordRes = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  }

  if (!discordRes.ok) {
    const errText = await discordRes.text();
    return new Response(JSON.stringify({ error: `Discord returned ${discordRes.status}: ${errText}` }), {
      status: discordRes.status,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const discordData = await discordRes.json();
  return new Response(JSON.stringify({ messageId: discordData?.id, threadId: threadId ?? null }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
