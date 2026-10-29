// Luna: a personal AI agent that lives on your Mac desktop as a little character.
// Brain: Claude Code (your Claude login or an Anthropic API key) or any OpenAI-compatible model (lib/agent.js).
const { app, BrowserWindow, ipcMain, screen, Menu, Tray, powerMonitor, globalShortcut, shell, safeStorage, dialog, nativeTheme, clipboard } = require('electron');
const connect = require('./lib/connect');
const { makeAgent, listModels, PROVIDERS } = require('./lib/agent');
const { createWA } = require('./lib/wa');
const crypto = require('crypto');
const http = require('http');
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

let win = null;
let tray = null;
let hideTimer = null;
let sessionId = null;
let claudeBin = null;
let shellPath = process.env.PATH || '';

// find the `claude` CLI and the PATH your terminal uses (nvm, homebrew, etc.)
function findClaude() {
  try {
    const out = execFileSync('/bin/zsh', ['-ilc', 'echo "__PATH__$PATH"; command -v claude'], { encoding: 'utf8', timeout: 15000 });
    const lines = out.split('\n').map((l) => l.trim()).filter(Boolean);
    const p = lines.find((l) => l.startsWith('__PATH__'));
    if (p) shellPath = p.slice(8);
    const c = lines.reverse().find((l) => l.startsWith('/') && l.endsWith('claude'));
    if (c) return c;
  } catch (_) {}
  const home = os.homedir();
  for (const c of [path.join(home, '.claude/local/claude'), path.join(home, '.local/bin/claude'), '/opt/homebrew/bin/claude', '/usr/local/bin/claude']) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

function createWindow() {
  const wa = screen.getPrimaryDisplay().workArea;
  win = new BrowserWindow({
    x: wa.x, y: wa.y, width: wa.width, height: wa.height, // full screen, clicks pass through except on luna
    transparent: true, frame: false, resizable: false, movable: false, hasShadow: false,
    alwaysOnTop: true, skipTaskbar: true, fullscreenable: false, backgroundColor: '#00000000',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false }
  });
  win.setAlwaysOnTop(true, 'floating');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.setIgnoreMouseEvents(true, { forward: true });
  win.loadFile('index.html');
  win.webContents.on('did-finish-load', () => { send('roam', prefs.roam); send('voice', prefs.autoSpeak); send('config', publicConfig()); send('character', characterInfo()); });
  screen.on('display-metrics-changed', () => {
    const w = screen.getPrimaryDisplay().workArea;
    win.setBounds({ x: w.x, y: w.y, width: w.width, height: w.height });
  });
}

ipcMain.on('interactive', (e, on) => { if (win && e.sender === win.webContents) win.setIgnoreMouseEvents(!on, { forward: true }); });
ipcMain.on('focus', (e) => { const w = BrowserWindow.fromWebContents(e.sender); if (w) { app.focus({ steal: true }); w.focus(); } });
// green button: the chat takes the whole screen (menu bar and dock hide, like a real full-screen app)
let isFull = false;
function setFullScreen(on) {
  if (!win || on === isFull) return;
  isFull = on;
  const d = screen.getDisplayMatching(win.getBounds());
  if (on) {
    win.setResizable(true);
    if (process.platform === 'darwin') win.setSimpleFullScreen(true); else win.setBounds(d.bounds);
    win.setIgnoreMouseEvents(false);
    app.focus({ steal: true }); win.focus();
  } else {
    if (process.platform === 'darwin') win.setSimpleFullScreen(false);
    win.setBounds(d.workArea); win.setResizable(false);
  }
}
ipcMain.on('fullscreen', (_e, on) => setFullScreen(Boolean(on)));
// ---------- show / hide / quit ----------
function showLuna() { clearTimeout(hideTimer); if (win) win.showInactive(); refreshTray(); }
function hideLuna(ms) {
  if (!win) return;
  setFullScreen(false);
  win.hide();
  clearTimeout(hideTimer);
  if (ms) hideTimer = setTimeout(showLuna, ms);
  refreshTray();
}

