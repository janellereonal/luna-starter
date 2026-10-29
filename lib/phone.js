// chatting with luna from your phone: you message yourself on WhatsApp ("Message yourself" chat),
// luna's linked device sees it, answers, and replies in the same chat. only your own self-chat counts,
// so nobody else can give luna instructions this way. (pure helpers, tested in test/phone.test.js)
const MARK = '🦎 ';
const num = (jid) => String(jid || '').split('@')[0].split(':')[0];
// me = the linked account ({ id: '63917...:12@s.whatsapp.net', lid: '1234:12@lid' })
function isSelfChat(jid, me) {
  if (!jid || !me || String(jid).endsWith('@g.us')) return false;
  const n = num(jid);
  return Boolean(n) && (n === num(me.id) || (me.lid && n === num(me.lid)));
}
// luna's own replies also show up as "from me" in that chat: skip them
const isLunaEcho = (text, sentIds, id) => (sentIds && sentIds.has(id)) || String(text || '').startsWith(MARK.trim());
// "2" after a reply with numbered options runs option 2
function pickAction(text, actions) {
  const m = String(text || '').trim().match(/^([1-3])[.)]?$/);
  return m && actions && actions[Number(m[1]) - 1] ? actions[Number(m[1]) - 1].prompt : null;
}
module.exports = { MARK, isSelfChat, isLunaEcho, pickAction, num };
