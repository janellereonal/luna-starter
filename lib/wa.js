// luna's own WhatsApp line: she links to your account as a "linked device" (like WhatsApp Web / Desktop)
// and sends, reads and shares files in the background. nothing types on your screen.
// built on Baileys (unofficial WhatsApp Web library). linking once = scan a QR with your phone.
const fs = require('fs');
const path = require('path');

const phone = require('./phone');

function createWA({ dir, log = () => {}, onQr = () => {}, onStatus = () => {}, onMessage = () => {}, onSelf = () => {} }) {
  const AUTH = path.join(dir, 'auth');
  const STORE = path.join(dir, 'store.json');
  let B = null, sock = null, status = 'off', qr = null, me = null, stopping = false, retry = 0, saveT = null;
  const sentIds = new Set(); // messages luna sent herself (so her own replies in your self-chat aren't read as new requests)
  let store = { contacts: {}, chats: {}, msgs: {}, lid: {} };
  try { store = { ...store, ...JSON.parse(fs.readFileSync(STORE, 'utf8')) }; } catch (_) {}
  const save = () => { clearTimeout(saveT); saveT = setTimeout(() => { try { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(STORE, JSON.stringify(store)); } catch (_) {} }, 1500); };
  const setStatus = (s) => { status = s; onStatus(s); };

  // ---------- names ----------
  const num = (jid) => String(jid || '').split('@')[0].split(':')[0];
  function nameOf(jid) {
    const c = store.contacts[jid] || store.contacts[store.lid[jid]] || {};
    const ch = store.chats[jid] || {};
    return c.name || ch.name || c.notify || c.verifiedName || (jid.endsWith('@g.us') ? 'group' : '+' + num(jid));
  }
  function putContact(c) {
    if (!c || !c.id) return;
    const prev = store.contacts[c.id] || {};
    store.contacts[c.id] = { name: c.name || prev.name, notify: c.notify || prev.notify, verifiedName: c.verifiedName || prev.verifiedName, phone: c.phoneNumber || prev.phone, lid: c.lid || prev.lid };
    if (c.lid && c.phoneNumber) { store.lid[c.lid] = c.phoneNumber; store.lid[c.phoneNumber] = c.lid; }
  }
  function putChat(c) {
    if (!c || !c.id || c.id === 'status@broadcast') return;
    const prev = store.chats[c.id] || {};
    store.chats[c.id] = { name: c.name || prev.name, t: Number(c.conversationTimestamp || prev.t || 0), unread: c.unreadCount != null ? c.unreadCount : prev.unread || 0 };
  }
  function textOf(m) {
    const x = (m && m.message) || {};
    const inner = x.ephemeralMessage?.message || x.viewOnceMessage?.message || x.viewOnceMessageV2?.message || x;
    return inner.conversation || inner.extendedTextMessage?.text || inner.imageMessage?.caption && ('[photo] ' + inner.imageMessage.caption) || (inner.imageMessage && '[photo]')
      || (inner.videoMessage && ('[video] ' + (inner.videoMessage.caption || ''))) || (inner.documentMessage && ('[file] ' + (inner.documentMessage.fileName || '')))
      || (inner.audioMessage && '[voice note]') || (inner.stickerMessage && '[sticker]') || (inner.reactionMessage && ('[reacted ' + (inner.reactionMessage.text || '') + ']'))
      || (inner.locationMessage && '[location]') || (inner.contactMessage && '[contact card]') || '';
  }
  function putMsg(m) {
    const jid = m?.key?.remoteJid; if (!jid || jid === 'status@broadcast') return null;
    const text = textOf(m); if (!text) return null;
    const rec = { id: m.key.id, me: Boolean(m.key.fromMe), from: m.key.fromMe ? 'me' : (m.pushName || nameOf(m.key.participant || jid)), text: text.slice(0, 1500), t: Number(m.messageTimestamp || Date.now() / 1000) };
    const list = store.msgs[jid] || (store.msgs[jid] = []);
    if (list.some((r) => r.id === rec.id)) return null;
    list.push(rec); list.sort((a, b) => a.t - b.t); if (list.length > 60) list.splice(0, list.length - 60);
    const ch = store.chats[jid] || (store.chats[jid] = {}); ch.t = Math.max(ch.t || 0, rec.t);
    if (!rec.me && m.pushName && !jid.endsWith('@g.us')) { const c = store.contacts[jid] || (store.contacts[jid] = {}); c.notify = c.notify || m.pushName; }
    return rec;
  }

  // ---------- connection ----------
  async function start() {
    if (sock || status === 'connecting') return;
    stopping = false; setStatus('connecting');
    try {
      B = B || (await import('baileys'));
      fs.mkdirSync(AUTH, { recursive: true });
      const { state, saveCreds } = await B.useMultiFileAuthState(AUTH);
      let version; try { version = (await B.fetchLatestBaileysVersion()).version; } catch (_) {}
      const quiet = { level: 'silent', child() { return quiet; }, trace() {}, debug() {}, info() {}, warn() {}, error() {}, fatal() {} };
      sock = B.makeWASocket({ auth: state, version, logger: quiet, browser: B.Browsers.macOS('Luna'), markOnlineOnConnect: false, syncFullHistory: false, generateHighQualityLinkPreview: false });
      sock.ev.on('creds.update', saveCreds);
      sock.ev.on('connection.update', (u) => {
        if (u.qr) { qr = u.qr; onQr(u.qr); setStatus('needs-scan'); }
        if (u.connection === 'open') { qr = null; retry = 0; me = sock.user; setStatus('connected'); log('whatsapp linked as ' + (me && (me.name || num(me.id)))); }
        if (u.connection === 'close') {
          const code = u.lastDisconnect?.error?.output?.statusCode;
          sock = null;
          if (stopping) { setStatus('off'); return; }
          if (code === B.DisconnectReason.loggedOut) { try { fs.rmSync(AUTH, { recursive: true, force: true }); } catch (_) {} setStatus('logged-out'); return; }
          setStatus('reconnecting');
          setTimeout(start, Math.min(60000, 2000 * 2 ** retry++));
        }
      });
      sock.ev.on('messaging-history.set', ({ chats, contacts, messages, lidPnMappings }) => {
        (contacts || []).forEach(putContact); (chats || []).forEach(putChat); (messages || []).forEach(putMsg);
        (lidPnMappings || []).forEach((m) => { store.lid[m.lid] = m.pn; store.lid[m.pn] = m.lid; });
        save();
      });
      sock.ev.on('contacts.upsert', (cs) => { cs.forEach(putContact); save(); });
      sock.ev.on('contacts.update', (cs) => { cs.forEach(putContact); save(); });
      sock.ev.on('chats.upsert', (cs) => { cs.forEach(putChat); save(); });
      sock.ev.on('chats.update', (cs) => { cs.forEach(putChat); save(); });
      sock.ev.on('lid-mapping.update', (m) => { if (m && m.lid && m.pn) { store.lid[m.lid] = m.pn; store.lid[m.pn] = m.lid; save(); } });
      sock.ev.on('messages.upsert', ({ messages, type }) => {
        for (const m of messages || []) {
          // you, messaging yourself from your phone: that's you talking to luna
          if (m.key?.fromMe && phone.isSelfChat(m.key.remoteJid, sock?.user || me) && Number(m.messageTimestamp || 0) > Date.now() / 1000 - 120) selfMessage(m);
          const rec = putMsg(m);
          if (rec && type === 'notify' && !rec.me) {
            const jid = m.key.remoteJid;
            onMessage({ chat: jid, chatName: nameOf(jid), group: jid.endsWith('@g.us'), from: rec.from, text: rec.text, mentionsMe: Boolean(me && (m.message?.extendedTextMessage?.contextInfo?.mentionedJid || []).some((j) => num(j) === num(me.id))) });
          }
        }
        save();
      });
    } catch (e) { sock = null; setStatus('error'); log('whatsapp error: ' + e.message); }
  }
  // a message in your own self-chat: text, a voice note or a photo (media is saved so luna can open it)
  const seenSelf = new Set();
  async function selfMessage(m) {
    const id = m.key.id;
    if (seenSelf.has(id)) return; seenSelf.add(id); if (seenSelf.size > 500) seenSelf.clear();
    const x = m.message || {};
    const inner = x.ephemeralMessage?.message || x;
    const text = inner.conversation || inner.extendedTextMessage?.text || inner.imageMessage?.caption || inner.videoMessage?.caption || inner.documentMessage?.caption || '';
    if (phone.isLunaEcho(text, sentIds, id)) return;
    let file = null, kind = null;
    const media = inner.audioMessage ? ['voice', 'ogg'] : inner.imageMessage ? ['photo', 'jpg'] : inner.documentMessage ? ['file', (inner.documentMessage.fileName || 'file').split('.').pop().slice(0, 8) || 'bin'] : null;
    if (media) {
      try {
        const buf = await B.downloadMediaMessage(m, 'buffer', {}, { logger: { info() {}, warn() {}, error() {}, debug() {}, trace() {}, child() { return this; } }, reuploadRequest: sock.updateMediaMessage });
        const inbox = path.join(dir, 'inbox'); fs.mkdirSync(inbox, { recursive: true, mode: 0o700 });
        file = path.join(inbox, `${id}.${media[1].replace(/[^\w]/g, '')}`); fs.writeFileSync(file, buf, { mode: 0o600 }); kind = media[0];
      } catch (e) { log('couldn’t download from your self-chat: ' + e.message); kind = media[0]; }
    }
    if (!text && !kind) return;
    onSelf({ id, chat: m.key.remoteJid, text, kind, file, fileName: inner.documentMessage?.fileName });
  }
  // replies to your self-chat: marked with 🦎 so you can tell luna from you
  async function sendSelf(chat, text) {
    need();
    const r = await sock.sendMessage(chat, { text: phone.MARK + String(text) });
    if (r?.key?.id) { sentIds.add(r.key.id); if (sentIds.size > 500) sentIds.delete(sentIds.values().next().value); }
  }
  async function typing(chat, on) { try { if (sock) await sock.sendPresenceUpdate(on ? 'composing' : 'paused', chat); } catch (_) {} }

  async function stop() { stopping = true; try { sock && sock.end(undefined); } catch (_) {} sock = null; setStatus('off'); }
  async function unlink() { stopping = true; try { sock && (await sock.logout()); } catch (_) {} sock = null; try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {} store = { contacts: {}, chats: {}, msgs: {}, lid: {} }; setStatus('off'); }
  const linked = () => fs.existsSync(path.join(AUTH, 'creds.json'));

  // ---------- finding people ----------
  const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N} ]/gu, '').trim();
  function find(query, limit = 8) {
    const q = norm(query), digits = String(query).replace(/\D/g, '');
    const seen = new Map();
    const consider = (jid) => {
      if (!jid || seen.has(jid) || jid === 'status@broadcast') return;
      const names = [store.contacts[jid]?.name, store.chats[jid]?.name, store.contacts[jid]?.notify, store.contacts[jid]?.verifiedName].filter(Boolean);
      let score = 0;
      for (const n of names) { const nn = norm(n); if (nn === q) score = Math.max(score, 100); else if (nn.startsWith(q)) score = Math.max(score, 80); else if (nn.split(' ').some((w) => w.startsWith(q))) score = Math.max(score, 70); else if (q.length > 2 && nn.includes(q)) score = Math.max(score, 50); }
      if (digits.length >= 6 && num(jid).endsWith(digits.slice(-9))) score = Math.max(score, 95);
      if (score) seen.set(jid, { jid, name: nameOf(jid), group: jid.endsWith('@g.us'), score: score + Math.min(10, (store.chats[jid]?.t || 0) / 1e9) });
    };
    Object.keys(store.contacts).forEach(consider); Object.keys(store.chats).forEach(consider);
    return [...seen.values()].sort((a, b) => b.score - a.score).slice(0, limit);
  }
  function resolve(to) {
    const s = String(to || '').trim();
    if (/@(s\.whatsapp\.net|g\.us|lid)$/.test(s)) return { jid: s, name: nameOf(s) };
    const digits = s.replace(/[^\d]/g, '');
    if (/^\+?[\d\s()-]{7,}$/.test(s)) return { jid: digits + '@s.whatsapp.net', name: '+' + digits };
    const hits = find(s, 5);
    if (!hits.length) throw new Error(`no whatsapp contact matches "${s}". try their number with country code, e.g. +63 917...`);
    if (hits.length > 1 && hits[0].score - hits[1].score < 15 && norm(hits[0].name) !== norm(s)) throw new Error(`"${s}" matches more than one chat: ${hits.map((h) => h.name).join(', ')}. say which one.`);
    return hits[0];
  }
  const need = () => { if (!sock || status !== 'connected') throw new Error(linked() ? 'whatsapp is reconnecting, try again in a few seconds' : 'whatsapp is not linked yet. open settings > connections > whatsapp and scan the QR'); };

  // ---------- actions ----------
  async function sendText(to, text) {
    need(); const r = resolve(to);
    await sock.sendMessage(r.jid, { text: String(text) });
    return `sent to ${r.name}`;
  }
  const MIME = { pdf: 'application/pdf', doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', txt: 'text/plain', csv: 'text/csv', zip: 'application/zip', md: 'text/markdown', key: 'application/x-iwork-keynote-sffkey', pages: 'application/x-iwork-pages-sffpages', numbers: 'application/x-iwork-numbers-sffnumbers' };
  async function sendFile(to, file, caption) {
    need(); const r = resolve(to);
    const f = path.resolve(String(file).replace(/^~(?=\/)/, require('os').homedir()));
    if (!fs.existsSync(f) || !fs.statSync(f).isFile()) throw new Error('file not found: ' + f);
    if (fs.statSync(f).size > 95 * 1024 * 1024) throw new Error('that file is over whatsapp\'s ~100 MB limit');
    const ext = path.extname(f).slice(1).toLowerCase(), name = path.basename(f);
    let msg;
    if (/^(jpe?g|png|webp|heic)$/.test(ext) && ext !== 'heic') msg = { image: { url: f }, caption: caption || undefined };
    else if (/^(mp4|mov|m4v)$/.test(ext)) msg = { video: { url: f }, caption: caption || undefined, mimetype: 'video/mp4' };
    else msg = { document: { url: f }, mimetype: MIME[ext] || 'application/octet-stream', fileName: name, caption: caption || undefined };
    await sock.sendMessage(r.jid, msg);
    return `sent ${name} to ${r.name}`;
  }
  function read(chat, count = 20) {
    const r = resolve(chat);
    const list = (store.msgs[r.jid] || store.msgs[store.lid[r.jid]] || []).slice(-Math.min(60, count));
    return { chat: r.name, messages: list.map((m) => ({ from: m.from, text: m.text, at: new Date(m.t * 1000).toLocaleString() })) };
  }
  function chats(limit = 15) {
    return Object.entries(store.chats).sort((a, b) => (b[1].t || 0) - (a[1].t || 0)).slice(0, limit).map(([jid, c]) => {
      const last = (store.msgs[jid] || []).slice(-1)[0];
      return { name: nameOf(jid), group: jid.endsWith('@g.us'), unread: c.unread || 0, last: last ? `${last.from}: ${last.text.slice(0, 120)}` : '', at: c.t ? new Date(c.t * 1000).toLocaleString() : '' };
    });
  }
  return { start, stop, unlink, linked, state: () => ({ status, qr, me: me && { name: me.name, number: num(me.id) } }), find, sendText, sendFile, read, chats, sendSelf, typing };
}

module.exports = { createWA };
