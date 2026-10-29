// connecting luna to everything the person already has, with no setup:
// - their Claude login (Claude Code) and the connectors on their Claude account (Claude Code brings those itself)
// - every local tool they added to the Claude desktop app (MCP servers + desktop extensions)
// - Claude Code's memory files on their Mac
// - a bridge back into the Claude app, so Claude can hand luna its memory (and anything else) with one sentence
// - their Claude data export (past chats), if they drop it in
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');

const HOME = os.homedir();
const CLAUDE_APP = path.join(HOME, 'Library', 'Application Support', 'Claude');
const DESKTOP_CONFIG = path.join(CLAUDE_APP, 'claude_desktop_config.json');
const run = (cmd, args, opts = {}) => new Promise((res) => execFile(cmd, args, { timeout: 60000, maxBuffer: 8e6, ...opts }, (e, out, err) => res({ ok: !e, out: String(out || ''), err: String(err || (e && e.message) || '') })));
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (_) { return null; } };
const safeName = (s) => String(s || 'tool').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'tool';

// ---------- 1. is Claude Code installed and signed in? ----------
async function claudeStatus(claudeBin, env) {
  if (!claudeBin) return { installed: false, loggedIn: false };
  const r = await run(claudeBin, ['auth', 'status', '--json'], { env });
  let j = null; try { j = JSON.parse(r.out.slice(r.out.indexOf('{'))); } catch (_) {}
  return { installed: true, loggedIn: Boolean(j && j.loggedIn), method: j && j.authMethod, configDir: (j && j.configDirectory) || path.join(HOME, '.claude'), projectsDir: (j && j.projectsDirectory) || path.join(HOME, '.claude', 'projects') };
}
// opens Terminal with the sign-in command (it opens their browser to log in to Claude)
function signIn() { return run('osascript', ['-e', 'tell application "Terminal" to activate', '-e', 'tell application "Terminal" to do script "claude auth login"']); }

// ---------- 2. every local tool from the Claude desktop app ----------
// reads claude_desktop_config.json (mcpServers) and installed desktop extensions (with their saved settings),
// and writes an MCP config luna's brain loads. secrets stay on this mac; nothing is copied anywhere else.
function importDesktopTools(outFile, skip = ['luna']) {
  const servers = {};
  const add = (name, server, from) => {
    let n = safeName(name); if (skip.includes(n) || n === 'browser') return;
    while (servers[n]) n += '-2';
    servers[n] = server; found.push({ name: n, from });
  };
  const found = [];
  const cfg = readJson(DESKTOP_CONFIG);
  for (const [name, s] of Object.entries((cfg && cfg.mcpServers) || {})) if (s && (s.command || s.url)) add(name, s, 'Claude app');
  const extDir = path.join(CLAUDE_APP, 'Claude Extensions'), setDir = path.join(CLAUDE_APP, 'Claude Extensions Settings');
  let dirs = []; try { dirs = fs.readdirSync(extDir); } catch (_) {}
  for (const id of dirs) {
    const dir = path.join(extDir, id), m = readJson(path.join(dir, 'manifest.json'));
    if (!m || !m.server || !m.server.mcp_config) continue;
    const settings = readJson(path.join(setDir, id + '.json')) || {};
    if (settings.isEnabled === false) continue;
    const user = { ...(settings.userConfig || {}) };
    for (const [k, v] of Object.entries(m.user_config || {})) if (user[k] === undefined && v && v.default !== undefined) user[k] = v.default;
    const fill = (s) => String(s).replace(/\$\{__dirname\}/g, dir).replace(/\$\{HOME\}/g, HOME).replace(/\$\{pathSeparator\}|\$\{\/\}/g, '/')
      .replace(/\$\{user_config\.([^}]+)\}/g, (_, k) => (user[k] === undefined ? '' : Array.isArray(user[k]) ? user[k].join(',') : String(user[k])));
    const c = m.server.mcp_config;
    const server = { command: fill(c.command || 'node') };
    if (c.args) server.args = c.args.map(fill);
    if (c.env) server.env = Object.fromEntries(Object.entries(c.env).map(([k, v]) => [k, fill(v)]));
    add(m.display_name || m.name || id, server, 'extension');
  }
  try { fs.writeFileSync(outFile, JSON.stringify({ mcpServers: servers }, null, 2), { mode: 0o600 }); } catch (_) {}
  return found;
}

