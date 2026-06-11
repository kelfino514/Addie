# Milestone 2 — Live Brain AI, keys server-side

This adds **real Claude** summarization/extraction and **audio upload** transcription to the
Brain panel, with the API keys held in **Netlify Functions** instead of the browser. This closes
the exposed-key risk from the original standalone Brainy (which shipped `VITE_*` keys in its bundle).

## What changed

- `netlify/functions/brainy.mjs` → `/api/brainy` — sends captured text to Claude (`claude-haiku-4-5`)
  and returns `{ summary, actionItems, followUps }`. Uses `ANTHROPIC_API_KEY`.
- `netlify/functions/transcribe.mjs` → `/api/transcribe` — sends uploaded audio to OpenAI Whisper
  and returns `{ text }`. Uses `OPENAI_API_KEY`.
- `index.html` — the Brain panel calls `/api/brainy` on "Summarize + extract" and falls back to the
  built-in local heuristic if the endpoint isn't reachable (so the single file still works offline).
  An "Upload audio" button posts to `/api/transcribe`.

## Deploy

This is no longer a single-file drag-drop deploy — Functions need the folder + config.

1. Push this folder to a Git repo and connect it to Netlify (or `netlify deploy` with the Netlify CLI).
2. In **Netlify → Site settings → Environment variables**, add:
   - `ANTHROPIC_API_KEY` (required for live summarization/extraction)
   - `OPENAI_API_KEY` (only needed for audio upload; live listen needs no key)
3. Deploy. `index.html` is served at the site root; `/api/brainy` and `/api/transcribe` run as functions.

## Graceful degradation

If the functions aren't deployed (e.g. opening `index.html` locally), the Brain panel automatically
falls back to the local heuristic extractor and shows audio-upload as unavailable. Nothing breaks.

## Notes / next

- Model is `claude-haiku-4-5` (matches the original Brainy, cheapest at $1/$5 per 1M tokens). Change the
  `CLAUDE_MODEL` constant in `brainy.mjs` to `claude-sonnet-4-6` or `claude-opus-4-8` for higher quality.
- Whisper upload goes through a synchronous function (~6 MB request cap) — fine for short clips. Larger
  files would need a background function or direct-to-storage upload.
- Milestone 3 (cross-device sync via Supabase) and Milestone 4 (automated imports) build on this.
