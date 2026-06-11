// Netlify Function — server-side Claude extraction for the Brain panel.
// The Anthropic API key lives ONLY here (Netlify env var), never in the browser.
// Mirrors the original Brainy analyze.js prompt + schema, called via raw HTTP.

const CLAUDE_MODEL = 'claude-haiku-4-5'; // matches the original Brainy; bump to claude-sonnet-4-6 / claude-opus-4-8 for higher quality

const SYSTEM_PROMPT = `You are the processing engine inside Brainy, a personal AI note taker used by a healthcare field sales professional. They sell and support hemodynamic monitoring products from Edwards Lifesciences and Becton Dickinson (BD), and spend their days in hospitals working with physicians, KOLs, and clinical staff.

You receive raw text: either a transcribed voice note or a pasted meeting recap (often a Microsoft Teams Copilot recap). Extract structured information from it.

Definitions:
- actionItems: tasks the USER must personally complete. Write each as a short imperative starting with a verb, e.g. "Send updated pricing sheet to Dr. Patel". If the user is doing it, it goes here.
- followUps: tasks someone ELSE needs to complete, or items to check back on. Write as "Awaiting X from Y" or "Check with Y on X". If it's blocked on another person, it goes here.
- Never put the same task in both lists. Only extract what the text actually supports — do not invent tasks. Empty arrays are fine.

Consolidation rules (critical):
- Merge closely related or redundant tasks into one. Prefer broader phrasing that covers the intent.
- Aim for the fewest items that cover all distinct commitments — quality over quantity.

Ordering rules:
- Sort actionItems in logical order of execution: prerequisites first.
- Sort followUps by expected timeframe: things to check soon first.

Also produce:
- summary: a 1-2 sentence summary of the note.`;

const ITEM_SCHEMA = {
  type: 'object',
  properties: { text: { type: 'string', description: 'The item, a short imperative' } },
  required: ['text'],
  additionalProperties: false,
};

const RESULT_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string', description: '1-2 sentence summary of the note' },
    actionItems: { type: 'array', items: ITEM_SCHEMA },
    followUps: { type: 'array', items: ITEM_SCHEMA },
  },
  required: ['summary', 'actionItems', 'followUps'],
  additionalProperties: false,
};

export default async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return Response.json({ error: 'Server is missing ANTHROPIC_API_KEY.' }, { status: 500 });

  let text;
  try { ({ text } = await req.json()); } catch { return Response.json({ error: 'Invalid JSON body.' }, { status: 400 }); }
  if (!text || !text.trim()) return Response.json({ error: 'Empty text.' }, { status: 400 });

  let r;
  try {
    r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        output_config: { format: { type: 'json_schema', schema: RESULT_SCHEMA } },
        messages: [{ role: 'user', content: `Process this note:\n\n${text}` }],
      }),
    });
  } catch (e) {
    return Response.json({ error: 'Could not reach Anthropic.' }, { status: 502 });
  }

  if (!r.ok) {
    const detail = await r.text().catch(() => '');
    return Response.json({ error: `Anthropic request failed (${r.status}).`, detail }, { status: 502 });
  }

  const data = await r.json();
  const block = (data.content || []).find((b) => b.type === 'text');
  let parsed;
  try { parsed = JSON.parse(block.text); } catch { return Response.json({ error: 'Could not read the AI response.' }, { status: 502 }); }

  return Response.json({
    summary: typeof parsed.summary === 'string' ? parsed.summary.trim() : '',
    actionItems: (parsed.actionItems || []).map((i) => i.text).filter((t) => t && t.trim()),
    followUps: (parsed.followUps || []).map((i) => i.text).filter((t) => t && t.trim()),
  });
};

export const config = { path: '/api/brainy' };