// ---------- 3. Claude Code's own memory on this mac ----------
// ~/.claude/CLAUDE.md (their personal instructions) and Claude Code's auto-memory notes for each project
function readClaudeCodeMemory(configDir, projectsDir, skipDir) {
  const parts = [];
  const take = (file, label) => { try { const t = fs.readFileSync(file, 'utf8').trim(); if (t) parts.push(`## ${label}\n${t.slice(0, 12000)}`); } catch (_) {} };
  take(path.join(configDir || path.join(HOME, '.claude'), 'CLAUDE.md'), 'personal instructions (~/.claude/CLAUDE.md)');
  const skipKey = skipDir ? skipDir.replace(/[^a-zA-Z0-9]/g, '-') : null;
  let projects = []; try { projects = fs.readdirSync(projectsDir || path.join(HOME, '.claude', 'projects')); } catch (_) {}
  for (const p of projects) {
    if (skipKey && p === skipKey) continue;
    const mem = path.join(projectsDir, p, 'memory');
    let files = []; try { files = fs.readdirSync(mem).filter((f) => f.endsWith('.md')); } catch (_) { continue; }
    const project = p.replace(/^-/, '/').replace(/-/g, '/').split('/').filter(Boolean).slice(-2).join('/');
    for (const f of files.slice(0, 20)) take(path.join(mem, f), `notes from project ${project} (${f})`);
  }
  return parts.join('\n\n').slice(0, 60000);
}
// writes me/from-claude-code.md when it changed; returns how much it found
function syncClaudeCodeMemory(root, status) {
  const text = readClaudeCodeMemory(status.configDir, status.projectsDir, root);
  const out = path.join(root, 'me', 'from-claude-code.md');
  if (!text) return { chars: 0 };
  const body = `# what Claude Code knows (synced automatically from this mac, don't edit)\n\n${text}\n`;
  let old = ''; try { old = fs.readFileSync(out, 'utf8'); } catch (_) {}
  if (old !== body) { fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, body); }
  return { chars: text.length };
}

// ---------- 4. bridge into the Claude app ----------
// adds luna's tools to the Claude desktop app, so in any Claude chat they can say
// "save everything you remember about me to luna" (or "remind me every morning through luna").
function bridgeInstalled(root) { const c = readJson(DESKTOP_CONFIG); return Boolean(c && c.mcpServers && c.mcpServers.luna && JSON.stringify(c.mcpServers.luna).includes(root)); }
function installBridge(root, nodeCmd) {
  fs.mkdirSync(CLAUDE_APP, { recursive: true });
  let raw = '{}'; try { raw = fs.readFileSync(DESKTOP_CONFIG, 'utf8'); } catch (_) {}
  let c; try { c = JSON.parse(raw || '{}'); } catch (_) { throw new Error("couldn't read the Claude app's settings file, so I left it alone"); }
  if (raw && raw !== '{}') fs.writeFileSync(DESKTOP_CONFIG + '.before-luna', raw); // backup
  c.mcpServers = c.mcpServers || {};
  c.mcpServers.luna = { command: nodeCmd.command, args: [path.join(root, 'tools', 'luna-mcp.js')], env: { ...(nodeCmd.env || {}) } };
  fs.writeFileSync(DESKTOP_CONFIG, JSON.stringify(c, null, 2));
  return true;
}
function removeBridge() {
  const c = readJson(DESKTOP_CONFIG); if (!c || !c.mcpServers || !c.mcpServers.luna) return false;
  delete c.mcpServers.luna; fs.writeFileSync(DESKTOP_CONFIG, JSON.stringify(c, null, 2)); return true;
}

// ---------- 5. the one-tap "copy from Claude" prompt ----------
const MEMORY_MARK = 'MY CLAUDE MEMORY FOR LUNA';
const MEMORY_PROMPT = `Please write out everything you remember about me, verbatim and complete: your saved memories, plus anything durable from our past chats (who I am, work, school, projects, people, routines, goals, preferences, how I like you to respond). Start your reply with the exact line "${MEMORY_MARK}" and put everything in one plain-text list after it. Then I'll copy it to my assistant Luna.`;
const memoryPromptUrl = () => 'https://claude.ai/new?q=' + encodeURIComponent(MEMORY_PROMPT);

// ---------- 6. their Claude data export (zip from Claude settings > privacy > export data) ----------
async function unpackExport(zipFile, destDir) {
  fs.rmSync(destDir, { recursive: true, force: true }); fs.mkdirSync(destDir, { recursive: true });
  let r = await run('ditto', ['-x', '-k', zipFile, destDir]);
  if (!r.ok) r = await run('unzip', ['-o', '-q', zipFile, '-d', destDir]);
  if (!r.ok) throw new Error("couldn't open that zip: " + r.err.slice(0, 200));
  const files = [];
  const walk = (d, depth = 0) => { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); const st = fs.statSync(p); if (st.isDirectory() && depth < 3) walk(p, depth + 1); else if (/\.json$/i.test(f)) files.push({ path: p, name: f, size: st.size }); } };
  walk(destDir);
  if (!files.some((f) => /conversations|memor|projects|users/i.test(f.name))) throw new Error("that doesn't look like a Claude data export (no conversations.json inside)");
  return files;
}

const hash = (s) => crypto.createHash('sha1').update(String(s)).digest('hex').slice(0, 12);
module.exports = { claudeStatus, signIn, importDesktopTools, readClaudeCodeMemory, syncClaudeCodeMemory, bridgeInstalled, installBridge, removeBridge, MEMORY_MARK, MEMORY_PROMPT, memoryPromptUrl, unpackExport, DESKTOP_CONFIG, hash };
