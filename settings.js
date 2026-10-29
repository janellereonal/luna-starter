(async function () {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  let st = await S.get();
  const P = () => st.prefs;
  const set = async (k, v) => { st = await S.set(k, v); return st; };
  const debounce = (fn, ms = 500) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

  // ---------- navigation ----------
  function go(id) {
    if (!$(id)) id = 'general';
    document.querySelectorAll('.page').forEach((p) => p.classList.toggle('on', p.id === id));
    document.querySelectorAll('aside [data-go]').forEach((b) => b.classList.toggle('on', b.dataset.go === id));
    if (id === 'activity') loadActivity();
    if (id === 'memory') renderMemory();
  }
  document.querySelectorAll('aside [data-go]').forEach((b) => b.addEventListener('click', () => go(b.dataset.go)));
  S.onGo((s) => go(s));
  document.querySelectorAll('[data-pane]').forEach((b) => b.addEventListener('click', () => S.open(b.dataset.pane)));

  function seg(id, value, onPick) {
    const el = $(id);
    el.querySelectorAll('button').forEach((b) => {
      b.classList.toggle('on', b.dataset.v === String(value));
      b.onclick = () => { el.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b)); onPick(b.dataset.v); };
    });
  }
  function names() {
    const n = P().charName || 'luna';
    document.querySelectorAll('.cn').forEach((e) => (e.textContent = n));
    $('brandName').textContent = n; $('brandIcon').textContent = P().charIcon || '🦎';
    $('ver').textContent = 'v' + st.version;
  }

  // ---------- general ----------
  function bindText(id, key) {
    $(id).value = P()[key] || '';
    $(id).addEventListener('input', debounce(async () => { await set(key, $(id).value.trim()); names(); if (key === 'personalPrefs') { $('prefsSaved').textContent = 'saved'; setTimeout(() => ($('prefsSaved').textContent = ''), 1500); } }));
  }
  ['userName', 'work', 'personalPrefs', 'charName', 'charIcon'].forEach((k) => bindText(k, k));
  $('copyClaude').onclick = () => S.open('https://claude.ai/settings/general');
  $('hotkey').value = P().hotkey || 'Alt+Space'; $('hotkey').onchange = () => set('hotkey', $('hotkey').value);
  seg('tapOpens', P().tapOpens || 'small', (v) => set('tapOpens', v));
  $('login').checked = st.loginOn; $('login').onchange = () => set('login', $('login').checked);
  $('proactive').checked = P().proactive !== false; $('proactive').onchange = () => set('proactive', $('proactive').checked);
  for (const id of ['quietFrom', 'quietTo']) {
    for (let h = 0; h < 24; h++) $(id).insertAdjacentHTML('beforeend', `<option value="${h}">${String(h).padStart(2, '0')}:00</option>`);
    $(id).value = P()[id]; $(id).onchange = () => set(id, Number($(id).value));
  }

  // ---------- appearance ----------
  const theme = () => ({ mode: 'system', style: 'luna', accent: '#3E7B4F', bubble: '#F6D77A', font: 'default', size: 'normal', ...(P().theme || {}) });
  const setTheme = (patch) => set('theme', { ...theme(), ...patch }).then(paintAppearance);
  function paintAppearance() {
    const th = theme();
    seg('mode', th.mode, (v) => setTheme({ mode: v }));
    seg('font', th.font, (v) => setTheme({ font: v }));
    seg('size', th.size, (v) => setTheme({ size: v }));
    document.querySelectorAll('.sty').forEach((s) => { s.classList.toggle('on', s.dataset.v === th.style); s.onclick = () => setTheme({ style: s.dataset.v }); });
    $('customBox').classList.toggle('hidden', th.style !== 'custom');
    $('accent').value = th.accent; $('bubble').value = th.bubble;
    $('cmAccent').style.background = th.accent; $('cmBubble').style.background = th.bubble;
  }
  $('accent').addEventListener('input', debounce(() => setTheme({ accent: $('accent').value }), 200));
  $('bubble').addEventListener('input', debounce(() => setTheme({ bubble: $('bubble').value }), 200));
  $('autoSpeak').checked = Boolean(P().autoSpeak); $('autoSpeak').onchange = () => set('autoSpeak', $('autoSpeak').checked);
  seg('roam', P().roam || 'both', (v) => set('roam', v));
  $('charScale').value = P().charScale || 1; $('charScale').addEventListener('input', debounce(() => set('charScale', Number($('charScale').value)), 150));

  // ---------- characters ----------
  function renderChars() {
    const cur = P().character || { type: 'gecko' };
    $('chars').innerHTML = '';
    for (const c of st.characters) {
      const on = c.id === 'gecko' ? cur.type === 'gecko' : cur.file === c.id;
      const d = document.createElement('div'); d.className = 'char' + (on ? ' on' : '');
      d.innerHTML = (c.type === 'gecko' ? '<div class="emoji">🦎</div>' : c.dataUrl ? `<img src="${c.dataUrl}">` : '<div class="emoji">🧸</div>') +
        `<div class="n">${esc(c.name)}</div>` + (c.type === '3d' ? '<span class="tag">3D</span>' : c.type === 'image' ? '<span class="tag">2D</span>' : '') +
        (c.id !== 'gecko' ? '<button class="x" title="delete">×</button>' : '') +
        (c.id !== 'gecko' ? '<div style="margin-top:6px;display:flex;gap:4px;justify-content:center">' + (c.type === 'image' ? '<button class="btn" data-edit style="padding:3px 8px;font-size:12px">edit parts</button>' : '') + '<button class="btn" data-share title="save as one file you can send to a friend" style="padding:3px 8px;font-size:12px">share</button></div>' : '');
      d.onclick = async (e) => {
        if (e.target.closest('.x')) { if (confirm(`delete ${c.name}?`)) { st = await S.charDelete(c.id); renderChars(); } return; }
        if (e.target.closest('[data-share]')) { const r = await S.charExport(c.id); if (r && r.error) alert(r.error); else if (r && r.ok) alert(`saved ${c.name} as one file (${r.kb} KB). send it to a friend, and they add it in their Luna with + add character. no rescan needed.`); return; }
        if (e.target.closest('[data-edit]')) { openEditor({ id: c.id, name: c.name, dataUrl: c.dataUrl, rig: c.rig, animUrl: c.animUrl, anim: c.anim }); return; }
        st = await S.charUse(c.id); renderChars();
      };
      $('chars').appendChild(d);
    }
    const add = document.createElement('div'); add.className = 'char add'; add.innerHTML = '<div style="font-size:28px">+</div><div class="n">add character<br><span style="font-size:11px">picture, .glb or shared file</span></div>';
    add.onclick = addCharacter;
    $('chars').appendChild(add);
  }

  // ---------- scanner + rig editor ----------
  let ed = null; // { kind:'image'|'3d', id?, name, cv (prepared picture), rig, glb, fresh }
  let liveBuddy = null, liveRaf = 0, liveMode = 'idle', liveT0 = 0, scanToken = 0;
  const status = (t, busy) => { $('scanStatus').textContent = t; $('scanStatus').classList.toggle('busy', Boolean(busy)); };
  const loadImg = (src) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('could not open that picture')); i.src = src; });
  function freshLive() { const old = $('liveCv'), c = document.createElement('canvas'); c.id = 'liveCv'; old.replaceWith(c); return c; }
  function summary(r) {
    const n = (a, w) => (a.length ? `${a.length} ${w}${a.length > 1 ? 's' : ''}` : '');
    return ['head', n(r.eyes, 'eye'), r.mouth ? 'mouth' : '', n(r.ears, 'ear'), n(r.arms, 'arm'), n(r.legs, 'leg'), r.tail ? 'tail' : ''].filter(Boolean).join(', ');
  }
  const who = () => P().charName || 'luna';

  async function addCharacter() {
    const f = await S.charPick();
    if (!f) return;
    if (f.error) { alert(f.error); return; }
    if (f.kind === 'imported') { st = f.state; renderChars(); alert(`${f.name} is here and ready to go 🎉`); return; }
    if (f.kind === '3d') return open3D(f);
    // an animated picture (gif) keeps all its frames: her own blink, wiggle and moves
    const an = await BuddyCore.decodeAnimated(f.dataUrl);
    if (an) {
      const frames = BuddyCore.prepareFrames(an.frames), cv = frames[0];
      await openEditor({ name: f.name, cv, rig: BuddyCore.guessRig(cv), fresh: true, frames, delays: an.delays });
    } else {
      let img; try { img = await loadImg(f.dataUrl); } catch (e) { alert(e.message); return; }
      const cv = BuddyCore.prepareImage(img);
      await openEditor({ name: f.name, cv, rig: BuddyCore.guessRig(cv), fresh: true });
    }
    scan();
  }
  // two passes: measure on a grid, then check her own markings drawn on the picture and fix them
  async function scan() {
    if (!ed || ed.kind !== 'image') return;
    const my = ++scanToken;
    $('saveChar').disabled = true; $('rescan').disabled = true;
    status(`${who()} is looking closely: face, eyes, mouth, arms, legs, ears, tail... (1 of 2)`, true);
    const r1 = await S.charScan(BuddyCore.scanImage(ed.cv));
    if (my !== scanToken || !ed) return;
    if (!r1.ok) { $('saveChar').disabled = false; $('rescan').disabled = false; status(`couldn't scan (${r1.error}). using a quick guess from the outline, you can drag the dots to fix it.`); return; }
    ed.rig = BuddyCore.refineRig(ed.cv, r1.rig);
    if (r1.rig.name && ed.fresh && !$('newName').dataset.touched) $('newName').value = String(r1.rig.name).slice(0, 30);
    drawRig(); rebuildLive();
    status(`found ${summary(ed.rig)}. double-checking her work... (2 of 2)`, true);
    const r2 = await S.charScan(BuddyCore.scanImage(ed.cv, ed.rig), ed.rig);
    if (my !== scanToken || !ed) return;
    if (r2.ok) { ed.rig = BuddyCore.refineRig(ed.cv, r2.rig); drawRig(); rebuildLive(); }
    $('saveChar').disabled = false; $('rescan').disabled = false;
    status(`found ${summary(ed.rig)}${ed.frames ? `, plus ${ed.frames.length} frames of her own animation (she'll keep her own blink and moves)` : ''}. try the buttons on the right to see her move. drag any dot that looks off.`);
  }
  $('rescan').onclick = () => scan();

  async function openEditor(o) {
    if (!o.cv) { const img = await loadImg(o.dataUrl); o.cv = document.createElement('canvas'); o.cv.width = img.width; o.cv.height = img.height; o.cv.getContext('2d').drawImage(img, 0, 0); }
    if (!o.frames && o.animUrl && o.anim) { try { o.frames = BuddyCore.fromStrip(await loadImg(o.animUrl), o.anim.n); o.delays = o.anim.delays; } catch (_) {} }
    scanToken++;
    ed = { kind: 'image', id: o.id, name: o.name, cv: o.cv, rig: BuddyCore.cleanRig(o.rig || BuddyCore.guessRig(o.cv)), fresh: o.fresh, back: undefined, backCv: null, frames: o.frames || null, delays: o.delays || null };
    if (o.backUrl) { try { ed.backCv = BuddyCore.fitBack(await loadImg(o.backUrl), o.cv); ed.backUrl0 = o.backUrl; } catch (_) {} }
    document.querySelector('.scan').style.gridTemplateColumns = '';
    $('scanner').classList.remove('hidden'); $('rigBox').parentElement.classList.remove('hidden');
    $('partBtns').classList.remove('hidden'); $('scanHelp').classList.remove('hidden');
    $('scanTitle').textContent = o.id ? `Edit ${o.name}` : 'New character';
    $('newName').value = o.name || ''; delete $('newName').dataset.touched; $('newName').disabled = false;
    $('saveChar').disabled = false; $('rescan').disabled = false;
    status(o.id ? summary(ed.rig) : '');
    const rc = $('rigCv'); const k = Math.min(290 / ed.cv.height, 300 / ed.cv.width) * 2; // drawn at 2x for sharpness
    rc.width = Math.round(ed.cv.width * k); rc.height = Math.round(ed.cv.height * k);
    rc.style.width = rc.width / 2 + 'px'; rc.style.height = rc.height / 2 + 'px';
    drawRig(); rebuildLive();
    $('scanner').scrollIntoView({ behavior: 'smooth' });
  }
  $('newName').addEventListener('input', () => ($('newName').dataset.touched = '1'));

  function open3D(f) {
    scanToken++;
    ed = { kind: '3d', name: f.name, glb: f.glb };
    document.querySelector('.scan').style.gridTemplateColumns = '1fr';
    $('scanner').classList.remove('hidden');
    $('rigBox').parentElement.classList.add('hidden'); $('partBtns').classList.add('hidden'); $('scanHelp').classList.add('hidden');
    $('scanTitle').textContent = 'New 3D character'; $('newName').value = f.name; $('newName').disabled = false;
    status('loading the model...', true);
    stopLive();
    const c = freshLive();
    const bin = atob(f.glb), buf = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
    liveBuddy = BuddyCore.Buddy3D(c, buf.buffer, (info) => {
      if (info.error) { status('could not open that model: ' + info.error); $('saveChar').disabled = true; return; }
      ed.info = info; $('saveChar').disabled = false;
      const parts = Object.entries(info.bones).map(([k, n]) => `${n} ${k} bone${n > 1 ? 's' : ''}`);
      status(info.clips.length ? `found ${info.clips.length} animation${info.clips.length > 1 ? 's' : ''} (${info.clips.slice(0, 6).join(', ')}). she'll use walk/idle/wave ones when the names match.`
        : parts.length ? `no animations inside, but found ${parts.join(', ')}. she'll swing those to walk.` : 'no animations or skeleton inside, so she\'ll waddle and hop. models with a walk animation look best.');
    });
    startLive();
  }

  // ---- rig editor: drag the dots ----
  function handles() {
    const r = ed.rig, H = [];
    const b = r.body;
    H.push({ x: b.x, y: b.y, c: BuddyCore.COLORS.body, sq: true, set: (x, y) => { const x2 = b.x + b.w, y2 = b.y + b.h; b.x = Math.min(x, x2 - 0.03); b.y = Math.min(y, y2 - 0.03); b.w = x2 - b.x; b.h = y2 - b.y; } });
    H.push({ x: b.x + b.w, y: b.y + b.h, c: BuddyCore.COLORS.body, sq: true, set: (x, y) => { b.w = Math.max(0.03, x - b.x); b.h = Math.max(0.03, y - b.y); } });
    const h = r.head;
    H.push({ x: h.cx, y: h.cy, c: BuddyCore.COLORS.head, set: (x, y) => { const dx = x - h.cx, dy = y - h.cy; h.cx = x; h.cy = y; h.nx += dx; h.ny += dy; } });
    H.push({ x: h.cx + h.rx, y: h.cy, c: BuddyCore.COLORS.head, small: true, set: (x) => { h.rx = Math.max(0.02, x - h.cx); } });
    H.push({ x: h.cx, y: h.cy + h.ry, c: BuddyCore.COLORS.head, small: true, set: (x, y) => { h.ry = Math.max(0.02, y - h.cy); } });
    H.push({ x: h.nx, y: h.ny, c: BuddyCore.COLORS.head, set: (x, y) => { h.nx = x; h.ny = y; } });
    r.eyes.forEach((e, i) => {
      H.push({ x: e.x, y: e.y, c: '#111', set: (x, y) => { e.x = x; e.y = y; }, del: () => r.eyes.splice(i, 1) });
      H.push({ x: e.x + e.r, y: e.y, c: '#111', small: true, set: (x) => { e.r = Math.max(0.005, x - e.x); } });
    });
    if (r.mouth) { const m = r.mouth; H.push({ x: m.x + m.w / 2, y: m.y + m.h / 2, c: BuddyCore.COLORS.mouth, sq: true, set: (x, y) => { m.x = x - m.w / 2; m.y = y - m.h / 2; }, del: () => (r.mouth = null) });
      H.push({ x: m.x + m.w, y: m.y + m.h, c: BuddyCore.COLORS.mouth, small: true, set: (x, y) => { m.w = Math.max(0.01, x - m.x); m.h = Math.max(0.006, y - m.y); } }); }
    const limbs = (arr, key) => arr.forEach((l, i) => {
      const del = () => arr.splice(i, 1);
      H.push({ x: l.jx, y: l.jy, c: BuddyCore.COLORS[key], set: (x, y) => { l.jx = x; l.jy = y; }, del, limb: l });
      H.push({ x: l.tx, y: l.ty, c: BuddyCore.COLORS[key], small: true, set: (x, y) => { l.tx = x; l.ty = y; }, del, limb: l });
    });
    limbs(r.legs, 'legs'); limbs(r.arms, 'arms'); limbs(r.ears, 'ears');
    if (r.tail) { const l = r.tail, del = () => (r.tail = null); H.push({ x: l.jx, y: l.jy, c: BuddyCore.COLORS.tail, set: (x, y) => { l.jx = x; l.jy = y; }, del, limb: l }); H.push({ x: l.tx, y: l.ty, c: BuddyCore.COLORS.tail, small: true, set: (x, y) => { l.tx = x; l.ty = y; }, del, limb: l }); }
    return H;
  }
  function paintFacing() { if (!ed || ed.kind !== 'image') return; seg('facing', ed.rig.facing || 'front', (v) => { ed.rig.facing = v; ed.rig.facingSet = true; rebuildLive(); }); }
  function drawRig() {
    paintFacing();
    const c = $('rigCv'), x = c.getContext('2d'), W = c.width, H = c.height;
    x.clearRect(0, 0, W, H); x.drawImage(ed.cv, 0, 0, W, H);
    x.save(); x.scale(2, 2); BuddyCore.drawRigOverlay(x, ed.rig, W / 2, H / 2, { thin: true }); x.restore();
    for (const hd of handles()) {
      const px = hd.x * W, py = hd.y * H, r = hd.small ? 7 : 10;
      x.fillStyle = hd.c; x.strokeStyle = '#fff'; x.lineWidth = 3;
      x.beginPath(); if (hd.sq) x.rect(px - r * 0.8, py - r * 0.8, r * 1.6, r * 1.6); else x.arc(px, py, r, 0, Math.PI * 2); x.fill(); x.stroke();
    }
  }
  let drag = null;
  const rel = (e) => { const r = $('rigCv').getBoundingClientRect(); return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height, pw: r.width, ph: r.height }; };
  function pick(p) {
    let best = null, bd = 12;
    for (const h of handles()) { const d = Math.hypot((p.x - h.x) * p.pw, (p.y - h.y) * p.ph); if (d < bd) { bd = d; best = h; } }
    return best;
  }
  function limbAt(p) {
    const r = ed.rig; let best = null, bd = 1e9;
    for (const l of [...r.legs, ...r.arms, ...r.ears, ...(r.tail ? [r.tail] : [])]) {
      const ax = l.jx * p.pw, ay = l.jy * p.ph, bx = l.tx * p.pw, by = l.ty * p.ph, px = p.x * p.pw, py = p.y * p.ph;
      const L2 = (bx - ax) ** 2 + (by - ay) ** 2 || 1, t = Math.max(0, Math.min(1, ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / L2));
      const d = Math.hypot(px - (ax + t * (bx - ax)), py - (ay + t * (by - ay)));
      if (d < Math.max(10, l.w * p.pw * 0.6) && d < bd) { bd = d; best = l; }
    }
    return best;
  }
  const clamp01 = (v) => Math.max(0, Math.min(1, v));
  const liveSoon = debounce(rebuildLive, 150);
  $('rigBox').addEventListener('pointerdown', (e) => { if (!ed || ed.kind !== 'image') return; drag = pick(rel(e)); if (drag) $('rigCv').setPointerCapture(e.pointerId); });
  $('rigBox').addEventListener('pointermove', (e) => {
    if (!ed || ed.kind !== 'image') return;
    const p = rel(e);
    if (!drag) { $('rigCv').style.cursor = pick(p) ? 'grab' : limbAt(p) ? 'ns-resize' : 'default'; return; }
    drag.set(clamp01(p.x), clamp01(p.y)); drawRig(); liveSoon();
  });
  window.addEventListener('pointerup', () => { if (drag) { drag = null; status(summary(ed.rig)); } });
  $('rigBox').addEventListener('dblclick', (e) => { if (!ed) return; const h = pick(rel(e)); if (h && h.del) { h.del(); drawRig(); rebuildLive(); status(summary(ed.rig)); } });
  $('rigBox').addEventListener('wheel', (e) => {
    if (!ed || ed.kind !== 'image') return; const l = limbAt(rel(e)); if (!l) return;
    e.preventDefault(); l.w = Math.max(0.008, Math.min(0.5, l.w * (e.deltaY < 0 ? 1.08 : 0.93))); drawRig(); liveSoon();
  }, { passive: false });
  $('partBtns').querySelectorAll('[data-add]').forEach((b) => b.addEventListener('click', () => {
    const r = ed.rig, k = b.dataset.add, h = r.head, bd = r.body;
    if (k === 'eyes') r.eyes.push({ x: h.cx + h.rx * 0.3, y: h.cy - h.ry * 0.1, r: Math.max(0.012, h.rx * 0.15) });
    if (k === 'mouth') r.mouth = r.mouth || { x: h.cx - h.rx * 0.25, y: h.cy + h.ry * 0.35, w: h.rx * 0.5, h: h.ry * 0.12 };
    if (k === 'legs') r.legs.push({ jx: bd.x + bd.w / 2, jy: bd.y + bd.h * 0.85, tx: bd.x + bd.w / 2, ty: Math.min(1, bd.y + bd.h + 0.2), w: 0.06 });
    if (k === 'arms') r.arms.push({ jx: bd.x + bd.w * 0.85, jy: bd.y + bd.h * 0.15, tx: bd.x + bd.w + 0.08, ty: bd.y + bd.h * 0.6, w: 0.05 });
    if (k === 'ears') r.ears.push({ jx: h.cx + h.rx * 0.4, jy: h.cy - h.ry * 0.7, tx: h.cx + h.rx * 0.6, ty: Math.max(0, h.cy - h.ry * 1.3), w: h.rx * 0.3 });
    if (k === 'tail') r.tail = r.tail || { jx: bd.x + 0.02, jy: bd.y + bd.h * 0.3, tx: Math.max(0, bd.x - 0.15), ty: bd.y, w: 0.05 };
    drawRig(); rebuildLive(); status(summary(r));
  }));

  // ---- live preview ----
  function rebuildLive() {
    if (!ed || ed.kind !== 'image') return;
    stopLive();
    const c = freshLive();
    try { liveBuddy = BuddyCore.Buddy2D(c, ed.cv, ed.rig, { frames: ed.frames, delays: ed.delays }); } catch (e) { status('preview error: ' + e.message); return; }
    startLive();
  }
  function stopLive() { cancelAnimationFrame(liveRaf); if (liveBuddy && liveBuddy.dispose) liveBuddy.dispose(); liveBuddy = null; }
  const DUR = { wave: 1.8, happy: 1.3, nap: 99, walk: 99, idle: 99, talk: 99 };
  function startLive() {
    let last = performance.now(), t = 0, ph = 0, blink = 2, dir = 1, turn = 3;
    liveT0 = 0;
    const step = (now) => {
      const dt = Math.min(0.05, (now - last) / 1000); last = now; t += dt; liveT0 += dt;
      if (liveT0 > DUR[liveMode]) liveT0 = 0;
      const walking = liveMode === 'walk';
      if (walking) { ph += dt * 7; turn -= dt; if (turn < 0) { dir = -dir; turn = 3; } }
      blink -= dt; let eye = 1; if (blink < 0 && blink > -0.14) eye = 0.05; if (blink <= -0.14) blink = 2 + Math.random() * 3;
      const c = $('liveCv');
      const s = { quirkEvery: liveMode === 'silly' ? 0.12 : 1, t, dt, mode: liveMode === 'talk' || liveMode === 'silly' ? 'idle' : liveMode, modeT: liveT0, walkGo: walking ? 1 : 0, gaitPh: ph, where: 'floor', heading: 0, walkDir: dir, held: false, eyeOpen: eye, scale: 1, talking: liveMode === 'talk' };
      if (liveBuddy && liveBuddy.kind === '2d') { s.size = Math.min(190, c.clientHeight * 0.62); s.ax = c.clientWidth / 2; s.ay = c.clientHeight * 0.86; }
      if (liveBuddy) liveBuddy.draw(s);
      liveRaf = requestAnimationFrame(step);
    };
    liveRaf = requestAnimationFrame(step);
  }
  seg('liveMode', 'idle', (v) => { liveMode = v; liveT0 = 0; });

  function closeEditor() { scanToken++; stopLive(); ed = null; $('scanner').classList.add('hidden'); status(''); }
  $('cancelChar').onclick = closeEditor;
  $('saveChar').onclick = async () => {
    if (!ed) return;
    const name = $('newName').value.trim() || ed.name || 'buddy';
    if (ed.kind === '3d') {
      let thumb = ''; try { thumb = liveBuddy.snapshot(); } catch (_) {}
      st = await S.charSave(name, { kind: '3d', glb: ed.glb, thumb, info: { clips: (ed.info || {}).clips || [] } });
    } else if (ed.id) {
      st = await S.charRig(ed.id, ed.rig, ed.back);
      if (name !== ed.name) { const r = await S.charRename(ed.id, name); if (r && r.error) alert(r.error); else if (r) st = r; }
    }
    else st = await S.charSave(name, { kind: 'image', png: ed.cv.toDataURL('image/png'), rig: ed.rig, anim: ed.frames ? { strip: BuddyCore.toStrip(ed.frames), n: ed.frames.length, delays: ed.delays } : undefined });
    closeEditor(); renderChars();
  };

  // ---------- brain ----------
  function renderBrain() {
    const list = [['claude-code', 'Claude (your account)', 'Uses your Claude Pro or Max login through Claude Code. No API key, no extra cost.']]
      .concat(Object.entries(st.providers).map(([id, p]) => [id, p.label, p.needsKey ? (st.keys[id] ? 'key saved' : 'needs an API key') : 'no key needed']));
    $('providers').innerHTML = list.map(([id, label, d]) => `<div class="provider${P().provider === id ? ' on' : ''}" data-id="${id}"><span class="dot"></span><div class="txt"><div class="t">${esc(label)}</div><div class="d">${esc(id === 'claude-code' && !st.claudeFound ? 'Claude Code not found. Install it and run "claude" once to log in.' : d)}</div></div></div>`).join('');
    $('providers').querySelectorAll('.provider').forEach((el) => (el.onclick = async () => { await set('provider', el.dataset.id); renderBrain(); }));
    const id = P().provider, isC = id === 'claude-code' || id === 'anthropic', meta = st.providers[id] || {};
    $('claudeCfg').classList.toggle('hidden', !isC); $('provCfg').classList.toggle('hidden', isC);
    seg('claudeModel', P().model || 'sonnet', (v) => set('model', v));
    if (!isC) {
      const cfg = (P().providers || {})[id] || {};
      $('keyRow').classList.toggle('hidden', !meta.needsKey && id !== 'custom');
      $('keyHint').innerHTML = (st.keys[id] ? 'Saved in your keychain. Paste a new one to replace it.' : 'Saved in your Mac\'s keychain.') + (meta.keyUrl ? ` <a href="#" id="getKey">Get a key</a>` : '');
      if ($('getKey')) $('getKey').onclick = (e) => { e.preventDefault(); S.open(meta.keyUrl); };
      $('urlRow').classList.toggle('hidden', id !== 'custom' && id !== 'ollama');
      $('baseURL').value = cfg.baseURL || meta.baseURL || '';
      $('modelSel').innerHTML = cfg.model ? `<option>${esc(cfg.model)}</option>` : '<option value="">pick a model (tap refresh)</option>';
    }
  }
  $('saveKey').onclick = async () => { st = await S.secret(P().provider, $('apiKey').value); $('apiKey').value = ''; renderBrain(); };
  $('baseURL').onchange = () => set('providerConfig', { provider: P().provider, config: { baseURL: $('baseURL').value.trim() } });
  $('loadModels').onclick = async () => {
    $('loadModels').disabled = true;
    try { const ms = await S.models(P().provider); const cur = ((P().providers || {})[P().provider] || {}).model; $('modelSel').innerHTML = ms.map((m) => `<option${m === cur ? ' selected' : ''}>${esc(m)}</option>`).join(''); if (!cur && ms[0]) set('providerConfig', { provider: P().provider, config: { model: ms[0] } }); }
    catch (e) { alert('could not load models: ' + e.message); }
    $('loadModels').disabled = false;
  };
  $('modelSel').onchange = () => set('providerConfig', { provider: P().provider, config: { model: $('modelSel').value } });
  $('test').onclick = async () => {
    $('testOut').textContent = 'asking...'; $('testOut').classList.add('busy');
    const r = await S.test(); $('testOut').classList.remove('busy');
    $('testOut').textContent = r.ok ? `✓ "${r.text}" (${(r.ms / 1000).toFixed(1)}s)` : `✗ ${r.text}`;
  };

  // ---------- get started (connect everything they already have) ----------
  const pill = (id, ok, text) => { $(id).textContent = text; $(id).classList.toggle('off', !ok); };
  function paintSetup(w) {
    if (!w) return;
    const c = w.claude || {};
    if (!c.installed) { $('wClaudeD').textContent = "Claude Code isn't on this Mac yet. It's free with your Claude plan (Pro or Max)."; pill('wClaudeP', false, 'not installed'); }
    else if (!c.loggedIn) { $('wClaudeD').textContent = 'Sign in once with your Claude account. No API key needed.'; pill('wClaudeP', false, 'not signed in'); }
    else { $('wClaudeD').textContent = 'Signed in with your Claude account. I think with your own Claude.'; pill('wClaudeP', true, 'connected'); }
    $('wSignIn').classList.toggle('hidden', !c.installed || c.loggedIn); $('wInstall').classList.toggle('hidden', c.installed);
    const nice = (n) => n.replace(/^claude_ai_/i, '').replace(/[_-]+/g, ' ');
    $('wConnD').textContent = w.connectors.length ? `Found: ${w.connectors.map(nice).join(', ')}.` : "None found yet. Connect apps on claude.ai, then tap Check again.";
    $('wToolsD').textContent = w.desktopTools.length ? `Found: ${w.desktopTools.join(', ')}.` : 'None found in the Claude desktop app (that’s fine).';
    pill('wCcP', w.ccMemoryChars > 0, w.ccMemoryChars > 0 ? 'synced' : 'none');
    $('wCcD').textContent = w.ccMemoryChars > 0 ? `Synced automatically (${Math.round(w.ccMemoryChars / 100) / 10}k characters).` : 'Nothing saved in Claude Code yet. That’s ok.';
    pill('wMemP', w.fromClaude, w.fromClaude ? 'brought over ✓' : 'not yet');
    if (w.caught) $('wMemS').textContent = 'got it ✓';
    if (w.error) $('wMemS').textContent = w.error;
    $('wBridge').checked = Boolean(w.bridge);
    pill('wExportP', w.fromExport, w.fromExport ? 'learned ✓' : 'no');
    pill('wLearnP', w.aboutMe, w.learning ? 'learning...' : w.aboutMe ? 'done ✓' : 'not yet');
    $('wLearn').textContent = w.aboutMe ? 'Again' : 'Start';
    if (!$('wName').value) $('wName').value = w.name || P().userName || '';
  }
  $('wName').addEventListener('input', debounce(async () => { await set('userName', $('wName').value.trim()); $('userName').value = $('wName').value.trim(); }));
  $('wSignIn').onclick = () => S.setupSignin();
  $('wInstall').onclick = () => S.open('https://code.claude.com/docs/en/setup');
  $('wConnMore').onclick = () => S.open('https://claude.ai/settings/connectors');
  $('wRefresh').onclick = async () => { $('wRefresh').disabled = true; paintSetup(await S.setupRefresh()); $('wRefresh').disabled = false; };
  $('wCopy').onclick = async () => { await S.setupCopy(); $('wMemS').textContent = 'waiting for you to copy Claude’s answer...'; $('wMemS').classList.add('busy'); };
  $('wPasteGo').onclick = async () => { const r = await S.setupPaste($('wPaste').value); $('wMemS').classList.remove('busy'); $('wMemS').textContent = r.text; if (r.ok) { $('wPaste').value = ''; paintSetup(r.state); } };
  $('wBridge').onchange = async () => { const r = await S.setupBridge($('wBridge').checked); if (!r.ok) alert(r.text); paintSetup(r.state); };
  $('wExport').onclick = async () => { const r = await S.setupExport(); if (r.cancelled) return; if (!r.ok) { alert(r.text); return; } paintSetup(r.state); pill('wExportP', false, 'reading...'); };
  $('wLearn').onclick = async () => { paintSetup(await S.setupLearn()); pill('wLearnP', false, 'learning...'); };
  $('wDone').onclick = async () => { await set('onboarded', true); go('general'); };
  document.querySelectorAll('[data-goto]').forEach((b) => (b.onclick = () => go(b.dataset.goto)));
  S.onSetup && S.onSetup((w) => { $('wMemS').classList.remove('busy'); paintSetup(w); });
  S.setupStatus && S.setupStatus().then(paintSetup);
  S.onJobs && S.onJobs(() => S.setupStatus().then(paintSetup));

  // ---------- connections ----------
  function paintWa(w) {
    if (!w) return;
    const label = { connected: 'linked' + (w.me && w.me.name ? ' as ' + w.me.name : ''), 'needs-scan': 'scan the QR', connecting: 'connecting...', reconnecting: 'reconnecting...', 'logged-out': 'unlinked on your phone', error: 'error', off: w.linked ? 'paused' : 'not linked' }[w.status] || w.status;
    $('waPill').textContent = label; $('waPill').classList.toggle('off', w.status !== 'connected');
    $('waQrRow').classList.toggle('hidden', !(w.status === 'needs-scan' && w.qrImage));
    if (w.qrImage) $('waQr').src = w.qrImage;
    $('waLink').classList.toggle('hidden', w.status === 'connected' || w.status === 'needs-scan');
    $('waLink').textContent = w.linked ? 'Reconnect' : 'Link WhatsApp';
    $('waUnlink').classList.toggle('hidden', !w.linked && w.status !== 'needs-scan');
    $('waUnlink').textContent = w.linked ? 'Unlink' : 'Cancel';
    seg('waNotify', w.notify || P().waNotify || 'direct', (v) => set('waNotify', v));
    $('waPhone').checked = w.phone !== false;
  }
  $('waPhone').onchange = () => set('waPhone', $('waPhone').checked);
  // ---------- safety check-up ----------
  $('docRun').onclick = async () => {
    $('docRun').disabled = true;
    const r = await S.doctor();
    $('docRun').disabled = false;
    $('docScore').textContent = 'Safety: ' + r.score + (r.fixed && r.fixed.length ? ` (tightened ${r.fixed.length} file permission${r.fixed.length > 1 ? 's' : ''})` : '');
    const icon = { ok: '✓', warn: '!', bad: '✗', info: '·' }, color = { ok: 'var(--ok, #3E7B4F)', warn: '#B7791F', bad: '#C0392B', info: 'inherit' };
    $('docList').innerHTML = '';
    for (const i of r.items) {
      const row = document.createElement('div'); row.className = 'row';
      row.innerHTML = `<div class="txt"><div class="t"><span style="color:${color[i.level]};font-weight:700;margin-right:6px">${icon[i.level]}</span>${esc(i.title)}</div><div class="d">${esc(i.detail)}</div></div>`;
      $('docList').appendChild(row);
    }
  };
  $('waLink').onclick = async () => { $('waLink').disabled = true; paintWa(await S.waLink()); $('waLink').disabled = false; };
  $('waUnlink').onclick = async () => { if (confirm('unlink luna from your whatsapp?')) paintWa(await S.waUnlink()); };
  S.onWa && S.onWa(paintWa);
  S.waState && S.waState().then(paintWa);
  $('bgBrowser').checked = Boolean(P().bgBrowser); $('bgBrowser').onchange = () => set('bgBrowser', $('bgBrowser').checked);
  $('connCount').textContent = (P().servers || []).length ? `${(P().servers || []).length} connected` : 'none yet';
  $('connCount').classList.toggle('off', !(P().servers || []).length);
  seg('effort', P().effort || 'low', (v) => set('effort', v));

  // ---------- memory ----------
  function renderMemory() {
    $('memList').innerHTML = st.memory.map((m) => `<div class="item"><span class="grow">${esc(m.path)}</span><span class="meta">${(m.size / 1024).toFixed(1)} KB · ${new Date(m.updated).toLocaleDateString()}</span><button class="btn" data-open="${esc(m.path)}">Open</button></div>`).join('') || '<div class="item">nothing yet</div>';
    $('memList').querySelectorAll('[data-open]').forEach((b) => (b.onclick = async () => { $('memPath').textContent = b.dataset.open; $('memText').value = await S.memRead(b.dataset.open); $('memEdit').classList.remove('hidden'); }));
  }
  $('memSave').onclick = async () => { const ok = await S.memWrite($('memPath').textContent, $('memText').value); $('memSave').textContent = ok ? 'Saved' : 'Read-only'; setTimeout(() => ($('memSave').textContent = 'Save'), 1200); st = await S.get(); renderMemory(); };
  $('memClose').onclick = () => $('memEdit').classList.add('hidden');
  $('memDel').onclick = async () => { if (!confirm('delete this file?')) return; await S.memDelete($('memPath').textContent); $('memEdit').classList.add('hidden'); st = await S.get(); renderMemory(); };
  $('impGo').onclick = async () => { if (!$('impText').value.trim()) return; st.memory = await S.memImport($('impFrom').value, $('impText').value); $('impText').value = ''; $('impOut').textContent = 'imported ✓'; renderMemory(); };
  $('forgetGo').onclick = async () => { const t = $('forget').value.trim(); if (!t) return; $('forgetOut').textContent = 'forgetting...'; $('forgetOut').textContent = await S.memForget(t); $('forget').value = ''; };

  // ---------- routines ----------
  function renderRoutines() {
    const rs = P().routines || [];
    $('routineList').innerHTML = rs.map((r, i) => `<div class="item"><span class="grow"><b>${esc(r.title)}</b> · ${esc(r.when)}<br><span class="meta">${esc(r.instructions).slice(0, 120)}</span></span><button class="btn" data-run="${i}">Run now</button><button class="btn danger" data-rm="${i}">Remove</button></div>`).join('') || '<div class="item">no routines yet</div>';
    $('routineList').querySelectorAll('[data-run]').forEach((b) => (b.onclick = () => S.routineRun(rs[b.dataset.run].title)));
    $('routineList').querySelectorAll('[data-rm]').forEach((b) => (b.onclick = async () => { st = await S.routineRemove(rs[b.dataset.rm].title); renderRoutines(); }));
    $('jobList').innerHTML = st.jobs.map((j) => `<div class="item"><span class="grow">${esc(j.title)}</span><span class="meta">since ${new Date(j.started).toLocaleTimeString()}</span><button class="btn danger" data-stop="${esc(j.id)}">Stop</button></div>`).join('') || '<div class="item">nothing running</div>';
    $('jobList').querySelectorAll('[data-stop]').forEach((b) => (b.onclick = async () => { st = await S.jobStop(b.dataset.stop); renderRoutines(); }));
  }
  $('rAdd').onclick = async () => {
    const when = $('rWhen').value.trim(), title = $('rTitle').value.trim(), what = $('rWhat').value.trim();
    if (!when || !title || !what) return;
    st = await S.routineAdd({ when, title, instructions: what }); $('rWhen').value = $('rTitle').value = $('rWhat').value = ''; renderRoutines();
  };
  S.onJobs && S.onJobs(async () => { st = await S.get(); renderRoutines(); });

  // ---------- activity / about ----------
  async function loadActivity() { const lines = await S.activity(); $('actLog').textContent = lines.join('\n') || 'nothing yet'; }
  $('aboutVer').textContent = st.version; $('aboutFolder').textContent = st.folder; $('aboutTz').textContent = st.timezone;
  $('quit').onclick = () => S.action('quit');

  names(); paintAppearance(); renderChars(); renderBrain(); renderRoutines();
  go(location.hash.slice(1) || (P().onboarded ? 'general' : 'welcome'));
})();
