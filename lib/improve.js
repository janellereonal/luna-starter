// luna changing her own code, safely. this is the "agentic engineering" loop:
//   1. snapshot every code file (so any change can be undone in one tap)
//   2. an engineering session makes the change, following HOW-I-WORK.md
//   3. the app (not the ai) re-runs the local checks in a separate process
//   4. the safety files must be byte-for-byte unchanged
//   5. pass -> keep it and offer a restart; fail -> put everything back automatically
// this file is guarded: a self-improvement can't edit it (see GUARDED).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SNAPS = '.luna-snapshots';
// files that hold the safety rules and the checks themselves. a self-change that touches them is rolled back.
const GUARDED = ['tools/sentinel.js', 'lib/rules.js', 'lib/improve.js', 'scripts/check.js'];
// never part of "code": personal data, logins, downloads, generated files
const SKIP_DIRS = new Set(['me', 'node_modules', '.whatsapp', 'browser-profile', 'characters', 'outputs', SNAPS, '.git', 'skills', '.claude']);
const SKIP_FILES = /^(\.luna-prefs\.json|\.mcp\.json|luna\.log|package-lock\.json)$|^tools\/(\.|desktop-mcp\.json|browser-mcp\.json|sentinel-settings\.json|screen\.png)|\.v\d+\.(js|html)$/; // last part: old backup copies from manual updates
const CODE_EXT = /\.(js|html|css|md|json|sh|applescript|command)$/;

