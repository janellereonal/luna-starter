const fs = require('fs');
const os = require('os');
const path = require('path');
const pack = require('../lib/charpack');

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'luna-test-')); }

test('a shared character comes back identical, with a new name if taken', () => {
  const a = tmp(), b = tmp();
  fs.writeFileSync(path.join(a, 'snow-bear.png'), PNG);
  fs.writeFileSync(path.join(a, 'snow-bear.json'), JSON.stringify({ v: 2, eyes: [] }));
  const file = path.join(a, 'out.lunachar');
  fs.writeFileSync(file, pack.exportPack(a, 'snow-bear.png'));
  const one = pack.importPack(b, file), two = pack.importPack(b, file);
  assert.strictEqual(one.file, 'snow-bear.png'); assert.strictEqual(two.file, 'snow-bear-2.png');
  assert.ok(fs.readFileSync(path.join(b, 'snow-bear.png')).equals(PNG));
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(b, 'snow-bear.json'), 'utf8')), { v: 2, eyes: [] });
});
test('rejects files that are not characters or are damaged', () => {
  const a = tmp(), f = path.join(a, 'x.lunachar');
  fs.writeFileSync(f, 'hello'); assert.throws(() => pack.importPack(a, f), /isn't a luna character/);
  fs.writeFileSync(f, JSON.stringify({ format: 'luna-character', files: { '.png': Buffer.from('nope').toString('base64') } }));
  assert.throws(() => pack.importPack(a, f), /damaged/);
  assert.throws(() => pack.exportPack(a, '../../etc/passwd'), /pick one/);
});
test('rename moves every part of the character', () => {
  const a = tmp();
  fs.writeFileSync(path.join(a, 'cmvqsomir.png'), PNG); fs.writeFileSync(path.join(a, 'cmvqsomir.json'), '{}');
  assert.strictEqual(pack.renameChar(a, 'cmvqsomir.png', 'Snow Panda'), 'snow-panda.png');
  assert.deepStrictEqual(fs.readdirSync(a).sort(), ['snow-panda.json', 'snow-panda.png']);
  assert.throws(() => pack.renameChar(a, 'snow-panda.png', '!!!'), /letter or number/);
});
