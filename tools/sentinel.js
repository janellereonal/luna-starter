// sentinel: luna's independent safety checker. claude code runs this before and after every tool luna uses.
// it doesn't ask the ai whether something is risky; it follows fixed rules here.
//   - reading, searching, drafting, local files: allowed
//   - messages and normal actions: allowed and logged
//   - payments, deleting, public posts, sharing files, publishing workflows: the user must tap Approve in luna's chat
// every action that changes something is written to me/activity.md
const fs = require('fs');
const path = require('path');
const http = require('http');

const ROOT = path.join(__dirname, '..');
const LOG = path.join(ROOT, 'me', 'activity.md');

let raw = '';
process.stdin.on('data', (d) => { raw += d; });
process.stdin.on('end', () => {
  let e = {};
  try { e = JSON.parse(raw); } catch (_) { process.exit(0); }
  const tool = String(e.tool_name || '');
  const input = e.tool_input || {};
  // rules look at what the action IS (tool, url, button, command), not at the words inside a message
  const MSG = new Set(['text', 'body', 'message', 'content', 'html', 'markdown', 'caption', 'description', 'notes']);
  let blob = JSON.stringify(Object.fromEntries(Object.entries(input).filter(([k]) => !MSG.has(k)))).slice(0, 4000);
  if (tool === 'Bash' && /^osascript tools\/(send-whatsapp|mac)\.applescript/.test(String(input.command || ''))) blob = '';
  const summary = describe(tool, input);

  if (e.hook_event_name === 'PostToolUse') {
    if (!isReadOnly(tool, input)) log(summary);
    process.exit(0);
  }

  // PreToolUse
  if (isReadOnly(tool, input)) process.exit(0);
  const why = needsApproval(tool, blob);
  if (!why) process.exit(0);
  // full trust mode (set from the 🦎 menu): skip the card, but still log it
  if (trusted()) { log(`[auto-approved: ${why}] ${summary}`); out('allow', 'full trust mode is on'); return; }
  askUser(summary, why).then((ok) => {
    out(ok ? 'allow' : 'deny', ok ? 'approved by the user' : 'the user said no (or didn’t answer). don’t retry; tell them it was not done.');
  });
});

function trusted() {
  try { const until = Number(fs.readFileSync(path.join(__dirname, '.sentinel-trust'), 'utf8')); return until === -1 || Date.now() < until; } catch (_) { return false; }
}
function out(decision, reason) {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: decision, permissionDecisionReason: reason } }));
  process.exit(0);
}

function isReadOnly(tool, input) {
  if (/^(Read|Glob|Grep|WebSearch|WebFetch|TodoWrite|Task|ToolSearch)$/.test(tool)) return true;
  if (tool === 'Bash') {
    const c = String(input.command || '');
    return /^(tools\/look\.sh|tools\/wa-recent\.sh)/.test(c) || /mac\.applescript" ?(front|wait)|mac\.applescript (front|wait)/.test(c);
  }
  if (tool.startsWith('mcp__')) {
    const name = tool.split('__').slice(2).join('__');
    return /^(get|list|search|read|fetch|query|find|view|describe|download|resolve|count|check|browser_snapshot|browser_take_screenshot|browser_tabs|browser_console|browser_network|browser_wait)/i.test(name);
  }
  return false;
}

// fixed rules: these always need the user's tap, no matter what the ai thinks
const RULES = [
  [/checkout|place[ _-]?order|purchase|buy now|\bpay(ment)?\b|credit card|card number|gcash|maya|bank transfer|subscribe/i, 'money'],
  [/delete|trash|remove|unpublish|archive|empty[_ ]?trash|drop table|rm -/i, 'deleting'],
  [/create_post|publish_post|share_post|tweet|story|post_to_(feed|page)|comment_on|reply_to_comment/i, 'posting publicly'],
  [/share_file|permissions|make_public|anyone with the link/i, 'sharing files'],
  [/publish_workflow|activate_workflow|update_workflow|archive_workflow|publish_agent/i, 'changing an n8n workflow'],
  [/send_bulk|bulk_|mass_/i, 'bulk sending']
];
function needsApproval(tool, blob) {
  const hay = tool + ' ' + blob;
  for (const [re, why] of RULES) if (re.test(hay)) return why;
  return null;
}

function describe(tool, input) {
  const t = tool.replace(/^mcp__/, '').replace(/__/g, ' > ').replace(/claude_ai_/g, '');
  let detail = '';
  if (tool === 'Bash') detail = String(input.command || '');
  else if (input.file_path) detail = String(input.file_path).replace(ROOT + '/', '');
  else {
    const pick = ['to', 'recipient', 'channel', 'subject', 'title', 'summary', 'name', 'url', 'element', 'text', 'body', 'message', 'content'];
    detail = pick.filter((k) => input[k]).map((k) => `${k}: ${String(typeof input[k] === 'string' ? input[k] : JSON.stringify(input[k])).slice(0, 120)}`).join(' | ');
  }
  return `${t}${detail ? ' → ' + detail.slice(0, 300) : ''}`;
}

function log(line) {
  try {
    const n = new Date(); // the mac's own time zone
    const p = (x) => String(x).padStart(2, '0');
    fs.appendFileSync(LOG, `- ${n.getFullYear()}-${p(n.getMonth() + 1)}-${p(n.getDate())} ${p(n.getHours())}:${p(n.getMinutes())} | ${line.replace(/\n/g, ' ')}\n`);
  } catch (_) {}
}

// ask the user through luna's chat (approve / deny card). no answer in 2 minutes = no.
function askUser(summary, why) {
  return new Promise((resolve) => {
    let port;
    try { port = Number(fs.readFileSync(path.join(__dirname, '.sentinel-port'), 'utf8')); } catch (_) { return resolve(false); }
    const body = JSON.stringify({ summary, why });
    const req = http.request({ host: '127.0.0.1', port, path: '/approve', method: 'POST', headers: { 'content-type': 'application/json' }, timeout: 130000 }, (res) => {
      let d = ''; res.on('data', (c) => { d += c; }); res.on('end', () => { try { resolve(JSON.parse(d).ok === true); } catch (_) { resolve(false); } });
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.end(body);
  });
}
