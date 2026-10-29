#!/usr/bin/env node
// luna's own MCP server: background tools that work without touching the screen.
// whatsapp (through luna's linked device), imessage/sms, email with attachments (Mail app, hidden),
// contacts lookup, and finding any file on the mac. claude code talks to it over stdio.
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const { execFile } = require('child_process');

const API = path.join(__dirname, '.luna-api.json');
// (if Luna isn't open, these tools say so; everything else works on its own)
function callLuna(route, body) {
  let cfg; try { cfg = JSON.parse(fs.readFileSync(API, 'utf8')); } catch (_) { return Promise.reject(new Error('Luna is not open on this Mac. Open Luna, then try again.')); }
  const data = JSON.stringify(body || {});
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: cfg.port, path: route, method: 'POST', headers: { 'content-type': 'application/json', 'x-luna': cfg.token, 'content-length': Buffer.byteLength(data) }, timeout: 60000 }, (res) => {
      let out = ''; res.on('data', (d) => (out += d)); res.on('end', () => { try { const j = JSON.parse(out); j.ok ? resolve(j.result) : reject(new Error(j.error || 'failed')); } catch (_) { reject(new Error('bad reply from luna')); } });
    });
    req.on('error', reject); req.on('timeout', () => req.destroy(new Error('timed out')));
    req.end(data);
  });
}
const run = (cmd, args, ms = 60000) => new Promise((resolve, reject) => execFile(cmd, args, { timeout: ms, maxBuffer: 4e6 }, (e, out, err) => (e ? reject(new Error((err || e.message).trim())) : resolve(String(out).trim()))));
const osa = (script, args) => run('osascript', ['-e', script, ...args.map(String)]);
const home = (p) => path.resolve(String(p).replace(/^~(?=\/|$)/, os.homedir()));

const IMESSAGE = `on run argv
  set target to item 1 of argv
  set msg to item 2 of argv
  set f to item 3 of argv
  tell application "Messages"
    set svc to 1st account whose service type = iMessage
    try
      set p to participant target of svc
    on error
      set svc to 1st account whose service type = SMS
      set p to participant target of svc
    end try
    if msg is not "" then send msg to p
    if f is not "" then send (POSIX file f) to p
  end tell
  return "sent"
end run`;
const MAIL = `on run argv
  set toList to item 1 of argv
  set subj to item 2 of argv
  set bodyText to item 3 of argv
  set doSend to item 4 of argv
  tell application "Mail"
    set m to make new outgoing message with properties {subject:subj, content:bodyText & return & return, visible:false}
    set AppleScript's text item delimiters to ","
    repeat with addr in text items of toList
      tell m to make new to recipient at end of to recipients with properties {address:(addr as text)}
    end repeat
    set AppleScript's text item delimiters to ""
    repeat with i from 5 to count of argv
      tell content of m to make new attachment with properties {file name:(POSIX file (item i of argv))} at after last paragraph
    end repeat
    if doSend is "send" then
      delay 1
      send m
      return "sent"
    else
      set visible of m to true
      return "draft opened"
    end if
  end tell
end run`;
const CONTACTS = `on run argv
  set q to item 1 of argv
  set out to ""
  tell application "Contacts"
    repeat with p in (every person whose name contains q)
      set ph to ""
      repeat with x in phones of p
        set ph to ph & (value of x) & " "
      end repeat
      set em to ""
      repeat with x in emails of p
        set em to em & (value of x) & " "
      end repeat
      set out to out & (name of p) & " | phones: " & ph & "| emails: " & em & linefeed
    end repeat
  end tell
  return out
end run`;

