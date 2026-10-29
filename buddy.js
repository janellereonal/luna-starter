// desktop side of custom characters: listens for the chosen character and draws it where luna would be
(function () {
  if (/standalone=1/.test(location.search)) return; // her own window has no character in it
  const stage = document.getElementById('pet'), gecko = document.getElementById('c');
  let buddy = null, cv = null, scale = 1, token = 0, zT = 0, heartsAt = -1;
  const loadImg = (src) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
  function fresh() { if (cv) cv.remove(); cv = document.createElement('canvas'); cv.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none'; stage.insertBefore(cv, gecko); return cv; }
  function clear() { if (buddy && buddy.dispose) buddy.dispose(); buddy = null; if (cv) { cv.remove(); cv = null; } }

  async function setCharacter(info) {
    const my = ++token;
    clear();
    if (!info || info.type === 'gecko') return;
    scale = info.scale || 1;
    try {
      if (info.type === 'image' && info.dataUrl) {
        const img = await loadImg(info.dataUrl);
        if (my !== token) return;
        const src = document.createElement('canvas'); src.width = img.width; src.height = img.height; src.getContext('2d').drawImage(img, 0, 0);
        // animated characters bring their own frames (her own blink and moves)
        let frames = null;
        if (info.animUrl && info.anim) { try { frames = window.BuddyCore.fromStrip(await loadImg(info.animUrl), info.anim.n); } catch (_) {} }
        if (my !== token) return;
        buddy = window.BuddyCore.Buddy2D(fresh(), src, info.rig || window.BuddyCore.guessRig(src), { frames, delays: info.anim && info.anim.delays });
      } else if (info.type === '3d' && info.glb) {
        const bin = atob(info.glb), buf = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
        buddy = window.BuddyCore.Buddy3D(fresh(), buf.buffer);
      }
    } catch (e) { console.error('character failed to load', e); clear(); }
  }

  // little floating things (z's while napping, hearts when happy), since the gecko's own ones live in her 3d scene
  function puff(text, color) {
    const p = buddy && buddy.headPoint(); if (!p) return;
    const s = document.createElement('div');
    s.textContent = text;
    s.style.cssText = `position:absolute;left:${p.x + 10 + Math.random() * 16}px;top:${p.y - 6}px;font:700 18px ui-rounded,system-ui;color:${color};pointer-events:none;transition:transform 1.6s ease-out,opacity 1.6s ease-out;opacity:1`;
    stage.appendChild(s);
    requestAnimationFrame(() => { s.style.transform = `translate(${10 + Math.random() * 20}px,-46px) scale(1.4)`; s.style.opacity = '0'; });
    setTimeout(() => s.remove(), 1700);
  }

  window.LUNA_BUDDY = {
    active: () => Boolean(buddy),
    get floorOnly() { return false; }, // picture characters roam the whole screen too, staying upright
    draw(st) {
      st.scale = scale;
      const now = performance.now();
      st.talking = (window.LUNA_TALK_UNTIL || 0) > now || Boolean(window.speechSynthesis && window.speechSynthesis.speaking);
      st.thinking = Boolean(window.LUNA_THINKING);
      if (buddy.kind === '2d') { st.size = 150; st.ax = stage.clientWidth / 2; st.ay = stage.clientHeight / 2 + (st.where === 'wall' ? 60 : 56); }
      buddy.draw(st);
      if (st.mode === 'nap') { zT -= st.dt; if (zT <= 0 && st.modeT > 0.8) { puff('z', '#8a8577'); zT = 1.3; } } else zT = 0;
      if (st.mode === 'happy') { const n = Math.floor(st.modeT / 0.45); if (n !== heartsAt && n < 3) { heartsAt = n; puff('♥', '#E5533D'); } } else heartsAt = -1;
    },
    hit: (x, y) => Boolean(buddy && buddy.hit(x, y)),
    headPoint: () => (buddy ? buddy.headPoint() : null)
  };
  if (window.luna && window.luna.onCharacter) window.luna.onCharacter((c) => setCharacter(c));
})();