// open at login: a LaunchAgent that starts this folder with this electron
// (keeps using an existing *.luna.plist from an older install)
const AGENT = (() => { const d = path.join(os.homedir(), 'Library/LaunchAgents'); try { const f = fs.readdirSync(d).find((x) => /\.luna\.plist$/.test(x)); if (f) return path.join(d, f); } catch (_) {} return path.join(d, 'app.desktop.luna.plist'); })();
function loginOn() { return fs.existsSync(AGENT); }
function setLogin(on) {
  try {
    if (on) {
      const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${path.basename(AGENT, '.plist')}</string>
<key>ProgramArguments</key><array><string>${process.execPath}</string><string>${__dirname}</string></array>
<key>RunAtLoad</key><true/>
</dict></plist>
`;
      fs.mkdirSync(path.dirname(AGENT), { recursive: true });
      fs.writeFileSync(AGENT, plist);
    } else if (fs.existsSync(AGENT)) fs.unlinkSync(AGENT);
  } catch (_) {}
  refreshTray();
}

// a Luna app in ~/Applications so she shows up in Spotlight / Launchpad
function makeAppShortcut() {
  const dest = path.join(os.homedir(), 'Applications/Luna.app');
  if (fs.existsSync(dest)) return;
  try {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const cmd = `"${process.execPath}" "${__dirname}" > /dev/null 2>&1 &`;
    execFileSync('/usr/bin/osacompile', ['-o', dest, '-e', `do shell script ${JSON.stringify(cmd)}`]);
  } catch (_) {}
}

function menuTemplate() {
  const visible = win && win.isVisible();
  return [
    { label: 'settings…', accelerator: 'Cmd+,', click: () => openSettings() },
    { type: 'separator' },
    visible ? { label: 'hide luna', click: () => hideLuna() } : { label: 'show luna', click: showLuna },
    { label: 'hide for 1 hour', enabled: Boolean(visible), click: () => hideLuna(60 * 60 * 1000) },
    { label: 'walks on the floor', type: 'radio', checked: prefs.roam === 'floor', click: () => setRoam('floor') },
    { label: 'climbs the screen', type: 'radio', checked: prefs.roam === 'wall', click: () => setRoam('wall') },
    { label: 'does both', type: 'radio', checked: prefs.roam === 'both', click: () => setRoam('both') },
    { type: 'separator' },
    { label: 'read every reply out loud', type: 'checkbox', checked: prefs.autoSpeak, click: (mi) => { prefs.autoSpeak = mi.checked; savePrefs(); send('voice', prefs.autoSpeak); } },
    { label: 'call luna: option + space', enabled: false },
    watch ? { label: `stop auto-replying to ${watch.contact}`, click: stopWatch } : { label: 'auto-reply: off', enabled: false },
    { label: `jobs running: ${jobs.size}`, submenu: jobs.size ? [...jobs.entries()].map(([id, j]) => ({ label: `stop "${j.title}"`, click: () => stopJob(id) })) : [{ label: 'none right now', enabled: false }] },
    { label: `routines: ${(prefs.routines || []).length}`, submenu: (prefs.routines || []).length ? prefs.routines.map((r) => ({ label: `remove "${r.title}" (${r.when})`, click: () => removeRoutine(r.title) })) : [{ label: 'none yet. ask luna to set one up', enabled: false }] },
    { label: "open luna's work folder", click: () => { try { fs.mkdirSync(OUTPUTS, { recursive: true }); } catch (_) {} shell.openPath(OUTPUTS); } },
    { label: 'open activity log', click: () => { const f = path.join(__dirname, 'me', 'activity.md'); if (!fs.existsSync(f)) fs.writeFileSync(f, '# everything luna did\n'); shell.openPath(f); } },
    { type: 'separator' },
    { label: isTrusted() ? (prefs.trustUntil === -1 ? '⚡ full trust: always' : '⚡ full trust: on for now') : '🛡️ safety checks: on', submenu: [
      { label: 'ask me before risky stuff (recommended)', type: 'radio', checked: !isTrusted(), click: () => setTrust(0) },
      { label: 'skip approvals for 1 hour', type: 'radio', checked: isTrusted() && prefs.trustUntil !== -1, click: () => setTrust(Date.now() + 3600000) },
      { label: 'skip approvals always (full trust)', type: 'radio', checked: prefs.trustUntil === -1, click: () => setTrust(-1) }
    ] },
    { label: 'proactive check-ins', type: 'checkbox', checked: prefs.proactive, click: (m) => { prefs.proactive = m.checked; savePrefs(); refreshTray(); } },
    { label: 'check in every', submenu: [15, 30, 60].map((n) => ({ label: n + ' min', type: 'radio', checked: prefs.pulseMin === n, click: () => { prefs.pulseMin = n; savePrefs(); } })) },
    { label: 'check in now', click: () => pulse(true) },
    { label: 'sync memory with claude now', click: brainSync },
    { type: 'separator' },
    { label: 'new chat', click: () => { stopBrain(); sessionId = null; startBrain(); } },
    { label: 'quick brain (fastest)', type: 'radio', checked: prefs.model === 'haiku', click: () => setModel('haiku') },
    { label: 'smart brain (default)', type: 'radio', checked: prefs.model === 'sonnet', click: () => setModel('sonnet') },
    { label: 'genius brain (slowest, uses more of your plan)', type: 'radio', checked: prefs.model === 'opus', click: () => setModel('opus') },
    { label: 'refresh connected apps', click: discoverServers },
    { type: 'separator' },
    { label: 'start luna when i log in', type: 'checkbox', checked: loginOn(), click: (m) => setLogin(m.checked) },
    { type: 'separator' },
    { label: 'quit luna', click: () => app.quit() }
  ];
}
function refreshTray() { if (tray) tray.setContextMenu(Menu.buildFromTemplate(menuTemplate())); }

ipcMain.on('hide', () => hideLuna());
ipcMain.on('menu', () => { Menu.buildFromTemplate(menuTemplate()).popup({ window: win }); });
// ---------- the brain: one warm Claude Code session that streams replies ----------
// keeping a single `claude -p` process alive skips the startup cost on every message,
// and streaming shows words as they come in.
const PREFS = path.join(__dirname, '.luna-prefs.json');
let prefs = { model: 'sonnet', servers: null, roam: 'both', proactive: true, pulseMin: 30, recent: [], routinesDone: {}, syncedChars: 0, autoSpeak: false, routines: [], trustUntil: 0,
  provider: 'claude-code', providers: {}, secrets: {}, userName: '', charName: 'luna', charIcon: '🦎', character: { type: 'gecko' }, charScale: 1,
  quietFrom: 22, quietTo: 4, reminders: null, hotkey: 'Alt+Space', onboarded: false,
  theme: { mode: 'system', style: 'luna', accent: '#3E7B4F', bubble: '#F6D77A', font: 'default', size: 'normal' }, work: '', personalPrefs: '',
  effort: 'low', waNotify: 'direct', bgBrowser: false };
try { prefs = { ...prefs, ...JSON.parse(fs.readFileSync(PREFS, 'utf8')) }; } catch (_) {}
const savePrefs = () => { try { fs.writeFileSync(PREFS, JSON.stringify(prefs)); } catch (_) {} };
// default daily reminders (editable in settings)
if (!Array.isArray(prefs.reminders)) { prefs.reminders = [{ at: '12:30', text: 'lunch break? 🍱' }, { at: '21:30', text: 'wind down soon 💤' }]; savePrefs(); }
const isClaude = () => prefs.provider === 'claude-code' || prefs.provider === 'anthropic';
const who = () => prefs.userName || 'the user';
const charName = () => prefs.charName || 'luna';

// api keys are encrypted with the mac keychain (electron safeStorage), never stored as plain text
function setSecret(name, value) {
  prefs.secrets = prefs.secrets || {};
  if (!value) delete prefs.secrets[name];
  else prefs.secrets[name] = safeStorage.isEncryptionAvailable() ? 'enc:' + safeStorage.encryptString(value).toString('base64') : 'raw:' + value;
  savePrefs();
}
function getSecret(name) {
  const v = (prefs.secrets || {})[name];
  if (!v) return '';
  try { return v.startsWith('enc:') ? safeStorage.decryptString(Buffer.from(v.slice(4), 'base64')) : v.slice(4); } catch (_) { return ''; }
}

let brain = null, buf = '', pending = null, turnTimer = null;

// her connected apps (Gmail, Calendar, Drive, Notion, Slack, n8n...) come from her Claude account.
// we find their names once, then let luna use them. luna still asks before sending or changing anything (see CLAUDE.md).
const SKIP_SERVERS = /remote-devices/i; // claude-in-chrome stays: it's how she reaches Messenger, WhatsApp Web and any site
function allowedTools() {
  const base = ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'WebSearch', 'WebFetch', 'mcp__luna', 'mcp__canvas', 'mcp__browser',
    'Bash(osascript tools/send-whatsapp.applescript:*)', 'Bash(osascript tools/mac.applescript:*)',
    'Bash(tools/look.sh)', 'Bash(tools/wa-recent.sh:*)', 'Bash(open -a:*)', 'Bash(open https://:*)', 'Bash(open http://:*)'];
  for (const sv of prefs.servers || []) base.push('mcp__' + sv);
  for (const t of prefs.desktopTools || []) base.push('mcp__' + t.name);
  return [...new Set(base)].join(',');
}
// luna's own browser (separate from your chrome, remembers her logins in browser-profile/)
function mcpConfigs() {
  const files = [];
  const canvas = path.join(__dirname, '.mcp.json');
  if (fs.existsSync(canvas)) files.push(canvas);
  // every local tool from their Claude desktop app (imported at launch)
  const desk = path.join(__dirname, 'tools', 'desktop-mcp.json');
  try { if (Object.keys(JSON.parse(fs.readFileSync(desk, 'utf8')).mcpServers || {}).length) files.push(desk); } catch (_) {}
  const bf = path.join(__dirname, 'tools', 'browser-mcp.json');
  try {
    // her browser can work hidden in the background (settings > connections); turn it off to log in to a site once
    const bargs = ['-y', '@playwright/mcp@0.0.83', '--browser', 'chrome', '--user-data-dir', path.join(__dirname, 'browser-profile')];
    if (prefs.bgBrowser) bargs.push('--headless');
    fs.writeFileSync(bf, JSON.stringify({ mcpServers: {
      browser: { command: 'npx', args: bargs },
      // luna's own background tools: whatsapp, imessage, email with attachments, contacts, finding files
      luna: { command: process.execPath, args: [path.join(__dirname, 'tools', 'luna-mcp.js')], env: { ELECTRON_RUN_AS_NODE: '1' } }
    } }, null, 2));
    files.push(bf);
  } catch (_) {}
  const out = files.length ? ['--mcp-config', ...files] : [];
  return out.concat(sentinelArgs(), trustArgs());
}
const LOCKED = ['Write(./tools/**)', 'Edit(./tools/**)', 'Write(./main.js)', 'Edit(./main.js)', 'Write(./CLAUDE.md)', 'Edit(./CLAUDE.md)', 'Write(./me/activity.md)', 'Edit(./me/activity.md)'].join(',');
// ---------- sentinel: fixed safety rules + approve/deny cards + activity log ----------
// full trust mode: skips approval cards (still logged) and lets luna use any tool, including any terminal command
const isTrusted = () => prefs.trustUntil === -1 || Date.now() < prefs.trustUntil;
function setTrust(until) {
  prefs.trustUntil = until; savePrefs();
  try { fs.writeFileSync(path.join(__dirname, 'tools', '.sentinel-trust'), String(until)); } catch (_) {}
  refreshTray();
  send('nudge', { text: until === 0 ? 'safety checks back on 🛡️' : until === -1 ? 'full trust mode on. i won’t ask before anything, but i’ll still log it all' : 'full trust mode on for 1 hour', actions: [] });
}
function trustArgs() { return isTrusted() ? ['--permission-mode', 'bypassPermissions'] : []; }
function sentinelArgs() {
  const f = path.join(__dirname, 'tools', 'sentinel-settings.json');
  const cmd = `node "${path.join(__dirname, 'tools', 'sentinel.js')}"`;
  try { fs.writeFileSync(f, JSON.stringify({ hooks: { PreToolUse: [{ matcher: '', hooks: [{ type: 'command', command: cmd, timeout: 150 }] }], PostToolUse: [{ matcher: '', hooks: [{ type: 'command', command: cmd }] }] } }, null, 2)); } catch (_) {}
  return ['--settings', f];
}
const approvals = new Map(); let approvalSeq = 0;
const sentinelServer = http.createServer((req, res) => {
  if (req.method !== 'POST' || req.url !== '/approve') { res.writeHead(404); res.end(); return; }
  let b = ''; req.on('data', (c) => { b += c; });
  req.on('end', () => {
    let j = {}; try { j = JSON.parse(b); } catch (_) {}
    const id = ++approvalSeq;
    const done = (ok) => { if (!approvals.has(id)) return; approvals.delete(id); clearTimeout(t); res.end(JSON.stringify({ ok })); };
    const t = setTimeout(() => done(false), 120000);
    approvals.set(id, done);
    if (win && !win.isVisible()) showLuna();
    send('approval', { id, summary: j.summary || 'an action', why: j.why || 'needs your ok' });
  });
});
sentinelServer.listen(0, '127.0.0.1', () => { try { fs.writeFileSync(path.join(__dirname, 'tools', '.sentinel-port'), String(sentinelServer.address().port)); } catch (_) {} });
ipcMain.on('approve', (_e, id, ok) => { const f = approvals.get(id); if (f) f(Boolean(ok)); });

function baseEnv() {
  const env = { ...process.env, PATH: shellPath };
  delete env.ANTHROPIC_API_KEY; // claude-code mode: always your claude login
  if (prefs.provider === 'anthropic' && getSecret('anthropic')) env.ANTHROPIC_API_KEY = getSecret('anthropic');
  return env;
}
function discoverServers() {
  if (!claudeBin) claudeBin = findClaude();
  if (!claudeBin) return;
  const args = ['-p', 'reply with just: ok', '--output-format', 'stream-json', '--verbose', '--model', 'haiku', '--no-session-persistence', '--max-turns', '1', '--chrome'];
  args.push(...mcpConfigs());
  const child = spawn(claudeBin, args, { cwd: __dirname, env: baseEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
  let b = '';
  const done = setTimeout(() => child.kill(), 60000);
  child.stdout.on('data', (d) => {
    b += d;
    let i;
    while ((i = b.indexOf('\n')) >= 0) {
      const line = b.slice(0, i); b = b.slice(i + 1);
      let j; try { j = JSON.parse(line); } catch (_) { continue; }
      if (j.type === 'system' && j.subtype === 'init' && Array.isArray(j.tools)) {
        const found = [...new Set(j.tools.filter((t) => t.startsWith('mcp__')).map((t) => t.split('__')[1]))].filter((n) => !SKIP_SERVERS.test(n)).sort();
        clearTimeout(done); child.kill();
        if (JSON.stringify(found) !== JSON.stringify(prefs.servers)) {
          prefs.servers = found; savePrefs();
          if (!pending) { stopBrain(); startBrain(); } else restartAfterTurn = true;
        }
        return;
      }
    }
  });
  child.stderr.on('data', () => {});
}
let restartAfterTurn = false;

// each message runs one `claude -p` turn that resumes the same conversation (the same way your terminal test worked)
function startBrain() { return null; } // kept so older calls still work; nothing to warm up
function stopBrain() { if (agentAbort) { agentAbort.abort(); agentAbort = null; } if (brain) { const b = brain; brain = null; try { b.kill(); } catch (_) {} } }

function onLine(line) {
  let j;
  try { j = JSON.parse(line); } catch (_) { return; }
  if (j.session_id) sessionId = j.session_id;
  // whenever her session starts, pick up any newly connected apps
  if (j.type === 'system' && j.subtype === 'init' && Array.isArray(j.tools)) {
    const found = [...new Set(j.tools.filter((t) => t.startsWith('mcp__')).map((t) => t.split('__')[1]))].filter((n) => !SKIP_SERVERS.test(n)).sort();
    if (JSON.stringify(found) !== JSON.stringify(prefs.servers)) { prefs.servers = found; savePrefs(); }
  }
  if (!pending) return;
  if (j.type === 'stream_event') {
    const e = j.event;
    if (e && e.type === 'content_block_delta' && e.delta && e.delta.type === 'text_delta') {
      if (pending.sawTool) { pending.sawTool = false; send('delta', '\n\n'); pending.acc += '\n\n'; }
      send('delta', e.delta.text); pending.acc += e.delta.text;
    }
    if (e && e.type === 'content_block_start' && e.content_block && e.content_block.type === 'tool_use') { pending.sawTool = true; send('status', 'checking...'); }
  } else if (j.type === 'assistant' && j.message && Array.isArray(j.message.content)) {
    const t = j.message.content.filter((c) => c.type === 'text').map((c) => c.text).join('');
    if (t) pending.lastText = t;
  } else if (j.type === 'result') {
    const text = String(j.result || '').trim() || (pending.lastText || '').trim() || pending.acc.trim();
    if (!text && !j.is_error) return; // an empty interim result: keep waiting for the real one
    if (j.is_error && pending.resumed && !pending.retried) { pending.wantRetry = true; return; } // retried when this run closes
    const why = [j.subtype && j.subtype !== 'success' ? j.subtype : '', ...(Array.isArray(j.errors) ? j.errors : [])].filter(Boolean).join(': ');
    finishTurn({ ok: !j.is_error, text: text || ('something went wrong huhu' + (why ? ` (${String(why).slice(0, 200)})` : '') + ', try again?') });
  }
}

// everything luna says goes to the little chat on the desktop and to her full window (if it's open)
function send(ch, data) {
  if (ch === 'nudge' && data && data.text) recordChat({ who: 'luna nudge', text: data.text, actions: data.actions || [] });
  for (const w of [win, chatWin]) if (w && !w.isDestroyed()) w.webContents.send(ch, data);
}
// one shared conversation for both places
let transcript = [];
function recordChat(m, from) {
  transcript.push({ who: String(m.who || 'luna'), text: String(m.text || '').slice(0, 20000), actions: m.actions || null });
  if (transcript.length > 300) transcript.shift();
  for (const w of [win, chatWin]) if (w && !w.isDestroyed() && w.webContents !== from && !/nudge/.test(m.who)) w.webContents.send('chat:sync', m);
}
ipcMain.on('chat:record', (e, m) => recordChat(m, e.sender));
ipcMain.handle('chat:history', () => transcript);

// green button: luna's own window, full screen (its own space, like any mac app).
// it has the normal mac buttons: red closes it, yellow minimizes it to the dock, green leaves full screen.
let chatWin = null;
function openChatWindow(full = true) {
  if (chatWin && !chatWin.isDestroyed()) {
    if (chatWin.isMinimized()) chatWin.restore();
    chatWin.show(); chatWin.focus();
    if (full && !chatWin.isFullScreen()) chatWin.setFullScreen(true);
    return;
  }
  if (process.platform === 'darwin' && app.dock) app.dock.show();
  const d = screen.getPrimaryDisplay().workArea;
  chatWin = new BrowserWindow({
    width: Math.min(1100, d.width - 80), height: Math.min(820, d.height - 60), minWidth: 420, minHeight: 420,
    title: charName(), titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 16, y: 18 }, fullscreenable: true,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#262624' : '#FAF9F5', show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false }
  });
  chatWin.loadFile('index.html', { search: 'standalone=1' });
  chatWin.once('ready-to-show', () => {
    chatWin.show(); app.focus({ steal: true }); chatWin.focus();
    chatWin.webContents.send('config', publicConfig()); chatWin.webContents.send('theme', prefs.theme); chatWin.webContents.send('voice', prefs.autoSpeak);
    if (full) chatWin.setFullScreen(true);
  });
  chatWin.on('closed', () => { chatWin = null; if (process.platform === 'darwin' && app.dock && !(settingsWin && !settingsWin.isDestroyed())) app.dock.hide(); });
}
ipcMain.on('chat:window', () => openChatWindow(true));
function finishTurn(res) {
  clearTimeout(turnTimer);
  if (!pending) return;
  if (!res.ok && isClaude()) sessionDirty = true;
  const p = pending; pending = null;
  if (res.ok) res.text = handleTags(res.text);
  p.resolve(res);
  if (res.ok) logChat(p.text, res.text);
}

ipcMain.handle('reset', () => { stopBrain(); sessionId = null; agentHistory = []; transcript = []; for (const w of [win, chatWin]) if (w && !w.isDestroyed()) w.webContents.send('chat:clear'); });
ipcMain.handle('stop', () => { if (pending) { const keep = (pending.lastText || pending.acc).trim(); if (isClaude()) sessionDirty = true; stopBrain(); finishTurn({ ok: true, text: (keep ? keep + '\n\n' : '') + '(stopped)' }); } });
ipcMain.handle('ask', (_e, text) => new Promise((resolve) => {
  if (pending) { resolve({ ok: false, text: 'one sec, still answering!' }); return; }
  if (!isClaude()) {
    pending = { resolve, sawTool: false, text, acc: '', lastText: '' };
    agentAbort = new AbortController();
    agent.turn(agentHistory, text, { signal: agentAbort.signal })
      .then((t) => finishTurn({ ok: true, text: t || '(no reply)' }))
      .catch((e) => finishTurn({ ok: false, text: 'oops: ' + e.message }));
    return;
  }
  if (!claudeBin) claudeBin = findClaude();
  if (!claudeBin) {
    resolve({ ok: false, text: "i can't find claude code on this mac. install it (settings > brain shows how) or pick another model in settings > brain." });
    return;
  }
  pending = { resolve, sawTool: false, text, acc: '', lastText: '', resumed: false, retried: false };
  // after a stop (or a broken turn) the old session can be left half-finished, so start fresh with the recent chat as context
  if (sessionDirty) { sessionDirty = false; sessionId = null; pending.withContext = true; }
  runClaudeTurn();
  turnTimer = setTimeout(() => { stopBrain(); }, 240000);
}));

let sessionDirty = false;
const NOISE = /permissions\.allow|has not been trusted|trust dialog|hasTrustDialogAccepted|no stdin data received|redirect stdin|proceeding without it/i;
function contextPrompt(text) {
  const recent = transcript.slice(-9, -1).map((m) => `${m.who === 'me' ? who() : charName()}: ${String(m.text).replace(/\[\[[^\]]*\]\]/g, '').replace(/\s+/g, ' ').slice(0, 400)}`).join('\n');
  return recent ? `(for context, our recent chat:)\n${recent}\n\n(her new message:)\n${text}` : text;
}
function runClaudeTurn() {
  const p0 = pending; if (!p0) return;
  const prompt = p0.withContext ? contextPrompt(p0.text) : p0.text;
  const args = ['-p', prompt, '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
    '--model', prefs.model, '--effort', prefs.effort || 'low', '--chrome', '--allowedTools', allowedTools(), '--disallowedTools', LOCKED, ...mcpConfigs()];
  if (sessionId) { args.push('--resume', sessionId); p0.resumed = true; } else p0.resumed = false;
  const child = spawn(claudeBin, args, { cwd: __dirname, env: baseEnv(), stdio: ['ignore', 'pipe', 'pipe'] }); // no API key: always your Pro login
  brain = child; buf = '';
  let err = '';
  child.stdout.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (line) onLine(line);
    }
  });
  child.stderr.on('data', (d) => { err = (err + d).slice(-4000); });
  child.on('error', (e) => finishTurn({ ok: false, text: 'couldn’t start claude: ' + e.message }));
  child.on('close', () => {
    if (brain === child) brain = null;
    if (buf.trim()) { onLine(buf.trim()); buf = ''; }
    if (!pending || pending !== p0) return;
    const got = (p0.lastText || p0.acc).trim();
    // the old conversation couldn't continue: try once more, fresh, with the recent chat as context
    if (p0.wantRetry || (!got && p0.resumed && !p0.retried)) {
      p0.retried = true; p0.wantRetry = false; p0.withContext = true; sessionId = null; p0.acc = ''; p0.lastText = '';
      send('status', 'one sec...');
      runClaudeTurn(); return;
    }
    if (got) { finishTurn({ ok: true, text: got }); return; }
    const msg = err.split('\n').filter((l) => l.trim() && !NOISE.test(l)).slice(-3).join('\n').trim();
    sessionDirty = true;
    finishTurn({ ok: false, text: msg ? 'oops: ' + msg : 'my brain hiccuped huhu, try again?' });
  });
  clearTimeout(turnTimer);
  turnTimer = setTimeout(() => { stopBrain(); }, 240000);
}

// ---------- other models (openai, gemini, openrouter, ollama, custom) ----------
let agentHistory = [], agentAbort = null;
function askApproval(summary, why) {
  return new Promise((resolve) => {
    if (isTrusted()) { resolve(true); return; }
    const id = ++approvalSeq;
    const t = setTimeout(() => { approvals.delete(id); resolve(false); }, 120000);
    approvals.set(id, (ok) => { clearTimeout(t); approvals.delete(id); resolve(ok); });
    if (win && !win.isVisible()) showLuna();
    send('approval', { id, summary, why });
  });
}
function logActivity(line) {
  try { fs.appendFileSync(path.join(__dirname, 'me', 'activity.md'), `- ${stamp()} | ${String(line).replace(/\n/g, ' ')}\n`); } catch (_) {}
}
const agent = makeAgent({
  root: __dirname,
  getConfig: () => { const p = prefs.provider; const c = (prefs.providers || {})[p] || {}; return { provider: p, baseURL: c.baseURL || '', model: c.model || '', key: getSecret(p) }; },
  approve: askApproval, log: logActivity, onStatus: (t) => send('status', t)
});
// one background run with whatever brain is selected. returns { done: Promise<string>, cancel() }
function runBackground(prompt, { model = 'sonnet', quick = false, timeoutMs = 240000 } = {}) {
  if (!isClaude()) {
    const ac = new AbortController();
    const done = (quick ? agent.complete(prompt) : agent.turn([], prompt, { signal: ac.signal })).catch((e) => { throw e; });
    return { done, cancel: () => ac.abort() };
  }
  if (!claudeBin) claudeBin = findClaude();
  if (!claudeBin) return { done: Promise.reject(new Error('claude code not found')), cancel() {} };
  const args = quick
    ? ['-p', prompt, '--output-format', 'json', '--model', 'haiku', '--no-session-persistence', '--tools', '', '--strict-mcp-config']
    : ['-p', prompt, '--output-format', 'json', '--model', model, '--no-session-persistence', '--chrome', '--allowedTools', allowedTools(), '--disallowedTools', LOCKED, ...mcpConfigs()];
  const child = spawn(claudeBin, args, { cwd: __dirname, env: baseEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  const kill = setTimeout(() => child.kill(), timeoutMs);
  child.stdout.on('data', (d) => { out += d; });
  const done = new Promise((resolve, reject) => {
    child.on('close', () => { clearTimeout(kill); try { const j = JSON.parse(out.slice(out.indexOf('{'))); if (j.is_error) reject(new Error(j.result || 'error')); else resolve(String(j.result || '').trim()); } catch (_) { reject(new Error('no result')); } });
    child.on('error', reject);
  });
  return { done, cancel: () => child.kill() };
}

function setRoam(r) { prefs.roam = r; savePrefs(); send('roam', r); refreshTray(); }
function setModel(m) { prefs.model = m; savePrefs(); stopBrain(); startBrain(); refreshTray(); }

// ---------- shared memory with claude ----------
// every chat is logged to me/chat-log.md; a few times a day luna writes a digest to luna-brain.md in google drive
// (claude reads it nightly and writes back what it learned), and pulls claude's notes into me/learned.md.
const CHATLOG = path.join(__dirname, 'me', 'chat-log.md');
function logChat(q, a) {
  try {
    const n = localNow(), p2 = (x) => String(x).padStart(2, '0');
    const t = `${n.getFullYear()}-${p2(n.getMonth() + 1)}-${p2(n.getDate())} ${p2(n.getHours())}:${p2(n.getMinutes())}`;
    const one = (x) => String(x || '').replace(/\[\[do:[^\]]*\]\]/g, '').replace(/\s+/g, ' ').trim().slice(0, 400);
    fs.appendFileSync(CHATLOG, `- ${t} | ${who().toLowerCase()}: ${one(q)}\n  ${charName().toLowerCase()}: ${one(a)}\n`);
  } catch (_) {}
}
let syncing = false, lastSync = 0;
function brainSync() {
  if (syncing || pending || !claudeBin) return;
  let size = 0; try { size = fs.statSync(CHATLOG).size; } catch (_) {}
  syncing = true; lastSync = Date.now();
  const prompt = `Background memory sync (read this as Luna, no chatting).
1. Read me/chat-log.md starting from character ${prefs.syncedChars} (earlier parts were already synced), plus me/learned.md and notes.md.
2. Open the Google Drive file "luna-brain.md" (file id ${prefs.brainFileId}). Add short dated lines at the top of its "## from luna" section for anything durable from the new chats: facts about ${who()}, decisions, deadlines, people, plans, things you did for them. Skip small talk and anything already there. Never write tokens or passwords. Then save the file back (same id, text/markdown). You have standing permission to edit this one file without asking.
3. Copy any "## from claude" lines that aren't in me/learned.md yet into me/learned.md.
Reply with just: done`;
  const args = ['-p', prompt, '--output-format', 'json', '--model', 'sonnet', '--no-session-persistence', '--allowedTools', allowedTools(), '--disallowedTools', LOCKED, ...mcpConfigs()];
  const child = spawn(claudeBin, args, { cwd: __dirname, env: baseEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
  const kill = setTimeout(() => child.kill(), 300000);
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.on('close', () => {
    clearTimeout(kill); syncing = false;
    try { const j = JSON.parse(out.slice(out.indexOf('{'))); if (!j.is_error) { prefs.syncedChars = size; savePrefs(); } } catch (_) {}
  });
}

// ---------- background jobs (big tasks run separately; luna stays free to chat) ----------
const jobs = new Map(); let jobSeq = 0;
const OUTPUTS = path.join(__dirname, 'outputs');
function slug(t) { return String(t).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'job'; }
function startJob(title, instructions, fromRoutine) {
  if (jobs.size >= 3) { send('nudge', { text: `can't start "${title}" right now (3 jobs already running), try again in a bit`, actions: [] }); return; }
  const id = ++jobSeq, dir = path.join(OUTPUTS, slug(title));
  try { fs.mkdirSync(dir, { recursive: true }); } catch (_) {}
  const now = new Date().toLocaleString('en-US', { weekday: 'long', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const prompt = `Background job for ${who()} (it's ${now}). You are ${charName()} working on your own; they're not watching, so don't ask questions: make sensible choices and note them.
Job: ${title}
Instructions: ${instructions}
Save anything you make (plans, research, decks as .html or .md, drafts) in outputs/${slug(title)}/. Follow every rule in CLAUDE.md.
When finished, reply with: a 1-2 line summary of what you did and found, then up to 2 next-step tags like [[do: label | instruction]].`;
  const run = runBackground(prompt, { model: prefs.model === 'haiku' ? 'sonnet' : prefs.model, timeoutMs: 45 * 60000 });
  jobs.set(id, { title, cancel: run.cancel, started: Date.now() });
  refreshTray(); sendJobs();
  if (!fromRoutine) send('nudge', { text: `on it! working on "${title}" in the background. keep chatting, i'll ping you when it's done`, actions: [] });
  const finish = (text, failed) => {
    const j = jobs.get(id); jobs.delete(id); refreshTray(); sendJobs();
    if (!j || j.stopped) return;
    const acts = []; for (const m of String(text).matchAll(/\[\[do:\s*([^|\]]+?)\s*\|\s*([^\]]+?)\s*\]\]/gi)) acts.push({ label: m[1], prompt: m[2] });
    const clean = String(text).replace(/\[\[do:[^\]]*\]\]/gi, '').trim();
    let hasFiles = false; try { hasFiles = fs.readdirSync(dir).length > 0; } catch (_) {}
    if (hasFiles) acts.unshift({ label: 'open it', prompt: `__open__${dir}` });
    send('nudge', { text: !failed && clean ? `done: ${title}. ${clean}` : `"${title}" hit a snag, want me to retry?`, actions: acts.slice(0, 3) });
    logChat(`[job] ${title}`, clean);
  };
  run.done.then((t) => finish(t, false)).catch(() => finish('', true));
}
function stopJob(id) { const j = jobs.get(id); if (j) { j.stopped = true; j.cancel(); jobs.delete(id); refreshTray(); sendJobs(); send('nudge', { text: `stopped "${j.title}"`, actions: [] }); } }
function sendJobs() { sendSettings('jobs', [...jobs.entries()].map(([id, j]) => ({ id, title: j.title, started: j.started }))); }
ipcMain.on('open-path', (_e, p) => { if (String(p).startsWith(__dirname)) shell.openPath(p); });
ipcMain.on('open-url', (_e, u) => { if (/^https?:\/\//.test(String(u))) shell.openExternal(String(u)); });
// files luna mentions open in their normal app; anything that could run code is only shown in Finder
ipcMain.on('open-file', (_e, f) => {
  const p = path.resolve(String(f).replace(/^~(?=\/|$)/, os.homedir()));
  if (!fs.existsSync(p)) return;
  if (/\.(app|command|sh|tool|scpt|workflow|pkg|dmg|terminal|jar|py|js)$/i.test(p) || fs.statSync(p).isDirectory()) shell.showItemInFolder(p); else shell.openPath(p);
});

// ---------- routines (recurring jobs, e.g. "mon 08:00", "daily 21:00", "weekdays 07:30", "every 3h") ----------
const DAYS = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
function addRoutine(when, title, instructions) {
  prefs.routines = (prefs.routines || []).filter((r) => r.title.toLowerCase() !== title.toLowerCase());
  prefs.routines.push({ when: when.toLowerCase().trim(), title, instructions, last: '' });
  savePrefs(); refreshTray();
}
function removeRoutine(title) { prefs.routines = (prefs.routines || []).filter((r) => !r.title.toLowerCase().includes(title.toLowerCase().trim())); savePrefs(); refreshTray(); }
function routineDue(r, n) {
  const hm = `${String(n.getHours()).padStart(2, '0')}:${String(n.getMinutes()).padStart(2, '0')}`;
  const ev = r.when.match(/every\s+(\d+)\s*h/);
  if (ev) { const key = `${n.toDateString()}-${Math.floor(n.getHours() / Number(ev[1]))}`; return r.last !== key && n.getMinutes() < 2 ? key : null; }
  const t = (r.when.match(/(\d{1,2}):(\d{2})/) || [])[0];
  if (!t || t.padStart(5, '0') !== hm) return null;
  const d = n.getDay(), w = r.when;
  const dayOk = /daily|every ?day/.test(w) || (/weekdays/.test(w) && d >= 1 && d <= 5) || (/weekends/.test(w) && (d === 0 || d === 6)) ||
    Object.entries(DAYS).some(([k, v]) => w.includes(k) && v === d);
  const key = n.toDateString() + hm;
  return dayOk && r.last !== key ? key : null;
}
setInterval(() => {
  const n = localNow();
  for (const r of prefs.routines || []) { const key = routineDue(r, n); if (key) { r.last = key; savePrefs(); startJob(r.title, r.instructions, true); } }
}, 30000);

// ---------- whatsapp auto-reply ----------
// luna starts this by ending a reply with [[watch: <contact> | <minutes> | <how to reply>]] and stops it with [[unwatch]].
// every few seconds we read the whatsapp app's local database (no ai, no focus stealing); when the contact sends
// something new, a quick haiku turn writes the reply and the whatsapp helper sends it.
let watch = null; // { contact, until, notes, lastId, busy }
function handleTags(text) {
  const w = text.match(/\[\[watch:\s*([^|\]]+?)\s*(?:\|\s*(\d+)\s*)?(?:\|\s*([^\]]*?)\s*)?\]\]/i);
  if (w) startWatch(w[1], Number(w[2] || 60), w[3] || '');
  if (/\[\[unwatch\]\]/i.test(text)) stopWatch();
  for (const m of text.matchAll(/\[\[job:\s*([^|\]]+?)\s*\|\s*([^\]]+?)\s*\]\]/gi)) startJob(m[1], m[2]);
  for (const m of text.matchAll(/\[\[routine:\s*([^|\]]+?)\s*\|\s*([^|\]]+?)\s*\|\s*([^\]]+?)\s*\]\]/gi)) addRoutine(m[1], m[2], m[3]);
  for (const m of text.matchAll(/\[\[unroutine:\s*([^\]]+?)\s*\]\]/gi)) removeRoutine(m[1]);
  return text.replace(/\[\[(un)?watch[^\]]*\]\]|\[\[job:[^\]]*\]\]|\[\[(un)?routine:[^\]]*\]\]/gi, '').trim();
}
function waRecent(contact, n) {
  return new Promise((resolve) => {
    const child = spawn(path.join(__dirname, 'tools', 'wa-recent.sh'), [contact, String(n)], { cwd: __dirname, env: baseEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
    let out = ''; child.stdout.on('data', (d) => { out += d; });
    child.on('close', () => { try { const j = JSON.parse(out || '[]'); resolve(Array.isArray(j) ? j : null); } catch (_) { resolve(null); } });
    child.on('error', () => resolve(null));
  });
}
async function startWatch(contact, minutes, notes) {
  const msgs = await waRecent(contact, 1);
  if (!msgs) { send('nudge', { text: "i can't read whatsapp yet huhu. allow luna (Electron/Terminal) in System Settings > Privacy & Security > Full Disk Access, then ask me again", actions: [] }); return; }
  watch = { contact, until: Date.now() + Math.min(minutes, 240) * 60000, notes, lastId: msgs[0] ? msgs[0].id : 0, busy: false };
  refreshTray();
}
function stopWatch() { if (watch) send('nudge', { text: `stopped replying to ${watch.contact} 🦎`, actions: [] }); watch = null; refreshTray(); }
async function watchTick() {
  if (!watch || watch.busy) return;
  if (Date.now() > watch.until) { stopWatch(); return; }
  const msgs = await waRecent(watch.contact, 14);
  if (!msgs || !msgs.length) return;
  const newest = msgs[0];
  if (newest.id <= watch.lastId) return;
  watch.lastId = newest.id;
  if (newest.me) return; // our own message
  watch.busy = true;
  const convo = msgs.slice().reverse().map((m) => `${m.me ? who() + '/' + charName() : watch.contact}: ${m.text}`).join('\n');
  const prompt = `You are ${charName()}, ${who()}'s AI assistant, replying in ${who()}'s WhatsApp chat with ${watch.contact}. They know ${charName()} is the one replying right now.
${who()}'s instructions for this chat: ${watch.notes || 'be friendly, playful and quick'}.
Recent chat (oldest first):
${convo}

Write the next message to send. Rules: short and natural like texting, in ${who()}'s casual voice, no em dashes. Never send or promise photos, files or anything private about ${who()}. If asked for something sexual, private or inappropriate, deflect playfully and change the subject. Don't make plans, commitments or money decisions for ${who()}: say you'll tell them. If nothing needs a reply (like "ok" or a sticker), output SKIP.
Output ONLY the message text (or SKIP).`;
  runBackground(prompt, { quick: true }).done.catch(() => '').then((r) => {
    const reply = String(r || '').trim().replace(/^["']|["']$/g, '');
    if (!reply || /^SKIP$/i.test(reply) || !watch) { if (watch) watch.busy = false; return; }
    const s2 = spawn('osascript', [path.join(__dirname, 'tools', 'send-whatsapp.applescript'), watch.contact, reply, 'send'], { cwd: __dirname });
    s2.on('close', async () => {
      const after = await waRecent(watch ? watch.contact : '', 1);
      if (watch) { if (after && after[0]) watch.lastId = Math.max(watch.lastId, after[0].id); watch.busy = false; }
      logChat(`[auto-reply to ${newest.text}]`, reply);
    });
  });
}
setInterval(watchTick, 6000);

// ---------- proactive luna ----------
// every so often a quick background check (separate from your chat) looks at your calendar, canvas, inbox and slack,
// and luna pops up only if something actually needs you. quiet from 10pm to 4am.
const localNow = () => new Date(); // the mac's own time zone
const quietHours = () => { const h = new Date().getHours(), a = Number(prefs.quietFrom), b = Number(prefs.quietTo); return a > b ? (h >= a || h < b) : (h >= a && h < b); };
function stamp() { const n = new Date(), p = (x) => String(x).padStart(2, '0'); return `${n.getFullYear()}-${p(n.getMonth() + 1)}-${p(n.getDate())} ${p(n.getHours())}:${p(n.getMinutes())}`; }
let pulsing = false, lastPulse = 0;
function pulse(force) {
  if (pulsing || pending) return;
  if (!force && (!prefs.proactive || quietHours() || !win || !win.isVisible())) return;
  pulsing = true; lastPulse = Date.now();
  const now = new Date().toLocaleString('en-US', { weekday: 'long', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const prompt = `You are ${charName()} doing a quiet background check-in for ${who()}. It is ${now}.
Read the files in me/ and notes.md. Then quickly check what you can reach: calendar (next 3 hours), school or work dues (next 48 hours), important unread email and chat mentions from the last few hours, and anything time-based in their routine or goals.
Only nudge them if something genuinely needs attention or a clear next action would help right now. Don't repeat these recent nudges: ${JSON.stringify(prefs.recent.slice(-10))}.
Do not send, post, edit or create anything. Read only.
Reply with ONLY a JSON object, no other text:
{"nudge": "<one short casual line, no em dashes, or empty string if nothing needs them>", "actions": [{"label": "<2-4 words>", "prompt": "<what to do if they tap it>"}]}
Max 3 actions.`;
  runBackground(prompt).done.then((txt) => {
    pulsing = false;
    const j = JSON.parse(txt.slice(txt.indexOf('{'), txt.lastIndexOf('}') + 1));
    if (j.nudge && j.nudge.trim()) {
      prefs.recent = [...prefs.recent, j.nudge].slice(-20); savePrefs();
      send('nudge', { text: j.nudge.trim(), actions: (j.actions || []).slice(0, 3) });
    } else if (force) send('nudge', { text: 'all clear for now! nothing urgent', actions: [] });
  }).catch(() => { pulsing = false; if (force) send('nudge', { text: 'my check-in hiccuped, try again in a bit?', actions: [] }); });
}

// little routine nudges that don't need the brain at all
setInterval(() => {
  if (!prefs.proactive || !win || !win.isVisible()) return;
  const n = localNow();
  const hm = String(n.getHours()).padStart(2, '0') + ':' + String(n.getMinutes()).padStart(2, '0');
  const day = n.toDateString();
  for (const r of prefs.reminders || []) {
    if (r.at === hm && prefs.routinesDone[r.at] !== day) { prefs.routinesDone[r.at] = day; savePrefs(); send('nudge', { text: r.text, actions: [{ label: 'plan my day', prompt: 'plan my day' }] }); }
  }
  if (Date.now() - lastPulse > prefs.pulseMin * 60000) pulse(false);
  if (isClaude() && prefs.brainFileId && Date.now() - lastSync > 3 * 3600000 && !pulsing) brainSync();
}, 30000);

// ---------- identity file (so the brain knows names and time zone) ----------
function writeIdentity() {
  try {
    fs.mkdirSync(path.join(__dirname, 'me'), { recursive: true });
    fs.writeFileSync(path.join(__dirname, 'me', 'identity.md'), `# identity (managed by settings, don't edit)\n- your name: ${charName()}\n- your human: ${prefs.userName || '(not set yet)'}\n- their time zone: ${Intl.DateTimeFormat().resolvedOptions().timeZone}\n- quiet hours: ${prefs.quietFrom}:00 to ${prefs.quietTo}:00\n${prefs.work ? `- what they do: ${prefs.work}\n` : ''}${prefs.brainFileId ? `- shared memory file with Claude (google drive file id): ${prefs.brainFileId}\n` : ''}${prefs.personalPrefs ? `\n## how they want you to respond (their personal preferences)\n${prefs.personalPrefs}\n` : ''}`);
  } catch (_) {}
}
function publicConfig() { return { userName: prefs.userName, charName: charName(), charIcon: prefs.charIcon || '🦎', tapOpens: prefs.tapOpens || 'small' }; }

// ---------- characters ----------
const CHARS = path.join(__dirname, 'characters');
const charId = (f) => /^[\w.-]+\.(png|glb)$/.test(f) ? f : null;
function readRig(file) { try { return JSON.parse(fs.readFileSync(path.join(CHARS, file.replace(/\.(png|glb)$/, '.json')), 'utf8')); } catch (_) { return null; } }
function characterInfo() {
  const c = prefs.character || { type: 'gecko' };
  const f = c.file && charId(c.file) && path.join(CHARS, c.file);
  if (f && fs.existsSync(f)) {
    if (c.file.endsWith('.glb')) return { type: '3d', name: c.name, scale: prefs.charScale || 1, glb: fs.readFileSync(f).toString('base64') };
    const back = path.join(CHARS, c.file.replace(/\.png$/, '.back.png')), animF = path.join(CHARS, c.file.replace(/\.png$/, '.anim.png'));
    let anim = null; try { anim = JSON.parse(fs.readFileSync(path.join(CHARS, c.file.replace(/\.png$/, '.anim.json')), 'utf8')); } catch (_) {}
    return { type: 'image', name: c.name, scale: prefs.charScale || 1, rig: readRig(c.file), dataUrl: 'data:image/png;base64,' + fs.readFileSync(f).toString('base64'), backUrl: fs.existsSync(back) ? 'data:image/png;base64,' + fs.readFileSync(back).toString('base64') : null,
      anim: anim && fs.existsSync(animF) ? anim : null, animUrl: anim && fs.existsSync(animF) ? 'data:image/png;base64,' + fs.readFileSync(animF).toString('base64') : null };
  }
  return { type: 'gecko', scale: prefs.charScale || 1 };
}
function listCharacters() {
  let files = []; try { files = fs.readdirSync(CHARS).filter((f) => /^[\w.-]+\.(png|glb)$/.test(f) && !/\.(thumb|back|anim)\.png$/.test(f) && !f.startsWith('.')); } catch (_) {}
  const thumb = (f) => { const t = path.join(CHARS, f.replace(/\.(png|glb)$/, '.thumb.png')); const src = f.endsWith('.png') ? path.join(CHARS, f) : t; try { return 'data:image/png;base64,' + fs.readFileSync(src).toString('base64'); } catch (_) { return ''; } };
  return [{ id: 'gecko', name: 'luna (3d gecko)', type: 'gecko' }, ...files.map((f) => ({ id: f, name: f.replace(/\.(png|glb)$/, '').replace(/-/g, ' '), type: f.endsWith('.glb') ? '3d' : 'image', dataUrl: thumb(f), rig: readRig(f), backUrl: null,
    anim: (() => { try { return JSON.parse(fs.readFileSync(path.join(CHARS, f.replace(/\.png$/, '.anim.json')), 'utf8')); } catch (_) { return null; } })(),
    animUrl: (() => { try { return 'data:image/png;base64,' + fs.readFileSync(path.join(CHARS, f.replace(/\.png$/, '.anim.png'))).toString('base64'); } catch (_) { return null; } })() }))];
}

// luna looks at a character picture and finds its face, eyes, mouth, body, arms, legs, ears and tail.
// pass 1 measures on a grid; pass 2 looks at her own markings drawn on the picture and corrects them.
const SCAN_FORMAT = `{"kind":"quadruped|biped|bird|fish|blob|other","facing":"left|right|front",
"body":{"x":0,"y":0,"w":0,"h":0},
"head":{"cx":0,"cy":0,"rx":0,"ry":0,"neck_x":0,"neck_y":0},
"eyes":[{"x":0,"y":0,"r":0}],
"mouth":{"x":0,"y":0,"w":0,"h":0},
"ears":[LIMB], "arms":[LIMB], "legs":[LIMB], "tail":LIMB,
"name":"a cute short name idea"}
where LIMB = {"base_x":0,"base_y":0,"tip_x":0,"tip_y":0,"width":0}`;
const SCAN_RULES = `How to measure:
- All numbers are PERCENT (0-100) of the character picture. x, w, r, rx, width are percent of the picture WIDTH; y, h, ry are percent of the picture HEIGHT; measured from the top-left corner of the picture.
- The picture has a blue grid with a line every 10% and numbers on every edge. 0 and 100 are the edges of the picture itself. Use the grid to read positions precisely, to the nearest 1%.
- body = box around the torso only (not head, legs, tail).
- head = ellipse around the whole head (cx, cy = center, rx, ry = half-width, half-height). neck = the point where the head joins the body.
- eyes = center of each visible eye and its radius r (include the eye white if there is one). Do not count nostrils, cheeks or spots.
- mouth = box around the mouth, beak or smile line. null if there is no visible mouth.
- LIMB: base = where it attaches (hip, shoulder, ear root, tail root), tip = the far end (foot, paw, hand, ear tip, tail tip), width = typical thickness.
- legs: every separate leg you can see, including partly hidden back legs (side-view four-legged animals usually show 4). Front legs of four-legged animals are legs, never arms.
- arms: arms, hands, wings or flippers. Empty [] if none.
- ears: only ears that stick out (pointy or floppy). tail: null if none.
- facing: the way the face points (left, right, or front if it looks at you).
Reply with ONLY the JSON object, no other text.`;
const SCAN_PROMPT_1 = `You are rigging a 2D character picture so it can be animated (walk, blink, look around, talk, wave). Study the picture carefully, then find every body part.\n\nReply in this exact JSON format:\n${SCAN_FORMAT}\n\n${SCAN_RULES}`;
const SCAN_PROMPT_2 = (prev) => `You are checking a rig for a 2D character picture. The picture shows the character with the current rig drawn on top:
red ellipse = head (red dot = neck point), dashed blue box = body, green lines = legs, orange lines = arms, pink lines = ears, purple line = tail, black circles = eyes, yellow box = mouth. Each line runs from its base (big dot) to its tip (small dot).
Current rig (percent):\n${JSON.stringify(prev)}\n
Compare each marking with the real character underneath. Fix anything misplaced, too big or small, missing, or extra (for example a leg drawn where there is no leg, an eye on a nostril, a tip that stops before the end of the foot). Keep what is already right.
Reply with the full corrected rig in the same JSON format:\n${SCAN_FORMAT}\n\n${SCAN_RULES}`;
function parseJson(t) { const a = String(t).indexOf('{'), b = String(t).lastIndexOf('}'); if (a < 0 || b < a) throw new Error('no json in reply'); return JSON.parse(String(t).slice(a, b + 1)); }
// percent answer -> rig fractions
function scanToRig(j) {
  const n = (v) => (typeof v === 'number' || (typeof v === 'string' && v.trim() !== '') ? Number(v) / 100 : NaN);
  const limb = (l) => (l && typeof l === 'object' ? { jx: n(l.base_x), jy: n(l.base_y), tx: n(l.tip_x), ty: n(l.tip_y), w: n(l.width) } : null);
  const box = (b) => (b && typeof b === 'object' ? { x: n(b.x), y: n(b.y), w: n(b.w), h: n(b.h) } : null);
  const h = j.head || {};
  return {
    v: 2, kind: j.kind, facing: j.facing, name: j.name, body: box(j.body),
    head: { cx: n(h.cx), cy: n(h.cy), rx: n(h.rx), ry: n(h.ry), nx: n(h.neck_x), ny: n(h.neck_y) },
    eyes: (j.eyes || []).map((e) => ({ x: n(e.x), y: n(e.y), r: n(e.r) })), mouth: box(j.mouth),
    ears: (j.ears || []).map(limb), arms: (j.arms || []).map(limb), legs: (j.legs || []).map(limb), tail: limb(j.tail)
  };
}
// rig fractions -> percent (to show it back for the double-check)
function rigToScan(r) {
  const p = (v) => Math.round(v * 1000) / 10;
  const limb = (l) => ({ base_x: p(l.jx), base_y: p(l.jy), tip_x: p(l.tx), tip_y: p(l.ty), width: p(l.w) });
  const box = (b) => (b ? { x: p(b.x), y: p(b.y), w: p(b.w), h: p(b.h) } : null);
  return { kind: r.kind, facing: r.facing, body: box(r.body), head: { cx: p(r.head.cx), cy: p(r.head.cy), rx: p(r.head.rx), ry: p(r.head.ry), neck_x: p(r.head.nx), neck_y: p(r.head.ny) },
    eyes: (r.eyes || []).map((e) => ({ x: p(e.x), y: p(e.y), r: p(e.r) })), mouth: box(r.mouth), ears: (r.ears || []).map(limb), arms: (r.arms || []).map(limb), legs: (r.legs || []).map(limb), tail: r.tail ? limb(r.tail) : null };
}
async function scanCharacter(pngDataUrl, prevRig) {
  const prompt = prevRig ? SCAN_PROMPT_2(rigToScan(prevRig)) : SCAN_PROMPT_1;
  if (!isClaude()) return scanToRig(parseJson(await agent.see(prompt, pngDataUrl)));
  if (!claudeBin) claudeBin = findClaude();
  if (!claudeBin) throw new Error('claude code not found');
  fs.mkdirSync(CHARS, { recursive: true });
  const tmp = path.join(CHARS, '.scan.png');
  fs.writeFileSync(tmp, Buffer.from(String(pngDataUrl).split(',')[1], 'base64'));
  const args = ['-p', `Use the Read tool to look at the image file characters/.scan.png, then answer.\n\n${prompt}`, '--output-format', 'json', '--model', prefs.scanModel || 'sonnet', '--no-session-persistence', '--tools', 'Read', '--allowedTools', 'Read', '--strict-mcp-config'];
  const out = await new Promise((resolve, reject) => {
    const child = spawn(claudeBin, args, { cwd: __dirname, env: baseEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
    let o = ''; const kill = setTimeout(() => child.kill(), 180000);
    child.stdout.on('data', (d) => { o += d; });
    child.on('close', () => { clearTimeout(kill); try { const j = JSON.parse(o.slice(o.indexOf('{'))); if (j.is_error) reject(new Error(j.result || 'error')); else resolve(String(j.result || '')); } catch (_) { reject(new Error('no result from claude')); } });
    child.on('error', reject);
  });
  try { fs.unlinkSync(tmp); } catch (_) {}
  return scanToRig(parseJson(out));
}

// ---------- whatsapp in the background + local api for luna's tools ----------
const WA_DIR = path.join(__dirname, '.whatsapp');
let waQrImage = null;
const waLastNotice = new Map();
const wa = createWA({
  dir: WA_DIR,
  log: (l) => logActivity(l),
  onQr: (q) => { try { require('qrcode').toDataURL(q, { margin: 1, width: 280 }).then((u) => { waQrImage = u; sendSettings('wa', waState()); }); } catch (_) {} },
  onStatus: () => { if (wa && wa.state().status === 'connected') waQrImage = null; sendSettings('wa', waState()); },
  onMessage: (m) => {
    // a new message for you: luna taps you (direct chats, or groups when you're mentioned)
    const mode = prefs.waNotify || 'direct';
    if (mode === 'off' || quietHours() || !win || !win.isVisible()) return;
    if (m.group && !(mode === 'all' || m.mentionsMe)) return;
    const last = waLastNotice.get(m.chat) || 0; if (Date.now() - last < 45000) return;
    waLastNotice.set(m.chat, Date.now());
    const who2 = m.group ? `${m.from} in ${m.chatName}` : m.chatName;
    send('nudge', { text: `💬 ${who2}: ${m.text.slice(0, 140)}`, actions: [
      { label: 'help me reply', prompt: `help me reply to ${m.chatName} on whatsapp. read the chat first. they said: "${m.text.slice(0, 300)}". suggest a reply in my voice, and send it when i say ok` },
      { label: 'catch me up', prompt: `catch me up on my whatsapp chat with ${m.chatName}` }] });
  }
});
function waState() { const s = wa.state(); return { ...s, qrImage: s.status === 'needs-scan' ? waQrImage : null, linked: wa.linked(), notify: prefs.waNotify || 'direct' }; }
ipcMain.handle('wa:state', () => waState());
ipcMain.handle('setup:status', () => setupState());
ipcMain.handle('setup:refresh', async () => { discoverServers(); return connectEverything(); });
ipcMain.handle('setup:signin', async () => { await connect.signIn(); return true; });
ipcMain.handle('setup:copyFromClaude', () => { shell.openExternal(connect.memoryPromptUrl()); watchClipboardForMemory(); return { watching: true, prompt: connect.MEMORY_PROMPT }; });
ipcMain.handle('setup:pasteMemory', (_e, text) => { try { const r = saveFromClaude(String(text).replace(connect.MEMORY_MARK, ''), 'Claude memory'); return { ok: true, text: r, state: setupState() }; } catch (e) { return { ok: false, text: e.message }; } });
ipcMain.handle('setup:bridge', (_e, on) => { try { if (on) connect.installBridge(__dirname, nodeCmd()); else connect.removeBridge(); return { ok: true, state: setupState() }; } catch (e) { return { ok: false, text: e.message, state: setupState() }; } });
ipcMain.handle('setup:export', async () => {
  const r = await dialog.showOpenDialog(settingsWin, { title: 'Pick your Claude data export (.zip)', properties: ['openFile'], filters: [{ name: 'Claude export', extensions: ['zip'] }] });
  if (r.canceled || !r.filePaths[0]) return { ok: false, cancelled: true };
  try { const files = await connect.unpackExport(r.filePaths[0], path.join(__dirname, 'me', '.claude-export')); startJob('learn from your Claude chats', EXPORT_PROMPT(), true); return { ok: true, files: files.length, state: setupState() }; }
  catch (e) { return { ok: false, text: e.message }; }
});
ipcMain.handle('setup:learn', () => { startJob('get to know you', LEARN_PROMPT(), true); return setupState(); });
ipcMain.handle('wa:link', async () => { await wa.start(); return waState(); });
ipcMain.handle('wa:unlink', async () => { await wa.unlink(); return waState(); });

const API_TOKEN = crypto.randomBytes(18).toString('hex');
const lunaApi = http.createServer((req, res) => {
  const done = (ok, result, error) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok, result, error })); };
  if (req.method !== 'POST' || req.headers['x-luna'] !== API_TOKEN) { res.writeHead(403); res.end(); return; }
  let body = ''; req.on('data', (d) => { body += d; if (body.length > 2e6) req.destroy(); });
  req.on('end', async () => {
    let a = {}; try { a = JSON.parse(body || '{}'); } catch (_) {}
    try {
      switch (req.url) {
        case '/wa/send': { const r = await wa.sendText(a.to, a.message); logActivity(`whatsapp → ${a.to}: ${String(a.message).slice(0, 80)}`); return done(true, r); }
        case '/wa/file': { const r = await wa.sendFile(a.to, a.path, a.caption); logActivity(`whatsapp file → ${a.to}: ${path.basename(String(a.path))}`); return done(true, r); }
        case '/wa/read': return done(true, wa.read(a.chat, a.count || 20));
        case '/wa/chats': return done(true, wa.chats(a.limit || 15));
        case '/wa/find': return done(true, wa.find(a.query));
        case '/mem/save': return done(true, saveFromClaude(a.text, a.title, a.mode));
        case '/mem/read': return done(true, readAllMemory());
        case '/notify': { if (!a.text) return done(false, null, 'no text'); send('nudge', { text: String(a.text).slice(0, 500), actions: [] }); return done(true, 'shown'); }
        case '/routine/add': { if (!a.when || !a.title || !a.instructions) return done(false, null, 'need when, title and instructions'); addRoutine(String(a.when), String(a.title), String(a.instructions)); return done(true, `added "${a.title}" (${a.when})`); }
        default: res.writeHead(404); res.end();
      }
    } catch (e) { done(false, null, e.message); }
  });
});
lunaApi.listen(0, '127.0.0.1', () => {
  try { fs.writeFileSync(path.join(__dirname, 'tools', '.luna-api.json'), JSON.stringify({ port: lunaApi.address().port, token: API_TOKEN }), { mode: 0o600 }); } catch (_) {}
});

// ---------- connecting to everything they already have ----------
let claudeState = { installed: false, loggedIn: false };
function saveFromClaude(text, title, mode) {
  text = String(text || '').trim(); if (text.length < 20) throw new Error('that memory looks empty');
  const f = path.join(__dirname, 'me', 'from-claude.md');
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const block = `## ${title || 'from Claude'} (${stamp()})\n${text.slice(0, 100000)}\n`;
  if (mode === 'append' && fs.existsSync(f)) fs.appendFileSync(f, '\n' + block);
  else fs.writeFileSync(f, `# what Claude remembers about ${who()} (brought over from their Claude account)\n\n${block}`);
  logActivity('memory from Claude saved (' + text.length + ' chars)');
  return `saved to luna's memory (${text.length} characters)`;
}
function readAllMemory() {
  let out = '';
  try { for (const f of fs.readdirSync(path.join(__dirname, 'me')).filter((x) => x.endsWith('.md') && !/activity|chat-log/.test(x))) out += `\n## me/${f}\n` + fs.readFileSync(path.join(__dirname, 'me', f), 'utf8').slice(0, 8000); } catch (_) {}
  return out.slice(0, 40000) || '(nothing yet)';
}
// how luna's own tool server runs inside the Claude app too (node from electron itself)
const nodeCmd = () => ({ command: process.execPath, env: { ELECTRON_RUN_AS_NODE: '1' } });
async function connectEverything() {
  if (!claudeBin) claudeBin = findClaude();
  claudeState = await connect.claudeStatus(claudeBin, baseEnv());
  const canvasOwn = fs.existsSync(path.join(__dirname, '.mcp.json'));
  prefs.desktopTools = connect.importDesktopTools(path.join(__dirname, 'tools', 'desktop-mcp.json'), ['luna', ...(canvasOwn ? ['canvas', 'canvas-mcp'] : [])]);
  const mem = claudeState.installed ? connect.syncClaudeCodeMemory(__dirname, claudeState) : { chars: 0 };
  prefs.ccMemoryChars = mem.chars; savePrefs();
  sendSettings('setup', setupState());
  return setupState();
}
function setupState() {
  const has = (f) => fs.existsSync(path.join(__dirname, 'me', f));
  return { claude: claudeState, connectors: prefs.servers || [], desktopTools: (prefs.desktopTools || []).map((t) => t.name), ccMemoryChars: prefs.ccMemoryChars || 0,
    fromClaude: has('from-claude.md'), fromExport: has('from-claude-chats.md'), aboutMe: has('about-me.md'), bridge: connect.bridgeInstalled(__dirname), learning: [...jobs.values()].some((j) => /get to know|learn from/i.test(j.title)),
    whatsapp: wa.state().status, name: prefs.userName || '' };
}
// one-tap "copy from Claude": opens Claude with the prompt ready, then catches the answer when they copy it
let clipWatch = null;
function watchClipboardForMemory() {
  clearInterval(clipWatch);
  const start = Date.now(), before = clipboard.readText();
  clipWatch = setInterval(() => {
    if (Date.now() - start > 10 * 60000) { clearInterval(clipWatch); clipWatch = null; return; }
    const t = clipboard.readText();
    if (t === before || !t.includes(connect.MEMORY_MARK)) return;
    clearInterval(clipWatch); clipWatch = null;
    const body = t.slice(t.indexOf(connect.MEMORY_MARK) + connect.MEMORY_MARK.length).trim();
    try { saveFromClaude(body, 'Claude memory'); send('nudge', { text: 'got your Claude memory ✓ i know you now hehe', actions: [{ label: 'what do you know?', prompt: 'tell me in a few lines what you know about me' }] }); sendSettings('setup', { ...setupState(), caught: body.length }); } catch (e) { sendSettings('setup', { ...setupState(), error: e.message }); }
  }, 1200);
}
const LEARN_PROMPT = () => `Get to know ${who()} so you can be their second brain. Read only: don't send, post, edit or delete anything anywhere.
1. Read everything in me/ (especially from-claude.md, from-claude-code.md and from-claude-chats.md if they exist).
2. Look at what's connected (skip anything not available): their calendar for the next 2 weeks and last week, important emails from the last 2 weeks, school or work tools (Canvas, Notion, Slack, Drive) for deadlines and active projects, WhatsApp recent chats (whatsapp_recent_chats), and recently changed documents on their Mac (find_files for common words like "resume", "notes", "plan").
3. Write or update these files (keep anything already there that's still true, keep them tidy, dated facts):
   - me/about-me.md: who they are, work/school, daily routine, preferences, how they talk
   - me/people.md: the important people and how they relate
   - me/deadlines.md: upcoming due dates and commitments, soonest first
   - me/projects.md: active projects and where each stands
   - me/goals.md: goals they've mentioned (only if any)
   Never store passwords, ID numbers, card numbers or anything like that.
4. Finish with a short friendly summary of what you learned, and suggest 2 or 3 routines that would help them (like a morning brief or a deadline check), each as [[do: label | set up a routine that ...]].`;
const EXPORT_PROMPT = () => `${who()} gave you their Claude data export (their past Claude chats) in me/.claude-export/. Learn from it so you know them well. Read only.
The JSON files can be big: use Grep and Read with offsets instead of reading whole files. Look at conversation titles and their own messages; memories.json (if present) matters most.
Write me/from-claude-chats.md: durable facts about them (who they are, work, school, projects, people, routines, goals, preferences, how they like answers), grouped and dated when possible. Skip one-off questions. Never copy passwords, keys, ID or card numbers.
Finish with a 3 line summary of what you learned.`;

// ---------- appearance ----------
function applyTheme() {
  const th = prefs.theme || {};
  nativeTheme.themeSource = ['light', 'dark'].includes(th.mode) ? th.mode : 'system';
  send('theme', th); sendSettings('theme', th);
}

// ---------- hotkey ----------
function registerHotkey() {
  try { globalShortcut.unregisterAll(); } catch (_) {}
  try { globalShortcut.register(prefs.hotkey || 'Alt+Space', () => { showLuna(); app.focus({ steal: true }); if (win) win.focus(); send('summon', true); }); } catch (_) {}
}

// ---------- settings window (claude-style) ----------
let settingsWin = null;
function openSettings(section) {
  if (settingsWin && !settingsWin.isDestroyed()) { settingsWin.show(); settingsWin.focus(); if (section) settingsWin.webContents.send('settings:go', section); return; }
  if (process.platform === 'darwin' && app.dock) app.dock.show();
  settingsWin = new BrowserWindow({
    width: 920, height: 660, minWidth: 760, minHeight: 520, title: 'Settings', titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 16, y: 18 },
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1F1E1B' : '#FAF8F3', show: false,
    webPreferences: { preload: path.join(__dirname, 'preload-settings.js'), contextIsolation: true, nodeIntegration: false }
  });
  settingsWin.loadFile('settings.html', section ? { hash: section } : undefined);
  settingsWin.once('ready-to-show', () => { settingsWin.show(); app.focus({ steal: true }); });
  settingsWin.on('closed', () => { settingsWin = null; if (process.platform === 'darwin' && app.dock && !(chatWin && !chatWin.isDestroyed())) app.dock.hide(); });
}
function sendSettings(ch, data) { if (settingsWin && !settingsWin.isDestroyed()) settingsWin.webContents.send(ch, data); }
ipcMain.on('open-settings', (_e, section) => openSettings(section));

const MEM_OK = (rel) => /^(me\/[\w .-]+\.md|notes\.md)$/.test(rel) && !rel.includes('..');
function memoryFiles() {
  const out = [];
  try { for (const f of fs.readdirSync(path.join(__dirname, 'me'))) if (f.endsWith('.md')) { const st = fs.statSync(path.join(__dirname, 'me', f)); out.push({ path: 'me/' + f, size: st.size, updated: st.mtimeMs }); } } catch (_) {}
  try { const st = fs.statSync(path.join(__dirname, 'notes.md')); out.push({ path: 'notes.md', size: st.size, updated: st.mtimeMs }); } catch (_) {}
  return out.sort((a, b) => b.updated - a.updated);
}
function settingsState() {
  return {
    prefs: { ...prefs, secrets: undefined },
    keys: Object.fromEntries(Object.keys(PROVIDERS).concat('anthropic').map((p) => [p, Boolean(getSecret(p))])),
    providers: PROVIDERS,
    claudeFound: Boolean(claudeBin || findClaude()),
    loginOn: loginOn(),
    memory: memoryFiles(),
    characters: listCharacters(),
    jobs: [...jobs.entries()].map(([id, j]) => ({ id, title: j.title, started: j.started })),
    watch: watch ? { contact: watch.contact, until: watch.until } : null,
    trusted: isTrusted(),
    version: require('./package.json').version,
    folder: __dirname,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
  };
}
ipcMain.handle('settings:get', () => settingsState());
ipcMain.handle('settings:set', (_e, key, value) => {
  const allowed = ['userName', 'charName', 'charIcon', 'roam', 'autoSpeak', 'proactive', 'pulseMin', 'model', 'provider', 'quietFrom', 'quietTo', 'reminders', 'hotkey', 'onboarded', 'charScale', 'brainFileId', 'theme', 'work', 'personalPrefs', 'tapOpens', 'scanModel', 'effort', 'waNotify', 'bgBrowser'];
  if (key === 'providerConfig') { prefs.providers = prefs.providers || {}; prefs.providers[value.provider] = { ...(prefs.providers[value.provider] || {}), ...value.config }; savePrefs(); return settingsState(); }
  if (key === 'trust') { setTrust(value); return settingsState(); }
  if (key === 'login') { setLogin(Boolean(value)); return settingsState(); }
  if (!allowed.includes(key)) return settingsState();
  prefs[key] = value; savePrefs();
  if (key === 'roam') send('roam', value);
  if (key === 'autoSpeak') send('voice', value);
  if (key === 'provider') { stopBrain(); sessionId = null; agentHistory = []; if (isClaude()) discoverServers(); }
  if (key === 'model') { stopBrain(); }
  if (key === 'hotkey') registerHotkey();
  if (key === 'charScale') send('character', characterInfo());
  if (key === 'theme') applyTheme();
  if (key === 'tapOpens') send('config', publicConfig());
  if (key === 'effort' || key === 'bgBrowser') stopBrain();
  if (['userName', 'charName', 'charIcon', 'quietFrom', 'quietTo', 'work', 'personalPrefs'].includes(key)) { writeIdentity(); send('config', publicConfig()); if (tray) tray.setTitle(prefs.charIcon || '🦎'); }
  refreshTray();
  return settingsState();
});
ipcMain.handle('settings:secret', (_e, name, value) => { setSecret(name, String(value || '').trim()); if (name === prefs.provider) { stopBrain(); agentHistory = []; } return settingsState(); });
ipcMain.handle('settings:models', async (_e, provider) => {
  const c = (prefs.providers || {})[provider] || {};
  return listModels({ provider, baseURL: c.baseURL, key: getSecret(provider) });
});
ipcMain.handle('settings:test', async () => {
  const t0 = Date.now();
  try { const r = await runBackground('Reply with exactly: hi! i can hear you', { quick: true, timeoutMs: 60000 }).done; return { ok: true, text: r, ms: Date.now() - t0 }; }
  catch (e) { return { ok: false, text: e.message, ms: Date.now() - t0 }; }
});
// memory
ipcMain.handle('memory:read', (_e, rel) => (MEM_OK(rel) ? fs.readFileSync(path.join(__dirname, rel), 'utf8') : ''));
ipcMain.handle('memory:write', (_e, rel, text) => { if (!MEM_OK(rel) || /activity\.md$|identity\.md$/.test(rel)) return false; fs.writeFileSync(path.join(__dirname, rel), String(text)); return true; });
ipcMain.handle('memory:delete', (_e, rel) => { if (!MEM_OK(rel) || /identity\.md$/.test(rel)) return false; try { fs.unlinkSync(path.join(__dirname, rel)); } catch (_) {} return true; });
ipcMain.handle('memory:import', (_e, source, text) => {
  const f = path.join(__dirname, 'me', `imported-from-${String(source).toLowerCase().replace(/[^a-z]/g, '') || 'ai'}.md`);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, `# what ${source} knew about ${who()} (imported ${stamp()})\n\n${String(text).trim()}\n`);
  return memoryFiles();
});
ipcMain.handle('memory:forget', async (_e, thing) => {
  const r = runBackground(`Remove everything about "${thing}" from the files in me/ and notes.md (edit the files directly; keep everything else). Reply with one line saying what you removed.`);
  try { return await r.done; } catch (e) { return 'could not: ' + e.message; }
});
// automations
ipcMain.handle('routine:add', (_e, r) => { addRoutine(r.when, r.title, r.instructions); return settingsState(); });
ipcMain.handle('routine:remove', (_e, title) => { removeRoutine(title); return settingsState(); });
ipcMain.handle('routine:run', (_e, title) => { const r = (prefs.routines || []).find((x) => x.title === title); if (r) startJob(r.title, r.instructions, true); return true; });
ipcMain.handle('job:stop', (_e, id) => { stopJob(id); return settingsState(); });
ipcMain.handle('watch:stop', () => { stopWatch(); return settingsState(); });
ipcMain.handle('checkin:now', () => { pulse(true); return true; });
// activity
ipcMain.handle('activity:get', () => { try { return fs.readFileSync(path.join(__dirname, 'me', 'activity.md'), 'utf8').split('\n').filter(Boolean).slice(-300).reverse(); } catch (_) { return []; } });
// characters
ipcMain.handle('char:pick', async () => {
  const r = await dialog.showOpenDialog(settingsWin, { title: 'Pick a character (a picture, or a 3D model)', properties: ['openFile'], filters: [{ name: 'Pictures and 3D models', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'glb', 'vrm'] }] });
  if (r.canceled || !r.filePaths[0]) return null;
  const f = r.filePaths[0]; const ext = path.extname(f).slice(1).toLowerCase().replace('jpg', 'jpeg');
  const name = path.basename(f).replace(/\.[^.]+$/, '');
  if (ext === 'glb' || ext === 'vrm') {
    if (fs.statSync(f).size > 60 * 1024 * 1024) return { error: 'that model is over 60 MB. try a lighter version (under 20 MB works best).' };
    return { name, kind: '3d', glb: fs.readFileSync(f).toString('base64') };
  }
  return { name, kind: 'image', dataUrl: `data:image/${ext};base64,` + fs.readFileSync(f).toString('base64') };
});
ipcMain.handle('char:scan', async (_e, pngDataUrl, prevRig) => {
  try { return { ok: true, rig: await scanCharacter(pngDataUrl, prevRig) }; } catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('char:save', (_e, name, data) => {
  fs.mkdirSync(CHARS, { recursive: true });
  const id = (String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'buddy');
  if (typeof data === 'string') data = { kind: 'image', png: data };
  if (data.kind === '3d') {
    fs.writeFileSync(path.join(CHARS, id + '.glb'), Buffer.from(String(data.glb), 'base64'));
    if (data.thumb) fs.writeFileSync(path.join(CHARS, id + '.thumb.png'), Buffer.from(String(data.thumb).split(',')[1], 'base64'));
    if (data.info) fs.writeFileSync(path.join(CHARS, id + '.json'), JSON.stringify(data.info));
    prefs.character = { type: '3d', file: id + '.glb', name };
  } else {
    fs.writeFileSync(path.join(CHARS, id + '.png'), Buffer.from(String(data.png).split(',')[1], 'base64'));
    if (data.rig) fs.writeFileSync(path.join(CHARS, id + '.json'), JSON.stringify(data.rig));
    saveBack(id + '.png', data.back);
    // animated characters: all frames side by side in one picture, plus their timing
    for (const f of [id + '.anim.png', id + '.anim.json']) { try { fs.unlinkSync(path.join(CHARS, f)); } catch (_) {} }
    if (data.anim && String(data.anim.strip).startsWith('data:image/png;base64,')) { fs.writeFileSync(path.join(CHARS, id + '.anim.png'), Buffer.from(data.anim.strip.split(',')[1], 'base64')); fs.writeFileSync(path.join(CHARS, id + '.anim.json'), JSON.stringify({ n: Number(data.anim.n) || 1, delays: (data.anim.delays || []).map(Number) })); }
    prefs.character = { type: 'image', file: id + '.png', name };
  }
  savePrefs(); send('character', characterInfo());
  return settingsState();
});
// custom back-view picture: a data url saves it, null removes it, undefined leaves it alone
function saveBack(id, back) {
  const f = path.join(CHARS, id.replace(/\.png$/, '.back.png'));
  if (back === null) { try { fs.unlinkSync(f); } catch (_) {} } else if (typeof back === 'string' && back.startsWith('data:image/png;base64,')) fs.writeFileSync(f, Buffer.from(back.split(',')[1], 'base64'));
}
ipcMain.handle('char:rig', (_e, id, rig, back) => {
  if (!charId(id) || !id.endsWith('.png')) return settingsState();
  fs.writeFileSync(path.join(CHARS, id.replace(/\.png$/, '.json')), JSON.stringify(rig));
  saveBack(id, back);
  if ((prefs.character || {}).file === id) send('character', characterInfo());
  return settingsState();
});
ipcMain.handle('char:use', (_e, id) => {
  prefs.character = id === 'gecko' || !charId(id) ? { type: 'gecko' } : { type: id.endsWith('.glb') ? '3d' : 'image', file: id, name: id.replace(/\.(png|glb)$/, '') };
  savePrefs(); send('character', characterInfo()); return settingsState();
});
ipcMain.handle('char:delete', (_e, id) => {
  if (id !== 'gecko' && charId(id)) {
    const stem = id.replace(/\.(png|glb)$/, '');
    for (const f of [id, stem + '.json', stem + '.thumb.png', stem + '.back.png', stem + '.anim.png', stem + '.anim.json']) { try { fs.unlinkSync(path.join(CHARS, f)); } catch (_) {} }
    if ((prefs.character || {}).file === id) { prefs.character = { type: 'gecko' }; savePrefs(); send('character', characterInfo()); }
  }
  return settingsState();
});
// mac permissions shortcuts
ipcMain.handle('open:pane', (_e, pane) => {
  const panes = { accessibility: 'Privacy_Accessibility', screen: 'Privacy_ScreenCapture', automation: 'Privacy_Automation', disk: 'Privacy_AllFiles', mic: 'Privacy_Microphone' };
  if (panes[pane]) shell.openExternal('x-apple.systempreferences:com.apple.preference.security?' + panes[pane]);
  else if (pane === 'folder') shell.openPath(__dirname);
  else if (pane === 'outputs') { fs.mkdirSync(OUTPUTS, { recursive: true }); shell.openPath(OUTPUTS); }
  else if (/^https:\/\//.test(pane)) shell.openExternal(pane);
  return true;
});
ipcMain.handle('app:action', (_e, what) => {
  if (what === 'hide') hideLuna();
  if (what === 'show') showLuna();
  if (what === 'quit') app.quit();
  if (what === 'newchat') { stopBrain(); sessionId = null; agentHistory = []; }
  if (what === 'discover') discoverServers();
  return true;
});

if (process.platform === 'darwin' && app.dock) app.dock.hide();
if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', showLuna); // opening Luna again just brings her back

app.whenReady().then(() => {
  try { fs.writeFileSync(path.join(__dirname, 'tools', '.sentinel-trust'), String(prefs.trustUntil || 0)); } catch (_) {}
  claudeBin = findClaude();
  createWindow();
  tray = new Tray(require('electron').nativeImage.createEmpty());
  tray.setTitle(prefs.charIcon || '🦎');
  tray.setToolTip('luna');
  refreshTray();
  makeAppShortcut();
  startBrain();
  writeIdentity();
  applyTheme();
  if (wa.linked()) wa.start(); // reconnect luna's whatsapp line
  connectEverything().catch(() => {}); // their Claude login, Claude app tools and Claude Code memory
  nativeTheme.on('updated', () => sendSettings('theme', prefs.theme));
  if (!prefs.onboarded) openSettings('welcome');
  // option + space from anywhere: luna comes to you with the chat open, ready for typing or dictation
  registerHotkey();
  if (isClaude()) discoverServers(); // find connected apps (Gmail, Calendar, Notion, Slack...) and let luna use them
  lastPulse = Date.now() - prefs.pulseMin * 60000 + 3 * 60000; // first check-in ~3 min after launch
  lastSync = Date.now() - 3 * 3600000 + 10 * 60000; // first memory sync ~10 min after launch
  // welcome back: when you unlock your mac, luna checks if anything happened while you were away
  powerMonitor.on('unlock-screen', () => { lastPulse = 0; setTimeout(() => pulse(false), 4000); });
});
app.on('before-quit', () => { stopBrain(); wa.stop(); });
app.on('window-all-closed', () => app.quit());
