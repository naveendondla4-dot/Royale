/* render_world.js - builds the static 3D world from the generated map data:
 * sky, sun, terrain, buildings, trees, rocks, bushes, grass, clouds.
 * Colours: material/vertex colours are converted to linear (the renderer outputs sRGB);
 * sky + fog colours are written as plain sRGB because they are mixed after the output conversion. */
(function (G) {
  'use strict';
  const BR = (G.BR = G.BR || {});
  const sstep = BR.World.sstep;
  const rgb = (hex) => [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
  const lin = (c) => [Math.pow(c[0], 2.2), Math.pow(c[1], 2.2), Math.pow(c[2], 2.2)];
  const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];

  function grainTexture(THREE, size, lo, hi, seed, blotches) {
    const cv = document.createElement('canvas'); cv.width = cv.height = size;
    const g = cv.getContext('2d'), rnd = BR.World.mulberry32(seed);
    g.fillStyle = 'rgb(' + hi + ',' + hi + ',' + hi + ')'; g.fillRect(0, 0, size, size);
    for (let i = 0; i < (size * size) / 6; i++) { const v = (lo + (hi - lo) * rnd()) | 0; g.fillStyle = 'rgba(' + v + ',' + v + ',' + v + ',0.5)'; g.fillRect(rnd() * size, rnd() * size, 1 + rnd() * 2, 1 + rnd() * 2); }
    for (let i = 0; i < blotches; i++) {
      const v = (lo + (hi - lo) * rnd()) | 0, r = 8 + rnd() * 30, x = rnd() * size, y = rnd() * size, gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, 'rgba(' + v + ',' + v + ',' + v + ',0.35)'); gr.addColorStop(1, 'rgba(' + v + ',' + v + ',' + v + ',0)');
      g.fillStyle = gr; g.fillRect(x - r, y - r, 2 * r, 2 * r);
    }
    const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.encoding = THREE.sRGBEncoding; t.anisotropy = 4;
    return t;
  }

  // lit material: per-pixel PBR on "high", cheaper per-vertex Lambert otherwise
  function litMat(THREE, q, o) { return q.std ? new THREE.MeshStandardMaterial(Object.assign({ roughness: 0.92, metalness: 0 }, o)) : new THREE.MeshLambertMaterial(o); }

  // ------------------------------------------------------------------ box batch: many boxes -> one geometry
  const FACES = [
    { n: [0, 1, 0], c: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]], k: 'top' },
    { n: [0, -1, 0], c: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], k: 'bot' },
    { n: [1, 0, 0], c: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]], k: 'x' },
    { n: [-1, 0, 0], c: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]], k: 'x' },
    { n: [0, 0, 1], c: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], k: 'z' },
    { n: [0, 0, -1], c: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]], k: 'z' },
  ];
  class BoxBatch {
    constructor() { this.p = []; this.n = []; this.uv = []; this.c = []; this.i = []; this.v = 0; }
    add(x0, y0, z0, x1, y1, z1, side, top) {
      top = top || side;
      const tall = y1 - y0 > 0.9;
      for (const f of FACES) {
        for (const c of f.c) {
          const x = c[0] ? x1 : x0, y = c[1] ? y1 : y0, z = c[2] ? z1 : z0;
          this.p.push(x, y, z); this.n.push(f.n[0], f.n[1], f.n[2]);
          if (f.k === 'x') this.uv.push(z * 0.25, y * 0.25); else if (f.k === 'z') this.uv.push(x * 0.25, y * 0.25); else this.uv.push(x * 0.25, z * 0.25);
          const base = f.k === 'top' ? top : side, sh = f.k === 'bot' ? 0.55 : f.k === 'top' ? 1 : tall ? 0.8 + 0.2 * c[1] : 1;
          this.c.push(base[0] * sh, base[1] * sh, base[2] * sh);
        }
        const v = this.v; this.i.push(v, v + 1, v + 2, v, v + 2, v + 3); this.v += 4;
      }
    }
    geometry(THREE, colors) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.p), 3));
      g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(this.n), 3));
      g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(this.uv), 2));
      if (colors) g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(this.c), 3));
      g.setIndex(new THREE.BufferAttribute(this.v > 65000 ? new Uint32Array(this.i) : new Uint16Array(this.i), 1));
      g.computeBoundingSphere();
      return g;
    }
  }

  // merge several primitive geometries (with a baked colour) into one flat-shaded geometry
  function mergeParts(THREE, parts) {
    const gs = parts.map((p) => { let g = p.g.index ? p.g.toNonIndexed() : p.g.clone(); g.applyMatrix4(p.m); if (!p.smooth) g.computeVertexNormals(); return { g, c: lin(rgb(p.hex)) }; });
    let n = 0; gs.forEach((o) => (n += o.g.attributes.position.count));
    const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3);
    let o = 0;
    for (const e of gs) {
      const cnt = e.g.attributes.position.count;
      pos.set(e.g.attributes.position.array, o * 3); nor.set(e.g.attributes.normal.array, o * 3);
      for (let i = 0; i < cnt; i++) col.set(e.c, (o + i) * 3);
      o += cnt;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.computeBoundingSphere();
    return g;
  }

  // ------------------------------------------------------------------ terrain
  function buildTerrain(THREE, W, q, tex) {
    const st = q.stride, vn = W.N / st + 1, G1 = W.G1;
    const pos = new Float32Array(vn * vn * 3), uv = new Float32Array(vn * vn * 2), col = new Float32Array(vn * vn * 3);
    for (let j = 0; j < vn; j++) {
      for (let i = 0; i < vn; i++) {
        const k = j * vn + i, x = -W.EXT + i * st * W.CELL, z = -W.EXT + j * st * W.CELL;
        pos[k * 3] = x; pos[k * 3 + 1] = W.heights[j * st * G1 + i * st]; pos[k * 3 + 2] = z; uv[k * 2] = x / 9; uv[k * 2 + 1] = z / 9;
      }
    }
    const idx = new (vn * vn > 65000 ? Uint32Array : Uint16Array)((vn - 1) * (vn - 1) * 6);
    let o = 0;
    for (let j = 0; j < vn - 1; j++) for (let i = 0; i < vn - 1; i++) { const a = j * vn + i, b = a + 1, c = a + vn, d = c + 1; idx[o++] = a; idx[o++] = c; idx[o++] = b; idx[o++] = b; idx[o++] = c; idx[o++] = d; }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(new THREE.BufferAttribute(idx, 1)); g.computeVertexNormals();
    const ny = g.attributes.normal.array;
    const grassA = rgb(0x4a9433), grassB = rgb(0x7dba4c), dry = rgb(0xa3a352), rock = rgb(0x80776a), snow = rgb(0xdfe3e8), road = rgb(0xa08e6e), plaza = rgb(0x93856a);
    for (let k = 0; k < vn * vn; k++) {
      const x = pos[k * 3], y = pos[k * 3 + 1], z = pos[k * 3 + 2];
      let c = mix(grassA, grassB, sstep(0.35, 0.68, BR.World.fbm(x * 0.021, z * 0.021, W.seed + 11, 3)));
      c = mix(c, dry, sstep(0.58, 0.8, BR.World.fbm(x * 0.009, z * 0.009, W.seed + 31, 2)) * 0.7);
      c = mul(c, 0.9 + 0.2 * BR.World.fbm(x * 0.35, z * 0.35, W.seed + 5, 2));
      const slope = 1 - ny[k * 3 + 1];
      c = mix(c, rock, Math.max(sstep(0.16, 0.4, slope), sstep(13, 26, y)));
      c = mix(c, snow, sstep(36, 46, y));
      const rd = W.roadDist(x, z);
      if (rd < 3.8) c = mix(c, road, 1 - sstep(1.8, 3.8, rd));
      for (const b of W.buildings) { const d = Math.hypot(Math.max(Math.abs(x - b.x) - b.w / 2, 0), Math.max(Math.abs(z - b.z) - b.d / 2, 0)); if (d < 5) c = mix(c, plaza, (1 - sstep(1.5, 5, d)) * 0.8); }
      const l = lin(c); col[k * 3] = l[0]; col[k * 3 + 1] = l[1]; col[k * 3 + 2] = l[2];
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const m = litMat(THREE, q, { vertexColors: true, map: tex });
    const mesh = new THREE.Mesh(g, m); mesh.receiveShadow = true;
    return mesh;
  }

  // ------------------------------------------------------------------ buildings (one mesh for the whole town set)
  function buildBuildings(THREE, W, q, tex) {
    const solid = new BoxBatch(), glass = new BoxBatch();
    const R = { wood: 0x7a5233, crate: 0xa7743e, barrel: 0x2f5f8f, metal: 0x8a98a3, foundation: 0x77746e, glass: 0x9ed8ff };
    const conv = (role, pal, v) => {
      let s, t;
      if (role === 'wall') { s = rgb(pal.wall); t = mul(s, 0.9); }
      else if (role === 'trim') { s = rgb(pal.trim); t = s; }
      else if (role === 'roof') { s = rgb(pal.trim); t = rgb(pal.roof); }
      else if (role === 'parapet') { s = mul(rgb(pal.wall), 0.85); t = rgb(pal.trim); }
      else if (role === 'floor') { s = rgb(pal.floor); t = s; }
      else if (role === 'crate') { s = rgb(R.crate); t = mul(s, 1.12); }
      else if (role === 'barrel') { s = rgb(R.barrel); t = mul(s, 1.2); }
      else { s = rgb(R[role] || 0x999999); t = s; }
      return [lin(mul(s, v)), lin(mul(t, v))];
    };
    for (const b of W.buildings) {
      const v = 0.93 + ((b.id * 37) % 13) / 100;
      for (const arr of [b.boxes, b.decor]) for (const x of arr) { const c = conv(x.role, b.pal, v); solid.add(x.minX, x.minY, x.minZ, x.maxX, x.maxY, x.maxZ, c[0], c[1]); }
      for (const x of b.glass) glass.add(x.minX, x.minY, x.minZ, x.maxX, x.maxY, x.maxZ, [1, 1, 1]);
    }
    for (const x of W.props) { const c = conv(x.role, { wall: 0, trim: 0, roof: 0, floor: 0 }, 1); solid.add(x.minX, x.minY, x.minZ, x.maxX, x.maxY, x.maxZ, c[0], c[1]); }
    const m = litMat(THREE, q, { vertexColors: true, map: tex });
    const mesh = new THREE.Mesh(solid.geometry(THREE, true), m); mesh.castShadow = q.shadows; mesh.receiveShadow = true;
    const gm = new THREE.Mesh(glass.geometry(THREE, false), new THREE.MeshPhongMaterial({ color: R.glass, transparent: true, opacity: 0.32, shininess: 90, specular: 0xffffff, depthWrite: false }));
    return [mesh, gm];
  }

  // ------------------------------------------------------------------ trees / rocks / bushes / grass
  function instanced(THREE, geo, mat, list, place, tint, shadow) {
    const im = new THREE.InstancedMesh(geo, mat, Math.max(1, list.length)), d = new THREE.Object3D(), c = new THREE.Color();
    list.forEach((o, i) => {
      place(d, o); d.updateMatrix(); im.setMatrixAt(i, d.matrix);
      const t = tint(o); c.setRGB(t[0], t[1], t[2]); im.setColorAt(i, c);
    });
    im.count = list.length; im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true;
    im.frustumCulled = false; im.castShadow = !!shadow; im.receiveShadow = false;
    return im;
  }
  function buildNature(THREE, W, q, scene) {
    const M4 = THREE.Matrix4, mk = (x, y, z) => new M4().makeTranslation(x, y, z);
    const pine = mergeParts(THREE, [
      { g: new THREE.CylinderGeometry(0.16, 0.26, 3.4, 6), m: mk(0, 1.7, 0), hex: 0x5b3d26 },
      { g: new THREE.ConeGeometry(2.3, 3.4, 7), m: mk(0, 2.4 + 1.7, 0), hex: 0x2c6733 },
      { g: new THREE.ConeGeometry(1.8, 3.0, 7), m: mk(0, 4.4 + 1.5, 0), hex: 0x337638 },
      { g: new THREE.ConeGeometry(1.2, 2.6, 7), m: mk(0, 6.2 + 1.3, 0), hex: 0x3d8841 },
    ]);
    const oak = mergeParts(THREE, [
      { g: new THREE.CylinderGeometry(0.22, 0.34, 2.8, 6), m: mk(0, 1.4, 0), hex: 0x6a4a2d },
      { g: new THREE.IcosahedronGeometry(1.9, 0), m: mk(0, 4.0, 0), hex: 0x5f9f3f },
      { g: new THREE.IcosahedronGeometry(1.4, 0), m: mk(1.1, 3.3, 0.4), hex: 0x6fb04a },
      { g: new THREE.IcosahedronGeometry(1.5, 0), m: mk(-1.0, 4.6, -0.5), hex: 0x4f8f36 },
      { g: new THREE.IcosahedronGeometry(1.1, 0), m: mk(0.2, 5.4, 0.3), hex: 0x7cc055 },
    ]);
    const treeMat = litMat(THREE, q, { vertexColors: true });
    const pines = W.trees.filter((t) => t.type === 0), oaks = W.trees.filter((t) => t.type === 1);
    const tPlace = (d, t) => { d.position.set(t.x, t.y - 0.15, t.z); d.rotation.set(0, t.ry, 0); d.scale.set(t.s, t.s * (0.9 + t.tint * 0.3), t.s); };
    const tTint = (t) => { const k = 0.82 + t.tint * 0.3; return [k, k * (0.95 + t.tint * 0.1), k * 0.95]; };
    scene.add(instanced(THREE, pine, treeMat, pines, tPlace, tTint, q.shadows));
    scene.add(instanced(THREE, oak, treeMat, oaks, tPlace, tTint, q.shadows));

    // rocks: jittered icosahedron, flat shaded
    const rg = new THREE.IcosahedronGeometry(1, 1), rp = rg.attributes.position, rr = BR.World.mulberry32(W.seed + 77);
    for (let i = 0; i < rp.count; i++) { const k = 0.8 + rr() * 0.45; rp.setXYZ(i, rp.getX(i) * k * 1.15, rp.getY(i) * k * 0.78, rp.getZ(i) * k); }
    const rock = mergeParts(THREE, [{ g: rg, m: new M4(), hex: 0x8b8880 }]);
    scene.add(instanced(THREE, rock, litMat(THREE, q, { vertexColors: true }), W.rocks, (d, r) => { d.position.set(r.x, r.y + 0.25 * r.s, r.z); d.rotation.set(0, r.ry, 0); d.scale.set(r.s, r.s, r.s); }, (r) => { const k = 0.75 + r.tint * 0.4; return [k, k, k * 0.97]; }, q.shadows));

    const bush = mergeParts(THREE, [{ g: new THREE.IcosahedronGeometry(0.85, 1), m: new M4().makeScale(1.25, 0.8, 1.25).setPosition(0, 0.5, 0), hex: 0x3f8f3a }]);
    scene.add(instanced(THREE, bush, litMat(THREE, q, { vertexColors: true }), W.bushes, (d, b) => { d.position.set(b.x, b.y - 0.1, b.z); d.rotation.set(0, b.tint * 6, 0); d.scale.set(b.s, b.s, b.s); }, (b) => { const k = 0.75 + b.tint * 0.5; return [k * 0.9, k, k * 0.8]; }, false));

    // grass tufts
    if (q.grass > 0) {
      const pa = [], ca = [];
      for (let k = 0; k < 3; k++) {
        const a = (k * Math.PI) / 3, cx = Math.cos(a), sz = Math.sin(a);
        pa.push(-0.1 * cx, 0, -0.1 * sz, 0.1 * cx, 0, 0.1 * sz, 0, 0.62, 0);
        ca.push(0.45, 0.6, 0.3, 0.45, 0.6, 0.3, 0.95, 1.1, 0.7);
      }
      const gg = new THREE.BufferGeometry();
      gg.setAttribute('position', new THREE.Float32BufferAttribute(pa, 3)); gg.setAttribute('color', new THREE.Float32BufferAttribute(ca.map((v) => Math.pow(v, 2.2)), 3));
      gg.computeVertexNormals();
      const rnd = BR.World.mulberry32(W.seed + 123), list = [];
      for (let tries = 0; tries < q.grass * 3 && list.length < q.grass; tries++) {
        const x = (rnd() * 2 - 1) * (W.half - 3), z = (rnd() * 2 - 1) * (W.half - 3);
        if (W.buildingAt(x, z) || W.roadDist(x, z) < 3) continue;
        const y = W.heightAt(x, z); if (y > 24) continue;
        list.push({ x, y, z, s: 0.7 + rnd() * 0.9, tint: rnd() });
      }
      const gm = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
      scene.add(instanced(THREE, gg, gm, list, (d, o) => { d.position.set(o.x, o.y, o.z); d.rotation.set(0, o.tint * 25, 0); d.scale.set(o.s, o.s * (0.8 + o.tint * 0.6), o.s); }, (o) => { const k = 0.7 + o.tint * 0.6; return [k * 0.9, k, k * 0.7]; }, false));
    }
  }

  // ------------------------------------------------------------------ sky, sun, clouds
  function buildSky(THREE, scene, q) {
    const sunDir = new THREE.Vector3(-0.45, 0.62, -0.5).normalize();
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { top: { value: new THREE.Color(0x2f78d0) }, mid: { value: new THREE.Color(0x78b4ea) }, hor: { value: new THREE.Color(q.fogColor) }, sunDir: { value: sunDir } },
      vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'uniform vec3 top; uniform vec3 mid; uniform vec3 hor; uniform vec3 sunDir; varying vec3 vP;' +
        'void main(){ float h = vP.y; vec3 up = mix(mid, top, smoothstep(0.15, 0.85, h)); vec3 c = mix(hor, up, smoothstep(0.0, 0.4, h)); if (h < 0.0) c = hor;' +
        'float s = max(dot(normalize(vP), sunDir), 0.0); c += vec3(1.0,0.86,0.62) * (pow(s, 900.0) * 3.0 + pow(s, 14.0) * 0.28); gl_FragColor = vec4(c, 1.0); }',
    });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(Math.min(900, q.far * 0.92), 32, 16), mat); // must stay inside the camera far plane, otherwise a black hole is cut out of the sky
    sky.frustumCulled = false; sky.renderOrder = -10; scene.add(sky);
    return { sky, sunDir };
  }
  function buildClouds(THREE, scene, W) {
    const rnd = BR.World.mulberry32(W.seed + 901), cloudMat = new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x9aa7b8, transparent: true, opacity: 0.92, fog: false });
    const geo = new THREE.IcosahedronGeometry(1, 1), clouds = [];
    for (let i = 0; i < 16; i++) {
      const grp = new THREE.Group();
      for (let k = 0; k < 5; k++) { const m = new THREE.Mesh(geo, cloudMat); const s = 14 + rnd() * 16; m.scale.set(s * 1.6, s * 0.55, s); m.position.set((k - 2) * 20 + rnd() * 10, rnd() * 6, rnd() * 16 - 8); grp.add(m); }
      grp.position.set((rnd() * 2 - 1) * 650, 190 + rnd() * 70, (rnd() * 2 - 1) * 650); grp.userData.sp = 2 + rnd() * 3; scene.add(grp); clouds.push(grp);
    }
    return clouds;
  }

  // ------------------------------------------------------------------ public
  function build(THREE, scene, W, q, log) {
    const out = { clouds: [] };
    const run = (name, fn) => { try { return fn(); } catch (e) { if (log) log(name + ': ' + e.message); console.error(name, e); } };
    const ground = grainTexture(THREE, 256, 205, 255, 11, 40), walls = grainTexture(THREE, 128, 215, 255, 12, 8);
    const sk = run('sky', () => buildSky(THREE, scene, q)); if (sk) { out.sky = sk.sky; out.sunDir = sk.sunDir; }
    run('terrain', () => scene.add(buildTerrain(THREE, W, q, ground)));
    run('buildings', () => buildBuildings(THREE, W, q, walls).forEach((m) => scene.add(m)));
    run('nature', () => buildNature(THREE, W, q, scene));
    if (q.clouds) out.clouds = run('clouds', () => buildClouds(THREE, scene, W)) || [];
    return out;
  }
  BR.RenderWorld = { build, BoxBatch, grainTexture, mergeParts, litMat, rgb, lin };
})(window);
