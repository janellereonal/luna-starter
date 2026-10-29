// sharing characters: one .lunachar file holds the picture, its scan and its animation,
// so a friend's luna can use it with no rescan. (pure file work, tested in test/charpack.test.js)
const fs = require('fs');
const path = require('path');

const EXT = 'lunachar';
const PARTS = ['.png', '.json', '.thumb.png', '.back.png', '.anim.png', '.anim.json', '.glb'];
const isId = (f) => /^[\w.-]+\.(png|glb)$/.test(String(f));
const slugify = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
const stemOf = (id) => String(id).replace(/\.(png|glb)$/, '');
function freeStem(dir, base) {
  let stem = base, i = 2;
  while (PARTS.some((ext) => fs.existsSync(path.join(dir, stem + ext)))) stem = `${base}-${i++}`;
  return stem;
}

function exportPack(dir, id) {
  if (!isId(id)) throw new Error('pick one of your own characters to share');
  const stem = stemOf(id), files = {};
  for (const ext of PARTS) { const f = path.join(dir, stem + ext); if (fs.existsSync(f)) files[ext] = fs.readFileSync(f).toString('base64'); }
  if (!files['.png'] && !files['.glb']) throw new Error('that character is missing its picture');
  return JSON.stringify({ format: 'luna-character', v: 1, name: stem.replace(/-/g, ' '), files });
}

// returns { stem, file, type } of the new character
function importPack(dir, file) {
  if (fs.statSync(file).size > 80 * 1024 * 1024) throw new Error('that character file is too big');
  let pack; try { pack = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { throw new Error("that isn't a luna character file"); }
  if (!pack || pack.format !== 'luna-character' || !pack.files || typeof pack.files !== 'object') throw new Error("that isn't a luna character file");
  const main = pack.files['.png'] ? '.png' : pack.files['.glb'] ? '.glb' : null;
  if (!main) throw new Error('that character file has no picture in it');
  const buf = {};
  for (const [ext, b64] of Object.entries(pack.files)) {
    if (!PARTS.includes(ext) || typeof b64 !== 'string') continue;
    const b = Buffer.from(b64, 'base64');
    if (ext.endsWith('.png') && b.slice(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error('that character file looks damaged');
    if (ext === '.glb' && b.slice(0, 4).toString() !== 'glTF') throw new Error('that character file looks damaged');
    if (ext.endsWith('.json')) { try { JSON.parse(b.toString('utf8')); } catch (_) { continue; } }
    buf[ext] = b;
  }
  if (main === '.glb') delete buf['.png'];
  fs.mkdirSync(dir, { recursive: true });
  const stem = freeStem(dir, slugify(pack.name || path.basename(file).replace(/\.[^.]+$/, '')) || 'buddy');
  for (const [ext, b] of Object.entries(buf)) fs.writeFileSync(path.join(dir, stem + ext), b);
  return { stem, file: stem + main, type: main === '.glb' ? '3d' : 'image' };
}

// returns the new id (or the same id if the name didn't change)
function renameChar(dir, id, name) {
  if (!isId(id)) throw new Error("couldn't find that character");
  const stem = stemOf(id), main = String(id).slice(stem.length);
  const base = slugify(name);
  if (!base) throw new Error('use at least one letter or number in the name');
  if (base === stem) return id;
  const next = freeStem(dir, base);
  for (const ext of PARTS) { const f = path.join(dir, stem + ext); if (fs.existsSync(f)) fs.renameSync(f, path.join(dir, next + ext)); }
  return next + main;
}

module.exports = { EXT, PARTS, isId, exportPack, importPack, renameChar };
