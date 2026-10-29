// copies your Canvas MCP server from the Claude desktop app so Luna can check your dues.
// looks in the app config first, then in installed desktop extensions.
const fs = require('fs');
const os = require('os');
const path = require('path');

const out = path.join(__dirname, '.mcp.json');
const force = process.argv.includes('--force');
if (fs.existsSync(out) && !force) process.exit(0);

const base = path.join(os.homedir(), 'Library/Application Support/Claude');
const save = (server, from) => {
  fs.writeFileSync(out, JSON.stringify({ mcpServers: { canvas: server } }, null, 2));
  console.log('✓ hooked luna up to your canvas (from ' + from + ')');
  process.exit(0);
};

// 1) plain config file
try {
  const servers = JSON.parse(fs.readFileSync(path.join(base, 'claude_desktop_config.json'), 'utf8')).mcpServers || {};
  const key = Object.keys(servers).find((k) => /canvas/i.test(k));
  if (key) save(servers[key], 'claude app config');
} catch (_) {}

// 2) desktop extensions
const extDir = path.join(base, 'Claude Extensions');
const setDir = path.join(base, 'Claude Extensions Settings');
let dirs = [];
try { dirs = fs.readdirSync(extDir); } catch (_) {}
for (const id of dirs) {
  const dir = path.join(extDir, id);
  let m;
  try { m = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')); } catch (_) { continue; }
  const label = [id, m.name, m.display_name].filter(Boolean).join(' ');
  if (!/canvas/i.test(label)) continue;
  const cfg = (m.server && m.server.mcp_config) || {};
  let user = {};
  try { user = JSON.parse(fs.readFileSync(path.join(setDir, id + '.json'), 'utf8')).userConfig || {}; } catch (_) {}
  // fill defaults for anything not set
  for (const [k, v] of Object.entries(m.user_config || {})) if (user[k] === undefined && v && v.default !== undefined) user[k] = v.default;
  const fill = (s) => String(s)
    .replace(/\$\{__dirname\}/g, dir)
    .replace(/\$\{HOME\}/g, os.homedir())
    .replace(/\$\{pathSeparator\}|\$\{\/\}/g, '/')
    .replace(/\$\{user_config\.([^}]+)\}/g, (_, k) => (user[k] !== undefined ? String(user[k]) : ''));
  const server = { command: fill(cfg.command || 'node') };
  if (cfg.args) server.args = cfg.args.map(fill);
  if (cfg.env) server.env = Object.fromEntries(Object.entries(cfg.env).map(([k, v]) => [k, fill(v)]));
  save(server, 'extension "' + (m.display_name || m.name || id) + '"');
}

console.log('no canvas connection found in the claude app, luna will work without canvas');
