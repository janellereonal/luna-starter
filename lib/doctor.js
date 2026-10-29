// safety check-up: looks for the things that actually get personal agents in trouble
// (open network doors, readable login files, safety switched off, weak models, private files in git).
// read-only except fix(), which only tightens file permissions. used by: tray menu, settings, node scripts/doctor.js
const fs = require('fs');
const path = require('path');

const WEAK_MODELS = /haiku|llama|mistral|phi|gemma|qwen|tinyllama|local/i;
const mode = (f) => { try { return fs.statSync(f).mode & 0o777; } catch (_) { return null; } };
const exists = (f) => fs.existsSync(f);

// prefs: the app's settings object. runtime: { apiHost, sentinelHook } from the running app (optional)
function audit(root, prefs = {}, runtime = {}) {
  const out = [];
  const add = (level, title, detail, fix) => out.push({ level, title, detail, fix: fix || null });

  // 1. network: luna's doors must only open to this mac
  if (runtime.apiHost && runtime.apiHost !== '127.0.0.1') add('bad', 'Luna’s local door is open to the network', `It listens on ${runtime.apiHost}. It should be 127.0.0.1 (this Mac only).`);
  else add('ok', 'Only this Mac can talk to Luna', 'Her tool door and approval door listen on 127.0.0.1 and need a secret token.');

  // 2. secrets on disk
  const api = path.join(root, 'tools', '.luna-api.json');
  if (exists(api) && (mode(api) & 0o077)) add('warn', 'Luna’s tool token is readable by other users', 'tools/.luna-api.json should be private.', 'perms');
  const auth = path.join(root, '.whatsapp', 'auth');
  if (exists(auth) && (mode(auth) & 0o077)) add('warn', 'WhatsApp login files are readable by other users', 'The .whatsapp folder holds your linked-device login.', 'perms');
  else if (exists(auth)) add('ok', 'WhatsApp login is private', 'Only your user can read it. Unlink any time in Settings > Connections.');

  // 3. safety switches
  const until = Number(prefs.trustUntil || 0);
  if (until === -1) add('bad', 'Full trust mode is on, with no end time', 'Luna won’t ask before payments, deleting, posting or sharing. Turn it off from the 🦎 menu unless you really mean it.');
  else if (until > Date.now()) add('warn', 'Full trust mode is on for now', `Until ${new Date(until).toLocaleTimeString()}.`);
  else add('ok', 'Sentinel asks before risky actions', 'Payments, deleting, public posts, sharing files and bulk sends need your tap.');
  if (runtime.sentinelHook === false) add('bad', 'The safety checker isn’t hooked up', 'tools/sentinel-settings.json is missing. Restart Luna.');
  const sent = path.join(root, 'tools', 'sentinel.js');
  if (!exists(sent)) add('bad', 'The safety checker file is missing', 'tools/sentinel.js was removed. Reinstall Luna.');

  // 4. the brain: smarter models resist tricks hidden in emails and web pages much better
  const brain = prefs.provider === 'claude-code' || prefs.provider === 'anthropic' || !prefs.provider ? (prefs.model || 'sonnet') : `${prefs.provider} ${(prefs.providers || {})[prefs.provider]?.model || ''}`;
  if (WEAK_MODELS.test(brain) || prefs.provider === 'ollama') add('warn', `Her brain is a small model (${brain.trim()})`, 'Small models are easier to trick with instructions hidden in emails or websites. Use Sonnet or Opus for anything that can send or change things.');
  else add('ok', `Brain: ${brain.trim()}`, 'A strong model, harder to trick.');

  // 5. private files and git
  if (exists(path.join(root, '.git'))) {
    let gi = ''; try { gi = fs.readFileSync(path.join(root, '.gitignore'), 'utf8'); } catch (_) {}
    const missing = ['me/', '.whatsapp/', '.luna-prefs.json', 'browser-profile/'].filter((p) => !gi.includes(p));
    if (missing.length) add('bad', 'Private files could end up on GitHub', `This folder is a git repo and .gitignore doesn’t cover: ${missing.join(', ')}`);
    else add('ok', 'Private files stay out of git', 'me/, WhatsApp login, browser logins and settings are ignored.');
  }

  // 6. things that run on their own
  const routines = (prefs.routines || []).length;
  if (routines) add('info', `${routines} routine${routines > 1 ? 's' : ''} run on a schedule`, (prefs.routines || []).map((r) => `${r.title} (${r.when})`).join(', '));
  let skills = []; try { skills = fs.readdirSync(path.join(root, 'skills')).filter((n) => !n.startsWith('.')); } catch (_) {}
  if (skills.length) add('info', `${skills.length} skill${skills.length > 1 ? 's' : ''} Luna wrote for herself`, `In skills/: ${skills.join(', ')}. Scripts there still go through Sentinel.`);

  const score = out.filter((x) => x.level === 'bad').length ? 'needs attention' : out.filter((x) => x.level === 'warn').length ? 'mostly good' : 'all good';
  return { score, items: out };
}

// only tightens permissions; never deletes or changes anything else
function fix(root) {
  const done = [];
  const tighten = (f, m) => { if (exists(f) && (mode(f) & 0o077)) { try { fs.chmodSync(f, m); done.push(path.relative(root, f)); } catch (_) {} } };
  tighten(path.join(root, 'tools', '.luna-api.json'), 0o600);
  tighten(path.join(root, '.whatsapp'), 0o700);
  tighten(path.join(root, '.whatsapp', 'auth'), 0o700);
  try { for (const f of fs.readdirSync(path.join(root, '.whatsapp', 'auth'))) tighten(path.join(root, '.whatsapp', 'auth', f), 0o600); } catch (_) {}
  return done;
}

function report(r) {
  const icon = { ok: '✓', warn: '!', bad: '✗', info: '·' };
  return `safety check: ${r.score}\n` + r.items.map((i) => `${icon[i.level]} ${i.title}. ${i.detail}`).join('\n');
}
module.exports = { audit, fix, report, WEAK_MODELS };
