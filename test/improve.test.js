const fs = require('fs');
const os = require('os');
const path = require('path');
const improve = require('../lib/improve');

function fakeApp() {
  const r = fs.mkdtempSync(path.join(os.tmpdir(), 'luna-app-'));
  const put = (f, t) => { fs.mkdirSync(path.dirname(path.join(r, f)), { recursive: true }); fs.writeFileSync(path.join(r, f), t); };
  put('main.js', 'one\ntwo\n'); put('lib/rules.js', 'rules'); put('tools/sentinel.js', 'sentinel'); put('lib/improve.js', 'x'); put('scripts/check.js', 'c');
  put('me/about-me.md', 'private'); put('.whatsapp/auth/creds.json', '{}'); put('tools/.luna-api.json', '{}');
  return { r, put };
}
test('snapshots only code, never personal files', () => {
  const { r } = fakeApp();
  const files = improve.codeFiles(r);
  assert.ok(files.includes('main.js') && files.includes('lib/rules.js'));
  assert.ok(!files.some((f) => f.startsWith('me/') || f.startsWith('.whatsapp') || f === 'tools/.luna-api.json'));
});
test('changes are listed and undo puts everything back', () => {
  const { r, put } = fakeApp();
  const id = improve.snapshot(r, 'test');
  put('main.js', 'one\nTWO\nthree\n'); put('lib/new.js', 'new'); fs.rmSync(path.join(r, 'scripts/check.js'));
  const ch = improve.changes(r, id);
  assert.deepStrictEqual(ch.map((x) => `${x.kind} ${x.file}`).sort(), ['added lib/new.js', 'changed main.js', 'removed scripts/check.js']);
  improve.restore(r, id);
  assert.strictEqual(fs.readFileSync(path.join(r, 'main.js'), 'utf8'), 'one\ntwo\n');
  assert.ok(!fs.existsSync(path.join(r, 'lib/new.js')) && fs.existsSync(path.join(r, 'scripts/check.js')));
  assert.strictEqual(fs.readFileSync(path.join(r, 'me/about-me.md'), 'utf8'), 'private');
});
test('touching a safety file is caught', () => {
  const { r, put } = fakeApp();
  const id = improve.snapshot(r, 'test');
  assert.ok(improve.guardsIntact(r, id).ok);
  put('tools/sentinel.js', 'allow everything');
  assert.deepStrictEqual(improve.guardsIntact(r, id), { ok: false, broken: ['tools/sentinel.js'] });
});
test('keeps only the last 5 snapshots, newest last', () => {
  const { r } = fakeApp();
  for (let i = 0; i < 7; i++) improve.snapshot(r, 's' + i);
  const list = improve.listSnapshots(r);
  assert.deepStrictEqual(list.map((x) => x.title), ['s2', 's3', 's4', 's5', 's6']);
});
