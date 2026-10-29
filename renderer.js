(function () {
  if (/standalone=1/.test(location.search)) return; // her own window has no character in it
  const stage = document.getElementById('pet');
  const canvas = document.getElementById('c');
  const bubble = document.getElementById('bubble');
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
  const camTarget = new THREE.Vector3(0, 0.7, -0.8);

  scene.add(new THREE.HemisphereLight(0xfff6e6, 0xbfae8c, 0.85));
  const sun = new THREE.DirectionalLight(0xfff3e0, 0.95);
  sun.position.set(-3, 7, 6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -7, right: 7, top: 7, bottom: -7, near: 0.5, far: 30 });
  sun.shadow.radius = 6;
  sun.shadow.bias = -0.0005;
  scene.add(sun);
  const back = new THREE.DirectionalLight(0xffe4c8, 0.45);
  back.position.set(5, 3, -4);
  scene.add(back);

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.ShadowMaterial({ opacity: 0.17 }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  function mulberry(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  const rand = mulberry(77210);
  const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

  // ---------- body profile: one continuous shape from tail tip to snout ----------
  // [z, half-width, half-height, centre height]
  const KEYS = [
    [-3.98, 0.015, 0.015, 0.05],
    [-3.9, 0.07, 0.065, 0.06],
    [-3.6, 0.17, 0.15, 0.11],
    [-3.2, 0.29, 0.25, 0.19],
    [-2.8, 0.4, 0.33, 0.27],
    [-2.4, 0.46, 0.38, 0.33],
    [-2.05, 0.45, 0.37, 0.37],
    [-1.75, 0.5, 0.39, 0.43],
    [-1.35, 0.68, 0.46, 0.5],
    [-0.85, 0.74, 0.5, 0.56],
    [-0.4, 0.64, 0.5, 0.66],
    [-0.05, 0.5, 0.44, 0.8],
    [0.15, 0.606, 0.538, 1.040],
    [0.35, 0.662, 0.567, 1.040],
    [0.55, 0.680, 0.579, 1.040],
    [0.75, 0.662, 0.578, 1.029],
    [0.92, 0.617, 0.565, 1.017],
    [1.07, 0.549, 0.535, 1.006],
    [1.2, 0.458, 0.482, 0.997],
    [1.3, 0.356, 0.410, 0.989],
    [1.37, 0.247, 0.320, 0.984],
    [1.41, 0.144, 0.220, 0.981],
    [1.43, 0.03, 0.03, 0.98]
  ];
  function cr(p0, p1, p2, p3, t) {
    const t2 = t * t, t3 = t2 * t;
    return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
  }
  function profileAt(u) { // u in [0, KEYS.length-1]
    const i = Math.min(KEYS.length - 2, Math.floor(u)), t = u - i;
    const k = (j) => KEYS[Math.max(0, Math.min(KEYS.length - 1, j))];
    const out = [];
    for (let c = 0; c < 4; c++) out.push(cr(k(i - 1)[c], k(i)[c], k(i + 1)[c], k(i + 2)[c], t));
    out[1] = Math.max(0.004, out[1]); out[2] = Math.max(0.004, out[2]);
    return out;
  }
  const RN = 260, SN = 64;
  const rings = [];
  for (let r = 0; r < RN; r++) rings.push(profileAt((r / (RN - 1)) * (KEYS.length - 1)));
  rings[0][1] = rings[0][2] = 0.001;
  rings[RN - 1][1] = rings[RN - 1][2] = 0.001;
  const zMin = rings[0][0], zMax = rings[RN - 1][0];

  function ringAtZ(z) {
    let lo = 0, hi = RN - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (rings[m][0] < z) lo = m; else hi = m; }
    const a = rings[lo], b = rings[hi], t = (z - a[0]) / Math.max(1e-6, b[0] - a[0]);
    return { r: lo + t, w: a[1] + (b[1] - a[1]) * t, h: a[2] + (b[2] - a[2]) * t, cy: a[3] + (b[3] - a[3]) * t };
  }
  const BELLY = 0.8;
  // the chin under the mouth is shallower than the belly
  const bellyAt = (z) => BELLY - 0.32 * smooth(0.05, 0.5, z);
  // the jaw narrows toward the chin so the face doesn't look puffy
  const jawSqueeze = (z, s) => (s < 0 ? 1 - 0.08 * smooth(0.15, 0.55, z) * (-s) : 1);
  function surf(z, ang, push = 0) {
    const p = ringAtZ(z), s = Math.sin(ang), c = Math.cos(ang);
    const hy = s >= 0 ? p.h : p.h * bellyAt(z);
    const wx = p.w * jawSqueeze(z, s);
    const pos = new THREE.Vector3(wx * c, p.cy + hy * s, z);
    const n = new THREE.Vector3(c / wx, s / hy, 0);
    const ahead = ringAtZ(Math.min(zMax, z + 0.02)), behind = ringAtZ(Math.max(zMin, z - 0.02));
    n.normalize();
    n.z = -((ahead.w - behind.w) / 0.04) * Math.abs(c) - ((ahead.h - behind.h) / 0.04) * Math.abs(s);
    n.normalize();
    return { pos: pos.addScaledVector(n, push), n };
  }

  const eyeZ = 0.91, eyeAng = 0.85; // eye position on the head (angle above the side)
  const EYE_Y = surf(eyeZ, eyeAng).pos.y;
  const NOSE_Y = EYE_Y - 0.15, MOUTH_Y = EYE_Y - 0.3;

  // ---------- painted skin texture (felt look, blotchy spots) ----------
  const TW = 2048, TH = 512;
  const tex = document.createElement('canvas');
  tex.width = TW; tex.height = TH;
  const ctx = tex.getContext('2d');
  const img = ctx.createImageData(TW, TH);
  const YEL = [233, 199, 132], CRM = [252, 248, 240], TAIL = [246, 242, 233];
  for (let x = 0; x < TW; x++) {
    const ring = rings[Math.round((x / (TW - 1)) * (RN - 1))];
    const z = ring[0];
    const tailK = smooth(-1.7, -3.2, z);
    const jawK = smooth(0.25, 0.75, z);
    for (let y = 0; y < TH; y++) {
      const s = Math.sin((y / TH) * Math.PI * 2);
      let k = smooth(-0.3, 0.25, s - jawK * 0.28);
      // on the head, yellow above the mouth line and cream below it
      const headK = smooth(0.3, 0.6, z);
      if (headK > 0) {
        const py = ring[3] + (s >= 0 ? ring[2] : ring[2] * bellyAt(z)) * s;
        k = k + (smooth(MOUTH_Y - 0.035, MOUTH_Y + 0.035, py) - k) * headK;
      }
      const top = YEL.map((c, i) => c + (TAIL[i] - c) * tailK);
      const n = (rand() - 0.5) * 24;
      const i4 = (y * TW + x) * 4;
      for (let c = 0; c < 3; c++) img.data[i4 + c] = Math.max(0, Math.min(255, CRM[c] + (top[c] - CRM[c]) * k + n));
      img.data[i4 + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  function blotch(z, ang, size) {
    const clusters = 1 + Math.floor(rand() * 2);
    for (let c = 0; c < clusters; c++) {
      const zz = z + (rand() - 0.5) * size * 1.4;
      const aa = ang + (rand() - 0.5) * size * 1.6;
      if (zz <= zMin + 0.05 || zz >= zMax - 0.05) continue;
      const p = ringAtZ(zz);
      const per = Math.PI * (p.w + p.h);
      const ri = Math.floor(p.r), dz = rings[Math.min(RN - 1, ri + 1)][0] - rings[ri][0];
      const pxPerUnitX = (TW / (RN - 1)) / Math.max(1e-4, dz);
      const pxPerUnitY = TH / per;
      const r = size * (0.4 + rand() * 0.35);
      const cx = (p.r / (RN - 1)) * TW;
      let cy = (((aa / (Math.PI * 2)) % 1) + 1) % 1 * TH;
      ctx.fillStyle = 'rgba(58, 40, 33, 0.94)';
      [0, TH, -TH].forEach((off) => {
        ctx.beginPath();
        ctx.ellipse(cx, cy + off, r * pxPerUnitX, r * pxPerUnitY, rand() * Math.PI, 0, Math.PI * 2);
        ctx.fill();
      });
    }
  }
  const nearEye = (z, a) => {
    const d1 = Math.hypot(z - eyeZ, (a - eyeAng) * 0.7), d2 = Math.hypot(z - eyeZ, (a - (Math.PI - eyeAng)) * 0.7);
    return Math.min(d1, d2) < 0.4;
  };
  // back: scattered blotches on the top half
  for (let i = 0; i < 95; i++) {
    const z = -1.85 + rand() * 2.1;
    const a = 0.15 + rand() * (Math.PI - 0.3);
    blotch(z, a, 0.085 + rand() * 0.045);
  }
  // tail: blotches grouped into soft bands
  [-2.0, -2.35, -2.7, -3.05, -3.35, -3.62].forEach((bz, bi) => {
    const n = 7 - Math.floor(bi / 2);
    for (let i = 0; i < n; i++) {
      const a = -0.1 + (i / (n - 1)) * (Math.PI + 0.2) + (rand() - 0.5) * 0.25;
      blotch(bz + (rand() - 0.5) * 0.1, a, 0.075 - bi * 0.007);
    }
  });
  const skinTex = new THREE.CanvasTexture(tex);
  skinTex.anisotropy = 4;
  skinTex.flipY = false;

  // fuzz bump for a soft felt feel
  const bump = document.createElement('canvas');
  bump.width = 1024; bump.height = 256;
  const bctx = bump.getContext('2d');
  const bimg = bctx.createImageData(1024, 256);
  for (let i = 0; i < bimg.data.length; i += 4) { const v = 110 + rand() * 120; bimg.data[i] = bimg.data[i + 1] = bimg.data[i + 2] = v; bimg.data[i + 3] = 255; }
  bctx.putImageData(bimg, 0, 0);
  const bumpTex = new THREE.CanvasTexture(bump);
  bumpTex.wrapS = bumpTex.wrapT = THREE.RepeatWrapping;
  bumpTex.repeat.set(6, 5);

  const skinMat = new THREE.MeshStandardMaterial({ map: skinTex, bumpMap: bumpTex, bumpScale: 0.022, roughness: 1, metalness: 0 });

  // ---------- the body mesh ----------
  const pos = new Float32Array(RN * (SN + 1) * 3);
  const uv = new Float32Array(RN * (SN + 1) * 2);
  const base = new Float32Array(pos.length);
  for (let r = 0; r < RN; r++) {
    const [z, w, h, cy] = rings[r];
    for (let j = 0; j <= SN; j++) {
      const a = (j / SN) * Math.PI * 2, s = Math.sin(a);
      const i = r * (SN + 1) + j;
      base[i * 3] = w * jawSqueeze(z, s) * Math.cos(a);
      base[i * 3 + 1] = cy + (s >= 0 ? h : h * bellyAt(z)) * s;
      base[i * 3 + 2] = z;
      uv[i * 2] = r / (RN - 1);
      uv[i * 2 + 1] = j / SN;
    }
  }
  pos.set(base);
  const idx = [];
  for (let r = 0; r < RN - 1; r++) for (let j = 0; j < SN; j++) {
    const a = r * (SN + 1) + j, b = a + SN + 1;
    idx.push(a, a + 1, b, b, a + 1, b + 1);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  geo.boundingSphere.radius += 0.5;

  const gecko = new THREE.Group();
  scene.add(gecko);
  const body = new THREE.Group();
  gecko.add(body);
  const skin = new THREE.Mesh(geo, skinMat);
  skin.castShadow = true;
  body.add(skin);

  // ---------- head parts (follow the head rotation) ----------
  const PIVOT = new THREE.Vector3(0, 0.78, -0.05);
  const headGroup = new THREE.Group();
  headGroup.position.copy(PIVOT);
  headGroup.rotation.order = 'YXZ';
  body.add(headGroup);
  const local = (v) => v.clone().sub(PIVOT);

  const sphereGeo = new THREE.SphereGeometry(1, 40, 28);
  const cream = new THREE.MeshStandardMaterial({ color: 0xFBF1E1, roughness: 1, bumpMap: bumpTex, bumpScale: 0.01 });
  const legMat = new THREE.MeshStandardMaterial({ color: 0xE8C17F, roughness: 1, bumpMap: bumpTex, bumpScale: 0.01 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x3A2821, roughness: 0.95 });
  const eyeMat = new THREE.MeshPhysicalMaterial({ color: 0x080606, roughness: 0.06, clearcoat: 1, clearcoatRoughness: 0.02, reflectivity: 0.6 });
  const white = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const tongueMat = new THREE.MeshStandardMaterial({ color: 0xF88497, roughness: 0.4 });
  function ball(r, mat, shadow = true) { const m = new THREE.Mesh(sphereGeo, mat); m.scale.setScalar(r); m.castShadow = shadow; return m; }

  // eyes: glossy dark eye set into the head, a thick cream eyelid ring around it,
  // and soft upper/lower lids that close for blinks and naps
  const eyes = [];
  const lidGeoTop = new THREE.SphereGeometry(1, 40, 20, 0, Math.PI * 2, 0, Math.PI / 2);
  const ringGeo = new THREE.TorusGeometry(1.03, 0.15, 20, 48);
  [eyeAng, Math.PI - eyeAng].forEach((a, side) => {
    const s = surf(eyeZ, a, -0.05);
    const g = new THREE.Group();
    g.position.copy(local(s.pos));
    const look = s.n.clone().add(new THREE.Vector3(0, 0.0, 1.25)).normalize();
    g.quaternion.setFromRotationMatrix(new THREE.Matrix4().lookAt(look, new THREE.Vector3(), new THREE.Vector3(0, 1, 0)));
    headGroup.add(g);
    const R = 0.19;
    const eye = ball(R, eyeMat);
    g.add(eye);
    const ring = new THREE.Mesh(ringGeo, cream);
    ring.scale.set(R * 1.0, R * 1.0, R * 0.9);
    ring.position.z = R * 0.42;
    ring.castShadow = true;
    g.add(ring);
    const upper = new THREE.Mesh(lidGeoTop, cream);
    upper.scale.setScalar(R * 1.07);
    g.add(upper);
    const lower = new THREE.Mesh(lidGeoTop, cream);
    lower.scale.setScalar(R * 1.06);
    lower.rotation.z = Math.PI;
    g.add(lower);
    const h1 = ball(0.05, white, false); h1.position.set(side ? 0.05 : -0.05, 0.065, R * 0.93); g.add(h1);
    const h2 = ball(0.022, white, false); h2.position.set(side ? -0.055 : 0.055, -0.05, R * 0.95); g.add(h2);
    eyes.push({ g, upper, lower, shine: [h1, h2] });
  });
  // lid rotation for an openness value (1 = open, 0 = shut)
  function setLids(e, open) {
    e.upper.rotation.x = -1.6 + (1 - open) * 1.6 - 0.55 * open; // open: tucked back, a little lid shows on top
    e.lower.rotation.x = 1.6 - (1 - open) * 1.6 + 0.35 * open;
    e.shine.forEach((h) => { h.visible = open > 0.35; });
    e.upper.visible = e.lower.visible = open < 0.93;
  }
  eyes.forEach((e) => setLids(e, 1));
  let lidOpen = 1;

  // small centred smile on the front of the face, between and below the eyes
  function frontZ(x, y) { // first body surface hit coming from the front at (x, y)
    for (let z = zMax - 0.002; z > 0.4; z -= 0.004) {
      const p = ringAtZ(z), hy = y >= p.cy ? p.h : p.h * bellyAt(z);
      const sy = Math.max(-1, Math.min(1, (y - p.cy) / hy));
      if ((x / (p.w * jawSqueeze(z, sy))) ** 2 + sy ** 2 <= 1) return z;
    }
    return 1.2;
  }
  const eyeY = surf(eyeZ, eyeAng).pos.y, eyeX = surf(eyeZ, eyeAng).pos.x;
  const noseY = NOSE_Y, mouthY = MOUTH_Y, halfW = 0.5;
  const smilePts = [];
  for (let i = 0; i <= 14; i++) {
    const x = -halfW + (2 * halfW * i) / 14;
    const y = mouthY + 0.028 * (x / halfW) ** 2;
    smilePts.push(local(new THREE.Vector3(x, y, frontZ(x, y) + 0.008)));
  }
  const smileMat = new THREE.MeshStandardMaterial({ color: 0x6E4B3A, roughness: 0.9 });
  const smile = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(smilePts), 80, 0.013, 8, false), smileMat);
  headGroup.add(smile);
  [-1, 1].forEach((s) => { // little nose: two nostrils centred just above the mouth
    const x = s * 0.055, y = noseY;
    const d = ball(0.016, smileMat, false);
    d.scale.set(0.018, 0.012, 0.008);
    d.position.copy(local(new THREE.Vector3(x, y, frontZ(x, y) + 0.003)));
    headGroup.add(d);
  });
  // round freckles on the head (as decals so they stay perfectly round)
  for (let i = 0, made = 0; i < 400 && made < 24; i++) {
    const z = 0.12 + rand() * 1.18;
    const a = 0.25 + rand() * (Math.PI - 0.5);
    if (nearEye(z, a)) continue;
    const sp = surf(z, a, -0.004);
    if (sp.pos.y < MOUTH_Y + 0.12) continue; // nothing on the cheeks/chin
    if (z > 0.75 && sp.pos.y < EYE_Y + 0.05) continue; // keep the face around the eyes, nose and mouth clean
    if (z > 1.2) continue;
    const r = 0.035 + rand() * 0.035;
    const d = new THREE.Mesh(sphereGeo, dark);
    d.scale.set(r * (0.85 + rand() * 0.3), r, r * 0.22);
    d.position.copy(local(sp.pos));
    d.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), sp.n);
    headGroup.add(d);
    made++;
  }

  const tongue = new THREE.Group();
  tongue.position.copy(local(new THREE.Vector3(0, mouthY - 0.005, frontZ(0, mouthY) - 0.06)));
  const tm = new THREE.Mesh(sphereGeo, tongueMat);
  tm.scale.set(0.15, 0.05, 0.25);
  tm.position.z = 0.18;
  tongue.add(tm);
  tongue.visible = false;
  headGroup.add(tongue);

  // ---------- legs ----------
  const legs = [];
  function makeLeg(s, z, front) {
    const sh = surf(z, s > 0 ? -0.25 : Math.PI + 0.25, -0.12).pos;
    const g = new THREE.Group();
    g.position.copy(sh);
    body.add(g);
    const len = front ? 1 : 1.08;
    const elbow = new THREE.Vector3(s * 0.55 * len, front ? 0.0 : 0.1, front ? 0.16 : -0.1);
    const wrist = new THREE.Vector3(s * 0.78 * len, -sh.y + 0.07, front ? 0.36 : -0.04);
    const upper = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0, 0), elbow.clone().multiplyScalar(0.5).add(new THREE.Vector3(0, 0.05, 0)), elbow]), 10, front ? 0.15 : 0.17, 10, false), legMat);
    upper.castShadow = true;
    g.add(upper);
    const knob = ball(front ? 0.15 : 0.17, legMat); knob.position.copy(elbow); g.add(knob);
    const lower = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([elbow, elbow.clone().lerp(wrist, 0.5).add(new THREE.Vector3(s * 0.03, 0, 0)), wrist]), 10, 0.12, 10, false), legMat);
    lower.castShadow = true;
    g.add(lower);
    const spot = ball(1, dark, false); spot.scale.set(0.05, 0.045, 0.03); spot.position.copy(elbow).add(new THREE.Vector3(0, 0.1, 0.05)); g.add(spot);
    const foot = new THREE.Group();
    foot.position.copy(wrist);
    g.add(foot);
    const pad = ball(1, cream); pad.scale.set(0.12, 0.06, 0.12); foot.add(pad);
    for (let i = 0; i < 5; i++) {
      const a = (i - 2) * 0.48 + s * (front ? 0.35 : 0.6);
      const toe = ball(1, cream);
      toe.scale.set(0.034, 0.03, 0.15);
      toe.position.set(Math.sin(a) * 0.17, -0.03, Math.cos(a) * 0.17);
      toe.rotation.y = a;
      foot.add(toe);
      const tip = ball(0.038, cream); tip.position.set(Math.sin(a) * 0.3, -0.035, Math.cos(a) * 0.3); foot.add(tip);
    }
    return g;
  }
  legs.push({ g: makeLeg(1, -0.3, true), ph: 0 }, { g: makeLeg(-1, -0.3, true), ph: Math.PI }, { g: makeLeg(1, -1.55, false), ph: Math.PI }, { g: makeLeg(-1, -1.55, false), ph: 0 });

  const pickables = [];
  gecko.traverse((o) => { if (o.isMesh) pickables.push(o); });

  // ---------- floating hearts and z's ----------
  function spriteTex(draw) { const cv = document.createElement('canvas'); cv.width = cv.height = 128; draw(cv.getContext('2d')); return new THREE.CanvasTexture(cv); }
  const heartTex = spriteTex((c) => { c.fillStyle = '#FF7F94'; c.beginPath(); c.moveTo(64, 112); c.bezierCurveTo(10, 72, 8, 30, 38, 22); c.bezierCurveTo(54, 18, 62, 30, 64, 40); c.bezierCurveTo(66, 30, 74, 18, 90, 22); c.bezierCurveTo(120, 30, 118, 72, 64, 112); c.fill(); });
  const zTex = spriteTex((c) => { c.fillStyle = '#7DA9D8'; c.font = '800 96px "Baloo 2", system-ui, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('z', 64, 68); });
  const particles = [];
  const tmp = new THREE.Vector3();
  function spawn(t, n) {
    headGroup.localToWorld(tmp.set(0, 0.6, 0.6));
    for (let i = 0; i < n; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false }));
      s.position.set(tmp.x + (Math.random() - 0.5) * 0.7, tmp.y, tmp.z);
      s.scale.setScalar(0.32);
      scene.add(s);
      particles.push({ s, vx: (Math.random() - 0.5) * 0.5, vy: 0.75 + Math.random() * 0.4, life: 0 });
    }
  }

  // ---------- behaviour ----------
  const DUR = { walk: 10, wave: 2.4, lick: 1.6, happy: 1.8, nap: 9 };
  let mode = 'idle', modeT = 0, idleFor = 0, nextStroll = 8 + Math.random() * 5;
  let walkDir = 1, rotY = -0.95, blinkT = 2, napPuff = 0, heartsDone = 0;
  const heartsAt = [0.2, 0.8, 1.4];
  const head = { x: 0, y: 0, z: 0 };
  let walkAmt = 0;
  // gait: diagonal pairs, feet planted during stance, short stop-and-go bursts like a real gecko
  let gaitPh = 0, walkGo = 0, going = true, goTimer = 1.2;
  const GAIT_HZ = 1.65, GAIT_W = Math.PI * 2 * GAIT_HZ, DUTY = 0.6, STRIDE = 0.66, FOOT_R = 0.85;
  const WALK_V = (STRIDE * FOOT_R) / (DUTY / GAIT_HZ);

  function setMode(m) {
    mode = m; modeT = 0; heartsDone = 0; napPuff = 0;
    tongue.visible = m === 'lick';
    if (m === 'walk') { going = true; goTimer = 1 + Math.random(); }
    if (m === 'walk') { walkDir = cx > W() * 0.7 ? -1 : cx < W() * 0.15 ? 1 : (Math.random() < 0.5 ? -1 : 1); if (where === 'floor' && roam !== 'floor' && (roam === 'wall' || Math.random() < 0.25)) climbUp(); }
  }
  const lines = ['hiii! 🦎', 'tap tap hehe', 'you got this today', 'drink water pls 💧', 'stretch break?', 'proud of you today ✨'];
  let bubbleTimer = 0;
  function say(text, secs = 2.6) { bubble.textContent = text; bubble.hidden = false; bubbleTimer = secs; }

  document.querySelectorAll('[data-move]').forEach((b) => b.addEventListener('click', () => {
    setMode(b.dataset.move);
    if (b.dataset.move === 'nap') say('nap time... zzz', 2.2);
  }));
  // ---------- where luna is on screen ----------
  // where 'floor': side view, strolling along the bottom of the screen.
  // where 'wall' : top-down view, stuck to your screen like a house gecko, crawling any direction.
  const HALF = 220;
  const W = () => window.innerWidth, H = () => window.innerHeight;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const wrapPi = (a) => Math.atan2(Math.sin(a), Math.cos(a));
  const EDGE = 175; // how close her center can get to a screen edge
  let roam = 'both'; // 'floor' | 'wall' | 'both'
  let where = 'floor', view = 0, heading = Math.PI, wanderT = 0, FLOOR_OFF = 60, PPU = 60;
  let press = null, held = false;
  let cx = W() * 0.66, cy = 0;
  const floorCY = () => H() - FLOOR_OFF - 34;
  function placePet() {
    if (where === 'floor' && !held) cy = floorCY();
    stage.style.left = (cx - HALF) + 'px';
    stage.style.top = (cy - HALF) + 'px';
  }
  window.addEventListener('resize', placePet);
  function climbUp() { where = 'wall'; heading = Math.PI + (Math.random() - 0.5) * 0.4; cy = floorCY() - 30; wanderT = 1.5; }
  const ray = new THREE.Raycaster(), ptr = new THREE.Vector2();
  function hit(e) {
    if (window.LUNA_BUDDY && window.LUNA_BUDDY.active()) return window.LUNA_BUDDY.hit(e.clientX, e.clientY);
    const r = canvas.getBoundingClientRect();
    ptr.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ptr, camera);
    return ray.intersectObjects(pickables, false).length > 0;
  }
  // tap to chat, press and drag to put her anywhere
  canvas.addEventListener('pointermove', (e) => {
    if (!press) { canvas.style.cursor = hit(e) ? 'grab' : 'default'; return; }
    const dx = e.clientX - press.x, dy = e.clientY - press.y;
    if (!press.moved && Math.hypot(dx, dy) > 5) { press.moved = true; held = true; if (mode !== 'idle') setMode('idle'); }
    if (press.moved) {
      cx = clamp(press.cx0 + dx, EDGE, W() - EDGE);
      cy = clamp(press.cy0 + dy, EDGE, floorCY());
      placePet();
    }
  });
  canvas.addEventListener('pointerdown', (e) => {
    if (!hit(e)) return;
    if (e.button === 2) { window.dispatchEvent(new CustomEvent('luna-menu')); return; }
    press = { x: e.clientX, y: e.clientY, cx0: cx, cy0: cy, moved: false };
    window.LUNA_DRAGGING = true;
    canvas.setPointerCapture(e.pointerId);
    canvas.style.cursor = 'grabbing';
  });
  const release = () => {
    if (!press) return;
    const wasDrag = press.moved;
    press = null; held = false; window.LUNA_DRAGGING = false;
    canvas.style.cursor = 'grab';
    if (wasDrag) {
      if (roam === 'floor' || (roam !== 'wall' && cy > floorCY() - 90)) { where = 'floor'; placePet(); say('wheee 🦎', 1.6); }
      else { if (where === 'floor') heading = Math.PI; where = 'wall'; say('sticky feet! 🦎', 1.8); }
      return;
    }
    const picks = ['happy', 'lick', 'wave'];
    if (mode !== 'walk') setMode(mode === 'nap' ? 'happy' : picks[Math.floor(Math.random() * picks.length)]);
    else setMode('idle');
    window.dispatchEvent(new CustomEvent('luna-tap'));
  };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  // floor camera: 3/4 side view. wall camera: straight down, so she looks pressed against the screen.
  const camT0 = new THREE.Vector3(0, 0.7, -0.8), camP0 = new THREE.Vector3();
  const camT1 = new THREE.Vector3(0, 0, 0), camP1 = new THREE.Vector3(0, 14.6, 0.001);
  const up0 = new THREE.Vector3(0, 1, 0), up1 = new THREE.Vector3(0, 0, -1);
  camP0.set(0.4, 2.4, 7.3).sub(camT0).normalize().multiplyScalar(14.6).add(camT0);
  const cP = new THREE.Vector3(), cT = new THREE.Vector3();
  function setCam(e) {
    cP.copy(camP0).lerp(camP1, e); cT.copy(camT0).lerp(camT1, e);
    camera.position.copy(cP);
    camera.up.copy(up0).lerp(up1, e).normalize();
    camera.lookAt(cT);
  }
  function resize() {
    const w = stage.clientWidth, h = stage.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    setCam(0);
    camera.updateMatrixWorld();
    const a = new THREE.Vector3(0, 0, 0).project(camera), b = new THREE.Vector3(1, 0, 0).project(camera);
    PPU = Math.abs(b.x - a.x) / 2 * w;
    FLOOR_OFF = (-new THREE.Vector3(0.4, 0, 0.6).project(camera).y) * h / 2;
    setCam(view * view * (3 - 2 * view));
    placePet();
  }
  new ResizeObserver(resize).observe(stage);
  resize();

  // ---------- per-frame body deformation (head turn, tail wag, walking wiggle) ----------
  const rotM = new THREE.Matrix4(), eul = new THREE.Euler(0, 0, 0, 'YXZ'), v = new THREE.Vector3();
  let slim = 0, headSX = 0, headSZ = 0;
  function deform(t, tailAmp, tailSpeed) {
    eul.set(head.x, head.y, head.z);
    rotM.makeRotationFromEuler(eul);
    for (let i = 0; i < base.length; i += 3) {
      let x = base[i], y = base[i + 1], z = base[i + 2];
      const wH = smooth(-0.15, 0.3, z);
      if (wH > 0) {
        // from above, keep the head in proportion to the slimmer body
        if (slim > 0) { x *= 1 - headSX * wH; z = PIVOT.z + (z - PIVOT.z) * (1 - headSZ * wH); }
        v.set(x - PIVOT.x, y - PIVOT.y, z - PIVOT.z).applyMatrix4(rotM).add(PIVOT);
        x += (v.x - x) * wH; y += (v.y - y) * wH; z += (v.z - z) * wH;
      }
      const wT = smooth(-1.6, -3.9, z);
      if (wT > 0) x += Math.sin(t * tailSpeed + z * 1.7) * tailAmp * wT * 1.4 * (1 - walkAmt * 0.7);
      if (walkAmt > 0 && z < 0.2) {
        // spine bends in an S that flips with each step; the tail follows a beat later
        x += Math.sin(gaitPh) * Math.cos(((z + 0.92) / 2.3) * Math.PI) * 0.075 * walkAmt;
        x += Math.sin(gaitPh - 0.9 - (-1.6 - z) * 0.55) * 0.16 * wT * walkAmt;
      }
      // slimmer body and tail when seen from above on the wall
      if (slim > 0) x *= 1 - slim * smooth(0.05, -0.45, z);
      pos[i] = x; pos[i + 1] = y; pos[i + 2] = z;
    }
    geo.attributes.position.needsUpdate = true;
    geo.computeVertexNormals();
  }

  const clock = new THREE.Clock();
  let geckoShown = true;
  let t = 0;
  const lerp = (a, b, k) => a + (b - a) * k;
  function tick() {
    const dt = Math.min(clock.getDelta(), 0.05);
    t += dt; modeT += dt;
    const ease = 1 - Math.exp(-dt * 7);
    let bodyY = Math.sin(t * 2.1) * 0.012, hop = 0;
    let hx = Math.sin(t * 0.6) * 0.04, hy = 0.85 + Math.sin(t * 0.45) * 0.08, hz = Math.sin(t * 0.8) * 0.06;
    let tailAmp = 0.06, tailSpeed = 1.5, swing = 0, eyeOpen = 1, rotTarget = -0.95, spin = 0;
    const SIDE = location.hash === '#side';
    if (SIDE) { hy = 0; hx = 0; hz = 0; rotTarget = Math.PI / 2; }
    legs.forEach((l) => { l.g.rotation.set(0, 0, 0); });

    blinkT -= dt;
    if (blinkT < 0 && blinkT > -0.13) eyeOpen = 0.08;
    if (blinkT <= -0.13) blinkT = 2.2 + Math.random() * 3;

    if (mode === 'idle') {
      idleFor += dt;
      if (!reduced && !window.LUNA_CHATTING && idleFor > nextStroll) { idleFor = 0; nextStroll = 9 + Math.random() * 7; setMode('walk'); }
    } else idleFor = 0;

    // picture characters are drawn from the side, so they stay on the floor (drag them anywhere you like)
    const floorOnly = Boolean(window.LUNA_BUDDY && window.LUNA_BUDDY.active() && window.LUNA_BUDDY.floorOnly);
    if (floorOnly && where === 'wall' && !held) { where = 'floor'; walkDir = Math.sin(heading) >= 0 ? 1 : -1; placePet(); }
    if (mode === 'walk') {
      swing = 1; tailAmp = 0.04; tailSpeed = 2;
      goTimer -= dt;
      if (goTimer < 0) { going = !going; goTimer = going ? 1 + Math.random() * 1.2 : 0.4 + Math.random() * 0.6; }
      const step = WALK_V * walkGo * dt * PPU;
      if (where === 'floor') {
        cx += walkDir * step;
        const m = 170;
        if (cx > W() - m || cx < m) {
          cx = clamp(cx, m, W() - m);
          if (roam !== 'floor' && !floorOnly && Math.random() < 0.6) climbUp(); else walkDir = -walkDir; // up the side of the screen, or turn around
        }
        rotTarget = walkDir * (Math.PI / 2) + Math.sin(gaitPh) * 0.05 * walkGo;
      } else {
        // wander across the screen, steering away from the edges
        wanderT -= dt;
        if (wanderT < 0) { wanderT = 1.2 + Math.random() * 2; heading += (Math.random() - 0.5) * 1.6; }
        // turn back well before an edge so her whole body (head included) stays on screen
        const m = 260, low = roam === 'wall' ? floorCY() - 120 : H() + 999;
        if (cx < m || cx > W() - m || cy < m || cy > low) heading += wrapPi(Math.atan2(W() / 2 - cx, H() / 2 - cy) - heading) * Math.min(1, dt * 3);
        cx = clamp(cx + Math.sin(heading) * step, EDGE, W() - EDGE);
        cy = clamp(cy + Math.cos(heading) * step, EDGE, floorCY());
        // reached the bottom heading down: hop back onto the floor (unless she's set to climb only)
        if (roam !== 'wall' && cy >= floorCY() - 2 && Math.cos(heading) > 0.3) { where = 'floor'; walkDir = Math.sin(heading) >= 0 ? 1 : -1; }
        rotTarget = heading + Math.sin(gaitPh) * 0.05 * walkGo;
      }
      placePet();
      // head holds steady against the body sway, and looks around while paused
      hy = (where === 'floor' ? -walkDir * 0.3 : 0) - Math.sin(gaitPh) * 0.08 * walkGo + Math.sin(t * 1.7) * 0.35 * (1 - walkGo);
      hx = 0.02 + Math.sin(t * 2.3) * 0.05 * (1 - walkGo); hz = 0;
      bodyY = -0.015 + Math.abs(Math.cos(gaitPh)) * 0.012 * walkGo;
    } else if (mode === 'wave') {
      const k = Math.min(1, modeT * 4) * Math.min(1, (DUR.wave - modeT) * 4);
      legs[1].g.rotation.x = -1.1 * k;
      legs[1].g.rotation.y = Math.sin(modeT * 13) * 0.35 * k;
      hz = -0.12; hy = 0.45;
    } else if (mode === 'lick') {
      const k = Math.max(0, Math.sin((modeT / DUR.lick) * Math.PI * 2));
      tongue.scale.set(1, 1, 0.05 + k);
      tongue.rotation.x = -0.45 * k;
      hx = -0.18; hy = 0.4; eyeOpen = Math.min(eyeOpen, 0.6);
    } else if (mode === 'happy') {
      hop = Math.abs(Math.sin((modeT * Math.PI) / 0.6)) * 0.4;
      const p = modeT / DUR.happy;
      spin = (p < 1 ? (1 - Math.cos(p * Math.PI)) / 2 : 1) * Math.PI * 2;
      eyeOpen = 0.3; tailAmp = 0.22; tailSpeed = 11; hx = -0.12;
      while (heartsDone < heartsAt.length && modeT >= heartsAt[heartsDone]) { spawn(heartTex, 2); heartsDone++; }
    } else if (mode === 'nap') {
      hx = 0.22; hy = 0.2; hz = 0.12; eyeOpen = 0.06; tailAmp = 0.015; tailSpeed = 1;
      bodyY = Math.sin(t * 1.2) * 0.02 - 0.06;
      napPuff -= dt;
      if (napPuff <= 0 && modeT > 0.8) { spawn(zTex, 1); napPuff = 1.3; }
    }
    if (mode !== 'idle' && modeT > DUR[mode]) setMode('idle');

    walkAmt = lerp(walkAmt, swing, ease);
    walkGo = lerp(walkGo, mode === 'walk' && going ? 1 : 0, 1 - Math.exp(-dt * 10));
    gaitPh += GAIT_W * walkGo * dt;
    if (where === 'wall' && mode !== 'walk') { rotTarget = heading; if (mode === 'idle') hy = Math.sin(t * 0.45) * 0.25; }
    rotY += wrapPi(rotTarget - rotY) * (1 - Math.exp(-dt * 5));
    view += ((where === 'wall' ? 1 : 0) - view) * (1 - Math.exp(-dt * 4));
    const ev = view * view * (3 - 2 * view);
    setCam(ev);
    gecko.rotation.y = rotY + spin;
    const ra = rotY + spin;
    gecko.position.x = lerp(0.4 + 1.22 * Math.sin(ra), 1.22 * Math.sin(ra), ev);
    gecko.position.z = lerp(0, 1.22 * Math.cos(ra), ev);
    slim = 0.2 * ev; headSX = 0.17 * ev; headSZ = 0.16 * ev;
    headGroup.scale.set(1 - headSX, 1, 1 - headSZ);
    legs.forEach((l) => { if (l.x0 === undefined) l.x0 = l.g.position.x; l.g.position.x = l.x0 * (1 - slim * 0.85); });
    if (held) { hop = 0.45 + Math.sin(t * 6) * 0.04; eyeOpen = Math.min(eyeOpen, 0.4); tailAmp = 0.16; tailSpeed = 9; hx = -0.15; }
    body.position.y = lerp(body.position.y, bodyY + hop, mode === 'happy' ? 1 : held ? 1 - Math.exp(-dt * 14) : ease);
    head.x = lerp(head.x, hx, ease); head.y = lerp(head.y, hy, ease); head.z = lerp(head.z, hz, ease);
    headGroup.rotation.set(head.x, head.y, head.z);
    lidOpen = lerp(lidOpen, eyeOpen, 1 - Math.exp(-dt * 28));
    eyes.forEach((e) => setLids(e, lidOpen));
    if (held) legs.forEach((l) => { l.g.rotation.z = Math.sign(l.g.position.x) * (-0.2 + Math.sin(t * 9 + l.ph) * 0.18); });
    if (walkAmt > 0.01 && mode !== 'wave') legs.forEach((l) => {
      const p = (((gaitPh + l.ph) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2) / (Math.PI * 2);
      let fwd, lift = 0;
      if (p < DUTY) fwd = STRIDE * (0.5 - p / DUTY); // planted: foot slides back under the body
      else { const u = (p - DUTY) / (1 - DUTY); fwd = STRIDE * (-0.5 + u * u * (3 - 2 * u)); lift = Math.sin(Math.PI * u); }
      const sx = Math.sign(l.g.position.x);
      l.g.rotation.y = -sx * fwd * walkAmt;
      l.g.rotation.z = sx * lift * 0.28 * walkAmt * walkGo;
    });
    deform(t, tailAmp, tailSpeed);

    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life += dt;
      p.s.position.x += p.vx * dt; p.s.position.y += p.vy * dt;
      p.s.material.opacity = Math.max(0, 1 - p.life / 1.6);
      p.s.scale.setScalar(0.28 + p.life * 0.2);
      if (p.life > 1.6) { scene.remove(p.s); p.s.material.dispose(); particles.splice(i, 1); }
    }
    if (!bubble.hidden) {
      bubbleTimer -= dt;
      if (bubbleTimer <= 0) bubble.hidden = true;
      headGroup.localToWorld(tmp.set(0, 1.05, 0.35));
      tmp.project(camera);
      bubble.style.left = ((tmp.x + 1) / 2) * stage.clientWidth + 'px';
      bubble.style.top = (((1 - tmp.y) / 2) * stage.clientHeight - 70 * view) + 'px'; // float clear of her head when she's on the wall
    }
    // a custom character (picture or 3d model) borrows her moves and draws itself instead
    const CB = window.LUNA_BUDDY;
    if (CB && CB.active()) {
      CB.draw({ t, dt, mode, modeT, walkGo, gaitPh, where, heading, walkDir, held, eyeOpen: lidOpen });
      if (!bubble.hidden) { const hp = CB.headPoint(); if (hp) { bubble.style.left = hp.x + 'px'; bubble.style.top = (hp.y - 12) + 'px'; } }
      if (geckoShown) { renderer.clear(); geckoShown = false; }
    } else { geckoShown = true; renderer.render(scene, camera); }
    requestAnimationFrame(tick);
  }
  function setRoam(r) {
    roam = r;
    if (r === 'floor' && where === 'wall') { where = 'floor'; walkDir = Math.sin(heading) >= 0 ? 1 : -1; placePet(); say('back on the floor 🦎', 1.6); }
    if (r === 'wall' && where === 'floor') { climbUp(); say('climbing time 🦎', 1.6); }
  }
  window.LUNA = { say, setMode, setRoam, hide: () => { bubbleTimer = 0; bubble.hidden = true; }, hitAt: (x, y) => hit({ clientX: x, clientY: y }), get mode() { return mode; } };
  say('hiii! 🦎', 3);
  requestAnimationFrame(tick);
})();
