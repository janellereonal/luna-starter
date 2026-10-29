// luna's brain for non-claude models: a small agent loop over any OpenAI-compatible API
// (OpenAI, Google Gemini, OpenRouter, Ollama, LM Studio, or a custom endpoint).
// claude users go through Claude Code instead (main.js), which brings its own tools and connectors.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { needsApproval } = require('./rules');

const PROVIDERS = {
  openai: { label: 'OpenAI (GPT)', baseURL: 'https://api.openai.com/v1', needsKey: true, keyUrl: 'https://platform.openai.com/api-keys' },
  gemini: { label: 'Google Gemini', baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai', needsKey: true, keyUrl: 'https://aistudio.google.com/apikey' },
  openrouter: { label: 'OpenRouter (any model)', baseURL: 'https://openrouter.ai/api/v1', needsKey: true, keyUrl: 'https://openrouter.ai/keys' },
  ollama: { label: 'Ollama (free, runs on your Mac)', baseURL: 'http://localhost:11434/v1', needsKey: false, keyUrl: 'https://ollama.com/download' },
  custom: { label: 'Custom (OpenAI-compatible)', baseURL: '', needsKey: false, keyUrl: '' }
};

function makeAgent(opts) {
  // opts: { root, getConfig: () => ({ provider, baseURL, model, key }), approve(summary, why) => Promise<bool>, log(line), onStatus(text) }
  const root = opts.root;
  const ALLOWED_READ = [/^me\//, /^notes\.md$/, /^outputs\//, /^CLAUDE\.md$/];
  const ALLOWED_WRITE = [/^me\/(?!activity\.md$)/, /^notes\.md$/, /^outputs\//];
  const safe = (p, list) => {
    const rel = path.normalize(String(p || '')).replace(/^(\.\/)+/, '');
    if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
    return list.some((re) => re.test(rel)) ? path.join(root, rel) : null;
  };
  const run = (cmd, args, ms = 30000) => new Promise((resolve) => {
    const c = spawn(cmd, args, { cwd: root });
    let out = '', err = '';
    const t = setTimeout(() => c.kill(), ms);
    c.stdout.on('data', (d) => { out += d; }); c.stderr.on('data', (d) => { err += d; });
    c.on('close', () => { clearTimeout(t); resolve((out || err).trim().slice(0, 6000)); });
    c.on('error', (e) => { clearTimeout(t); resolve('error: ' + e.message); });
  });

  const TOOLS = [
    fn('read_file', 'Read a text file in your folder (me/..., notes.md, outputs/..., CLAUDE.md).', { path: 'string' }, ['path']),
    fn('write_file', 'Create or overwrite a text file in me/, notes.md or outputs/.', { path: 'string', content: 'string' }, ['path', 'content']),
    fn('append_file', 'Append a line to a file in me/, notes.md or outputs/.', { path: 'string', content: 'string' }, ['path', 'content']),
    fn('list_files', 'List files in a folder of yours (me, outputs).', { folder: 'string' }, ['folder']),
    fn('mac', 'Control the Mac with the keyboard: action is one of open, type, enter, key, menu, front, wait. args are its arguments, e.g. ["WhatsApp"] for open, ["hello"] for type, ["tab","cmd"] for key, ["App","Menu","Item"] for menu.', { action: 'string', args: { type: 'array', items: { type: 'string' } } }, ['action']),
    fn('whatsapp_read', 'Read the latest messages with a WhatsApp contact (newest first; me=1 means sent by the user).', { contact: 'string', count: 'number' }, ['contact']),
    fn('whatsapp_send', 'Type a message in a WhatsApp chat. mode "draft" types without sending, "send" sends it.', { contact: 'string', message: 'string', mode: 'string' }, ['contact', 'message']),
    fn('look_at_screen', 'Take a screenshot of the screen so you can see it (to check your work).', {}, []),
    fn('open_url', 'Open a link in the default browser.', { url: 'string' }, ['url']),
    fn('web_fetch', 'Fetch a web page and return its text.', { url: 'string' }, ['url'])
  ];

  async function callTool(name, a) {
    a = a || {};
    const why = needsApproval(name, a);
    const summary = `${name} → ${JSON.stringify(a).slice(0, 200)}`;
    if (why && !(await opts.approve(summary, why))) return 'not approved by the user. do not retry; tell them it was not done.';
    if (!/^(read_file|list_files|whatsapp_read|look_at_screen|web_fetch)$/.test(name)) opts.log(summary);
    switch (name) {
      case 'read_file': { const f = safe(a.path, ALLOWED_READ); if (!f) return 'not allowed'; try { return fs.readFileSync(f, 'utf8').slice(0, 20000); } catch (_) { return 'file not found'; } }
      case 'write_file': case 'append_file': {
        const f = safe(a.path, ALLOWED_WRITE); if (!f) return 'not allowed';
        fs.mkdirSync(path.dirname(f), { recursive: true });
        if (name === 'write_file') fs.writeFileSync(f, String(a.content)); else fs.appendFileSync(f, String(a.content).replace(/\n?$/, '\n'));
        return 'saved';
      }
      case 'list_files': { const f = safe(String(a.folder || 'me') + '/x', ALLOWED_READ); if (!f) return 'not allowed'; try { return fs.readdirSync(path.dirname(f)).join('\n'); } catch (_) { return 'empty'; } }
      case 'mac': return run('osascript', [path.join(root, 'tools', 'mac.applescript'), String(a.action), ...(a.args || []).map(String)]);
      case 'whatsapp_read': return run(path.join(root, 'tools', 'wa-recent.sh'), [String(a.contact), String(a.count || 15)]);
      case 'whatsapp_send': return run('osascript', [path.join(root, 'tools', 'send-whatsapp.applescript'), String(a.contact), String(a.message), a.mode === 'send' ? 'send' : 'draft']);
      case 'look_at_screen': { await run(path.join(root, 'tools', 'look.sh'), []); return '__image__' + path.join(root, 'tools', 'screen.png'); }
      case 'open_url': { if (!/^https?:\/\//.test(String(a.url))) return 'only http(s) links'; return run('open', [String(a.url)]); }
      case 'web_fetch': {
        try {
          const r = await fetch(String(a.url), { headers: { 'user-agent': 'Mozilla/5.0 Luna' } });
          const t = await r.text();
          return t.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 12000);
        } catch (e) { return 'could not fetch: ' + e.message; }
      }
    }
    return 'unknown tool';
  }

  function systemPrompt() {
    let s = '';
    try { s += fs.readFileSync(path.join(root, 'CLAUDE.md'), 'utf8'); } catch (_) {}
    s += '\n\n# what you know (files in me/)\n';
    try {
      for (const f of fs.readdirSync(path.join(root, 'me')).filter((x) => x.endsWith('.md') && !/activity|chat-log/.test(x))) {
        s += `\n## me/${f}\n` + fs.readFileSync(path.join(root, 'me', f), 'utf8').slice(0, 8000);
      }
    } catch (_) {}
    s += `\n\nTools: you don't have Claude Code's tools here. Use the functions you're given (files, mac, whatsapp, look_at_screen, open_url, web_fetch). Current time: ${new Date().toString()}.`;
    return s.slice(0, 60000);
  }

  async function chatOnce(messages) {
    const c = opts.getConfig();
    const base = (c.baseURL || (PROVIDERS[c.provider] || {}).baseURL || '').replace(/\/$/, '');
    if (!base) throw new Error('no API address set. open settings > brain');
    if (!c.model) throw new Error('pick a model in settings > brain');
    const r = await fetch(base + '/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(c.key ? { authorization: 'Bearer ' + c.key } : {}) },
      body: JSON.stringify({ model: c.model, messages, tools: TOOLS, tool_choice: 'auto' })
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error((j.error && (j.error.message || j.error)) || `${r.status} ${r.statusText}`);
    return j.choices && j.choices[0] && j.choices[0].message;
  }

  // one conversation turn with tool use. history is kept by the caller.
  async function turn(history, userText, { maxSteps = 12, signal } = {}) {
    const msgs = [{ role: 'system', content: systemPrompt() }, ...history, { role: 'user', content: userText }];
    for (let step = 0; step < maxSteps; step++) {
      if (signal && signal.aborted) throw new Error('stopped');
      const m = await chatOnce(msgs);
      if (!m) throw new Error('empty reply from the model');
      msgs.push(m);
      if (!m.tool_calls || !m.tool_calls.length) {
        history.push({ role: 'user', content: userText }, { role: 'assistant', content: m.content || '' });
        while (history.length > 30) history.shift();
        return String(m.content || '').trim();
      }
      for (const tc of m.tool_calls) {
        opts.onStatus && opts.onStatus('checking...');
        let args = {}; try { args = JSON.parse(tc.function.arguments || '{}'); } catch (_) {}
        let out = await callTool(tc.function.name, args);
        if (out.startsWith('__image__')) {
          const file = out.slice(9);
          msgs.push({ role: 'tool', tool_call_id: tc.id, content: 'screenshot taken, attached below' });
          try { msgs.push({ role: 'user', content: [{ type: 'text', text: '(screenshot for your last step)' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,' + fs.readFileSync(file).toString('base64') } }] }); } catch (_) {}
          continue;
        }
        msgs.push({ role: 'tool', tool_call_id: tc.id, content: String(out) });
      }
    }
    return 'i ran out of steps on that one, want me to keep going?';
  }

  // plain one-shot text (for quick auto-replies)
  async function complete(prompt) {
    const c = opts.getConfig();
    const base = (c.baseURL || (PROVIDERS[c.provider] || {}).baseURL || '').replace(/\/$/, '');
    const r = await fetch(base + '/chat/completions', {
      method: 'POST', headers: { 'content-type': 'application/json', ...(c.key ? { authorization: 'Bearer ' + c.key } : {}) },
      body: JSON.stringify({ model: c.model, messages: [{ role: 'user', content: prompt }] })
    });
    const j = await r.json();
    return String((j.choices && j.choices[0].message.content) || '').trim();
  }

  // look at a picture and answer (used to scan custom characters)
  async function see(prompt, dataUrl) {
    const c = opts.getConfig();
    const base = (c.baseURL || (PROVIDERS[c.provider] || {}).baseURL || '').replace(/\/$/, '');
    const r = await fetch(base + '/chat/completions', {
      method: 'POST', headers: { 'content-type': 'application/json', ...(c.key ? { authorization: 'Bearer ' + c.key } : {}) },
      body: JSON.stringify({ model: c.model, messages: [{ role: 'user', content: [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: dataUrl } }] }] })
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error((j.error && (j.error.message || j.error)) || r.statusText);
    return String((j.choices && j.choices[0].message.content) || '').trim();
  }

  return { turn, complete, see };
}

async function listModels({ provider, baseURL, key }) {
  const base = (baseURL || (PROVIDERS[provider] || {}).baseURL || '').replace(/\/$/, '');
  const r = await fetch(base + '/models', { headers: key ? { authorization: 'Bearer ' + key } : {} });
  const j = await r.json();
  if (!r.ok) throw new Error((j.error && (j.error.message || j.error)) || r.statusText);
  return (j.data || j.models || []).map((m) => String(m.id || m.name || '').replace(/^models\//, '')).filter(Boolean).sort();
}

function fn(name, description, props, required) {
  const properties = {};
  for (const [k, v] of Object.entries(props)) properties[k] = typeof v === 'string' ? { type: v } : v;
  return { type: 'function', function: { name, description, parameters: { type: 'object', properties, required } } };
}

module.exports = { makeAgent, listModels, PROVIDERS };
