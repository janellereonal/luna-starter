// custom characters: bring a 2D picture to life (or load a 3D model) and animate it like luna.
// used by the desktop (buddy.js) and by the live preview in settings.
//
// a picture is turned into a soft puppet: a fine mesh laid over the image that bends at the joints
// (no cut-out pieces, so no seams). eyes blink and glance, the mouth opens when she talks,
// the head turns at the neck, legs walk, arms swing and wave, tails wag, ears twitch, the body breathes.
//
// rig (v2), everything as fractions of the picture (x/w/r of the width, y/h of the height, from the top-left):
// { v:2, kind, facing:'left'|'right'|'front',
//   body:{x,y,w,h}, head:{cx,cy,rx,ry,nx,ny}, eyes:[{x,y,r}], mouth:{x,y,w,h}|null,
//   ears:[limb], arms:[limb], legs:[limb], tail:limb|null }   limb = {jx,jy,tx,ty,w} (joint, tip, thickness)
(function () {
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const fin = (n) => typeof n === 'number' && isFinite(n);

  // ---------- picture prep: cut out the background cleanly ----------
  function prepareImage(img, maxSide = 760, opts = {}) {
    const k = Math.min(1, maxSide / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * k)), h = Math.max(1, Math.round(img.height * k));
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const x = cv.getContext('2d', { willReadFrequently: true });
    x.drawImage(img, 0, 0, w, h);
    const d = x.getImageData(0, 0, w, h), p = d.data;
    let clear = 0, n = 0; for (let i = 3; i < p.length; i += 4 * 7) { n++; if (p[i] < 20) clear++; }
    if (clear < n * 0.04) {
      // no transparency: learn the background colours from the border, flood-fill only those (tight, so dark outlines survive),
      // then soften the 1px edge so there's no halo
      const border = [];
      for (let i = 0; i < w; i += 2) border.push(i, (h - 1) * w + i);
      for (let j = 0; j < h; j += 2) border.push(j * w, j * w + w - 1);
      const pal = [];
      for (const i of border) { const c = [p[i * 4], p[i * 4 + 1], p[i * 4 + 2]]; const hit = pal.find((q) => Math.hypot(q.c[0] - c[0], q.c[1] - c[1], q.c[2] - c[2]) < 14); if (hit) hit.n++; else pal.push({ c, n: 1 }); }
      const bgs = pal.filter((q) => q.n >= border.length * 0.03).map((q) => q.c);
      if (!bgs.length) bgs.push(pal.sort((q, r2) => r2.n - q.n)[0].c);
      const dist = (i) => { let m = 1e9; for (const c of bgs) m = Math.min(m, Math.hypot(p[i * 4] - c[0], p[i * 4 + 1] - c[1], p[i * 4 + 2] - c[2])); return m; };
      const nearBg = (i) => { let best = bgs[0], m = 1e9; for (const c of bgs) { const d0 = Math.hypot(p[i * 4] - c[0], p[i * 4 + 1] - c[1], p[i * 4 + 2] - c[2]); if (d0 < m) { m = d0; best = c; } } return best; };
      const TOL = 18;
      const isBg = new Uint8Array(w * h), stack = [...border];
      while (stack.length) {
        const i = stack.pop(); if (isBg[i]) continue;
        if (dist(i) > TOL) continue;
        isBg[i] = 1;
        const cx = i % w, cy = (i / w) | 0;
        if (cx > 0) stack.push(i - 1); if (cx < w - 1) stack.push(i + 1); if (cy > 0) stack.push(i - w); if (cy < h - 1) stack.push(i + w);
      }
      for (let i = 0; i < w * h; i++) {
        if (isBg[i]) { p[i * 4 + 3] = 0; continue; }
        const cx = i % w, cy = (i / w) | 0;
        const edge = (cx > 0 && isBg[i - 1]) || (cx < w - 1 && isBg[i + 1]) || (cy > 0 && isBg[i - w]) || (cy < h - 1 && isBg[i + w]);
        if (!edge) continue;
        const bg = nearBg(i), a2 = clamp((dist(i) - TOL) / 60, 0.35, 1);
        for (let c = 0; c < 3; c++) p[i * 4 + c] = clamp(Math.round((p[i * 4 + c] - bg[c] * (1 - a2)) / a2), 0, 255);
        p[i * 4 + 3] = Math.round(a2 * 255);
      }
      x.putImageData(d, 0, 0);
    }
    // keep only what's joined to the character (plus any big separate pieces, like a held item)
    {
      const d2 = x.getImageData(0, 0, w, h), q = d2.data, lab = new Int32Array(w * h).fill(-1), sizes = [];
      for (let k = 0; k < w * h; k++) {
        if (lab[k] >= 0 || q[k * 4 + 3] < 30) continue;
        const id = sizes.length, st = [k]; lab[k] = id; let n = 0;
        while (st.length) { const c = st.pop(); n++; const cx = c % w; for (const nb of [c - 1, c + 1, c - w, c + w]) { if (nb < 0 || nb >= w * h || lab[nb] >= 0 || q[nb * 4 + 3] < 30) continue; if ((nb === c - 1 && cx === 0) || (nb === c + 1 && cx === w - 1)) continue; lab[nb] = id; st.push(nb); } }
        sizes.push(n);
      }
      if (sizes.length > 1) {
        const big = Math.max(...sizes);
        let changed = false;
        for (let k = 0; k < w * h; k++) if (lab[k] >= 0 && sizes[lab[k]] < big * 0.04) { q[k * 4 + 3] = 0; changed = true; }
        if (changed) x.putImageData(d2, 0, 0);
      }
    }
    if (opts.noCrop) return cv;
    const a = x.getImageData(0, 0, w, h).data;
    let x0 = w, y0 = h, x1 = 0, y1 = 0;
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) if (a[(j * w + i) * 4 + 3] > 40) { if (i < x0) x0 = i; if (i > x1) x1 = i; if (j < y0) y0 = j; if (j > y1) y1 = j; }
    if (x1 <= x0 || y1 <= y0) return cv;
    const m = Math.round(Math.max(x1 - x0, y1 - y0) * 0.05);
    x0 = Math.max(0, x0 - m); y0 = Math.max(0, y0 - m); x1 = Math.min(w - 1, x1 + m); y1 = Math.min(h - 1, y1 + m);
    const out = document.createElement('canvas'); out.width = x1 - x0 + 1; out.height = y1 - y0 + 1;
    out.getContext('2d').drawImage(cv, -x0, -y0);
    return out;
  }

  // ---------- animated pictures (GIF, animated WebP/PNG): her own frames ----------
  async function decodeAnimated(dataUrl) {
    try {
      if (!('ImageDecoder' in window)) return null;
      const type = dataUrl.slice(5, dataUrl.indexOf(';'));
      if (!/image\/(gif|webp|png|apng)/.test(type)) return null;
      const bin = atob(dataUrl.slice(dataUrl.indexOf(',') + 1)), buf = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
      const dec = new ImageDecoder({ data: buf, type: type === 'image/apng' ? 'image/png' : type });
      await dec.tracks.ready;
      const n = dec.tracks.selectedTrack ? dec.tracks.selectedTrack.frameCount : 1;
      if (n < 2) { dec.close(); return null; }
      const frames = [], delays = [];
      for (let i = 0; i < Math.min(n, 48); i++) {
        const { image } = await dec.decode({ frameIndex: i });
        const c = document.createElement('canvas'); c.width = image.displayWidth; c.height = image.displayHeight;
        c.getContext('2d').drawImage(image, 0, 0);
        delays.push(Math.max(20, Math.round((image.duration || 100000) / 1000)));
        image.close(); frames.push(c);
      }
      dec.close();
      return { frames, delays };
    } catch (_) { return null; }
  }
  // same background removal for every frame, then one shared crop so the frames stay lined up
  function prepareFrames(list, maxSide = 420) {
    const cvs = list.map((f) => prepareImage(f, maxSide, { noCrop: true }));
    const w = cvs[0].width, h = cvs[0].height;
    let x0 = w, y0 = h, x1 = 0, y1 = 0;
    for (const c of cvs) { const a = pixels(c); for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) if (a[(j * w + i) * 4 + 3] > 40) { if (i < x0) x0 = i; if (i > x1) x1 = i; if (j < y0) y0 = j; if (j > y1) y1 = j; } }
    if (x1 <= x0) return cvs;
    const m = Math.round(Math.max(x1 - x0, y1 - y0) * 0.05);
    x0 = Math.max(0, x0 - m); y0 = Math.max(0, y0 - m); x1 = Math.min(w - 1, x1 + m); y1 = Math.min(h - 1, y1 + m);
    return cvs.map((c) => { const o = document.createElement('canvas'); o.width = x1 - x0 + 1; o.height = y1 - y0 + 1; o.getContext('2d').drawImage(c, -x0, -y0); return o; });
  }
  // frames <-> one horizontal strip picture (how they're saved)
  function toStrip(frames) { const w = frames[0].width, h = frames[0].height, c = document.createElement('canvas'); c.width = w * frames.length; c.height = h; const x = c.getContext('2d'); frames.forEach((f, i) => x.drawImage(f, i * w, 0)); return c.toDataURL('image/png'); }
  function fromStrip(img, n) { const w = Math.round(img.width / n), h = img.height; return Array.from({ length: n }, (_, i) => { const c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d').drawImage(img, -i * w, 0); return c; }); }

  // follow the face through the frames (it sways), and find her own blink frame
  function studyFrames(frames, rigIn) {
    const r = cleanRig(rigIn), w = frames[0].width, h = frames[0].height;
    const E = r.eyes.map((e) => ({ x: e.x * w, y: e.y * h, r: Math.max(2, e.r * w) }));
    const darkIn = (a, cx, cy, R) => { let n = 0, sx = 0, sy = 0, y0 = h, y1 = 0; for (let y = Math.max(0, Math.floor(cy - R)); y <= Math.min(h - 1, cy + R); y++) for (let x = Math.max(0, Math.floor(cx - R)); x <= Math.min(w - 1, cx + R); x++) { const i = (y * w + x) * 4; if (a[i + 3] > 160 && 0.299 * a[i] + 0.587 * a[i + 1] + 0.114 * a[i + 2] < 90) { n++; sx += x; sy += y; if (y < y0) y0 = y; if (y > y1) y1 = y; } } return { n, x: n ? sx / n : cx, y: n ? sy / n : cy, hgt: n ? y1 - y0 + 1 : 0 }; };
    const info = frames.map((f) => {
      const a = pixels(f);
      const per = E.map((e) => darkIn(a, e.x, e.y, e.r * 2.2));
      const off = per.length ? { x: per.reduce((s2, q, i) => s2 + (q.x - E[i].x), 0) / per.length, y: per.reduce((s2, q, i) => s2 + (q.y - E[i].y), 0) / per.length } : { x: 0, y: 0 };
      return { off, eyeH: per.length ? per.reduce((s2, q) => s2 + q.hgt, 0) / per.length : 0, eyeN: per.reduce((s2, q) => s2 + q.n, 0) };
    });
    const o0 = { ...info[0].off }; info.forEach((q) => { q.off = { x: q.off.x - o0.x, y: q.off.y - o0.y }; });
    const openH = Math.max(...info.map((q) => q.eyeH), 0);
    let blink = -1;
    info.forEach((q, i) => { if (openH && q.eyeH > 0 && q.eyeH < openH * 0.55 && (blink < 0 || q.eyeH < info[blink].eyeH)) blink = i; });
    // her own closed eyes, cut from the blink frame (with a little skin around them)
    let closedPatches = null;
    if (blink >= 0) {
      const f = frames[blink], o = info[blink].off;
      closedPatches = E.map((e) => { const R = Math.ceil(e.r * 1.6), c = document.createElement('canvas'); c.width = c.height = R * 2; c.getContext('2d').drawImage(f, -(e.x + o.x - R), -(e.y + o.y - R)); return c; });
    }
    return { offsets: info.map((q) => q.off), blinkFrame: blink, closedPatches };
  }

  function pixels(cv) { return cv.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, cv.width, cv.height).data; }

  // ---------- quick offline guess from the outline (used until the AI scan comes back, or if it can't) ----------
  function guessRig(cv) {
    const w = cv.width, h = cv.height, a = pixels(cv);
    const on = (i, j) => a[(j * w + i) * 4 + 3] > 60;
    const runs = (j) => { const r = []; let s = -1; for (let i = 0; i < w; i++) { if (on(i, j)) { if (s < 0) s = i; } else if (s >= 0) { if (i - s > 2) r.push([s, i - 1]); s = -1; } } if (s >= 0) r.push([s, w - 1]); return r; };
    let bottom = h - 1; while (bottom > 0 && !runs(bottom).length) bottom--;
    let top = 0; while (top < h - 1 && !runs(top).length) top++;
    let legTop = bottom, legRuns = runs(Math.max(0, bottom - 2));
    for (let j = bottom - 2; j > top + (bottom - top) * 0.45; j--) { const r = runs(j); if (r.length < 2) { legTop = j; break; } if (r.length >= legRuns.length) legRuns = r; legTop = j; }
    const legs = legRuns.length >= 2 ? legRuns.slice(0, 4).map(([s, e]) => ({ jx: (s + e) / 2 / w, jy: legTop / h, tx: (s + e) / 2 / w, ty: bottom / h, w: (e - s + 1) / w })) : [];
    const topRun = runs(Math.min(h - 1, top + Math.round((bottom - top) * 0.08)))[0] || [0, w - 1];
    const cxTop = (topRun[0] + topRun[1]) / 2 / w;
    const wide = w > h * 1.15;
    const H = (bottom - top) / h, T = top / h, LT = legs.length ? legTop / h : bottom / h;
    let head, body;
    if (wide) {
      const left = cxTop < 0.5;
      head = { cx: left ? 0.2 : 0.8, cy: T + H * 0.22, rx: 0.17, ry: H * 0.22 };
      body = { x: 0.15, y: T + H * 0.3, w: 0.7, h: Math.max(0.08, LT - (T + H * 0.3)) };
    } else {
      head = { cx: 0.5, cy: T + H * 0.2, rx: 0.3, ry: H * 0.2 };
      body = { x: 0.15, y: T + H * 0.38, w: 0.7, h: Math.max(0.08, LT - (T + H * 0.38)) };
    }
    const bc = { x: body.x + body.w / 2, y: body.y + body.h / 2 };
    const neck = edgeToward(head, bc);
    return { v: 2, kind: wide ? 'quadruped' : 'biped', facing: wide ? (cxTop < 0.5 ? 'left' : 'right') : 'front', body, head: { ...head, nx: neck.x, ny: neck.y }, eyes: [], mouth: null, ears: [], arms: [], legs, tail: null, guessed: true };
  }
  function edgeToward(e, p) { const dx = p.x - e.cx, dy = p.y - e.cy, l = Math.hypot(dx / e.rx, dy / e.ry) || 1; return { x: e.cx + dx / l * 0.9, y: e.cy + dy / l * 0.9 }; }

  // ---------- rig cleanup (also upgrades old box-style rigs) ----------
  function limbFromBox(b, body) {
    const bc = { x: body.x + body.w / 2, y: body.y + body.h / 2 };
    if (b.h >= b.w) { const topNear = Math.abs(b.y - bc.y) < Math.abs(b.y + b.h - bc.y); return { jx: b.x + b.w / 2, jy: topNear ? b.y : b.y + b.h, tx: b.x + b.w / 2, ty: topNear ? b.y + b.h : b.y, w: b.w }; }
    const leftNear = Math.abs(b.x - bc.x) < Math.abs(b.x + b.w - bc.x);
    return { jx: leftNear ? b.x : b.x + b.w, jy: b.y + b.h / 2, tx: leftNear ? b.x + b.w : b.x, ty: b.y + b.h / 2, w: b.h * 0.9 };
  }
  function cleanRig(r) {
    r = r || {};
    const c01 = (v, d) => (fin(+v) ? clamp(+v, 0, 1) : d);
    const box = (b) => b && fin(+b.x) && fin(+b.y) && +b.w > 0.005 && +b.h > 0.005 ? { x: c01(b.x), y: c01(b.y), w: clamp(+b.w, 0.01, 1), h: clamp(+b.h, 0.01, 1) } : null;
    const body = box(r.body) || { x: 0.15, y: 0.35, w: 0.7, h: 0.4 };
    const limb = (l) => {
      if (!l) return null;
      if (fin(+l.jx) && fin(+l.tx)) { const o = { jx: c01(l.jx), jy: c01(l.jy), tx: c01(l.tx), ty: c01(l.ty), w: clamp(+l.w || 0.06, 0.008, 0.5) }; return Math.hypot(o.tx - o.jx, o.ty - o.jy) > 0.01 ? o : null; }
      const b = box(l); return b ? limbFromBox(b, body) : null;
    };
    let head;
    if (r.head && fin(+r.head.cx)) head = { cx: c01(r.head.cx), cy: c01(r.head.cy), rx: clamp(+r.head.rx || 0.15, 0.02, 0.6), ry: clamp(+r.head.ry || 0.15, 0.02, 0.6) };
    else { const b = box(r.head) || { x: 0.25, y: 0, w: 0.5, h: 0.4 }; head = { cx: b.x + b.w / 2, cy: b.y + b.h / 2, rx: b.w / 2, ry: b.h / 2 }; }
    const bc = { x: body.x + body.w / 2, y: body.y + body.h / 2 };
    const nk = r.head && fin(+r.head.nx) ? { x: c01(r.head.nx), y: c01(r.head.ny) } : edgeToward(head, bc);
    head.nx = nk.x; head.ny = nk.y;
    return {
      v: 2, kind: String(r.kind || 'other'), facing: /^(left|right|front)$/.test(r.facing) ? r.facing : 'front', facingSet: Boolean(r.facingSet),
      body, head,
      eyes: (r.eyes || []).filter((e) => e && fin(+e.x) && fin(+e.y)).map((e) => ({ x: c01(e.x), y: c01(e.y), r: clamp(+e.r || 0.025, 0.005, 0.2) })).slice(0, 4),
      mouth: box(r.mouth),
      ears: (r.ears || []).map(limb).filter(Boolean).slice(0, 4),
      arms: (r.arms || []).map(limb).filter(Boolean).slice(0, 4),
      legs: (r.legs || []).map(limb).filter(Boolean).slice(0, 6),
      tail: limb(r.tail)
    };
  }

  // ---------- after the AI scan: snap parts onto the real pixels ----------
  // eyes snap to the dark pupil / eye white nearby, limb tips slide to the actual end of the paw/foot,
  // and each limb's thickness is measured from the picture.
  function refineRig(cv, rigIn) {
    const r = cleanRig(rigIn), w = cv.width, h = cv.height, a = pixels(cv);
    const A = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : a[((y | 0) * w + (x | 0)) * 4 + 3]);
    const lum = (i) => 0.299 * a[i] + 0.587 * a[i + 1] + 0.114 * a[i + 2];
    // skin = typical colour inside the head
    const hx = r.head.cx * w, hy = r.head.cy * h, hrx = r.head.rx * w, hry = r.head.ry * h, samples = [];
    for (let k = 0; k < 400; k++) { const t = k * 2.399, rr = Math.sqrt(k / 400) * 0.8; const x = Math.round(hx + Math.cos(t) * hrx * rr), y = Math.round(hy + Math.sin(t) * hry * rr); if (A(x, y) > 200) { const i = (y * w + x) * 4; samples.push(lum(i)); } }
    samples.sort((p, q) => p - q);
    const skin = samples.length ? samples[Math.floor(samples.length / 2)] : 160;
    r.eyes = r.eyes.map((e) => {
      const ex = e.x * w, ey = e.y * h, er = e.r * w, R = Math.max(er * 1.7, 6);
      let sx = 0, sy = 0, n = 0, white = 0;
      for (let y = Math.floor(ey - R); y <= ey + R; y++) for (let x = Math.floor(ex - R); x <= ex + R; x++) {
        if ((x - ex) ** 2 + (y - ey) ** 2 > R * R || A(x, y) < 160) continue;
        const L = lum((y * w + x) * 4);
        if (L < Math.min(skin * 0.55, 90)) { sx += x; sy += y; n++; } else if (L > Math.max(skin + 35, 215)) white++;
      }
      if (n < 4) return { ...e, miss: true };
      const cx = sx / n, cy = sy / n, rad = Math.sqrt((n + white * 0.8) / Math.PI);
      return { x: cx / w, y: cy / h, r: clamp(rad, er * 0.55, er * 1.8) / w };
    });
    const fixLimb = (l) => {
      let jx = l.jx * w, jy = l.jy * h, tx = l.tx * w, ty = l.ty * h;
      const len = Math.hypot(tx - jx, ty - jy); if (len < 3) return l;
      const ux = (tx - jx) / len, uy = (ty - jy) / len;
      if (A(tx, ty) > 60) { let s = 0; while (s < len * 0.35 && A(tx + ux * (s + 1), ty + uy * (s + 1)) > 60) s++; tx += ux * s; ty += uy * s; }
      else { let s = 0; while (s < len * 0.6 && A(tx - ux * s, ty - uy * s) <= 60) s++; if (s < len * 0.6) { tx -= ux * s; ty -= uy * s; } }
      // thickness at 65% of the way down the limb
      const mx = jx + (tx - jx) * 0.65, my = jy + (ty - jy) * 0.65, px = -uy, py = ux, max = l.w * w * 2.5 + 6;
      let s1 = 0, s2 = 0;
      if (A(mx, my) > 60) { while (s1 < max && A(mx + px * s1, my + py * s1) > 60) s1++; while (s2 < max && A(mx - px * s2, my - py * s2) > 60) s2++; }
      const meas = s1 + s2, aw = l.w * w, ww = meas > 3 ? clamp(meas, aw * 0.6, aw * 1.4) : aw; // limbs lying over the body would measure too wide
      return { jx: jx / w, jy: jy / h, tx: clamp(tx / w, 0, 1), ty: clamp(ty / h, 0, 1), w: clamp(ww / w, 0.008, 0.5) };
    };
    // an eye with nothing eye-like under it (e.g. placed on a blush) gets swapped for one the finder sees
    const found = findEyes(cv, r);
    if (!r.eyes.length) r.eyes = found;
    else if (found.length === 2 && r.eyes.length <= 2) r.eyes = found; // a clear pair from the pixels is the most precise
    else if (r.eyes.some((e) => e.miss) || (found.length === 2 && r.eyes.length < 2)) {
      const used = new Set();
      const good = r.eyes.filter((e) => !e.miss);
      for (const g of good) { let bi = -1, bd = 1e9; found.forEach((f, i) => { const d = Math.hypot(f.x - g.x, f.y - g.y); if (d < bd) { bd = d; bi = i; } }); if (bi >= 0 && bd < 0.05) used.add(bi); }
      const extra = found.filter((_, i) => !used.has(i));
      r.eyes = [...good, ...extra].slice(0, Math.max(r.eyes.length, found.length));
    }
    r.eyes = r.eyes.map(({ miss, ...e }) => e);
    // which way is she looking? with both eyes visible, read it from where the face sits on the head
    if (r.eyes.length >= 2 && !rigIn.facingSet) { const fd = faceDirection(cv, r); if (fd) r.facing = fd; }
    r.mouth = snapMouth(cv, r) || r.mouth;
    r.legs = r.legs.map(fixLimb); r.arms = r.arms.map(fixLimb); r.ears = r.ears.map(fixLimb);
    if (r.tail) r.tail = fixLimb(r.tail);
    return r;
  }

  // ---------- eyes: find them from the pixels when the scan missed them ----------
  // looks inside the head for small, roundish dark spots (pupils), in pairs at about the same height
  function findEyes(cv, rig) {
    const w = cv.width, h = cv.height, a = pixels(cv), hd = rig.head;
    const cx = hd.cx * w, cy = hd.cy * h, rx = hd.rx * w, ry = hd.ry * h;
    const x0 = Math.max(0, Math.floor(cx - rx)), x1 = Math.min(w - 1, Math.ceil(cx + rx)), y0 = Math.max(0, Math.floor(cy - ry)), y1 = Math.min(h - 1, Math.ceil(cy + ry));
    const lum = (i) => 0.299 * a[i] + 0.587 * a[i + 1] + 0.114 * a[i + 2];
    const vals = [];
    for (let y = y0; y <= y1; y += 2) for (let x = x0; x <= x1; x += 2) { const i = (y * w + x) * 4; if (a[i + 3] > 200 && ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 < 1) vals.push(lum(i)); }
    if (vals.length < 20) return [];
    vals.sort((p, q) => p - q);
    const skin = vals[Math.floor(vals.length * 0.5)];
    // dark pupils on a light face, or light eyes on a dark face (like a penguin)
    const lightEyes = skin < 90, dark = Math.min(skin * 0.5, 85), light = Math.max(skin * 2, 175);
    const isEye = (i) => (lightEyes ? lum(i) >= light : lum(i) <= dark);
    const seen = new Uint8Array(w * h), blobs = [];
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const k = y * w + x; if (seen[k]) continue; seen[k] = 1;
      if (a[k * 4 + 3] < 200 || !isEye(k * 4) || ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 > 0.92) continue;
      let n = 0, sx = 0, sy = 0, bx0 = x, bx1 = x, by0 = y, by1 = y, edge = false; const st = [k];
      while (st.length) {
        const q = st.pop(), qx = q % w, qy = (q / w) | 0; n++; sx += qx; sy += qy;
        if (qx < bx0) bx0 = qx; if (qx > bx1) bx1 = qx; if (qy < by0) by0 = qy; if (qy > by1) by1 = qy;
        if (((qx - cx) / rx) ** 2 + ((qy - cy) / ry) ** 2 > 0.92) edge = true;
        for (const nb of [q - 1, q + 1, q - w, q + w]) { const nx = nb % w, ny = (nb / w) | 0; if (nb < 0 || nx < x0 || nx > x1 || ny < y0 || ny > y1 || seen[nb]) continue; seen[nb] = 1; if (a[nb * 4 + 3] >= 200 && isEye(nb * 4)) st.push(nb); }
        if (n > 20000) break;
      }
      const bw = bx1 - bx0 + 1, bh = by1 - by0 + 1, fill = n / (bw * bh), r = Math.sqrt(n / Math.PI);
      if (!edge && n >= 6 && fill > 0.45 && bw / bh < 2.2 && bh / bw < 2.6 && r > rx * 0.03 && r < rx * 0.35) blobs.push({ x: sx / n, y: sy / n, r, n });
    }
    if (!blobs.length) return [];
    // prefer two similar blobs side by side in the upper half of the head; else the single best one
    let best = null;
    for (let i = 0; i < blobs.length; i++) for (let j = i + 1; j < blobs.length; j++) {
      const p = blobs[i], q = blobs[j], dy = Math.abs(p.y - q.y), dx = Math.abs(p.x - q.x), sim = Math.min(p.n, q.n) / Math.max(p.n, q.n);
      if (dy < Math.max(p.r, q.r) * 1.6 && dx > (p.r + q.r) * 1.2 && dx < rx * 1.6 && sim > 0.35) { const sc = sim * 2 + (p.n + q.n) / 400 - ((p.y + q.y) / 2 - cy) / ry; if (!best || sc > best.sc) best = { sc, eyes: [p, q] }; }
    }
    const pick = best ? best.eyes : [blobs.sort((p, q) => (p.y - cy) / ry - (q.y - cy) / ry + (q.n - p.n) / 500)[0]];
    return pick.map((e) => ({ x: e.x / w, y: e.y / h, r: (e.r * 1.25) / w }));
  }

  function faceDirection(cv, r) {
    const w = cv.width, h = cv.height, a = pixels(cv);
    const ex = r.eyes.reduce((s2, e) => s2 + e.x, 0) / r.eyes.length * w, ey = r.eyes.reduce((s2, e) => s2 + e.y, 0) / r.eyes.length * h;
    let L = 0, R = 0, n = 0;
    for (let y = Math.round(ey - 2); y <= ey + 2; y++) {
      if (y < 0 || y >= h) continue;
      let l = -1, rr = -1; for (let x = 0; x < w; x++) if (a[(y * w + x) * 4 + 3] > 100) { if (l < 0) l = x; rr = x; }
      if (l >= 0) { L += l; R += rr; n++; }
    }
    if (!n) return null;
    L /= n; R /= n;
    let fx = ex; if (r.mouth) fx = (ex * 2 + (r.mouth.x + r.mouth.w / 2) * w) / 3;
    const off = (fx - (L + R) / 2) / Math.max(1, (R - L) / 2);
    return off > 0.05 ? 'right' : off < -0.05 ? 'left' : 'front';
  }

  // ---------- mouth: snap the box onto the actual mouth line (the dark mark below and between the eyes) ----------
  function snapMouth(cv, r) {
    const w = cv.width, h = cv.height, a = pixels(cv), hd = r.head;
    const hx = hd.cx * w, hy = hd.cy * h, hrx = hd.rx * w, hry = hd.ry * h;
    const lum = (i) => 0.299 * a[i] + 0.587 * a[i + 1] + 0.114 * a[i + 2];
    const E = r.eyes.map((e) => ({ x: e.x * w, y: e.y * h, r: e.r * w }));
    const er = E.length ? E.reduce((s2, e) => s2 + e.r, 0) / E.length : hrx * 0.1;
    const eyeY = E.length ? E.reduce((s2, e) => s2 + e.y, 0) / E.length : hy;
    let x0, x1;
    if (E.length >= 2) { const xs = E.map((e) => e.x).sort((p2, q) => p2 - q); x0 = xs[0] - er * 0.5; x1 = xs[xs.length - 1] + er * 0.5; }
    else { x0 = hx - hrx * 0.5; x1 = hx + hrx * 0.5; }
    if (r.facing !== 'front' && r.mouth) { const mc = (r.mouth.x + r.mouth.w / 2) * w; x0 = Math.min(x0, mc - hrx * 0.4); x1 = Math.max(x1, mc + hrx * 0.4); }
    const y0 = Math.round(eyeY - er * 0.2), y1 = Math.round(Math.min(hy + hry * 0.95, eyeY + Math.max(er * 4.5, hry * 0.35)));
    const vals = []; for (let y = y0; y <= y1; y += 2) for (let x = Math.round(x0); x <= x1; x += 2) { const i = (y * w + x) * 4; if (a[i + 3] > 200) vals.push(lum(i)); }
    if (vals.length < 10) return null;
    vals.sort((p2, q) => p2 - q);
    const skin = vals[Math.floor(vals.length * 0.6)], dark = Math.min(skin * 0.55, 110);
    const seen = new Uint8Array(w * h); const blobs = [];
    for (let y = y0; y <= y1; y++) for (let x = Math.max(0, Math.round(x0)); x <= Math.min(w - 1, x1); x++) {
      const k = y * w + x; if (seen[k]) continue; seen[k] = 1;
      if (a[k * 4 + 3] < 200 || lum(k * 4) > dark) continue;
      if (E.some((e) => Math.hypot(x - e.x, y - e.y) < e.r * 1.35)) continue;
      let n = 0, bx0 = x, bx1 = x, by0 = y, by1 = y; const st = [k];
      while (st.length) {
        const q = st.pop(), qx = q % w, qy = (q / w) | 0; n++;
        if (qx < bx0) bx0 = qx; if (qx > bx1) bx1 = qx; if (qy < by0) by0 = qy; if (qy > by1) by1 = qy;
        for (const nb of [q - 1, q + 1, q - w, q + w, q - w - 1, q - w + 1, q + w - 1, q + w + 1]) { const nx = nb % w, ny = (nb / w) | 0; if (nb < 0 || nx < x0 || nx > x1 || ny < y0 || ny > y1 || seen[nb]) continue; seen[nb] = 1; if (a[nb * 4 + 3] >= 200 && lum(nb * 4) <= dark && !E.some((e) => Math.hypot(nx - e.x, ny - e.y) < e.r * 1.35)) st.push(nb); }
        if (n > 5000) break;
      }
      const bw = bx1 - bx0 + 1, bh = by1 - by0 + 1;
      // a mouth is wider than tall-ish, not touching the head outline, not huge
      if (n >= 4 && bw >= er * 0.5 && bw < hrx * 0.9 && bh < hry * 0.6 && ((bx0 + bx1) / 2 - hx) ** 2 / hrx ** 2 + ((by0 + by1) / 2 - hy) ** 2 / hry ** 2 < 0.8) blobs.push({ bx0, bx1, by0, by1, n });
    }
    if (!blobs.length) return null;
    // the mouth sits just under the eyes, in the middle (side views: where the scan put it)
    const want = r.facing !== 'front' && r.mouth ? { x: (r.mouth.x + r.mouth.w / 2) * w, y: (r.mouth.y + r.mouth.h / 2) * h } : { x: E.length >= 2 ? (E[0].x + E[1].x) / 2 : (x0 + x1) / 2, y: eyeY + er * 1.6 };
    blobs.sort((p2, q) => Math.hypot((p2.bx0 + p2.bx1) / 2 - want.x, (p2.by0 + p2.by1) / 2 - want.y) - Math.hypot((q.bx0 + q.bx1) / 2 - want.x, (q.by0 + q.by1) / 2 - want.y));
    const m = blobs[0], pad = 1;
    return { x: (m.bx0 - pad) / w, y: (m.by0 - pad) / h, w: (m.bx1 - m.bx0 + 1 + pad * 2) / w, h: (m.by1 - m.by0 + 1 + pad * 2) / h };
  }

  // ---------- expressions: cartoon eyes and mouths drawn onto copies of the picture ----------
  // eyes: open (as drawn), closed (‿ blink / sleep), happy (^ ^), wink. mouth: as drawn, open (talking), wide (laugh), smile (D), o (yawn / surprise)
  function faceKit(src, rigIn, opts = {}) {
    const r = cleanRig(rigIn), w = src.width, h = src.height, a = pixels(src);
    const lum = (i) => 0.299 * a[i] + 0.587 * a[i + 1] + 0.114 * a[i + 2];
    const ringColor = (cx, cy, rx, ry) => {
      const cs = [];
      for (let k = 0; k < 90; k++) { const t = (k / 90) * Math.PI * 2; for (const f of [1.15, 1.35, 1.6]) { const X = Math.round(cx + Math.cos(t) * rx * f), Y = Math.round(cy + Math.sin(t) * ry * f); if (X < 0 || Y < 0 || X >= w || Y >= h) continue; const i = (Y * w + X) * 4; if (a[i + 3] > 220) cs.push([a[i], a[i + 1], a[i + 2], lum(i)]); } }
      if (!cs.length) return null;
      cs.sort((p2, q) => q[3] - p2[3]); // brightest half = skin, not the outline
      const top = cs.slice(0, Math.max(1, Math.floor(cs.length * 0.6)));
      const md = [0, 1, 2].map((c) => top.map((v) => v[c]).sort((p2, q) => p2 - q)[Math.floor(top.length / 2)]);
      return `rgb(${md[0]},${md[1]},${md[2]})`;
    };
    // ink = the outline colour (darkest tones inside the head)
    const hx = r.head.cx * w, hy = r.head.cy * h, hrx = r.head.rx * w, hry = r.head.ry * h, darks = [];
    for (let k = 0; k < 1500; k++) { const t = k * 2.399, rr = Math.sqrt(k / 1500); const X = Math.round(hx + Math.cos(t) * hrx * rr), Y = Math.round(hy + Math.sin(t) * hry * rr); if (X < 0 || Y < 0 || X >= w || Y >= h) continue; const i = (Y * w + X) * 4; if (a[i + 3] > 220) darks.push([a[i], a[i + 1], a[i + 2], lum(i)]); }
    darks.sort((p2, q) => p2[3] - q[3]);
    const inkC = darks.length ? darks[Math.floor(darks.length * 0.02)] : [40, 30, 30];
    const ink = inkC[3] < 120 ? `rgb(${inkC[0]},${inkC[1]},${inkC[2]})` : '#3a2a2a';
    const eyes = r.eyes.map((e) => {
      const E = { x: e.x * w, y: e.y * h, r: Math.max(3, e.r * w) }; E.skin = ringColor(E.x, E.y, E.r * 1.05, E.r * 1.05) || '#fff';
      // "dot" eyes = mostly solid dark inside (chibi / sticker style): they blink as a short dash
      let dk = 0, tot = 0; for (let y = Math.round(E.y - E.r * 0.8); y <= E.y + E.r * 0.8; y++) for (let x2 = Math.round(E.x - E.r * 0.8); x2 <= E.x + E.r * 0.8; x2++) { if (x2 < 0 || y < 0 || x2 >= w || y >= h) continue; const i = (y * w + x2) * 4; if (a[i + 3] < 150) continue; tot++; if (lum(i) < 110) dk++; }
      E.dot = tot > 0 && dk / tot > 0.55; return E;
    });
    const er = eyes.length ? eyes.reduce((s2, e) => s2 + e.r, 0) / eyes.length : hrx * 0.08;
    let mouth = null;
    if (r.mouth) {
      // talking/smiling mouths are sized to the face (tiny drawn mouths would be invisible when open)
      const eyeGap = eyes.length >= 2 ? Math.abs(eyes[0].x - eyes[1].x) : er * 5;
      const mw = Math.max(r.mouth.w * w, er * 2.4, eyeGap * 0.5), mh = Math.max(r.mouth.h * h, er * 0.6);
      mouth = { x: (r.mouth.x + r.mouth.w / 2) * w, y: (r.mouth.y + r.mouth.h / 2) * h, w: mw, h: mh, ow: r.mouth.w * w, oh: r.mouth.h * h };
      mouth.skin = ringColor(mouth.x, mouth.y, mouth.ow * 0.7 + 2, mouth.oh * 0.9 + 2) || eyes[0]?.skin || '#fff';
    }
    const lw = Math.max(1.6, er * 0.36);
    const erase = (x, cx, cy, rx, ry, color) => {
      x.save(); x.globalCompositeOperation = 'source-atop'; x.translate(cx, cy); x.scale(1, ry / rx);
      const g = x.createRadialGradient(0, 0, 0, 0, 0, rx); g.addColorStop(0, color); g.addColorStop(0.78, color); g.addColorStop(1, color.replace('rgb(', 'rgba(').replace(')', ',0)'));
      x.fillStyle = g; x.beginPath(); x.arc(0, 0, rx, 0, Math.PI * 2); x.fill(); x.restore();
    };
    function make(eyesS, mouthS) {
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const x = c.getContext('2d'); x.drawImage(src, 0, 0);
      x.lineCap = 'round'; x.lineJoin = 'round'; x.strokeStyle = ink; x.lineWidth = lw;
      const rightmost = eyes.length ? eyes.reduce((p2, q) => (q.x > p2.x ? q : p2)) : null;
      for (const e of eyes) {
        const st2 = eyesS === 'wink' ? (e === rightmost ? 'closed' : 'open') : eyesS;
        if (st2 === 'open') continue;
        erase(x, e.x, e.y, e.r * 1.45, e.r * 1.45, e.skin);
        const patch = st2 === 'closed' && opts.closedPatches && opts.closedPatches[eyes.indexOf(e)];
        if (patch) { x.save(); x.globalCompositeOperation = 'source-atop'; x.drawImage(patch, e.x - patch.width / 2, e.y - patch.height / 2); x.restore(); continue; } // her own blink from the gif
        x.beginPath();
        if (st2 === 'happy') x.arc(e.x, e.y + e.r * 0.55, e.r * 1.0, Math.PI * 1.15, Math.PI * 1.85); // ^
        else if (e.dot) { x.save(); x.lineWidth = Math.max(lw, e.r * 0.55); x.moveTo(e.x - e.r * 0.95, e.y + e.r * 0.15); x.lineTo(e.x + e.r * 0.95, e.y + e.r * 0.15); x.stroke(); x.restore(); continue; } // dot eyes close into a little dash
        else x.arc(e.x, e.y - e.r * 0.45, e.r * 1.0, Math.PI * 0.15, Math.PI * 0.85); // ‿ closed
        x.stroke();
      }
      if (mouth && mouthS !== 'normal') {
        const m = mouth;
        erase(x, m.x, m.y, Math.max(m.ow * 0.75, m.w * 0.6) + 2, Math.max(m.oh * 1.2, m.h) + 2, m.skin);
        const dark = '#5b1d26', tongue = '#f08a98';
        x.save(); x.lineWidth = lw * 0.9;
        const shape = () => {
          x.beginPath();
          if (mouthS === 'o') x.ellipse(m.x, m.y + m.w * 0.08, m.w * 0.22, m.w * 0.27, 0, 0, Math.PI * 2);
          else if (mouthS === 'smile') { const A = m.w * 0.55, top = m.y - m.w * 0.1, dep = m.w * 0.62; x.moveTo(m.x - A, top); x.quadraticCurveTo(m.x, top + m.w * 0.06, m.x + A, top); x.bezierCurveTo(m.x + A * 0.9, top + dep * 1.25, m.x - A * 0.9, top + dep * 1.25, m.x - A, top); x.closePath(); }
          else { const big = mouthS === 'wide'; x.ellipse(m.x, m.y + m.w * (big ? 0.16 : 0.1), m.w * (big ? 0.42 : 0.36), m.w * (big ? 0.44 : 0.28), 0, 0, Math.PI * 2); }
        };
        shape(); x.fillStyle = dark; x.fill();
        if (mouthS !== 'o') { x.save(); shape(); x.clip(); x.fillStyle = tongue; x.beginPath(); x.ellipse(m.x, m.y + m.w * (mouthS === 'smile' ? 0.48 : mouthS === 'wide' ? 0.48 : 0.32), m.w * 0.3, m.w * 0.18, 0, 0, Math.PI * 2); x.fill(); x.restore(); }
        shape(); x.stroke(); x.restore();
      }
      return c;
    }
    const cache = {};
    return { hasEyes: eyes.length > 0, hasMouth: Boolean(mouth), get: (e, m) => cache[e + '|' + m] || (cache[e + '|' + m] = make(e, m)) };
  }

  // ---------- back view: from behind, the head and body show their outer colour (hair, fur, shirt) ----------
  // limbs, tail, ears and feet keep their own colours; the face and belly markings disappear.
  function makeBackView(src, rigIn) {
    const r = cleanRig(rigIn), w = src.width, h = src.height;
    const out = document.createElement('canvas'); out.width = w; out.height = h;
    const x = out.getContext('2d', { willReadFrequently: true }); x.drawImage(src, 0, 0);
    const d = x.getImageData(0, 0, w, h), p = d.data;
    const A = (X, Y) => (X < 0 || Y < 0 || X >= w || Y >= h ? 0 : p[(Y * w + X) * 4 + 3]);
    const median = (list) => (list.length ? [0, 1, 2].map((c) => list.map((v) => v[c]).sort((a2, b2) => a2 - b2)[Math.floor(list.length / 2)]) : null);
    const col = (X, Y) => { const i = (Y * w + X) * 4; return [p[i], p[i + 1], p[i + 2]]; };
    const hd = { cx: r.head.cx * w, cy: r.head.cy * h, rx: r.head.rx * w, ry: r.head.ry * h };
    const inHead = (X, Y, f = 1) => ((X - hd.cx) / (hd.rx * f)) ** 2 + ((Y - hd.cy) / (hd.ry * f)) ** 2 <= 1;
    const B = { x: r.body.x * w, y: r.body.y * h, w: r.body.w * w, h: r.body.h * h };
    const limbs = [...r.legs, ...r.arms, ...r.ears, ...(r.tail ? [r.tail] : [])].map((l) => ({ jx: l.jx * w, jy: l.jy * h, tx: l.tx * w, ty: l.ty * h, w: l.w * w }));
    // each limb's own colour (sampled along its middle), so belly or face pixels under a limb's box still get painted
    limbs.forEach((l) => { const cs = []; for (let t = 0.4; t <= 0.9; t += 0.05) { const X = Math.round(l.jx + (l.tx - l.jx) * t), Y = Math.round(l.jy + (l.ty - l.jy) * t); if (A(X, Y) > 200) cs.push(col(X, Y)); } l.col = median(cs); });
    const near = (c1, c2) => c2 && Math.hypot(c1[0] - c2[0], c1[1] - c2[1], c1[2] - c2[2]) < 70;
    const onLimb = (X, Y) => limbs.some((l) => { const vx = l.tx - l.jx, vy = l.ty - l.jy, L2 = vx * vx + vy * vy || 1, t = ((X - l.jx) * vx + (Y - l.jy) * vy) / L2; if (t < 0.12 || t > 1.3) return false; const px = l.jx + vx * t, py = l.jy + vy * t; return Math.hypot(X - px, Y - py) < l.w * 0.6 && (!l.col || near(col(X, Y), l.col)); });
    // colour along the outer edge: walk in from the outline a few pixels
    const edgeSamples = (inside) => {
      const s = [];
      for (let Y = 1; Y < h - 1; Y += 2) for (let X = 1; X < w - 1; X += 2) {
        if (A(X, Y) < 220 || !inside(X, Y) || onLimb(X, Y)) continue;
        let near = false; for (let k = 3; k <= 9 && !near; k += 3) near = A(X - k, Y) < 40 || A(X + k, Y) < 40 || A(X, Y - k) < 40 || A(X, Y + k) < 40;
        if (near) s.push(col(X, Y));
      }
      return s;
    };
    const headCol = median(edgeSamples((X, Y) => inHead(X, Y, 1.05)));
    const bTop = Math.min(B.y, hd.cy); // also covers the neck between head and body
    const inBody = (X, Y) => X >= B.x && X <= B.x + B.w && Y >= bTop && Y <= B.y + B.h && !inHead(X, Y, 1.05);
    const bodyCol = median(edgeSamples(inBody)) || headCol;
    const mouth = r.mouth ? { x: (r.mouth.x - r.mouth.w * 0.2) * w - 4, y: (r.mouth.y - r.mouth.h * 0.3) * h - 4, w: r.mouth.w * 1.4 * w + 8, h: r.mouth.h * 1.6 * h + 8 } : null;
    for (let Y = 0; Y < h; Y++) for (let X = 0; X < w; X++) {
      const i = (Y * w + X) * 4; if (p[i + 3] < 10) continue;
      let c = null, shade = 1;
      if (headCol && (inHead(X, Y, 1.04) || (mouth && X >= mouth.x && X <= mouth.x + mouth.w && Y >= mouth.y && Y <= mouth.y + mouth.h)) && !onLimb(X, Y)) { c = headCol; shade = 1.06 - 0.12 * Math.min(1, Math.hypot((X - hd.cx) / hd.rx, (Y - hd.cy + hd.ry * 0.3) / hd.ry)); }
      else if (bodyCol && inBody(X, Y) && !onLimb(X, Y)) { c = bodyCol; shade = 1.03 - 0.1 * Math.min(1, Math.abs(X - (B.x + B.w / 2)) / (B.w / 2)); }
      if (c) { p[i] = Math.min(255, c[0] * shade); p[i + 1] = Math.min(255, c[1] * shade); p[i + 2] = Math.min(255, c[2] * shade); }
      else { p[i] *= 0.92; p[i + 1] *= 0.92; p[i + 2] *= 0.93; }
    }
    x.putImageData(d, 0, 0);
    // soften the seams between filled areas and the rest
    const soft = document.createElement('canvas'); soft.width = w; soft.height = h;
    const sx = soft.getContext('2d'); sx.filter = 'blur(0.8px)'; sx.drawImage(out, 0, 0); sx.filter = 'none';
    sx.globalCompositeOperation = 'destination-in'; sx.drawImage(src, 0, 0);
    return soft;
  }
  // fit a picture of the back onto the same canvas size as the front, so the puppet can wear it
  function fitBack(img, src) {
    const prep = prepareImage(img), out = document.createElement('canvas'); out.width = src.width; out.height = src.height;
    const k = Math.min(src.height / prep.height, src.width / prep.width);
    out.getContext('2d').drawImage(prep, (src.width - prep.width * k) / 2, src.height - prep.height * k, prep.width * k, prep.height * k);
    return out;
  }

  // ---------- drawing helpers for the scan (grid for measuring, overlay for double-checking) ----------
  const COLORS = { head: '#E5533D', body: '#3E7BD9', legs: '#1FA463', arms: '#E8912D', tail: '#9B59D0', ears: '#E05FA8', eyes: '#111111', mouth: '#E8C21D' };
  function scanImage(cv, rig) {
    const pad = 34, W = cv.width, H = cv.height, out = document.createElement('canvas');
    out.width = W + pad * 2; out.height = H + pad * 2;
    const x = out.getContext('2d');
    x.fillStyle = '#ffffff'; x.fillRect(0, 0, out.width, out.height);
    x.drawImage(cv, pad, pad);
    x.font = '600 12px Arial, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
    for (let i = 0; i <= 10; i++) {
      const gx = pad + (W * i) / 10, gy = pad + (H * i) / 10;
      x.strokeStyle = i % 5 === 0 ? 'rgba(0,120,255,.45)' : 'rgba(0,120,255,.22)'; x.lineWidth = 1;
      x.beginPath(); x.moveTo(gx, pad); x.lineTo(gx, pad + H); x.stroke();
      x.beginPath(); x.moveTo(pad, gy); x.lineTo(pad + W, gy); x.stroke();
      x.fillStyle = '#0060cc'; x.fillText(String(i * 10), gx, pad / 2); x.fillText(String(i * 10), pad / 2, gy);
      x.fillText(String(i * 10), gx, pad + H + pad / 2); x.fillText(String(i * 10), pad + W + pad / 2, gy);
    }
    if (rig) { x.save(); x.translate(pad, pad); drawRigOverlay(x, rig, W, H, { labels: true }); x.restore(); }
    return out.toDataURL('image/png');
  }
  function drawRigOverlay(x, r, W, H, o = {}) {
    x.save();
    x.lineWidth = o.thin ? 2 : 2.5;
    const dot = (px, py, c, rad = 4.5) => { x.fillStyle = c; x.beginPath(); x.arc(px, py, rad, 0, Math.PI * 2); x.fill(); x.strokeStyle = '#fff'; x.lineWidth = 1.5; x.stroke(); };
    const label = (t, px, py, c) => { if (!o.labels) return; x.font = '700 11px Arial'; x.fillStyle = c; x.textAlign = 'left'; x.fillText(t, px + 6, py - 6); };
    const b = r.body; x.strokeStyle = COLORS.body; x.setLineDash([6, 4]); x.strokeRect(b.x * W, b.y * H, b.w * W, b.h * H); x.setLineDash([]); label('body', b.x * W, b.y * H + 12, COLORS.body);
    const hd = r.head; x.strokeStyle = COLORS.head; x.lineWidth = 2.5; x.beginPath(); x.ellipse(hd.cx * W, hd.cy * H, hd.rx * W, hd.ry * H, 0, 0, Math.PI * 2); x.stroke();
    dot(hd.nx * W, hd.ny * H, COLORS.head); label('head', hd.cx * W, (hd.cy - hd.ry) * H, COLORS.head);
    const limb = (l, c, name) => {
      x.strokeStyle = c; x.globalAlpha = 0.28; x.lineCap = 'round'; x.lineWidth = Math.max(4, l.w * W); x.beginPath(); x.moveTo(l.jx * W, l.jy * H); x.lineTo(l.tx * W, l.ty * H); x.stroke();
      x.globalAlpha = 1; x.lineWidth = 2.5; x.beginPath(); x.moveTo(l.jx * W, l.jy * H); x.lineTo(l.tx * W, l.ty * H); x.stroke();
      dot(l.jx * W, l.jy * H, c); x.fillStyle = c; x.beginPath(); x.arc(l.tx * W, l.ty * H, 3, 0, Math.PI * 2); x.fill();
      label(name, l.tx * W, l.ty * H, c);
    };
    r.legs.forEach((l, i) => limb(l, COLORS.legs, 'leg ' + (i + 1))); r.arms.forEach((l, i) => limb(l, COLORS.arms, 'arm ' + (i + 1)));
    r.ears.forEach((l) => limb(l, COLORS.ears, 'ear')); if (r.tail) limb(r.tail, COLORS.tail, 'tail');
    if (r.mouth) { const m = r.mouth; x.strokeStyle = COLORS.mouth; x.lineWidth = 2.5; x.strokeRect(m.x * W, m.y * H, m.w * W, m.h * H); label('mouth', (m.x + m.w) * W, m.y * H, '#b08f00'); }
    r.eyes.forEach((e) => { x.strokeStyle = '#fff'; x.lineWidth = 4; x.beginPath(); x.arc(e.x * W, e.y * H, Math.max(3, e.r * W), 0, Math.PI * 2); x.stroke(); x.strokeStyle = COLORS.eyes; x.lineWidth = 2; x.stroke(); });
    x.restore();
  }

  // the white sticker border that hugged the drawn shadow: peel it off (but not the character's own border)
  function peelRing(q3, iw, ih, box) {
    const [bx0, by0, bx1, by1] = box, X0 = Math.max(1, bx0 - 6), Y0 = Math.max(1, by0 - 4), X1 = Math.min(iw - 2, bx1 + 6), Y1 = Math.min(ih - 2, by1 + 6);
    const L = (i) => 0.299 * q3[i] + 0.587 * q3[i + 1] + 0.114 * q3[i + 2];
    for (let pass = 0; pass < 6; pass++) {
      const kill = [];
      for (let Y = Y0; Y <= Y1; Y++) for (let X = X0; X <= X1; X++) {
        const k = Y * iw + X, i = k * 4; if (q3[i + 3] < 20) continue;
        const mx = Math.max(q3[i], q3[i + 1], q3[i + 2]), mn = Math.min(q3[i], q3[i + 1], q3[i + 2]);
        if (L(i) < 200 || (mx - mn) / (mx || 1) > 0.2) continue;
        if (!(q3[(k - 1) * 4 + 3] < 20 || q3[(k + 1) * 4 + 3] < 20 || q3[(k - iw) * 4 + 3] < 20 || q3[(k + iw) * 4 + 3] < 20)) continue;
        let dark = false;
        for (let dy = -4; dy <= 4 && !dark; dy++) for (let dx = -4; dx <= 4 && !dark; dx++) { const yy = Y + dy, xx = X + dx; if (xx < 0 || yy < 0 || xx >= iw || yy >= ih) continue; const j = (yy * iw + xx) * 4; if (q3[j + 3] > 150 && L(j) < 110) dark = true; }
        if (!dark) kill.push(i);
      }
      if (!kill.length) break;
      for (const i of kill) q3[i + 3] = 0;
    }
  }
  function shiftRig(rig, off, w, h) {
    const r = JSON.parse(JSON.stringify(rig)), dx = off.x / w, dy = off.y / h;
    r.head.cx += dx; r.head.cy += dy; r.head.nx += dx; r.head.ny += dy;
    r.eyes.forEach((e) => { e.x += dx; e.y += dy; });
    if (r.mouth) { r.mouth.x += dx; r.mouth.y += dy; }
    return r;
  }

  // ---------- the living puppet ----------
  function Buddy2D(canvas, src, rigIn, opts = {}) {
    const rig = cleanRig(rigIn);
    const iw = src.width, ih = src.height, alpha = pixels(src);
    const P = (fx, fy) => ({ x: fx * iw, y: fy * ih });
    // parts in pixels
    const B = { x: rig.body.x * iw, y: rig.body.y * ih, w: rig.body.w * iw, h: rig.body.h * ih };
    const bodyC = { x: B.x + B.w / 2, y: B.y + B.h / 2 };
    const head = { c: P(rig.head.cx, rig.head.cy), rx: rig.head.rx * iw, ry: rig.head.ry * ih, n: P(rig.head.nx, rig.head.ny) };
    const eyes = rig.eyes.map((e) => ({ x: e.x * iw, y: e.y * ih, r: Math.max(2.5, e.r * iw) }));
    const mouth = rig.mouth ? { x: (rig.mouth.x + rig.mouth.w / 2) * iw, y: (rig.mouth.y + rig.mouth.h / 2) * ih, w: Math.max(6, rig.mouth.w * iw), h: Math.max(3, rig.mouth.h * ih) } : null;
    const mkLimb = (l, kind, i) => { const j = P(l.jx, l.jy), t = P(l.tx, l.ty), len = Math.max(2, Math.hypot(t.x - j.x, t.y - j.y)); return { kind, i, j, t, len, u: { x: (t.x - j.x) / len, y: (t.y - j.y) / len }, w: Math.max(4, l.w * iw), right: (j.x + t.x) / 2 > bodyC.x }; };
    const legs = rig.legs.map((l, i) => mkLimb(l, 'leg', i)).sort((p, q) => p.j.x - q.j.x);
    const arms = rig.arms.map((l, i) => mkLimb(l, 'arm', i));
    const inBody = (q) => q.x > B.x && q.x < B.x + B.w && q.y > B.y && q.y < B.y + B.h;
    const mid = (a) => ({ x: (a.j.x + a.t.x) / 2, y: (a.j.y + a.t.y) / 2 });
    // limbs lying on the torso, or very broad ones (flippers, wings), only move gently: big moves would drag the body
    const solidAt = (x, y) => x >= 0 && y >= 0 && x < iw && y < ih && alpha[((y | 0) * iw + (x | 0)) * 4 + 3] > 60;
    arms.forEach((a) => {
      a.overBody = inBody(a.t) && inBody(mid(a)); a.broad = a.w > a.len * 0.42;
      // fused = the arm is drawn joined to the body along its length (flippers, arms held at the sides)
      const m = mid(a), toB = Math.sign(bodyC.x - m.x) || 1;
      a.fused = solidAt(m.x + toB * a.w * 0.9, m.y) && solidAt(m.x + toB * a.w * 0.9, a.j.y + (a.t.y - a.j.y) * 0.8);
    });
    legs.forEach((a) => { a.overBody = inBody(mid(a)); a.broad = a.w > a.len * 0.6; });
    const ears = rig.ears.map((l, i) => mkLimb(l, 'ear', i));
    const tail = rig.tail ? mkLimb(rig.tail, 'tail', 0) : null;
    // feet line = the lowest solid pixel
    let feetY = ih - 1;
    outer: for (let y = ih - 1; y > 0; y--) for (let x = 0; x < iw; x++) if (alpha[(y * iw + x) * 4 + 3] > 80) { feetY = y; break outer; }
    const quad = legs.length >= 3 || rig.kind === 'quadruped';
    // a ground shadow drawn under the feet (common in stickers) stays on the floor instead of moving with a leg
    const shadow = new Uint8Array(iw * ih);
    (() => {
      const lumA = (i) => 0.299 * alpha[i] + 0.587 * alpha[i + 1] + 0.114 * alpha[i + 2];
      const isSh = (k) => { const i = k * 4; if (alpha[i + 3] < 25) return false; const mx = Math.max(alpha[i], alpha[i + 1], alpha[i + 2]), mn = Math.min(alpha[i], alpha[i + 1], alpha[i + 2]); const L = lumA(i); return (alpha[i + 3] < 200 || (L > 110 && L < 242)) && (mx - mn) / (mx || 1) < 0.28; };
      const yTop = Math.floor(feetY - ih * 0.2), seen = new Uint8Array(iw * ih);
      let best = null;
      for (let y = Math.max(0, yTop); y <= feetY; y++) for (let x = 0; x < iw; x++) {
        const k = y * iw + x; if (seen[k] || !isSh(k)) continue;
        const st2 = [k], comp = []; seen[k] = 1; let x0 = x, x1 = x, y0 = y, y1 = y;
        while (st2.length) { const q = st2.pop(); comp.push(q); const qx = q % iw, qy = (q / iw) | 0; if (qx < x0) x0 = qx; if (qx > x1) x1 = qx; if (qy < y0) y0 = qy; if (qy > y1) y1 = qy;
          for (const nb of [q - 1, q + 1, q - iw, q + iw]) { const ny = (nb / iw) | 0; if (nb < 0 || nb >= iw * ih || ny < yTop || seen[nb]) continue; seen[nb] = 1; if (isSh(nb)) st2.push(nb); } }
        if (!best || comp.length > best.comp.length) best = { comp, x0, x1, y0, y1 };
      }
      if (best && best.x1 - best.x0 > iw * 0.25 && best.y1 - best.y0 < ih * 0.14 && best.y1 >= feetY - ih * 0.03 && (best.x1 - best.x0) > (best.y1 - best.y0) * 2.5) for (const k of best.comp) shadow[k] = 1;
    })();
    // take the drawn shadow out of the picture; she gets a soft shadow of her own that stays on the floor
    const clean = document.createElement('canvas'); clean.width = iw; clean.height = ih;
    let shadowInfo = null;
    {
      const cx2 = clean.getContext('2d'); cx2.drawImage(src, 0, 0);
      let n = 0, sx2 = 0, x0 = iw, x1 = 0, y0 = ih, y1 = 0, aSum = 0;
      for (let k2 = 0; k2 < iw * ih; k2++) if (shadow[k2]) { const X = k2 % iw, Y = (k2 / iw) | 0; n++; sx2 += X; aSum += alpha[k2 * 4 + 3]; if (X < x0) x0 = X; if (X > x1) x1 = X; if (Y < y0) y0 = Y; if (Y > y1) y1 = Y; }
      if (n) {
        const d2 = cx2.getImageData(0, 0, iw, ih), pp = d2.data;
        for (let k2 = 0; k2 < iw * ih; k2++) if (shadow[k2]) { pp[k2 * 4 + 3] = 0; for (const nb of [k2 - 1, k2 + 1, k2 - iw, k2 + iw]) if (nb >= 0 && nb < iw * ih && !shadow[nb] && pp[nb * 4 + 3] < 140) pp[nb * 4 + 3] = 0; }
        // leftover specks of the shadow's edge: anything near it that isn't joined to the character goes too
        const lab = new Int32Array(iw * ih).fill(-1); let bestId = -1, bestN = 0, id = 0;
        for (let k2 = 0; k2 < iw * ih; k2++) {
          if (lab[k2] >= 0 || pp[k2 * 4 + 3] < 30) continue;
          const stk = [k2]; lab[k2] = id; let cnt = 0;
          while (stk.length) { const q = stk.pop(); cnt++; const qx = q % iw; for (const nb of [q - 1, q + 1, q - iw, q + iw]) { if (nb < 0 || nb >= iw * ih || lab[nb] >= 0 || pp[nb * 4 + 3] < 30) continue; if ((nb === q - 1 && qx === 0) || (nb === q + 1 && qx === iw - 1)) continue; lab[nb] = id; stk.push(nb); } }
          if (cnt > bestN) { bestN = cnt; bestId = id; } id++;
        }
        for (let Y = Math.max(0, y0 - 4); Y <= Math.min(ih - 1, y1 + 4); Y++) for (let X = Math.max(0, x0 - 4); X <= Math.min(iw - 1, x1 + 4); X++) { const k2 = Y * iw + X; if (lab[k2] !== bestId) pp[k2 * 4 + 3] = 0; }
        peelRing(pp, iw, ih, [x0, y0, x1, y1]);
        cx2.putImageData(d2, 0, 0);
        shadowInfo = { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, rx: (x1 - x0) / 2, ry: Math.max(3, (y1 - y0) / 2), a: Math.min(0.35, (aSum / n / 255) * 0.3 + 0.12), box: [x0, y0, x1, y1] };
      }
    }
    if (!shadowInfo) { let x0 = iw, x1 = 0; for (const l of legs.length ? legs : [{ t: { x: B.x }, j: { x: B.x } }, { t: { x: B.x + B.w }, j: { x: B.x + B.w } }]) { x0 = Math.min(x0, l.t.x); x1 = Math.max(x1, l.t.x); } shadowInfo = { cx: (x0 + x1) / 2 || iw / 2, cy: feetY, rx: Math.max(B.w * 0.42, (x1 - x0) / 2 + B.w * 0.12), ry: Math.max(4, B.w * 0.07), a: 0.2 }; }
    // the same shadow clean-up for every frame of an animated picture
    function stripShadow(f) {
      if (!shadowInfo || !shadowInfo.box) return f;
      const o = document.createElement('canvas'); o.width = iw; o.height = ih; const ox2 = o.getContext('2d', { willReadFrequently: true }); ox2.drawImage(f, 0, 0);
      const d3 = ox2.getImageData(0, 0, iw, ih), q3 = d3.data, [bx0, by0, bx1, by1] = shadowInfo.box;
      const X0 = Math.max(0, bx0 - 4), Y0 = Math.max(0, by0 - 4), X1 = Math.min(iw - 1, bx1 + 4), Y1 = Math.min(ih - 1, by1 + 4);
      for (let Y = Y0; Y <= Y1; Y++) for (let X = X0; X <= X1; X++) { const i = (Y * iw + X) * 4; if (q3[i + 3] < 25) continue; const mx = Math.max(q3[i], q3[i + 1], q3[i + 2]), mn = Math.min(q3[i], q3[i + 1], q3[i + 2]), L = 0.299 * q3[i] + 0.587 * q3[i + 1] + 0.114 * q3[i + 2]; if ((q3[i + 3] < 200 || (L > 110 && L < 242)) && (mx - mn) / (mx || 1) < 0.28) q3[i + 3] = 0; }
      // keep only what's joined to the character
      const lab = new Int32Array(iw * ih).fill(-1); let bestId = -1, bestN = 0, id = 0;
      for (let k2 = 0; k2 < iw * ih; k2++) {
        if (lab[k2] >= 0 || q3[k2 * 4 + 3] < 30) continue;
        const stk = [k2]; lab[k2] = id; let cnt = 0;
        while (stk.length) { const q = stk.pop(); cnt++; const qx = q % iw; for (const nb of [q - 1, q + 1, q - iw, q + iw]) { if (nb < 0 || nb >= iw * ih || lab[nb] >= 0 || q3[nb * 4 + 3] < 30) continue; if ((nb === q - 1 && qx === 0) || (nb === q + 1 && qx === iw - 1)) continue; lab[nb] = id; stk.push(nb); } }
        if (cnt > bestN) { bestN = cnt; bestId = id; } id++;
      }
      for (let Y = Y0; Y <= Y1; Y++) for (let X = X0; X <= X1; X++) { const k2 = Y * iw + X; if (lab[k2] !== bestId) q3[k2 * 4 + 3] = 0; }
      peelRing(q3, iw, ih, shadowInfo.box);
      ox2.putImageData(d3, 0, 0);
      return o;
    }
    // feet line = above the drawn shadow
    if (shadow.some((v) => v)) { outer2: for (let y = ih - 1; y > 0; y--) for (let x = 0; x < iw; x++) if (alpha[(y * iw + x) * 4 + 3] > 80 && !shadow[y * iw + x]) { feetY = y; break outer2; } }
    const facing = rig.facing === 'left' ? -1 : rig.facing === 'right' ? 1 : 0;

    // parts that bend the mesh, in drawing order (back to front)
    const parts = [];
    if (tail) parts.push(tail);
    ears.forEach((e) => parts.push(e));
    legs.forEach((l) => parts.push(l));
    parts.push({ kind: 'head' });
    arms.forEach((a) => parts.push(a));
    const LAYER = { tail: 0, ear: 1, leg: 2, body: 3, head: 4, arm: 5 };
    const headIdx = parts.findIndex((q) => q.kind === 'head');

    function limbW(p, x, y) {
      const dx = x - p.j.x, dy = y - p.j.y, t = (dx * p.u.x + dy * p.u.y) / p.len, perp = Math.abs(dx * p.u.y - dy * p.u.x);
      // arms joined to the body bend softly from the shoulder (rubber-hose style) instead of tearing off
      const soft = (p.kind === 'arm' && (p.fused || p.overBody || p.broad)) || (p.kind === 'ear' && p.w > p.len * 0.55);
      const along = soft ? smooth(-0.25, 0.55, t) * (1 - smooth(1.3, 1.7, t)) : smooth(-0.04, 0.28, t) * (1 - smooth(1.25, 1.5, t));
      const half = p.w * 0.5, feather = soft ? Math.max(5, p.w * 0.6) : Math.max(2.5, p.w * 0.18);
      return along * (1 - smooth(half, half + feather, perp));
    }
    function headW(x, y) {
      const e = Math.hypot((x - head.c.x) / head.rx, (y - head.c.y) / head.ry);
      const vx = head.c.x - head.n.x, vy = head.c.y - head.n.y, l2 = vx * vx + vy * vy || 1;
      const t = ((x - head.n.x) * vx + (y - head.n.y) * vy) / l2;
      return (1 - smooth(0.95, 1.45, e)) * smooth(-0.55, 0.3, t); // a wide, soft neck: the head turns without a seam
    }

    // ---- mesh ----
    const step = Math.max(3, Math.max(iw, ih) / 120);
    const nx = Math.ceil(iw / step) + 1, ny = Math.ceil(ih / step) + 1, nv = nx * ny;
    const ox = new Float32Array(nv), oy = new Float32Array(nv);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const k = j * nx + i; ox[k] = Math.min(iw, i * step); oy[k] = Math.min(ih, j * step); }
    // per-vertex weights (normalised so overlapping parts share smoothly)
    const NP = parts.length, W = new Float32Array(nv * NP);
    for (let k = 0; k < nv; k++) {
      let sum = 0;
      for (let p = 0; p < NP; p++) { const pt = parts[p], v = pt.kind === 'head' ? headW(ox[k], oy[k]) : limbW(pt, ox[k], oy[k]); W[k * NP + p] = v; sum += v; }
      if (sum > 1) for (let p = 0; p < NP; p++) W[k * NP + p] /= sum;

    }
    // which layer each little square belongs to (decides what draws in front while moving)
    const solid = (x, y) => alpha[(Math.min(ih - 1, y | 0) * iw + Math.min(iw - 1, x | 0)) * 4 + 3] > 8;
    const layers = [[], [], [], [], [], []];
    for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
      const x0 = ox[a], y0 = oy[a], x1 = ox[d], y1 = oy[d];
      let any = false;
      for (let sy = 0; sy <= 2 && !any; sy++) for (let sx = 0; sx <= 2 && !any; sx++) any = solid(x0 + (x1 - x0) * sx / 2, y0 + (y1 - y0) * sy / 2);
      if (!any) continue;
      const cxm = (x0 + x1) / 2, cym = (y0 + y1) / 2;
      let best = -1, bw = 0.5;
      for (let p = 0; p < NP; p++) { const pt = parts[p], v = pt.kind === 'head' ? headW(cxm, cym) : limbW(pt, cxm, cym); if (v > bw) { bw = v; best = p; } }
      layers[best < 0 ? LAYER.body : LAYER[parts[best].kind]].push(a, c, b, b, c, d);
    }

    // ---- three.js ----
    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, premultipliedAlpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x000000, 0);
    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(0, 1, 0, -1, -10, 10);
    const mkTex = (c) => { const t = new THREE.CanvasTexture(c); t.premultiplyAlpha = true; t.generateMipmaps = false; t.minFilter = THREE.LinearFilter; t.magFilter = THREE.LinearFilter; return t; };
    const tex = mkTex(clean);
    // front-facing characters also get a back view (for climbing away from you, or turning around)
    const canTurn = false; // no back view: she just walks and turns around
    let backTex = null;
    const getBack = () => backTex || (backTex = mkTex(opts.back || makeBackView(src, rig)));
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, premultipliedAlpha: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide });
    const pos = new Float32Array(nv * 3), uv = new Float32Array(nv * 2);
    for (let k = 0; k < nv; k++) { uv[k * 2] = ox[k] / iw; uv[k * 2 + 1] = 1 - oy[k] / ih; }
    const posAttr = new THREE.BufferAttribute(pos, 3); posAttr.setUsage(THREE.DynamicDrawUsage);
    const shCv = document.createElement('canvas'); shCv.width = 128; shCv.height = 64;
    { const g = shCv.getContext('2d'), gr = g.createRadialGradient(64, 32, 0, 64, 32, 64); gr.addColorStop(0, 'rgba(0,0,0,1)'); gr.addColorStop(0.55, 'rgba(0,0,0,0.6)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.setTransform(1, 0, 0, 0.5, 0, 16); g.fillStyle = gr; g.fillRect(0, 0, 128, 128); }
    const shMat = new THREE.MeshBasicMaterial({ map: mkTex(shCv), transparent: true, opacity: shadowInfo.a, depthTest: false, depthWrite: false });
    const shMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), shMat); shMesh.renderOrder = -1; shMesh.frustumCulled = false; scene.add(shMesh);
    const meshes = layers.map((idx, li) => {
      if (!idx.length) return null;
      const g = new THREE.BufferGeometry(); g.setAttribute('position', posAttr); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      g.setIndex(nv > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
      const m = new THREE.Mesh(g, mat); m.renderOrder = li; m.frustumCulled = false; scene.add(m); return { m, idx: new Uint32Array(idx) };
    }).filter(Boolean);

    // ---- life: little behaviours that make it feel alive ----
    let look = { x: 0, y: 0 }, lookTo = { x: 0, y: 0 }, lookT = 1, tiltTo = 0, tilt = 0, tiltT = 2, earT = 3, earKick = 0, mouthOpen = 0, flip = 1, flipCur = 1, flipBase = 1, faceKeyInit = 0, view = 'front', turnT = 0, turnTo = null;
    // her own animation frames (gif): played in a loop, with her own blink; expressions are drawn per frame
    const frames = opts.frames && opts.frames.length > 1 ? opts.frames : null;
    const delays = frames ? (opts.delays || []).map((d) => Math.max(20, d || 80)) : [];
    const study = frames ? studyFrames(frames, rig) : null;
    const cleanFrames = frames ? frames.map((f, i) => (i === 0 ? clean : stripShadow(f))) : null;
    const frameTex = frames ? cleanFrames.map((f, i) => (i === 0 ? null : mkTex(f))) : null;
    let fi = 0, fT = 0;
    const kits = {};
    const kitFor = (i) => kits[i] || (kits[i] = faceKit(i === 0 ? clean : cleanFrames[i], study ? shiftRig(rig, study.offsets[i], frames[0].width, frames[0].height) : rig, { closedPatches: study && study.closedPatches }));
    let quirk = null, quirkT = 0, quirkIn = 4 + Math.random() * 4, faceKey = '0|open|normal', eyesNow = 'open', size0 = 150;
    const QUIRK = { hop2: 1.0, dance: 2.4, wink: 1.2, look: 2.0, stretch: 1.6, spin: 0.9, giggle: 1.3, wave: 1.8 };
    const faceTex = {};
    function setFace(e, mo) {
      const kit = kitFor(frames ? fi : 0);
      if (!kit.hasEyes) e = 'open'; if (!kit.hasMouth) mo = 'normal';
      eyesNow = e;
      const fr = frames ? fi : 0, key = fr + '|' + e + '|' + mo; if (key === faceKey) return; faceKey = key;
      const plain = e === 'open' && mo === 'normal';
      mat.map = plain ? (fr === 0 ? tex : frameTex[fr]) : (faceTex[key] || (faceTex[key] = mkTex(kitFor(fr).get(e, mo))));
      mat.needsUpdate = true;
    }
    const scr = new Float32Array(nv * 2);
    let lastSize = { w: 0, h: 0 }, headTop = null;

    // st: { t, dt, mode, modeT, walkGo, gaitPh, where, heading, walkDir, held, eyeOpen, scale, size, ax, ay, talking, thinking }
    function frame(st) {
      const t = st.t, dt = st.dt || 0.016, m = st.mode, wg = st.walkGo || 0;
      // where to look / tilt, picked every few seconds
      lookT -= dt; if (lookT < 0) { lookT = 1.2 + Math.random() * 2.8; lookTo = Math.random() < 0.35 ? { x: 0, y: 0 } : { x: (Math.random() * 2 - 1), y: (Math.random() * 1.4 - 0.7) }; }
      if (st.thinking) lookTo = { x: 0.6 * Math.sign(Math.sin(t * 0.4)) || 0.6, y: -0.8 };
      if (m === 'walk' && wg > 0.3) lookTo = { x: 0.7 * (facing || 0), y: 0.1 };
      look.x += (lookTo.x - look.x) * Math.min(1, dt * 9); look.y += (lookTo.y - look.y) * Math.min(1, dt * 9);
      tiltT -= dt; if (tiltT < 0) { tiltT = 2 + Math.random() * 4; tiltTo = Math.random() < 0.5 ? 0 : (Math.random() * 2 - 1) * 0.12; }
      tilt += (tiltTo - tilt) * Math.min(1, dt * 3);
      earT -= dt; if (earT < 0) { earT = 2 + Math.random() * 5; earKick = 1; } earKick = Math.max(0, earKick - dt * 4);
      // little quirks while she's idle: hops, a dance, a wink, a stretch, a spin, a giggle, a look around
      const idle = m === 'idle' && !st.talking && !st.thinking && !st.held;
      if (st.quirk && st.quirk !== quirk) { quirk = st.quirk; quirkT = 0; }
      if (quirk) { quirkT += dt; if (quirkT > QUIRK[quirk]) { quirk = null; quirkT = 0; quirkIn = (st.quirkEvery || 1) * (5 + Math.random() * 7); } }
      else if (idle) { quirkIn -= dt; if (quirkIn <= 0) { const pool = Object.keys(QUIRK).filter((q) => q !== 'wave' || arms.length); quirk = pool[Math.floor(Math.random() * pool.length)]; quirkT = 0; } }
      if (!idle && !st.quirk) quirk = null;
      const q = quirk, qT = quirkT;
      if (frames && m !== 'nap') { fT += dt * 1000; while (fT >= delays[fi]) { fT -= delays[fi]; fi = (fi + 1) % frames.length; } }
      // face: which eyes and mouth to show this frame (a gif with its own blink keeps it)
      let eyesS = (st.eyeOpen != null && st.eyeOpen < 0.5 && !(study && study.blinkFrame >= 0)) ? 'closed' : 'open', mouthS = 'normal';
      if (m === 'nap') eyesS = 'closed';
      if (m === 'happy' || m === 'wave') { eyesS = eyesS === 'closed' ? 'closed' : 'happy'; mouthS = 'smile'; }
      if (st.talking) { const v = Math.abs(Math.sin(t * 13) * Math.sin(t * 7.3 + 1)); mouthS = v > 0.6 ? 'wide' : v > 0.22 ? 'open' : 'normal'; }
      if (q === 'hop2' || q === 'dance' || q === 'spin') { eyesS = 'happy'; mouthS = 'smile'; }
      if (q === 'wink' && qT > 0.2 && qT < 1.0) { eyesS = 'wink'; mouthS = 'smile'; }
      if (q === 'giggle') { eyesS = 'happy'; mouthS = Math.sin(qT * 22) > 0 ? 'wide' : 'smile'; }
      if (q === 'stretch' && qT > 0.25 && qT < 1.3) { eyesS = 'closed'; mouthS = 'o'; }
      if (q === 'wave') { eyesS = eyesS === 'closed' ? 'closed' : 'happy'; mouthS = 'smile'; }
      setFace(eyesS, mouthS);
      const shut = 0, mouthOpen0 = 0;

      // angles for each part
      let headRot = tilt + Math.sin(t * 0.7) * 0.03, bodyTilt = 0, sy = 1 + Math.sin(t * 2.2) * 0.014, lift = 0;
      if (m === 'walk') headRot = tilt * (1 - wg) + Math.sin(st.gaitPh * 2) * 0.025 * wg;
      if (m === 'nap') { headRot = 0.18 * (facing || 1); sy = 1 + Math.sin(t * 1.3) * 0.03; }
      if (m === 'happy') { headRot = -0.12 * (facing || 1) + Math.sin(st.modeT * 12) * 0.05; }
      if (st.talking) headRot += Math.sin(t * 6.5) * 0.03;
      if (st.held) { headRot = Math.sin(t * 5) * 0.08; sy = 1.06; }
      let qHop = 0, qTilt = 0, qArms = 0;
      if (q === 'hop2') { const ph = (qT % 0.5) / 0.5; qHop = Math.sin(ph * Math.PI) * 0.16; sy *= ph < 0.12 || ph > 0.88 ? 0.9 : 1 + qHop * 0.4; qArms = 0.5; }
      if (q === 'dance') { qTilt = Math.sin(qT * 8) * 0.13; qHop = Math.abs(Math.sin(qT * 8)) * 0.04; headRot = -Math.sin(qT * 8) * 0.1; qArms = 0.4 + 0.4 * Math.sin(qT * 8); }
      if (q === 'wink') headRot = 0.13 * Math.sin(Math.min(1, qT * 3) * Math.PI * 0.5) * (facing || 1);
      if (q === 'look') { lookTo = { x: qT < 1 ? -1 : 1, y: -0.2 }; headRot = (qT < 1 ? -0.08 : 0.08) * Math.min(1, qT * 4) * Math.min(1, (QUIRK.look - qT) * 4); }
      if (q === 'stretch') { const k2 = smooth(0.1, 0.4, qT) * (1 - smooth(1.0, 1.25, qT)); sy *= 1 + k2 * 0.13; qArms = k2 * 1.3; if (qT > 1.25 && qT < 1.5) sy *= 0.9; }
      if (q === 'giggle') { qTilt = Math.sin(qT * 38) * 0.035; qHop = Math.abs(Math.sin(qT * 19)) * 0.02; }
      if (q === 'spin') { if (qT < 0.45) flip = -flipBase; else flip = flipBase; }
      if (q !== 'spin') flipBase = flip;
      // hop for happy, with squash and stretch
      let hop = 0;
      if (m === 'happy') { const ph = (st.modeT % 0.6) / 0.6; hop = Math.sin(ph * Math.PI) * 0.2; sy *= ph < 0.1 || ph > 0.9 ? 0.92 : 1 + hop * 0.25; }
      if (m === 'walk') hop = Math.abs(Math.cos(st.gaitPh)) * 0.03 * wg;
      if (m === 'wave' && !arms.length) hop = Math.abs(Math.sin(st.modeT * 7)) * 0.05;
      if (st.held) hop = 0.12 + Math.sin(t * 6) * 0.015;
      hop += qHop;
      // which way: side-view characters turn to face where they walk
      const want = st.where === 'wall' ? (Math.sin(st.heading) >= 0 ? 1 : -1) : (st.walkDir || 1);
      if (m === 'walk' && wg > 0.2) flip = want * (facing || 1); // front-facing pictures mirror when walking the other way
      // turning is a quick squash through the middle, like a 2D character spinning round
      flipCur += (flip - flipCur) * Math.min(1, dt * 11);
      const wantView = (canTurn && st.where === 'wall' && !st.held && Math.cos(st.heading) < -0.35 ? 'back' : 'front');
      if (wantView !== view && !turnTo) { turnTo = wantView; turnT = 0; }
      let turnSq = 1;
      if (turnTo) {
        turnT += dt / 0.28;
        if (turnT >= 0.5 && view !== turnTo) { view = turnTo; mat.map = view === 'back' ? getBack() : tex; mat.needsUpdate = true; }
        if (turnT >= 1) { turnTo = null; turnT = 0; } else turnSq = Math.abs(Math.cos(turnT * Math.PI));
      }
      const faceOn = view === 'front';
      if (facing === 0 && m === 'walk') bodyTilt = Math.sin(st.gaitPh) * 0.09 * wg; // front-facing: a bouncy waddle
      bodyTilt += qTilt;


      let waveSway = 0, waveHop = 0;
      const ang = new Float32Array(NP), dx = new Float32Array(NP), dy = new Float32Array(NP);
      for (let p = 0; p < NP; p++) {
        const pt = parts[p];
        if (pt.kind === 'head') { ang[p] = headRot; continue; }
        if (pt.kind === 'leg') {
          const ph = st.gaitPh + (pt.i % 2 ? Math.PI : 0) + (quad && pt.i >= 2 ? Math.PI * 0.5 : 0); // quadrupeds: a 4-beat walk
          const amp = (quad ? 0.32 : 0.4) * (pt.overBody ? 0.35 : 1) * (pt.broad ? 0.5 : 1);
          if (facing === 0) {
            // front view: march! each foot lifts in turn and kicks out a little
            const up = Math.max(0, Math.sin(st.gaitPh + (pt.i % 2 ? Math.PI : 0)));
            ang[p] = (pt.right ? -1 : 1) * up * 0.25 * wg; dx[p] = 0; dy[p] = -up * Math.max(pt.len * 0.45, size0 * 0.06) * wg;
          } else {
            ang[p] = Math.sin(ph) * amp * wg;
            lift = Math.max(0, Math.cos(ph)) * wg * (pt.overBody ? 0.4 : 1); dx[p] = -pt.u.x * lift * pt.len * 0.12; dy[p] = -pt.u.y * lift * pt.len * 0.12;
          }
          if (st.held) { ang[p] = Math.sin(t * 9 + pt.i * 1.9) * 0.3; dx[p] = dy[p] = 0; }
          if (m === 'nap') ang[p] = 0;
        } else if (pt.kind === 'arm') {
          const free = (pt.overBody ? 0.45 : 1) * (pt.broad ? 0.45 : 1) * (facing === 0 && m === 'walk' ? 0.5 : 1); // arms lying on the body move gently
          ang[p] = (-Math.sin(st.gaitPh + (pt.i % 2 ? Math.PI : 0)) * 0.3 * wg + Math.sin(t * 1.4 + pt.i) * 0.04) * free;
          if (st.talking) ang[p] += Math.sin(t * 4 + pt.i * 2) * 0.1 * free;
          const outw = (pt.t.x - pt.j.x) >= 0 ? -1 : 1; // rotating this way lifts the hand outward
          if (st.held) ang[p] = outw * (0.45 + Math.sin(t * 8 + pt.i) * 0.2) * free * (pt.fused || pt.overBody || pt.broad ? 0.4 : 1);
          if (m === 'happy') ang[p] = outw * 0.6 * Math.abs(Math.sin(st.modeT * 9)) * free * (pt.fused || pt.overBody || pt.broad ? 0.35 : 1);
          if (qArms) ang[p] = outw * qArms * Math.min(1, free * 1.6) * (pt.fused || pt.overBody || pt.broad ? 0.2 : 1);
          if (q === 'wave' && pt === parts.filter((x) => x.kind === 'arm').slice(-1)[0]) { const k3 = Math.min(1, qT * 4) * Math.min(1, Math.max(0, (QUIRK.wave - qT) * 4)); const joined = pt.fused || pt.overBody || pt.broad; ang[p] = outw * (joined ? 0.2 : 1.4) * k3 + Math.sin(qT * 13) * (joined ? 0.12 : 0.3) * k3; if (joined) { waveSway = Math.sin(qT * 9) * 0.1 * k3; waveHop = Math.abs(Math.sin(qT * 9)) * 0.04 * k3; } }
        } else if (pt.kind === 'tail') {
          const sp = m === 'happy' ? 14 : m === 'walk' ? 5 : st.talking ? 4 : 2.2, amp = m === 'happy' ? 0.45 : m === 'nap' ? 0.05 : 0.2;
          ang[p] = Math.sin(t * sp) * amp;
        } else if (pt.kind === 'ear') {
          // round little ears (bears, pandas) only twitch a tiny bit; long ears flop more
          ang[p] = (earKick * Math.sin(earKick * 20) * 0.25 * (pt.i % 2 ? -1 : 1) + (m === 'happy' ? Math.sin(t * 16 + pt.i) * 0.15 : 0) + (m === 'nap' ? 0.2 * (pt.right ? 1 : -1) : 0)) * (pt.w > pt.len * 0.55 ? 0.3 : 1);
        }
      }
      // wave: lift the hand (or front paw) up and out, then wave it
      if (m === 'wave') {
        const k = Math.min(1, st.modeT * 4) * Math.min(1, Math.max(0, (1.8 - st.modeT) * 4));
        let wp = -1;
        for (let p = 0; p < NP; p++) if (parts[p].kind === 'arm') wp = p; // last arm
        if (facing !== 0 && arms.length > 1) { let best = -1e9; for (let p = 0; p < NP; p++) if (parts[p].kind === 'arm') { const s = parts[p].t.x * facing; if (s > best) { best = s; wp = p; } } }
        if (wp >= 0) {
          const pt = parts[wp], out = facing !== 0 ? facing : pt.right ? 1 : -1;
          const target = Math.atan2(-0.95, out * 0.55), cur = Math.atan2(pt.u.y, pt.u.x);
          let d = target - cur; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2;
          if (pt.kind === 'leg') {
            // "give paw": lift the paw up and forward, with a little shake
            const fw = facing || (pt.right ? 1 : -1);
            ang[wp] = (-0.35 * fw + Math.sin(st.modeT * 13) * 0.12) * k;
            dx[wp] = fw * pt.len * 0.28 * k; dy[wp] = -pt.len * 0.38 * k;
          } else {
            const maxA = pt.broad || pt.overBody || pt.fused ? 0.2 : 2.3;
            d = clamp(d, -maxA, maxA);
            ang[wp] = (d + Math.sin(st.modeT * 13) * (pt.broad || pt.fused || pt.overBody ? 0.12 : 0.3)) * k; dx[wp] = dy[wp] = 0;
            if (pt.fused || pt.overBody || pt.broad) { waveSway = Math.sin(st.modeT * 9) * 0.1 * k; waveHop = Math.abs(Math.sin(st.modeT * 9)) * 0.04 * k; }
          }
        } else {
          // no arms (most animals): a happy hello with the head, a bounce and a wag
          for (let p = 0; p < NP; p++) {
            if (parts[p].kind === 'head') ang[p] = Math.sin(st.modeT * 7) * 0.13 * k;
            if (parts[p].kind === 'tail') ang[p] = Math.sin(t * 14) * 0.4;
            if (parts[p].kind === 'ear') ang[p] = Math.sin(t * 15 + parts[p].i) * 0.15;
          }
        }
      }

      // pass 1: face (blink, glance, mouth) in picture space; pass 2: bend at joints; pass 3: body + place on screen
      bodyTilt += waveSway; hop += waveHop;
      const size = (st.size || 150) * (st.scale || 1); size0 = size;
      const k = Math.min(size / Math.max(1, feetY - Math.min(head.c.y - head.ry, B.y)), (size * 1.7) / iw);
      const ax = st.ax, ay = st.ay - hop * size;
      const fx = iw / 2, fy = feetY;
      const cosB = Math.cos(bodyTilt), sinB = Math.sin(bodyTilt), sx = 1 / Math.sqrt(sy);
      const cosA = new Float32Array(NP), sinA = new Float32Array(NP);
      for (let p = 0; p < NP; p++) { cosA[p] = Math.cos(ang[p]); sinA[p] = Math.sin(ang[p]); }
      const look2 = look;
      const deform = (x0, y0, out, base) => {
        let x = x0, y = y0;
        for (let e = 0; faceOn && eyesNow === 'open' && e < eyes.length; e++) {
          const E = eyes[e], d = Math.hypot(x0 - E.x, y0 - E.y);
          if (d > E.r * 1.9) continue;
          const g = 1 - smooth(E.r * 0.45, E.r * 1.05, d);
          x += look2.x * E.r * 0.3 * g; y += look2.y * E.r * 0.22 * g;

        }
        if (false) {
          const hx = Math.abs(x0 - mouth.x), ddy = y0 - mouth.y;
          if (hx < mouth.w * 0.85 && ddy > -mouth.h) {
            const fxm = 1 - smooth(mouth.w * 0.4, mouth.w * 0.85, hx);
            const fym = smooth(-mouth.h * 0.35, mouth.h * 0.35, ddy) * (1 - smooth(mouth.h * 1.2 + 8, mouth.h * 3 + 18, ddy));
            y += mouthOpen * Math.max(mouth.h * 1.3, 5) * fxm * fym;
          }
        }
        // bend at joints: blend of each part's rotation around its joint
        let bx = 0, by = 0, wsum = 0;
        for (let p = 0; p < NP; p++) {
          const wt = W[base + p]; if (wt < 0.001) continue;
          const pt = parts[p], jx = pt.kind === 'head' ? head.n.x : pt.j.x, jy = pt.kind === 'head' ? head.n.y : pt.j.y;
          let c = cosA[p], s = sinA[p];
          if (pt.kind === 'tail' || pt.kind === 'ear') { const tt = clamp(((x0 - jx) * pt.u.x + (y0 - jy) * pt.u.y) / pt.len, 0, 1.3); c = Math.cos(ang[p] * tt * 1.4); s = Math.sin(ang[p] * tt * 1.4); }
          if (pt.kind === 'ear' && headIdx >= 0) {
            // ears ride along with the head first, then twitch: no gap where they join
            const hc = cosA[headIdx], hs = sinA[headIdx], nx = head.n.x, ny = head.n.y;
            const ex = nx + (x - nx) * hc - (y - ny) * hs, ey = ny + (x - nx) * hs + (y - ny) * hc;
            const jx2 = nx + (jx - nx) * hc - (jy - ny) * hs, jy2 = ny + (jx - nx) * hs + (jy - ny) * hc;
            const rx2 = ex - jx2, ry2 = ey - jy2;
            bx += wt * (jx2 + rx2 * c - ry2 * s); by += wt * (jy2 + rx2 * s + ry2 * c); wsum += wt; continue;
          }
          const rx = x - jx, ry = y - jy;
          bx += wt * (jx + rx * c - ry * s + dx[p]); by += wt * (jy + rx * s + ry * c + dy[p]); wsum += wt;
        }
        x = bx + x * (1 - wsum); y = by + y * (1 - wsum);
        // body: breathe / squash around the feet, lean, flip, scale, place
        let px = (x - fx) * sx, py = (y - fy) * sy;
        const qx = px * cosB - py * sinB, qy = px * sinB + py * cosB;
        out[0] = ax + qx * k * flipCur * Math.max(0.04, turnSq); out[1] = ay + qy * k;
      };
      const o = [0, 0];
      for (let v = 0; v < nv; v++) { deform(ox[v], oy[v], o, v * NP); scr[v * 2] = o[0]; scr[v * 2 + 1] = o[1]; pos[v * 3] = o[0]; pos[v * 3 + 1] = -o[1]; }
      posAttr.needsUpdate = true;
      // her shadow: on the floor, smaller and lighter when she's in the air
      const air = Math.min(0.6, hop * 2.2);
      shMesh.position.set(ax + (shadowInfo.cx - fx) * k * flipCur, -(st.ay + (shadowInfo.cy - fy) * k), 0);
      shMesh.scale.set(shadowInfo.rx * 2.3 * k * (1 - air * 0.5), shadowInfo.ry * 2.6 * k * (1 - air * 0.5), 1);
      shMat.opacity = shadowInfo.a * (1 - air * 0.6);
      // head top, for the speech bubble
      const htx = head.c.x, hty = head.c.y - head.ry;
      const hbase = Math.min(nv - 1, Math.round(hty / step) * nx + Math.round(htx / step));
      deform(htx, hty, o, Math.max(0, hbase) * NP); headTop = { x: o[0], y: o[1] };
    }

    function draw(st) {
      const w = canvas.clientWidth || canvas.width, h = canvas.clientHeight || canvas.height;
      if (w !== lastSize.w || h !== lastSize.h) { renderer.setSize(w, h, false); camera.left = 0; camera.right = w; camera.top = 0; camera.bottom = -h; camera.updateProjectionMatrix(); lastSize = { w, h }; }
      if (st.ax == null) { st.ax = w / 2; st.ay = h * 0.8; }
      frame(st);
      renderer.render(scene, camera);
    }
    // tap test: find the little triangle under the pointer and check the picture is solid there
    function hit(cx, cy) {
      const r = canvas.getBoundingClientRect(), x = cx - r.left, y = cy - r.top;
      for (const { idx } of meshes) for (let i = 0; i < idx.length; i += 3) {
        const a = idx[i], b = idx[i + 1], c = idx[i + 2];
        const ax_ = scr[a * 2], ay_ = scr[a * 2 + 1], bx_ = scr[b * 2], by_ = scr[b * 2 + 1], cx_ = scr[c * 2], cy_ = scr[c * 2 + 1];
        if (x < Math.min(ax_, bx_, cx_) - 1 || x > Math.max(ax_, bx_, cx_) + 1 || y < Math.min(ay_, by_, cy_) - 1 || y > Math.max(ay_, by_, cy_) + 1) continue;
        const d = (by_ - cy_) * (ax_ - cx_) + (cx_ - bx_) * (ay_ - cy_); if (Math.abs(d) < 1e-6) continue;
        const l1 = ((by_ - cy_) * (x - cx_) + (cx_ - bx_) * (y - cy_)) / d, l2 = ((cy_ - ay_) * (x - cx_) + (ax_ - cx_) * (y - cy_)) / d, l3 = 1 - l1 - l2;
        if (l1 < -0.02 || l2 < -0.02 || l3 < -0.02) continue;
        const sx_ = l1 * ox[a] + l2 * ox[b] + l3 * ox[c], sy_ = l1 * oy[a] + l2 * oy[b] + l3 * oy[c];
        if (alpha[(clamp(sy_ | 0, 0, ih - 1) * iw + clamp(sx_ | 0, 0, iw - 1)) * 4 + 3] > 40) return true;
      }
      return false;
    }
    function dispose() { try { meshes.forEach(({ m }) => m.geometry.dispose()); mat.dispose(); tex.dispose(); if (backTex) backTex.dispose(); Object.values(faceTex).forEach((x) => x.dispose()); if (frameTex) frameTex.forEach((x) => x && x.dispose()); shMat.map.dispose(); shMat.dispose(); renderer.dispose(); renderer.forceContextLoss(); } catch (_) {} }
    function snapshot() { draw({ t: 0, dt: 0.016, mode: 'idle', modeT: 0, walkGo: 0, gaitPh: 0, where: 'floor', heading: 0, walkDir: 1, eyeOpen: 1, scale: 1 }); return canvas.toDataURL('image/png'); }
    return { kind: '2d', rig, draw, hit, headPoint: () => headTop, dispose, snapshot, canClimb: canTurn };
  }

  // ---------- 3D model (.glb / .vrm) ----------
  // plays the model's own walk/idle/wave clips when it has them; otherwise swings its bones, or waddles
  function Buddy3D(canvas, arrayBuffer, done) {
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    if (THREE.sRGBEncoding) renderer.outputEncoding = THREE.sRGBEncoding;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(30, 1, 0.05, 100);
    scene.add(new THREE.HemisphereLight(0xffffff, 0xbfae8c, 1.0));
    const sun = new THREE.DirectionalLight(0xffffff, 0.9); sun.position.set(-2, 5, 4); scene.add(sun);
    const holder = new THREE.Group(); scene.add(holder);
    let model = null, mixer = null, clips = {}, current = null, bones = {}, blink = [], api = null;
    const find = (re) => Object.values(clips).find((c) => re.test(c.name));
    new THREE.GLTFLoader().parse(arrayBuffer, '', (g) => {
      model = g.scene || g.scenes[0];
      const box = new THREE.Box3().setFromObject(model), size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
      const s = 1.6 / Math.max(size.y, size.x * 0.8, size.z * 0.8, 0.001);
      model.scale.setScalar(s); model.position.set(-c.x * s, -box.min.y * s, -c.z * s);
      holder.add(model);
      if (g.animations && g.animations.length) {
        mixer = new THREE.AnimationMixer(model);
        g.animations.forEach((a) => (clips[a.name] = a));
      }
      model.traverse((o) => {
        if (o.isBone || o.type === 'Bone') {
          const n = o.name.toLowerCase();
          const put = (k) => { (bones[k] = bones[k] || []).push({ o, r: o.rotation.clone(), left: /left|_l\b|\.l\b|l_/.test(n) }); };
          if (/head|neck/.test(n) && !bones.head) put('head');
          else if (/(up(per)?_?leg|thigh)/.test(n)) put('leg');
          else if (/(up(per)?_?arm|shoulder)/.test(n) && !/fore/.test(n)) put('arm');
          else if (/tail/.test(n)) put('tail');
        }
        if (o.morphTargetDictionary) for (const [name, idx] of Object.entries(o.morphTargetDictionary)) if (/blink|eye.?clos/i.test(name)) blink.push({ o, idx });
      });
      done && done({ clips: Object.keys(clips), bones: Object.fromEntries(Object.entries(bones).map(([k, v]) => [k, v.length])), blink: blink.length > 0 });
    }, (e) => done && done({ error: String(e && e.message || e) }));

    function play(name) {
      if (!mixer) return false;
      const c = name === 'walk' ? find(/walk|run|move|locomot/i) : name === 'idle' ? find(/idle|breath|stand|wait/i) : name === 'wave' ? find(/wave|greet|hello/i) : name === 'happy' ? find(/jump|dance|happy|cheer|victory/i) : name === 'nap' ? find(/sleep|sit|lie|rest/i) : null;
      const pick = c || (name === 'idle' ? Object.values(clips)[0] : null);
      if (!pick) return false;
      if (current && current._clip === pick) return true;
      const a = mixer.clipAction(pick); a.reset().fadeIn(0.25).play();
      if (current) current.fadeOut(0.25);
      current = a; return true;
    }
    let lastW = 0, lastH = 0, rotY = Math.PI / 2;
    function draw(st) {
      const w = canvas.clientWidth, h = canvas.clientHeight;
      if (w !== lastW || h !== lastH) { renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); lastW = w; lastH = h; }
      const sc = st.scale || 1;
      camera.position.set(0, 1.25, 6.2 / sc); camera.lookAt(0, 0.55 / sc + 0.25, 0);
      if (!model) { renderer.clear(); return; }
      const m = st.mode, wg = st.walkGo || 0;
      const dir = st.where === 'wall' ? (Math.sin(st.heading) >= 0 ? 1 : -1) : (st.walkDir || 1);
      const target = m === 'walk' ? dir * Math.PI / 2 : 0.25 * dir;
      rotY += (target - rotY) * Math.min(1, st.dt * 5);
      holder.rotation.set(0, rotY, 0);
      const usedClip = play(m === 'walk' ? (wg > 0.3 ? 'walk' : 'idle') : m) || play('idle');
      if (mixer) mixer.update(st.dt);
      let hop = 0;
      if (m === 'happy') hop = Math.abs(Math.sin((st.modeT * Math.PI) / 0.6)) * 0.35;
      if (st.held) hop = 0.4 + Math.sin(st.t * 6) * 0.04;
      holder.position.y = hop + (usedClip ? 0 : Math.abs(Math.cos(st.gaitPh)) * 0.04 * wg);
      if (!usedClip) {
        // no animation clips: swing bones if it has a skeleton, else a cute waddle
        const sw = Math.sin(st.gaitPh) * 0.5 * wg;
        (bones.leg || []).forEach((b) => (b.o.rotation.x = b.r.x + (b.left ? sw : -sw)));
        (bones.arm || []).forEach((b) => { b.o.rotation.x = b.r.x + (b.left ? -sw : sw) * 0.6; if (m === 'wave' && !b.left) b.o.rotation.z = b.r.z - 2.2 - Math.sin(st.modeT * 13) * 0.3; else b.o.rotation.z = b.r.z; });
        (bones.head || []).forEach((b) => (b.o.rotation.y = b.r.y + Math.sin(st.t * 0.7) * 0.15 * (1 - wg)));
        (bones.tail || []).forEach((b) => (b.o.rotation.y = b.r.y + Math.sin(st.t * 2) * 0.3));
        if (!bones.leg) holder.rotation.z = Math.sin(st.gaitPh) * 0.1 * wg + (m === 'wave' ? Math.sin(st.modeT * 10) * 0.12 : 0);
        if (m === 'nap') holder.rotation.x = 0.12;
      }
      blink.forEach((b) => (b.o.morphTargetInfluences[b.idx] = 1 - st.eyeOpen));
      renderer.render(scene, camera);
    }
    const ray = new THREE.Raycaster(), v = new THREE.Vector2();
    function hit(x, y) {
      if (!model) return false;
      const r = canvas.getBoundingClientRect();
      v.set(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(v, camera);
      return ray.intersectObject(model, true).length > 0;
    }
    function headPoint() {
      if (!model) return null;
      const b = new THREE.Box3().setFromObject(model), p = new THREE.Vector3((b.min.x + b.max.x) / 2, b.max.y, (b.min.z + b.max.z) / 2).project(camera);
      const r = canvas.getBoundingClientRect();
      return { x: ((p.x + 1) / 2) * r.width, y: ((1 - p.y) / 2) * r.height };
    }
    function snapshot() { draw({ t: 0, dt: 0.016, mode: 'idle', modeT: 0, walkGo: 0, gaitPh: 0, where: 'floor', heading: 0, walkDir: 1, eyeOpen: 1, scale: 1 }); return canvas.toDataURL('image/png'); }
    function dispose() { try { renderer.dispose(); renderer.forceContextLoss(); } catch (_) {} }
    api = { kind: '3d', draw, hit, headPoint, snapshot, dispose, info: () => ({ clips: Object.keys(clips), bones }) };
    return api;
  }

  window.BuddyCore = { decodeAnimated, prepareFrames, toStrip, fromStrip, studyFrames, prepareImage, guessRig, cleanRig, refineRig, findEyes, snapMouth, faceKit, makeBackView, fitBack, scanImage, drawRigOverlay, COLORS, Buddy2D, Buddy3D };
})();