const TOOLS = [
  // shared with the Claude app (when bridged): Claude can hand luna what it knows, or ask luna to remind / notify
  { name: 'luna_save_memory', description: "Save what you know about the user into Luna (their desktop assistant), so Luna knows them too. When the user asks to sync or share memory with Luna, pass EVERYTHING you remember about them (saved memories and durable facts from past chats), verbatim, as one plain-text list. mode 'replace' (default) or 'append'.", inputSchema: { type: 'object', properties: { text: { type: 'string' }, title: { type: 'string' }, mode: { type: 'string', enum: ['replace', 'append'] } }, required: ['text'] }, go: (a) => callLuna('/mem/save', a) },
  { name: 'luna_read_memory', description: "Read what Luna (the user's desktop assistant) knows about them: profile, people, deadlines, projects, goals, notes.", inputSchema: { type: 'object', properties: {} }, go: () => callLuna('/mem/read', {}) },
  { name: 'luna_notify', description: "Show a message to the user from Luna on their desktop (a little tap on the shoulder).", inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] }, go: (a) => callLuna('/notify', a) },
  { name: 'luna_add_routine', description: 'Give Luna a recurring task on the user\'s Mac. when: "daily 07:30", "weekdays 09:00", "mon,thu 18:00", "every 3h". instructions: what Luna should do each time.', inputSchema: { type: 'object', properties: { when: { type: 'string' }, title: { type: 'string' }, instructions: { type: 'string' } }, required: ['when', 'title', 'instructions'] }, go: (a) => callLuna('/routine/add', a) },
  { name: 'whatsapp_send', description: 'Send a WhatsApp message in the background (no typing on screen). "to" is a contact or group name, or a phone number with country code.', inputSchema: { type: 'object', properties: { to: { type: 'string' }, message: { type: 'string' } }, required: ['to', 'message'] }, go: (a) => callLuna('/wa/send', a) },
  { name: 'whatsapp_send_file', description: 'Send a file, photo or video on WhatsApp in the background. "path" is a full file path on the Mac (use find_files to get it). Optional caption.', inputSchema: { type: 'object', properties: { to: { type: 'string' }, path: { type: 'string' }, caption: { type: 'string' } }, required: ['to', 'path'] }, go: (a) => callLuna('/wa/file', { ...a, path: home(a.path) }) },
  { name: 'whatsapp_read', description: 'Read the latest messages in a WhatsApp chat (contact or group name, or number).', inputSchema: { type: 'object', properties: { chat: { type: 'string' }, count: { type: 'number' } }, required: ['chat'] }, go: (a) => callLuna('/wa/read', a) },
  { name: 'whatsapp_recent_chats', description: 'List the most recent WhatsApp chats with their last message and unread count.', inputSchema: { type: 'object', properties: { limit: { type: 'number' } } }, go: (a) => callLuna('/wa/chats', a) },
  { name: 'whatsapp_find_contact', description: 'Find WhatsApp contacts or groups by name or number.', inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] }, go: (a) => callLuna('/wa/find', a) },
  { name: 'imessage_send', description: 'Send an iMessage (or SMS if they are not on iMessage) in the background through the Messages app. "to" must be a phone number or Apple ID email (use contacts_lookup for a name). Optional file path to attach.', inputSchema: { type: 'object', properties: { to: { type: 'string' }, message: { type: 'string' }, file: { type: 'string' } }, required: ['to'] }, go: (a) => osa(IMESSAGE, [a.to, a.message || '', a.file ? home(a.file) : '']).then(() => `sent to ${a.to}`) },
  { name: 'email_send', description: 'Send an email (with optional file attachments) in the background through the Mac Mail app. "to" is comma separated emails. mode "send" sends it, "draft" opens it for the user to check.', inputSchema: { type: 'object', properties: { to: { type: 'string' }, subject: { type: 'string' }, body: { type: 'string' }, attachments: { type: 'array', items: { type: 'string' } }, mode: { type: 'string', enum: ['send', 'draft'] } }, required: ['to', 'subject', 'body'] },
    go: (a) => { const files = (a.attachments || []).map(home); for (const f of files) if (!fs.existsSync(f)) throw new Error('attachment not found: ' + f); return osa(MAIL, [a.to, a.subject, a.body, a.mode === 'draft' ? 'draft' : 'send', ...files]); } },
  { name: 'contacts_lookup', description: "Look up people in the Mac's Contacts app by name: returns their phone numbers and emails.", inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] }, go: (a) => osa(CONTACTS, [a.name]).then((t) => t || 'no contact found') },
  { name: 'find_files', description: 'Find files on the Mac by name (Spotlight). Returns full paths, newest first. Use it before sending a document. Optional "kind": pdf, doc, slides, sheet, image, video.', inputSchema: { type: 'object', properties: { query: { type: 'string' }, kind: { type: 'string' } }, required: ['query'] },
    go: async (a) => {
      const ext = { pdf: ['pdf'], doc: ['doc', 'docx', 'pages', 'txt', 'md'], slides: ['ppt', 'pptx', 'key'], sheet: ['xls', 'xlsx', 'csv', 'numbers'], image: ['png', 'jpg', 'jpeg', 'heic', 'webp'], video: ['mp4', 'mov'] }[a.kind] || null;
      const q = String(a.query).replace(/["'\\]/g, '');
      const out = await run('mdfind', ['-onlyin', os.homedir(), `kMDItemDisplayName == "*${q}*"cd`], 20000).catch(() => '');
      let files = out.split('\n').filter((f) => f && !/\/Library\/|\/\.|node_modules|\.app\//.test(f));
      if (ext) files = files.filter((f) => ext.includes(path.extname(f).slice(1).toLowerCase()));
      const withTime = files.slice(0, 200).map((f) => { try { const s = fs.statSync(f); return s.isFile() ? { f, t: s.mtimeMs, size: s.size } : null; } catch (_) { return null; } }).filter(Boolean);
      withTime.sort((x, y) => y.t - x.t);
      return withTime.slice(0, 15).map((x) => `${x.f}  (${new Date(x.t).toLocaleDateString()}, ${Math.round(x.size / 1024)} KB)`).join('\n') || 'no files found';
    } }
];

// ---------- minimal MCP over stdio (newline-delimited JSON-RPC) ----------
let buf = '';
const reply = (id, result, error) => process.stdout.write(JSON.stringify(error ? { jsonrpc: '2.0', id, error } : { jsonrpc: '2.0', id, result }) + '\n');
process.stdin.on('data', (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
    if (!line) continue;
    let msg; try { msg = JSON.parse(line); } catch (_) { continue; }
    handle(msg);
  }
});
async function handle(m) {
  if (m.id === undefined) return; // notifications
  if (m.method === 'initialize') return reply(m.id, { protocolVersion: (m.params && m.params.protocolVersion) || '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'luna', version: '1.0.0' } });
  if (m.method === 'ping') return reply(m.id, {});
  if (m.method === 'tools/list') return reply(m.id, { tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
  if (m.method === 'tools/call') {
    const t = TOOLS.find((x) => x.name === m.params.name);
    if (!t) return reply(m.id, { content: [{ type: 'text', text: 'unknown tool' }], isError: true });
    try { const r = await t.go(m.params.arguments || {}); reply(m.id, { content: [{ type: 'text', text: typeof r === 'string' ? r : JSON.stringify(r, null, 1) }] }); }
    catch (e) { reply(m.id, { content: [{ type: 'text', text: 'error: ' + e.message }], isError: true }); }
    return;
  }
  reply(m.id, null, { code: -32601, message: 'method not found' });
}
