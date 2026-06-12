// Netlify Function — server-side audio transcription via OpenAI Whisper.
// The OpenAI key lives ONLY here. Client sends base64 audio; we forward to Whisper.
// Note: Netlify synchronous functions cap the request body at ~6 MB, so this is
// for short clips. Larger files need a background function or direct-to-storage upload.

// Only signed-in users may spend API credits — same check as brainy.mjs.
// These two values are public by design (they ship in index.html).
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://qykyltsgxfechhfnxrbq.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF5a3lsdHNneGZlY2hoZm54cmJxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEyMTk0MDgsImV4cCI6MjA5Njc5NTQwOH0.7sI2e-oTjMaz2Ca8E4hUlfvUX5E8G_xceGgkp7neM80';

async function requireUser(req) {
  const auth = req.headers.get('authorization') || '';
  if (!auth.startsWith('Bearer ')) return false;
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_ANON_KEY, authorization: auth },
    });
    return r.ok;
  } catch { return false; }
}

export default async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  if (!(await requireUser(req))) return Response.json({ error: 'Sign in to use the AI features.' }, { status: 401 });

  const key = process.env.OPENAI_API_KEY;
  if (!key) return Response.json({ error: 'Server is missing OPENAI_API_KEY.' }, { status: 500 });

  let audio, mime, name;
  try { ({ audio, mime, name } = await req.json()); } catch { return Response.json({ error: 'Invalid JSON body.' }, { status: 400 }); }
  if (!audio) return Response.json({ error: 'No audio provided.' }, { status: 400 });

  let bytes;
  try { bytes = Uint8Array.from(atob(audio), (c) => c.charCodeAt(0)); }
  catch { return Response.json({ error: 'Audio was not valid base64.' }, { status: 400 }); }

  // Whisper detects format from the filename extension, so send a real one.
  const extFromMime = { 'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/m4a': 'm4a', 'audio/aac': 'm4a', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/flac': 'flac' };
  let filename = (typeof name === 'string' && /\.[a-z0-9]{2,4}$/i.test(name)) ? name.replace(/[^\w.\-]/g, '_') : `audio.${extFromMime[mime] || 'm4a'}`;

  const form = new FormData();
  form.append('file', new Blob([bytes], { type: mime || 'audio/mp4' }), filename);
  form.append('model', 'whisper-1');

  let r;
  try {
    r = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}` },
      body: form,
    });
  } catch (e) {
    return Response.json({ error: 'Could not reach OpenAI.' }, { status: 502 });
  }

  if (!r.ok) {
    const detail = await r.text().catch(() => '');
    return Response.json({ error: `Transcription failed (${r.status}).`, detail }, { status: 502 });
  }

  const data = await r.json();
  const text = (data.text || '').trim();
  if (!text) return Response.json({ error: 'No speech detected.' }, { status: 422 });
  return Response.json({ text });
};

export const config = { path: '/api/transcribe' };
