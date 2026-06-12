// Netlify Function — server-side Claude extraction for the Brain panel.
// The Anthropic API key lives ONLY here (Netlify env var), never in the browser.
// Mirrors the original Brainy analyze.js prompt + schema, called via raw HTTP.

const CLAUDE_MODEL = 'claude-haiku-4-5'; // matches the original Brainy; bump to claude-sonnet-4-6 / claude-opus-4-8 for higher quality

const SYSTEM_PROMPT = `You are the processing engine inside Brainy, a personal AI note taker used by a healthcare field sales professional. They sell and support hemodynamic monitoring products from Edwards Lifesciences and Becton Dickinson (BD), and spend their days in hospitals working with physicians, KOLs, and clinical staff.

You receive raw text: either a transcribed voice note or a pasted meeting recap (often a Microsoft Teams Copilot recap). Extract structured information from it.

Definitions:
- actionItems: tasks the USER must personally complete.
- followUps: things waiting on someone ELSE, or to check back on.
- Never put the same task in both lists, and do not mirror an action as a follow-up: if an actionItem and a followUp describe the SAME underlying thing (same deliverable, person, or meeting), keep only ONE — prefer the actionItem. When unsure which list, pick one, never both.
- Only extract what the text actually supports — do not invent tasks. Empty arrays are fine.

Phrasing (CRITICAL — keep every item SHORT): write each item as terse shorthand, a fragment someone thumb-types into a to-do list, NEVER a sentence. Hard rules:
- Aim for 3-5 words; 6 is the absolute max. If it reads like a sentence, cut it down.
- Drop articles (a/an/the), pronouns (I/we/you), and filler verb phrases (need to, make sure to, follow up to, going to, should, want to, remember to).
- Start with the key noun or a single action verb — no preamble or explanatory clauses ("so that…", "in order to…", "regarding…", "to discuss…").
- KEEP names, accounts, products, dates, and numbers exactly as given.
Rewrite long → terse (this is the level of compression expected):
- "I need to send the updated hemodynamic pricing sheet over to Dr. Bailey" → "Pricing sheet to Dr. Bailey"
- "Make sure to confirm the headcount and timing for the OR breakfast on June 4th" → "Confirm OR breakfast 6/4"
- "We should prepare talking points for the INVOS contract renewal before the Rady visit" → "Prep INVOS renewal points"
- "Schedule the super user training class for the new staff" → "Schedule super user class"
- followUps: "Follow up with Patrick to get Tableau access" → "Tableau access from Patrick"; "Check back on trial dates from the Mercy OR team" → "Trial dates from Mercy OR".

Consolidation rules (critical):
- Merge closely related or redundant tasks into one. Prefer broader phrasing that covers the intent.
- Aim for the fewest items that cover all distinct commitments — quality over quantity.

Ordering rules:
- Group related items next to each other: cluster by account/site, person, or topic so related to-dos sit together (e.g. keep all "Dr. Bailey" items in a row, all "Rady" items in a row).
- Within a group put prerequisites first; otherwise order actionItems by execution order, and followUps by how soon to check back.

Also produce:
- summary: a 1-2 sentence summary of the note.`;

const ITEM_SCHEMA = {
  type: 'object',
  properties: { text: { type: 'string', description: 'Terse shorthand note, 3-5 words (6 max), never a sentence. E.g. "Pricing sheet to Dr. Bailey", "Confirm OR breakfast 6/4".' } },
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
