const { routineDue } = require('../lib/schedule');
const at = (s) => new Date(s); // local time

test('daily routine fires once at its minute', () => {
  const r = { when: 'daily 07:30', last: '' };
  const key = routineDue(r, at('2026-10-29T07:30:10'));
  assert.ok(key);
  assert.strictEqual(routineDue({ ...r, last: key }, at('2026-10-29T07:30:40')), null);
  assert.strictEqual(routineDue(r, at('2026-10-29T07:31:00')), null);
});
test('weekdays, weekends and named days', () => {
  assert.ok(routineDue({ when: 'weekdays 09:00' }, at('2026-10-29T09:00:00'))); // thursday
  assert.strictEqual(routineDue({ when: 'weekends 09:00' }, at('2026-10-29T09:00:00')), null);
  assert.ok(routineDue({ when: 'mon,thu 18:00' }, at('2026-10-29T18:00:00')));
  assert.strictEqual(routineDue({ when: 'mon 18:00' }, at('2026-10-29T18:00:00')), null);
  assert.ok(routineDue({ when: '7:05 daily' }, at('2026-10-29T07:05:00')));
});
test('every 3h fires at the start of each block', () => {
  assert.ok(routineDue({ when: 'every 3h' }, at('2026-10-29T09:01:00')));
  assert.strictEqual(routineDue({ when: 'every 3h' }, at('2026-10-29T10:01:00')) === routineDue({ when: 'every 3h' }, at('2026-10-29T09:01:00')), true);
  assert.strictEqual(routineDue({ when: 'every 3h' }, at('2026-10-29T09:05:00')), null);
});
