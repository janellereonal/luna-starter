#!/usr/bin/env node
// luna's local checks ("local CI"). run before keeping any change:   node scripts/check.js
//   1. every .js file parses
//   2. every .json file is valid
//   3. every module in lib/ is described in HOW-I-WORK.md (so the map of the code stays true)
//   4. the tests in test/*.test.js pass
// no dependencies: plain node. exits 1 if anything fails. this file is guarded (self-improvements can't edit it).
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');
const SKIP = new Set(['node_modules', 'me', '.whatsapp', 'browser-profile', 'characters', 'outputs', '.luna-snapshots', '.git', 'skills']);
const problems = [];
function walk(rel, out = []) {
  for (const n of fs.readdirSync(path.join(ROOT, rel))) {
    const r = rel ? `${rel}/${n}` : n;
    const st = fs.lstatSync(path.join(ROOT, r));
    if (st.isDirectory()) { if (!SKIP.has(n)) walk(r, out); } else out.push(r);
  }
  return out;
}
const files = walk('');

// 1 + 2
for (const f of files) {
  const text = () => fs.readFileSync(path.join(ROOT, f), 'utf8');
  if (f.endsWith('.js')) {
    try { new vm.Script(`(function (exports, require, module, __filename, __dirname) {${text().replace(/^#!.*/, '')}\n})`, { filename: f }); }
    catch (e) { problems.push(`${f}: ${e.message}`); }
  } else if (f.endsWith('.json') && !f.startsWith('tools/')) {
    try { JSON.parse(text()); } catch (e) { problems.push(`${f}: invalid json (${e.message})`); }
  }
}

// 3
let map = ''; try { map = fs.readFileSync(path.join(ROOT, 'HOW-I-WORK.md'), 'utf8'); } catch (_) { problems.push('HOW-I-WORK.md is missing'); }
for (const f of files.filter((x) => /^lib\/[^/]+\.js$/.test(x))) if (map && !map.includes(f)) problems.push(`HOW-I-WORK.md doesn't describe ${f}`);

// 4
const tests = [];
global.test = (name, fn) => tests.push({ name, fn });
global.assert = assert;
for (const f of files.filter((x) => /^test\/.+\.test\.js$/.test(x))) {
  try { require(path.join(ROOT, f)); } catch (e) { problems.push(`${f}: couldn't load (${e.message})`); }
}
(async () => {
  let passed = 0;
  for (const t of tests) {
    try { await t.fn(); passed++; } catch (e) { problems.push(`test "${t.name}": ${e.message.split('\n')[0]}`); }
  }
  const js = files.filter((f) => f.endsWith('.js')).length;
  if (problems.length) {
    console.log(`✗ ${problems.length} problem${problems.length > 1 ? 's' : ''}:\n` + problems.map((p) => '  - ' + p).join('\n'));
    process.exit(1);
  }
  console.log(`✓ all good: ${js} js files parse, ${passed}/${tests.length} tests pass, the code map is up to date`);
})();
