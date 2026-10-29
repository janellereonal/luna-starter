const fs = require('fs');
const os = require('os');
const path = require('path');
const skills = require('../lib/skills');
const doctor = require('../lib/doctor');

test('skills show up as one line each', () => {
  const r = fs.mkdtempSync(path.join(os.tmpdir(), 'luna-sk-'));
  fs.mkdirSync(path.join(r, 'skills', 'canvas-dues'), { recursive: true });
  fs.writeFileSync(path.join(r, 'skills', 'canvas-dues', 'SKILL.md'), '---\nname: canvas-dues\ndescription: list what is due on Canvas this week\n---\n# how\nrun node skills/canvas-dues/run.js');
  fs.mkdirSync(path.join(r, 'skills', 'broken'));
  assert.strictEqual(skills.skillLines(r), '- canvas-dues: list what is due on Canvas this week (read skills/canvas-dues/SKILL.md before using)');
});
test('the shipped make-a-skill guide is a valid skill', () => {
  const list = skills.listSkills(path.join(__dirname, '..'));
  assert.ok(list.some((s) => s.name === 'make-a-skill' && s.description.length > 20));
});
test('safety check flags the real risks', () => {
  const r = fs.mkdtempSync(path.join(os.tmpdir(), 'luna-doc-'));
  fs.mkdirSync(path.join(r, 'tools')); fs.writeFileSync(path.join(r, 'tools', 'sentinel.js'), '');
  fs.writeFileSync(path.join(r, 'tools', '.luna-api.json'), '{}'); fs.chmodSync(path.join(r, 'tools', '.luna-api.json'), 0o644);
  const bad = doctor.audit(r, { trustUntil: -1, model: 'haiku' }, { apiHost: '0.0.0.0' });
  assert.strictEqual(bad.score, 'needs attention');
  const titles = bad.items.map((i) => i.level + ' ' + i.title).join('\n');
  assert.ok(/bad .*open to the network/.test(titles) && /bad Full trust/.test(titles) && /warn .*small model/.test(titles) && /warn .*token/.test(titles));
  assert.deepStrictEqual(doctor.fix(r), ['tools/.luna-api.json']);
  const good = doctor.audit(r, { trustUntil: 0, model: 'sonnet' }, { apiHost: '127.0.0.1' });
  assert.strictEqual(good.score, 'all good');
});
