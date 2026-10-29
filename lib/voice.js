// turning a voice note into text. tries, in order:
//   1. a speech-to-text tool already on this mac (whisper or mlx_whisper, if they installed one)
//   2. OpenAI's transcription api, if they saved an OpenAI key in settings > brain
// returns the text, or null if nothing is available (luna then says so instead of guessing).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const run = (cmd, args, env, ms = 180000) => new Promise((res) => execFile(cmd, args, { env, timeout: ms, maxBuffer: 8e6 }, (e, out) => res(e ? null : String(out))));
async function which(cmd, env) { const r = await run('/bin/sh', ['-c', `command -v ${cmd}`], env, 5000); return r && r.trim() ? r.trim() : null; }

async function localWhisper(file, env) {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'luna-voice-'));
  try {
    for (const cmd of ['mlx_whisper', 'whisper']) {
      const bin = await which(cmd, env); if (!bin) continue;
      await run(bin, [file, '--model', cmd === 'whisper' ? 'base' : 'mlx-community/whisper-base-mlx', '--output_format', 'txt', '--output_dir', out], env);
      const txt = fs.readdirSync(out).find((f) => f.endsWith('.txt'));
      if (txt) return fs.readFileSync(path.join(out, txt), 'utf8').trim() || null;
    }
    return null;
  } finally { fs.rmSync(out, { recursive: true, force: true }); }
}

async function openaiWhisper(file, key) {
  if (!key || typeof fetch !== 'function') return null;
  const form = new FormData();
  form.append('model', 'whisper-1');
  form.append('file', new Blob([fs.readFileSync(file)]), path.basename(file).replace(/\.\w+$/, '.ogg'));
  const r = await fetch('https://api.openai.com/v1/audio/transcriptions', { method: 'POST', headers: { authorization: `Bearer ${key}` }, body: form });
  if (!r.ok) return null;
  const j = await r.json().catch(() => ({}));
  return (j.text || '').trim() || null;
}

async function transcribe(file, { env = process.env, openaiKey = '' } = {}) {
  try { const t = await localWhisper(file, env); if (t) return t; } catch (_) {}
  try { return await openaiWhisper(file, openaiKey); } catch (_) { return null; }
}
module.exports = { transcribe };