function codeFiles(root) {
  const out = [];
  const walk = (rel) => {
    let names = []; try { names = fs.readdirSync(path.join(root, rel)); } catch (_) { return; }
    for (const n of names) {
      const r = rel ? `${rel}/${n}` : n;
      let st; try { st = fs.lstatSync(path.join(root, r)); } catch (_) { continue; }
      if (st.isSymbolicLink()) continue;
      if (st.isDirectory()) { if (!SKIP_DIRS.has(n) && rel.split('/').length < 4) walk(r); continue; }
      if (CODE_EXT.test(n) && !SKIP_FILES.test(r) && st.size < 5e6) out.push(r);
    }
  };
  walk('');
  return out.sort();
}
const hash = (f) => { try { return crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex'); } catch (_) { return 'missing'; } };
const guardHashes = (root) => Object.fromEntries(GUARDED.map((g) => [g, hash(path.join(root, g))]));

let seq = 0;
function stamp(d = new Date()) { const p = (x) => String(x).padStart(2, '0'); return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`; }

// copies every code file into .luna-snapshots/<stamp>/ and remembers which files existed
function snapshot(root, title = '') {
  let id = stamp(), n = 2;
  while (fs.existsSync(path.join(root, SNAPS, id))) id = `${stamp()}-${n++}`;
  const dir = path.join(root, SNAPS, id);
  const files = codeFiles(root);
  for (const f of files) { const to = path.join(dir, f); fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(path.join(root, f), to); }
  fs.writeFileSync(path.join(dir, '.snapshot.json'), JSON.stringify({ id, title, at: new Date().toISOString(), seq: ++seq, files, guards: guardHashes(root) }));
  prune(root, 5);
  return id;
}
function readSnap(root, id) { return JSON.parse(fs.readFileSync(path.join(root, SNAPS, id, '.snapshot.json'), 'utf8')); }
function listSnapshots(root) {
  let ids = []; try { ids = fs.readdirSync(path.join(root, SNAPS)).filter((x) => /^\d{8}-\d{6}(-\d+)?$/.test(x)); } catch (_) {}
  // oldest first, by when they were taken (ids can repeat after old ones are pruned)
  return ids.map((id) => { try { return readSnap(root, id); } catch (_) { return null; } }).filter(Boolean).sort((a, b) => (a.at === b.at ? (a.seq || 0) - (b.seq || 0) : a.at < b.at ? -1 : 1));
}
function prune(root, keep) {
  const ids = listSnapshots(root).map((s) => s.id);
  for (const id of ids.slice(0, Math.max(0, ids.length - keep))) fs.rmSync(path.join(root, SNAPS, id), { recursive: true, force: true });
}

// puts the code back exactly as it was: changed files restored, files added since then removed
function restore(root, id) {
  const meta = readSnap(root, id), dir = path.join(root, SNAPS, id);
  const before = new Set(meta.files);
  for (const f of codeFiles(root)) if (!before.has(f)) fs.rmSync(path.join(root, f), { force: true });
  for (const f of meta.files) { const to = path.join(root, f); fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(path.join(dir, f), to); }
  return meta;
}

// what changed since a snapshot: [{ file, kind: 'added'|'changed'|'removed', plus, minus }]
function changes(root, id) {
  const meta = readSnap(root, id), dir = path.join(root, SNAPS, id);
  const now = codeFiles(root), before = new Set(meta.files), out = [];
  const lines = (f) => { try { return fs.readFileSync(f, 'utf8').split('\n'); } catch (_) { return []; } };
  const count = (a, b) => { // rough +/- line counts (multiset difference), good enough for a summary
    const m = new Map(); for (const l of a) m.set(l, (m.get(l) || 0) + 1);
    let plus = 0; for (const l of b) { const c = m.get(l) || 0; if (c) m.set(l, c - 1); else plus++; }
    let minus = 0; for (const c of m.values()) minus += c;
    return { plus, minus };
  };
  for (const f of now) {
    if (!before.has(f)) out.push({ file: f, kind: 'added', plus: lines(path.join(root, f)).length, minus: 0 });
    else if (hash(path.join(root, f)) !== hash(path.join(dir, f))) out.push({ file: f, kind: 'changed', ...count(lines(path.join(dir, f)), lines(path.join(root, f))) });
  }
  for (const f of meta.files) if (!now.includes(f)) out.push({ file: f, kind: 'removed', plus: 0, minus: lines(path.join(dir, f)).length });
  return out;
}
function guardsIntact(root, id) {
  const was = readSnap(root, id).guards, now = guardHashes(root);
  const broken = GUARDED.filter((g) => was[g] !== now[g]);
  return { ok: broken.length === 0, broken };
}

// the engineering brief for the session that makes the change
function brief({ title, details, who = 'the user', name = 'luna' }) {
  return `You are ${name}, improving your own app (an Electron app in this folder) because ${who} asked for this:
"${title}"
Details: ${details}

Work like a careful senior engineer (agentic engineering, not vibe coding):
1. Understand the intent first. Read HOW-I-WORK.md (your map of your own code), then the files you'll touch. Read more code instead of guessing.
2. Make the smallest change that fully does it, in the style of the code around it. Keep names obvious so a future session can find things. Put pure logic in lib/ so it can be tested.
3. Add or update a test in test/ for any logic you add (see test/*.test.js for the tiny test style).
4. Run: node scripts/check.js   Fix everything until it passes. Don't skip or weaken checks.
5. Now that it's built, ask yourself: "what would I refactor?" Do small, safe cleanups only if they clearly help, then run the checks again.
6. Update HOW-I-WORK.md if you added a file, a feature, or changed how something works.
Rules:
- Don't touch: ${GUARDED.join(', ')}, me/, .whatsapp/, characters/, or anything outside this folder. Those are rolled back automatically.
- No new npm packages, no network installs. Plain Node/Electron only.
- Never weaken safety: approvals (Sentinel), what needs a yes, privacy of me/, the token-protected local api.
- If the request is risky, unclear, or would need a big rewrite, do the safe part and explain the rest.
When done, reply in 2-4 short casual lines for ${who}: what you changed, how to try it, anything you didn't do. No em dashes.`;
}

module.exports = { SNAPS, GUARDED, codeFiles, snapshot, listSnapshots, restore, changes, guardsIntact, brief, hash };
