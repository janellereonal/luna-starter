// tiny test style: test(name, fn) and assert are globals from scripts/check.js
const { parseTags, toPlain } = require('../lib/tags');

test('reads every kind of tag', () => {
  const t = parseTags('ok! [[job: plan trip | find flights]] [[routine: daily 07:30 | brief | morning brief]] [[unroutine: old]] [[watch: kai | 30 | be sweet]] [[improve: dark bubbles | make chat bubbles darker]] [[do: open it | open the plan]]');
  assert.deepStrictEqual(t.jobs, [{ title: 'plan trip', instructions: 'find flights' }]);
  assert.deepStrictEqual(t.routines, [{ when: 'daily 07:30', title: 'brief', instructions: 'morning brief' }]);
  assert.deepStrictEqual(t.unroutines, ['old']);
  assert.deepStrictEqual(t.watch, { contact: 'kai', minutes: 30, notes: 'be sweet' });
  assert.deepStrictEqual(t.improve, [{ title: 'dark bubbles', details: 'make chat bubbles darker' }]);
  assert.strictEqual(t.actions[0].label, 'open it');
  assert.strictEqual(t.clean, 'ok!      [[do: open it | open the plan]]');
});
test('improve without details uses the title', () => {
  assert.deepStrictEqual(parseTags('[[improve: add a pomodoro timer]]').improve, [{ title: 'add a pomodoro timer', details: 'add a pomodoro timer' }]);
});
test('unwatch and plain text', () => {
  const t = parseTags('stopping now [[unwatch]]');
  assert.strictEqual(t.unwatch, true); assert.strictEqual(t.clean, 'stopping now');
  assert.strictEqual(parseTags('hello').clean, 'hello');
});
test('plain text for whatsapp numbers the actions', () => {
  const p = toPlain('here you go\n```tasks\n[ ] essay | due 5pm\n```\n[[do: draft it | draft the essay]] [[do: remind me | remind me at 4]]');
  assert.ok(p.text.includes('[ ] essay | due 5pm'));
  assert.ok(!p.text.includes('```'));
  assert.ok(p.text.endsWith('[ ] essay | due 5pm\n\n1. draft it\n2. remind me\n(reply with a number)'), JSON.stringify(p.text));
  assert.strictEqual(p.actions.length, 2);
});
