const phone = require('../lib/phone');
const me = { id: '639171234567:12@s.whatsapp.net', lid: '99887766:12@lid' };

test('only your own self-chat counts as talking to luna', () => {
  assert.ok(phone.isSelfChat('639171234567@s.whatsapp.net', me));
  assert.ok(phone.isSelfChat('99887766@lid', me));
  assert.ok(!phone.isSelfChat('639170000000@s.whatsapp.net', me));
  assert.ok(!phone.isSelfChat('639171234567-123@g.us', me));
  assert.ok(!phone.isSelfChat('639171234567@s.whatsapp.net', null));
});
test('luna ignores her own replies', () => {
  assert.ok(phone.isLunaEcho('🦎 sent ✓', new Set(), 'x'));
  assert.ok(phone.isLunaEcho('anything', new Set(['abc']), 'abc'));
  assert.ok(!phone.isLunaEcho('what is due today', new Set(), 'y'));
});
test('replying with a number runs that option', () => {
  const acts = [{ label: 'a', prompt: 'do a' }, { label: 'b', prompt: 'do b' }];
  assert.strictEqual(phone.pickAction('2', acts), 'do b');
  assert.strictEqual(phone.pickAction(' 1. ', acts), 'do a');
  assert.strictEqual(phone.pickAction('1.', acts), 'do a');
  assert.strictEqual(phone.pickAction('3', acts), null);
  assert.strictEqual(phone.pickAction('2 more please', acts), null);
});
