// chat panel + click-through handling for the transparent desktop window
(function () {
  const bridge = window.luna || {
    // browser preview fallback
    ask: async (t) => ({ ok: true, text: 'preview mode hehe, on your mac i answer for real (you said: ' + t + ')' }),
    reset: async () => {}, setInteractive: () => {}, menu: () => {}, focus: () => {}
  };
  // the same chat runs in two places: the little window by luna, and her own full window (?standalone=1)
  const STANDALONE = /standalone=1/.test(location.search);
  if (STANDALONE) document.documentElement.classList.add('standalone');
  const pet = document.getElementById('pet');
  const chat = document.getElementById('chat');
  const log = document.getElementById('log');
  const form = document.getElementById('f');
  const input = document.getElementById('q');
  const send = document.getElementById('send');
  let busy = false, interactive = null;

  function setInteractive(on) {
    if (on === interactive) return;
    interactive = on;
    bridge.setInteractive(on);
  }
  // the window ignores clicks except over luna or the open chat
  document.addEventListener('mousemove', (e) => {
    if (STANDALONE) return;
    const overPet = window.LUNA && window.LUNA.hitAt(e.clientX, e.clientY);
    const r = chat.getBoundingClientRect();
    const overChat = !chat.hidden && e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    const pl = document.getElementById('pill'), q = pl.getBoundingClientRect();
    const overPill = !pl.hidden && e.clientX >= q.left && e.clientX <= q.right && e.clientY >= q.top && e.clientY <= q.bottom;
    setInteractive(Boolean(overPet || overChat || overPill || window.LUNA_DRAGGING));
  });

  function place() {
    if (STANDALONE || chat.hidden || chat.classList.contains('full')) return;
    const pr = pet.getBoundingClientRect();
    const x = Math.min(window.innerWidth - chat.offsetWidth - 12, Math.max(12, pr.left + pr.width * 0.45 - chat.offsetWidth / 2));
    chat.style.left = x + 'px';
    // sit above her head, or below her if she's near the top of the screen
    const h = chat.offsetHeight;
    const above = pr.top + 150 - h;
    chat.style.top = Math.max(8, above >= 8 ? above : Math.min(window.innerHeight - h - 8, pr.bottom - 120)) + 'px';
  }
  setInterval(place, 120);

  function add(who, text) {
    const d = document.createElement('div');
    d.className = 'msg ' + who;
    setText(d, text, who);
    log.appendChild(d);
    if (/\bluna\b/.test(who) && !/wait/.test(who)) addSay(d);
    log.scrollTop = log.scrollHeight;
    return d;
  }

  // luna's messages get friendly formatting (lists, bold, tables, agenda / task / file cards)
  function setText(d, text, who) {
    d.dataset.raw = text;
    if (/\bluna\b/.test(who || d.className) && !/wait/.test(who || d.className) && window.LunaMD) LunaMD.render(d, text);
    else d.textContent = text;
  }
  function openChat() {
    chat.hidden = false;
    window.LUNA_CHATTING = true;
    if (!log.children.length) add('luna', `hiii${cfg.userName ? ' ' + cfg.userName.toLowerCase() : ''}! what do you need? ${cfg.charIcon || '🦎'}`);
    pill.hidden = true; minimized = false;
    updateHello();
    place();
    bridge.focus();
    setTimeout(() => input.focus(), 50);
  }
  function closeChat() {
    chat.hidden = true;
    window.LUNA_CHATTING = false;
    setInteractive(false);
  }

  // luna ends replies with suggested actions written as [[do: label | what to do]]; show them as buttons
  const ACT = /\[\[do:\s*([^|\]]+?)\s*\|\s*([^\]]+?)\s*\]\]/g;
  const clean = (t) => t.replace(ACT, '').replace(/\[\[[^\]]*$/, '').replace(/^\s+/, '').replace(/\s+$/, '');
  function addActions(actions) {
    if (!actions || !actions.length) return;
    const box = document.createElement('div');
    box.className = 'acts';
    for (const a of actions.slice(0, 3)) {
      const b = document.createElement('button');
      b.textContent = a.label;
      b.addEventListener('click', () => {
        if (String(a.prompt).startsWith('__open__')) { bridge.openPath && bridge.openPath(a.prompt.slice(8)); return; }
        box.querySelectorAll('button').forEach((x) => (x.disabled = true)); ask(a.prompt);
      });
      box.appendChild(b);
    }
    log.appendChild(box);
    log.scrollTop = log.scrollHeight;
  }
  function actionsFrom(text) { const out = []; let m; ACT.lastIndex = 0; while ((m = ACT.exec(text))) out.push({ label: m[1], prompt: m[2] }); return out; }

  // proactive check-ins: luna waves and says something; tap her to see it with action buttons
  if (bridge.onNudge) bridge.onNudge((n) => {
    if (!n || !n.text) return;
    const d = add('luna nudge', n.text);
    if (minimized) pillDot.hidden = false;
    addActions(n.actions);
    speak(n.text);
    if (chat.hidden) {
      window.LUNA && window.LUNA.say('psst! ' + (n.text.length > 42 ? n.text.slice(0, 40) + '…' : n.text), 20);
      window.LUNA && window.LUNA.setMode('wave');
    }
    return d;
  });

  // sentinel approval cards: risky actions wait for your tap (no answer in 2 min = no)
  if (bridge.onApproval) bridge.onApproval((a) => {
    if (chat.hidden) openChat();
    const card = document.createElement('div');
    card.className = 'approval';
    card.innerHTML = '<b>🛡️ need your ok</b><div class="what"></div><div class="why"></div>';
    card.querySelector('.what').textContent = a.summary;
    card.querySelector('.why').textContent = 'because it involves ' + a.why;
    const yes = document.createElement('button'); yes.className = 'yes'; yes.textContent = 'approve';
    const no = document.createElement('button'); no.className = 'no'; no.textContent = 'deny';
    const answer = (ok) => { bridge.approve(a.id, ok); yes.disabled = no.disabled = true; card.querySelector('b').textContent = ok ? '✅ approved' : '❌ denied'; };
    yes.onclick = () => answer(true); no.onclick = () => answer(false);
    card.append(yes, no);
    log.appendChild(card); log.scrollTop = log.scrollHeight;
    window.LUNA && window.LUNA.say('need your ok! 🛡️', 15);
    speak('i need your ok for this one');
  });

  // luna can read her replies out loud (toggle in the 🦎 menu)
  let voiceOn = false; // auto-read is off unless turned on in the 🦎 menu
  if (bridge.onVoice) bridge.onVoice((v) => { voiceOn = v; if (!v) speechSynthesis.cancel(); });
  function speak(t, force) {
    if ((!voiceOn && !force) || !t || !window.speechSynthesis) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(t.replace(/[\u{1F300}-\u{1FAFF}☀-➿]/gu, '').slice(0, 400));
    const v = speechSynthesis.getVoices().find((x) => /Samantha|Ava|Karen|Moira/i.test(x.name));
    if (v) u.voice = v;
    u.rate = 1.05; u.pitch = 1.15;
    speechSynthesis.speak(u);
  }
  // 🔊 on each of luna's messages: tap to hear it
  // listen + copy buttons under each of luna's messages
  const ICON_SPK = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/></svg>', ICON_CPY = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/></svg>', ICON_CHK = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';
  function addSay(d) {
    const bar = document.createElement('div'); bar.className = 'tools';
    const s = document.createElement('button'); s.type = 'button'; s.title = 'read out loud'; s.innerHTML = ICON_SPK;
    s.onclick = () => {
      if (speechSynthesis.speaking) { speechSynthesis.cancel(); s.classList.remove('on'); return; }
      speak(d.textContent, true); s.classList.add('on');
      const off = setInterval(() => { if (!speechSynthesis.speaking) { s.classList.remove('on'); clearInterval(off); } }, 300);
    };
    const c = document.createElement('button'); c.type = 'button'; c.title = 'copy'; c.innerHTML = ICON_CPY;
    c.onclick = () => { navigator.clipboard.writeText(d.dataset.raw || d.textContent).catch(() => {}); c.innerHTML = ICON_CHK; setTimeout(() => { c.innerHTML = ICON_CPY; }, 1200); };
    bar.append(s, c);
    d.after(bar);
  }

  // 🎤 voice typing: works with Wispr Flow (hold fn) or Mac dictation (fn fn), which type into the box;
  // when the words stop coming for a moment, luna sends it for you
  const mic = document.getElementById('mic'), tip = document.getElementById('mictip');
  let listening = false, quietTimer = null;
  function setListening(on) {
    listening = on; mic.classList.toggle('on', on); tip.hidden = !on;
    if (on) { input.value = ''; input.focus(); }
    clearTimeout(quietTimer);
  }
  mic.addEventListener('click', () => setListening(!listening));
  input.addEventListener('input', () => {
    if (!listening) return;
    clearTimeout(quietTimer);
    quietTimer = setTimeout(() => { if (listening && input.value.trim()) { setListening(false); form.requestSubmit(); } }, 1600);
  });

  // option + space: open the chat ready to type or dictate
  if (bridge.onSummon) bridge.onSummon(() => { if (STANDALONE) return; if (chat.hidden) openChat(); setListening(true); });

  // replies stream in word by word
  let live = null, liveText = '';
  if (bridge.onDelta) bridge.onDelta((t) => {
    if (!live) return;
    if (!liveText) { live.classList.remove('wait'); window.LUNA && window.LUNA.hide(); window.LUNA_THINKING = false; }
    window.LUNA_TALK_UNTIL = performance.now() + 450; // her mouth moves while words come in
    liveText += t;
    // re-render the formatting a few times a second while words stream in
    if (!live._r) live._r = setTimeout(() => { if (live) { setText(live, clean(liveText), 'luna'); live._r = null; log.scrollTop = log.scrollHeight; } }, 70);
    log.scrollTop = log.scrollHeight;
  });
  if (bridge.onStatus) bridge.onStatus((t) => { if (live && !liveText) live.textContent = t; });

  async function ask(text) {
    text = text.trim();
    if (!text || busy) return;
    busy = true; send.textContent = 'stop'; send.classList.add('stop');
    add('me', text);
    bridge.record && bridge.record({ who: 'me', text });
    updateHello();
    document.querySelector('.chips').hidden = true;
    input.value = '';
    live = add('luna wait', 'thinking...'); liveText = '';
    window.LUNA && window.LUNA.say('hmm... 🤔', 120);
    window.LUNA_THINKING = true;
    let res;
    try { res = await bridge.ask(text); } catch (e) { res = { ok: false, text: String(e) }; }
    window.LUNA_THINKING = false;
    live.classList.remove('wait');
    const full = res.ok ? (res.text || liveText) : res.text;
    clearTimeout(live._r); live._r = null;
    setText(live, clean(full), 'luna');
    bridge.record && bridge.record({ who: 'luna', text: full });
    addSay(live);
    const spoken = live.textContent;
    live = null;
    if (res.ok) { addActions(actionsFrom(full)); speak(spoken); }
    window.LUNA && window.LUNA.hide();
    if (res.ok && window.LUNA) window.LUNA.setMode('happy');
    busy = false; send.textContent = 'send'; send.classList.remove('stop');
    log.scrollTop = log.scrollHeight;
    input.focus();
  }

  // ---------- window buttons ----------
  // tap luna: the little chat. green: her own full-screen window. yellow: shrink to a pill. red: the chat is gone.
  const pill = document.getElementById('pill'), pillDot = document.getElementById('pillDot');
  let minimized = false;
  const anim = (el, from, to, ms) => el.animate([from, to], { duration: ms, easing: 'cubic-bezier(.3,.7,.2,1)' }).finished.catch(() => {});
  function originAtPet() {
    const pr = pet.getBoundingClientRect(), cr = chat.getBoundingClientRect();
    return `${pr.left + pr.width / 2 - cr.left}px ${pr.top + pr.height / 2 - cr.top}px`;
  }
  function setFull() {} // (kept for older calls) full screen now lives in her own window
  async function minimize() {
    if (chat.hidden) return;
    chat.style.transformOrigin = originAtPet();
    await anim(chat, { transform: 'scale(1)', opacity: 1 }, { transform: 'scale(0.08)', opacity: 0 }, 260);
    chat.hidden = true; window.LUNA_CHATTING = false; minimized = true;
    pill.hidden = false; pillDot.hidden = true; placePill();
    anim(pill, { transform: 'scale(0.4)', opacity: 0 }, { transform: 'scale(1)', opacity: 1 }, 220);
    setInteractive(false);
  }
  async function restore() {
    pill.hidden = true;
    openChat(); place();
    chat.style.transformOrigin = originAtPet();
    anim(chat, { transform: 'scale(0.08)', opacity: 0 }, { transform: 'scale(1)', opacity: 1 }, 260);
  }
  function placePill() {
    if (pill.hidden) return;
    const pr = pet.getBoundingClientRect();
    pill.style.left = Math.max(8, Math.min(window.innerWidth - pill.offsetWidth - 8, pr.left + pr.width / 2 - pill.offsetWidth / 2)) + 'px';
    const hp = window.LUNA_BUDDY && window.LUNA_BUDDY.active() && window.LUNA_BUDDY.headPoint();
    pill.style.top = Math.max(8, (hp ? pr.top + hp.y - 44 : pr.top + 70)) + 'px'; // just above her head
  }
  if (!STANDALONE) setInterval(placePill, 150);
  pill.addEventListener('click', () => restore());
  // green (or double-click the title bar): open her own window, full screen
  function bigWindow() { chat.hidden = true; window.LUNA_CHATTING = false; pill.hidden = true; minimized = false; setInteractive(false); bridge.openWindow && bridge.openWindow(); }
  // tapping luna: the little chat (or her own window, if you chose that in settings)
  window.addEventListener('luna-tap', () => { if (!chat.hidden) closeChat(); else if (cfg.tapOpens === 'full') bigWindow(); else restore(); });
  window.addEventListener('luna-menu', () => bridge.menu());
  if (bridge.onRoam) bridge.onRoam((r) => window.LUNA && window.LUNA.setRoam(r));
  document.getElementById('close').addEventListener('click', async () => {
    if (busy) await bridge.stop();
    if (listening) setListening(false);
    await anim(chat, { transform: 'scale(1)', opacity: 1 }, { transform: 'scale(0.96)', opacity: 0 }, 160);
    closeChat(); pill.hidden = true; minimized = false; // gone. tap luna to bring the little chat back
  });
  document.getElementById('min').addEventListener('click', minimize);
  document.getElementById('full').addEventListener('click', bigWindow);
  document.querySelector('#chat .head').addEventListener('dblclick', (e) => { if (!STANDALONE && !e.target.closest('button')) bigWindow(); });

  // ---------- one conversation in both places ----------
  function showSynced(m) {
    if (m.who === 'me') add('me', m.text);
    else if (/nudge/.test(m.who)) { add('luna nudge', m.text); addActions(m.actions); }
    else { add('luna', clean(m.text)); addActions(actionsFrom(m.text)); }
    document.querySelector('.chips').hidden = true;
    updateHello();
  }
  if (bridge.onSync) bridge.onSync(showSynced);
  if (bridge.onClear) bridge.onClear(() => { log.innerHTML = ''; document.querySelector('.chips').hidden = false; updateHello(); });
  if (bridge.history) bridge.history().then((list) => { if (list && list.length) { log.innerHTML = ''; list.forEach(showSynced); } if (STANDALONE) openStandalone(); }).catch(() => { if (STANDALONE) openStandalone(); });
  function openStandalone() { chat.classList.add('full'); openChat(); updateHello(); log.scrollTop = log.scrollHeight; }
  document.getElementById('settings').addEventListener('click', () => bridge.openSettings && bridge.openSettings());
  // esc leaves full screen first, then closes
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && chat.classList.contains('full')) { e.stopImmediatePropagation(); document.getElementById('full').click(); } }, true);

  // ---------- name, character and greeting from settings ----------
  let cfg = { userName: '', charName: 'luna', charIcon: '🦎', tapOpens: 'small' };
  function applyCfg(c) {
    cfg = { ...cfg, ...(c || {}) };
    document.getElementById('charName').textContent = cfg.charName || 'luna';
    for (const id of ['charIcon', 'helloIcon', 'pillIcon']) document.getElementById(id).textContent = cfg.charIcon || '🦎';
    document.getElementById('pillText').textContent = cfg.charName || 'luna';
    input.placeholder = `talk to ${cfg.charName || 'luna'}...`;
    updateHello();
  }
  function updateHello() {
    const h = new Date().getHours();
    const part = h < 12 ? 'good morning' : h < 18 ? 'good afternoon' : 'good evening';
    document.getElementById('helloText').textContent = cfg.userName ? `${part}, ${cfg.userName.toLowerCase()}` : part;
    const talked = log.querySelector('.msg.me');
    document.getElementById('hello').hidden = !(chat.classList.contains('full') && !talked);
  }
  if (bridge.config) bridge.config().then(applyCfg).catch(() => {});
  // ---------- theme (settings > appearance) ----------
  function applyTheme(th) {
    th = th || {};
    const root = document.documentElement;
    root.dataset.style = th.style === 'claude' ? 'claude' : 'luna';
    root.dataset.font = th.font || 'default';
    root.style.setProperty('--fs', ({ small: '12.5px', large: '15px', xl: '16.5px' })[th.size] || '13.5px');
    for (const v of ['--accent', '--me', '--meText']) root.style.removeProperty(v);
    if (th.style === 'custom') {
      if (th.accent) root.style.setProperty('--accent', th.accent);
      if (th.bubble) { root.style.setProperty('--me', th.bubble); const c = parseInt(th.bubble.slice(1), 16), l = 0.299 * (c >> 16) + 0.587 * ((c >> 8) & 255) + 0.114 * (c & 255); root.style.setProperty('--meText', l > 150 ? '#1d1c18' : '#fff'); }
    }
  }
  if (bridge.theme) bridge.theme().then(applyTheme).catch(() => {});
  if (bridge.onTheme) bridge.onTheme(applyTheme);
  if (bridge.onConfig) bridge.onConfig(applyCfg);
  document.getElementById('reset').addEventListener('click', async () => {
    await bridge.reset();
    log.innerHTML = '';
    document.querySelector('.chips').hidden = false;
    add('luna', 'fresh start! what’s up?');
  });
  document.querySelectorAll('.chips button').forEach((b) => b.addEventListener('click', () => ask(b.dataset.q)));
  // while she's working: the button becomes "stop". typing something new stops her and redirects her.
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const t = input.value.trim();
    if (busy) {
      await bridge.stop();
      for (let i = 0; i < 50 && busy; i++) await new Promise((r) => setTimeout(r, 100));
      if (t) ask('(change of plan while you were working) ' + t);
      return;
    }
    ask(t);
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !STANDALONE) closeChat(); });
})();
