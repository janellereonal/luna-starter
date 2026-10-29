// skills luna writes for herself. each one is a folder in skills/ with a SKILL.md
// (frontmatter: name + a one-line description) and usually a small script she tested once.
// only the one-line descriptions go into her context; she reads the full SKILL.md when she needs it.
// (like command-line tools: cheap to know about, composable, loaded on demand)
const fs = require('fs');
const path = require('path');

function readFrontmatter(text) {
  const m = String(text).match(/^---\s*\n([\s\S]*?)\n---/);
  const meta = {};
  if (m) for (const line of m[1].split('\n')) { const kv = line.match(/^([\w-]+):\s*(.*)$/); if (kv) meta[kv[1]] = kv[2].replace(/^["']|["']$/g, '').trim(); }
  return meta;
}
function listSkills(root) {
  const dir = path.join(root, 'skills');
  let names = []; try { names = fs.readdirSync(dir).filter((n) => !n.startsWith('.')); } catch (_) { return []; }
  const out = [];
  for (const n of names.sort()) {
    const f = path.join(dir, n, 'SKILL.md');
    let text; try { text = fs.readFileSync(f, 'utf8'); } catch (_) { continue; }
    const meta = readFrontmatter(text);
    out.push({ name: meta.name || n, folder: n, description: (meta.description || text.replace(/^---[\s\S]*?---/, '').trim().split('\n')[0] || '').slice(0, 200) });
  }
  return out;
}
const skillLines = (root) => listSkills(root).map((s) => `- ${s.name}: ${s.description} (read skills/${s.folder}/SKILL.md before using)`).join('\n');
module.exports = { listSkills, skillLines, readFrontmatter };
