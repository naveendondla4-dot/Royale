/* render_actors.js - everything that moves or flashes: gun models, soldiers, loot pickups,
 * muzzle flashes, tracers and impact particles. */
(function (G) {
  'use strict';
  const BR = (G.BR = G.BR || {});
  const CFG = BR.CFG;
  const rgb = (hex) => [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];

  // ------------------------------------------------------------------ guns (forward = -Z, origin = grip)
  const DARK = 0x2a2d31, MID = 0x3d4248, WOOD = 0x6b4a2b, OLIVE = 0x3b4a32, STEEL = 0x8b939b;
  function gunParts(THREE, id) {
    const M = THREE.Matrix4;
    const B = (w, h, d, x, y, z, hex) => ({ g: new THREE.BoxGeometry(w, h, d), m: new M().makeTranslation(x, y, z), hex });
    const Cy = (r, len, x, y, z, hex) => ({ g: new THREE.CylinderGeometry(r, r, len, 8), m: new M().makeRotationX(Math.PI / 2).setPosition(x, y, z), hex });
    const grip = (z) => B(0.04, 0.11, 0.05, 0, -0.07, z, DARK);
    switch (id) {
      case 'pistol': return { len: 0.22, p: [B(0.05, 0.07, 0.22, 0, 0.03, -0.09, MID), B(0.04, 0.025, 0.2, 0, 0.075, -0.09, DARK), grip(0.02), B(0.012, 0.02, 0.02, 0, 0.09, -0.18, STEEL)] };
      case 'smg': return { len: 0.45, p: [B(0.06, 0.1, 0.34, 0, 0.02, -0.15, DARK), Cy(0.014, 0.16, 0, 0.03, -0.4, STEEL), B(0.04, 0.17, 0.06, 0, -0.12, -0.12, MID), grip(0.04), B(0.05, 0.07, 0.14, 0, 0.0, 0.14, MID), B(0.03, 0.02, 0.1, 0, 0.085, -0.15, STEEL)] };
      case 'ar': return { len: 0.78, p: [B(0.06, 0.1, 0.42, 0, 0.02, -0.18, DARK), B(0.05, 0.07, 0.26, 0, 0.0, -0.5, WOOD), Cy(0.012, 0.3, 0, 0.03, -0.78, STEEL), B(0.04, 0.16, 0.07, 0, -0.12, -0.2, MID), grip(0.04), B(0.05, 0.11, 0.24, 0, -0.01, 0.2, WOOD), B(0.03, 0.04, 0.1, 0, 0.095, -0.18, STEEL), B(0.014, 0.03, 0.014, 0, 0.075, -0.7, STEEL)] };
      case 'shotgun': return { len: 0.82, p: [B(0.06, 0.09, 0.4, 0, 0.02, -0.15, DARK), Cy(0.02, 0.62, 0, 0.04, -0.5, STEEL), Cy(0.026, 0.3, 0, -0.01, -0.45, WOOD), grip(0.04), B(0.05, 0.12, 0.26, 0, -0.01, 0.22, WOOD)] };
      case 'sniper': return { len: 1.1, p: [B(0.06, 0.1, 0.5, 0, 0.02, -0.2, OLIVE), Cy(0.014, 0.6, 0, 0.03, -0.85, DARK), Cy(0.028, 0.26, 0, 0.115, -0.22, MID), Cy(0.036, 0.05, 0, 0.115, -0.38, DARK), B(0.04, 0.14, 0.06, 0, -0.1, -0.12, MID), grip(0.04), B(0.05, 0.13, 0.3, 0, -0.01, 0.25, OLIVE)] };
    }
    return { len: 0.3, p: [B(0.05, 0.07, 0.25, 0, 0, -0.1, DARK)] };
  }
  const gunCache = {};
  function gunMesh(THREE, id, lit) {
    const key = id + (lit ? 'L' : '');
    if (!gunCache[key]) {
      const d = gunParts(THREE, id), geo = BR.RenderWorld.mergeParts(THREE, d.p);
      gunCache[key] = { geo, len: d.len, mat: new THREE.MeshLambertMaterial({ vertexColors: true }) };
    }
    const c = gunCache[key], m = new THREE.Mesh(c.geo, c.mat);
    m.userData.len = c.len; m.castShadow = false;
    return m;
  }

  // ------------------------------------------------------------------ soldiers
  const PAL = [
    { shirt: 0x3f6fb5, pants: 0x2b3a55, helm: 0x2f4f8a }, { shirt: 0xb5483f, pants: 0x4a2b2b, helm: 0x8a2f2f }, { shirt: 0x4f9a52, pants: 0x2f4a2f, helm: 0x2f6a35 },
    { shirt: 0xd1a33a, pants: 0x5a4a2a, helm: 0x9a7a22 }, { shirt: 0x8a5fb5, pants: 0x3a2f55, helm: 0x5f3f8a }, { shirt: 0x3fb5a8, pants: 0x2a4a4a, helm: 0x2a8a80 },
    { shirt: 0xe07a3a, pants: 0x4a3a2a, helm: 0xa5551f }, { shirt: 0x8d939b, pants: 0x3a3d42, helm: 0x5d636b },
  ];
  const SKINS = [0xf1c8a0, 0xd9a577, 0xb07a4f, 0x7a4f32];
  // half-sphere parachute with 12 alternating light / dark panels (colour per triangle, so the panel edges are sharp)
  function paneledCanopy(THREE) {
    const g = new THREE.SphereGeometry(2.4, 24, 8, 0, Math.PI * 2, 0, Math.PI / 2).scale(1.3, 0.85, 1.3).toNonIndexed();
    const pa = g.attributes.position.array, col = new Float32Array(pa.length);
    for (let t = 0; t < pa.length; t += 9) {
      const cx = (pa[t] + pa[t + 3] + pa[t + 6]) / 3, cz = (pa[t + 2] + pa[t + 5] + pa[t + 8]) / 3;
      const k = Math.floor(((Math.atan2(cz, cx) + Math.PI) / (2 * Math.PI)) * 12) % 2 ? 1 : 0.5;
      for (let v = 0; v < 9; v += 3) { col[t + v] = col[t + v + 1] = col[t + v + 2] = k; }
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return g;
  }
  let shared = null;
  function share(THREE) {
    if (shared) return shared;
    const mk = (hex) => new THREE.MeshLambertMaterial({ color: new THREE.Color(hex).convertSRGBToLinear() });
    shared = {
      box: (w, h, d) => new THREE.BoxGeometry(w, h, d),
      shirt: PAL.map((p) => mk(p.shirt)), pants: PAL.map((p) => mk(p.pants)), helm: PAL.map((p) => mk(p.helm)), skin: SKINS.map(mk),
      dark: mk(0x1d2024), canopy: PAL.map((p) => new THREE.MeshLambertMaterial({ color: new THREE.Color(p.shirt).convertSRGBToLinear(), vertexColors: true, side: THREE.DoubleSide })),
      line: new THREE.LineBasicMaterial({ color: 0xdddddd }),
    };
    shared.geo = { leg: shared.box(0.2, 0.85, 0.24).translate(0, -0.425, 0), torso: shared.box(0.46, 0.6, 0.26), head: shared.box(0.24, 0.26, 0.24), helm: shared.box(0.29, 0.14, 0.29), visor: shared.box(0.22, 0.06, 0.03), pack: shared.box(0.34, 0.42, 0.16), arm: shared.box(0.13, 0.52, 0.13).translate(0, -0.26, 0),
      canopy: paneledCanopy(THREE) };
    const lg = new THREE.BufferGeometry(), r = 2.4 * 1.3 * 0.97, pts = [];
    for (let i = 0; i < 8; i++) { const a = (i * Math.PI) / 4; pts.push(Math.cos(a) * r, 3.1, Math.sin(a) * r, Math.cos(a) * 0.18, 1.75, Math.sin(a) * 0.1); }
    lg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)); shared.geo.lines = lg;
    return shared;
  }
  function makeSoldier(THREE, p) {
    const S = share(THREE), o = p.outfit % PAL.length, root = new THREE.Group(), body = new THREE.Group(); root.add(body);
    const add = (parent, geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; parent.add(m); return m; };
    const mk = (parent, x, y, z) => { const g = new THREE.Group(); g.position.set(x, y, z); parent.add(g); return g; };
    const legL = mk(body, -0.12, 0.85, 0), legR = mk(body, 0.12, 0.85, 0);
    add(legL, S.geo.leg, S.pants[o], 0, 0, 0); add(legR, S.geo.leg, S.pants[o], 0, 0, 0);
    add(body, S.geo.torso, S.shirt[o], 0, 1.15, 0); add(body, S.geo.pack, S.dark, 0, 1.2, 0.2);
    add(body, S.geo.head, S.skin[p.id % SKINS.length], 0, 1.58, 0); add(body, S.geo.helm, S.helm[o], 0, 1.7, 0); add(body, S.geo.visor, S.dark, 0, 1.6, -0.13);
    const armL = mk(body, -0.3, 1.4, 0), armR = mk(body, 0.3, 1.4, 0);
    add(armL, S.geo.arm, S.shirt[o], 0, 0, 0); add(armR, S.geo.arm, S.shirt[o], 0, 0, 0);
    const holder = mk(body, 0.08, 1.2, -0.3);
    const canopy = new THREE.Group();
    const dome = new THREE.Mesh(S.geo.canopy, S.canopy[o]); dome.position.y = 3.1; canopy.add(dome); canopy.add(new THREE.LineSegments(S.geo.lines, S.line)); canopy.visible = false; root.add(canopy);
    return { root, body, legL, legR, armL, armR, holder, canopy, gunId: null, gun: null, phase: Math.random() * 6, x: p.x, y: p.y, z: p.z, yaw: p.yaw, lieT: 0 };
  }
  function setGun(THREE, a, id) {
    if (a.gunId === id) return;
    if (a.gun) a.holder.remove(a.gun);
    a.gunId = id; a.gun = id ? gunMesh(THREE, id) : null;
    if (a.gun) a.holder.add(a.gun);
  }
  // pose + move one soldier. p = sim player, now = sim time
  function poseSoldier(a, p, dt, now) {
    const k = 1 - Math.exp(-22 * dt);
    a.x += (p.x - a.x) * k; a.y += (p.y - a.y) * k; a.z += (p.z - a.z) * k;
    let dy = p.yaw - a.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy)); a.yaw += dy * Math.min(1, 18 * dt);
    a.root.position.set(a.x, a.y, a.z); a.root.rotation.y = a.yaw;
    const b = a.body, sp = Math.min(1, p.speed / 6);
    a.phase += p.speed * dt * 1.5;
    b.rotation.set(0, 0, 0); b.position.set(0, 0, 0); b.scale.set(1, 1, 1);
    a.canopy.visible = p.alive && p.air === 'chute';
    if (!p.alive) { // fall over
      a.lieT = Math.min(1, a.lieT + dt * 2.2); const e = a.lieT * a.lieT;
      b.rotation.x = -1.5 * e; b.position.y = 0.2 * e; b.position.z = 0.1 * e;
      a.legL.rotation.x = a.legR.rotation.x = 0.2; a.armL.rotation.x = a.armR.rotation.x = -0.4 * (1 - e);
      return;
    }
    a.lieT = 0;
    if (p.air === 'free') { b.rotation.x = -1.4; b.position.y = 1.2; a.legL.rotation.set(0.15, 0, 0.2); a.legR.rotation.set(0.15, 0, -0.2); a.armL.rotation.set(-0.3, 0, -1.3); a.armR.rotation.set(-0.3, 0, 1.3); a.holder.visible = false; return; }
    if (p.air === 'chute') { // hanging under the canopy: hands up on the lines, legs dangling
      a.holder.visible = false; a.legL.rotation.set(0.25, 0, 0.06); a.legR.rotation.set(0.15, 0, -0.06);
      a.armL.rotation.set(2.9, 0, -0.18); a.armR.rotation.set(2.9, 0, 0.18); return;
    }
    a.holder.visible = true;
    const sw = Math.sin(a.phase) * 0.75 * sp;
    a.legL.rotation.set(sw, 0, 0); a.legR.rotation.set(-sw, 0, 0);
    if (p.sit) { b.scale.y = 0.72; b.position.y = -0.02; a.legL.rotation.x = a.legR.rotation.x = 0.1; }
    const aim = 1.35 + p.pitch * 0.8; // +X rotation swings a hanging arm forward (-Z); z tilts the hands in towards the gun
    a.armL.rotation.set(aim, 0, 0.5); a.armR.rotation.set(aim, 0, -0.4);
    a.holder.rotation.x = p.pitch * 0.8;
    if (p.healT > 0 || p.reloadT > 0) { a.armL.rotation.x -= 0.5; a.armR.rotation.x -= 0.5; }
    if (p.air === 'chute') { a.legL.rotation.x = a.legR.rotation.x = 0.1; }
  }

  // ------------------------------------------------------------------ the drop plane (forward = -Z)
  function makePlane(THREE) {
    const M = THREE.Matrix4, WHITE = 0xe9edf0, GREY = 0xa9b3bb, DARK = 0x1f2b34, ORANGE = 0xff7a1a, METAL = 0x6c757c;
    const B = (w, h, d, x, y, z, hex) => ({ g: new THREE.BoxGeometry(w, h, d), m: new M().makeTranslation(x, y, z), hex });
    const Cy = (rTop, rBot, len, x, y, z, hex) => ({ g: new THREE.CylinderGeometry(rTop, rBot, len, 16), m: new M().makeRotationX(Math.PI / 2).setPosition(x, y, z), hex }); // top = +Z (tail), bottom = -Z (nose)
    const parts = [
      Cy(1.5, 1.5, 15, 0, 0, 0, WHITE), Cy(1.5, 0.45, 4.2, 0, 0, -9.6, WHITE), Cy(0.5, 1.5, 5.4, 0, 0.35, 10.2, WHITE),
      Cy(1.53, 1.53, 1.3, 0, 0, -1.2, ORANGE),
      B(2.1, 0.55, 1.3, 0, 0.62, -7.4, DARK),
      B(26, 0.38, 3.8, 0, 1.25, -0.6, GREY), B(26.2, 0.1, 0.9, 0, 1.28, -2.4, ORANGE),
      B(0.34, 3.4, 3.0, 0, 3.0, 10.9, WHITE), B(0.36, 1.3, 1.7, 0, 3.7, 11.2, ORANGE), B(9, 0.26, 2.0, 0, 1.4, 11.2, GREY),
      Cy(0.5, 0.5, 2.8, -6.6, 0.55, -1.3, METAL), Cy(0.5, 0.5, 2.8, 6.6, 0.55, -1.3, METAL), Cy(0.5, 0.5, 2.8, -10.2, 0.55, -1.3, METAL), Cy(0.5, 0.5, 2.8, 10.2, 0.55, -1.3, METAL),
      B(0.25, 1.1, 1.0, 0, -1.6, 0.2, DARK), B(3.2, 0.2, 0.3, 0, -2.1, 0.2, DARK),
    ];
    for (let i = 0; i < 6; i++) parts.push(B(3.06, 0.36, 0.55, 0, 0.35, -4.6 + i * 1.7, DARK)); // window band
    const root = new THREE.Group(), body = new THREE.Mesh(BR.RenderWorld.mergeParts(THREE, parts), new THREE.MeshLambertMaterial({ vertexColors: true }));
    root.add(body); root.scale.set(1.25, 1.25, 1.25);
    const props = [], bm = new THREE.MeshLambertMaterial({ color: new THREE.Color(0x222a30).convertSRGBToLinear(), side: THREE.DoubleSide });
    for (const x of [-10.2, -6.6, 6.6, 10.2]) {
      const g = new THREE.Group(); g.position.set(x, 0.55, -2.85);
      g.add(new THREE.Mesh(new THREE.BoxGeometry(0.22, 3.0, 0.07), bm)); const b2 = new THREE.Mesh(new THREE.BoxGeometry(3.0, 0.22, 0.07), bm); g.add(b2);
      root.add(g); props.push(g);
    }
    root.visible = false;
    return { root, props };
  }

  // ------------------------------------------------------------------ loot on the ground
  const BEAM = { ammo: 0xffd54f, medkit: 0xff5252, armor: 0x40c4ff };
  function makePickup(THREE, k) {
    const g = new THREE.Group(), inner = new THREE.Group(); g.add(inner);
    let color = BEAM[k.kind] || 0xffffff;
    const mat = (hex) => new THREE.MeshLambertMaterial({ color: new THREE.Color(hex).convertSRGBToLinear() });
    const box = (w, h, d, hex, x, y, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(hex)); m.position.set(x || 0, y || 0, z || 0); inner.add(m); };
    if (k.kind === 'weapon') {
      const def = CFG.WEAPONS[k.w]; color = parseInt(CFG.RARITY_COLORS[def.tier].slice(1), 16);
      const gm = gunMesh(THREE, k.w); gm.scale.set(1.7, 1.7, 1.7); gm.position.z = (gm.userData.len / 2) * 1.7; inner.add(gm);
    } else if (k.kind === 'ammo') { box(0.38, 0.22, 0.26, 0x5a6b3a); box(0.39, 0.05, 0.27, 0xffd54f, 0, 0.05, 0); }
    else if (k.kind === 'medkit') { box(0.42, 0.28, 0.28, 0xf2f2f2); box(0.24, 0.07, 0.29, 0xd32f2f); box(0.07, 0.24, 0.29, 0xd32f2f); }
    else { box(0.42, 0.46, 0.16, 0x2f6fb5); box(0.3, 0.12, 0.17, 0x1d4a80, 0, 0.1, 0); }
    inner.position.y = 0.55;
    const bm = new THREE.MeshBasicMaterial({ color: new THREE.Color(color), transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.16, 9, 8, 1, true).translate(0, 4.5, 0), bm); g.add(beam);
    const disc = new THREE.Mesh(new THREE.CircleGeometry(0.55, 16).rotateX(-Math.PI / 2), bm); disc.position.y = 0.05; g.add(disc);
    g.position.set(k.x, k.y, k.z);
    return { g, inner };
  }

  // ------------------------------------------------------------------ effects: flashes, tracers, particles
  function flashTexture(THREE) {
    const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 30); gr.addColorStop(0, 'rgba(255,255,230,1)'); gr.addColorStop(0.3, 'rgba(255,200,90,0.9)'); gr.addColorStop(1, 'rgba(255,120,20,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64); g.strokeStyle = 'rgba(255,230,160,0.9)'; g.lineWidth = 3;
    for (let i = 0; i < 4; i++) { const a = (i * Math.PI) / 4; g.beginPath(); g.moveTo(32 - Math.cos(a) * 30, 32 - Math.sin(a) * 30); g.lineTo(32 + Math.cos(a) * 30, 32 + Math.sin(a) * 30); g.stroke(); }
    return new THREE.CanvasTexture(c);
  }
  class Effects {
    constructor(THREE, scene) {
      this.T = THREE; this.scene = scene;
      this.flashTex = flashTexture(THREE);
      // tracers
      this.tr = []; const tm = new THREE.MeshBasicMaterial({ color: 0xffe3a0, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
      const tg = new THREE.BoxGeometry(0.035, 0.035, 1).translate(0, 0, 0.5); // Mesh.lookAt() points +Z at the target, so the bar extends along +Z
      for (let i = 0; i < 28; i++) { const m = new THREE.Mesh(tg, tm); m.visible = false; m.frustumCulled = false; scene.add(m); this.tr.push({ m, t: 0, life: 0, a: new THREE.Vector3(), b: new THREE.Vector3(), len: 0 }); }
      // particles
      this.N = 360; this.pp = new Float32Array(this.N * 3); this.pc = new Float32Array(this.N * 3); this.pv = new Float32Array(this.N * 3); this.pl = new Float32Array(this.N); this.pi = 0;
      for (let i = 0; i < this.N; i++) this.pp[i * 3 + 1] = -1000;
      const g = new THREE.BufferGeometry(); this.pa = new THREE.BufferAttribute(this.pp, 3); this.ca = new THREE.BufferAttribute(this.pc, 3);
      g.setAttribute('position', this.pa); g.setAttribute('color', this.ca);
      this.pts = new THREE.Points(g, new THREE.PointsMaterial({ size: 0.16, vertexColors: true, transparent: true, depthWrite: false, opacity: 0.95 }));
      this.pts.frustumCulled = false; scene.add(this.pts);
      // flashes for other soldiers
      this.fl = []; const fm = new THREE.SpriteMaterial({ map: this.flashTex, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false });
      for (let i = 0; i < 8; i++) { const s = new THREE.Sprite(fm); s.visible = false; scene.add(s); this.fl.push({ s, life: 0 }); }
      this.fi = 0; this.ti = 0;
    }
    tracer(ax, ay, az, bx, by, bz) {
      const t = this.tr[this.ti++ % this.tr.length], dx = bx - ax, dy = by - ay, dz = bz - az, d = Math.hypot(dx, dy, dz);
      if (d < 1) return;
      t.a.set(ax, ay, az); t.b.set(bx, by, bz); t.len = d; t.t = 0; t.life = Math.max(0.07, d / 320);
      t.m.visible = true; t.m.position.copy(t.a); t.m.lookAt(t.b);
    }
    flash(x, y, z) { const f = this.fl[this.fi++ % this.fl.length]; f.s.position.set(x, y, z); f.s.scale.setScalar(0.5 + Math.random() * 0.4); f.life = 0.06; f.s.visible = true; }
    burst(x, y, z, role, n) {
      const cols = { ground: [0.45, 0.36, 0.22], wood: [0.62, 0.45, 0.25], rock: [0.7, 0.7, 0.7], box: [1, 0.8, 0.45], cyl: [0.7, 0.55, 0.3], body: [0.85, 0.1, 0.1] };
      const c = cols[role] || cols.box, sp = role === 'body' ? 2.2 : 3.2;
      for (let k = 0; k < (n || 8); k++) {
        const i = this.pi++ % this.N;
        this.pp[i * 3] = x; this.pp[i * 3 + 1] = y; this.pp[i * 3 + 2] = z;
        this.pv[i * 3] = (Math.random() - 0.5) * sp; this.pv[i * 3 + 1] = Math.random() * sp * 0.9; this.pv[i * 3 + 2] = (Math.random() - 0.5) * sp;
        const v = 0.75 + Math.random() * 0.4; this.pc[i * 3] = c[0] * v; this.pc[i * 3 + 1] = c[1] * v; this.pc[i * 3 + 2] = c[2] * v; this.pl[i] = 0.35 + Math.random() * 0.35;
      }
    }
    update(dt) {
      for (const t of this.tr) {
        if (!t.m.visible) continue;
        t.t += dt; const k = t.t / t.life;
        if (k >= 1) { t.m.visible = false; continue; }
        const seg = Math.min(t.len, 9), head = Math.min(t.len, k * t.len + seg * 0.5), tail = Math.max(0, head - seg), dx = (t.b.x - t.a.x) / t.len, dy = (t.b.y - t.a.y) / t.len, dz = (t.b.z - t.a.z) / t.len;
        t.m.position.set(t.a.x + dx * tail, t.a.y + dy * tail, t.a.z + dz * tail); t.m.scale.z = Math.max(0.1, head - tail);
      }
      for (const f of this.fl) if (f.s.visible) { f.life -= dt; if (f.life <= 0) f.s.visible = false; }
      let any = false;
      for (let i = 0; i < this.N; i++) {
        if (this.pl[i] <= 0) continue; any = true;
        this.pl[i] -= dt;
        if (this.pl[i] <= 0) { this.pp[i * 3 + 1] = -1000; continue; }
        this.pv[i * 3 + 1] -= 9 * dt;
        this.pp[i * 3] += this.pv[i * 3] * dt; this.pp[i * 3 + 1] += this.pv[i * 3 + 1] * dt; this.pp[i * 3 + 2] += this.pv[i * 3 + 2] * dt;
      }
      if (any) { this.pa.needsUpdate = true; this.ca.needsUpdate = true; }
    }
  }

  BR.Actors = { gunMesh, makeSoldier, setGun, poseSoldier, makePickup, makePlane, Effects, flashTexture };
})(window);
