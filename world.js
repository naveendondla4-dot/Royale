/* world.js - deterministic map generator + collision queries.
 * generate(seed) always returns the same map for the same seed, so a server and every client agree.
 * No THREE / DOM in here. */
(function (G) {
  'use strict';
  const BR = (G.BR = G.BR || {});
  const CFG = BR.CFG;

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hash2(ix, iz, s) {
    let h = Math.imul(ix, 374761393) ^ Math.imul(iz, 668265263) ^ Math.imul(s, 2147483647);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }
  const sstep = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  function vnoise(x, z, s) {
    const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz;
    const u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
    const a = hash2(ix, iz, s), b = hash2(ix + 1, iz, s), c = hash2(ix, iz + 1, s), d = hash2(ix + 1, iz + 1, s);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
  function fbm(x, z, s, oct) {
    let a = 1, f = 1, sum = 0, n = 0;
    for (let i = 0; i < oct; i++) { sum += vnoise(x * f, z * f, s + i * 101) * a; n += a; a *= 0.5; f *= 2.03; }
    return sum / n;
  }

  // ---- ray helpers (direction must be normalised, t = distance)
  function rayBox(c, ox, oy, oz, dx, dy, dz) {
    let tmin = 0, tmax = 1e9;
    if (Math.abs(dx) < 1e-9) { if (ox < c.minX || ox > c.maxX) return -1; }
    else { let a = (c.minX - ox) / dx, b = (c.maxX - ox) / dx; if (a > b) { const t = a; a = b; b = t; } if (a > tmin) tmin = a; if (b < tmax) tmax = b; if (tmin > tmax) return -1; }
    if (Math.abs(dy) < 1e-9) { if (oy < c.minY || oy > c.maxY) return -1; }
    else { let a = (c.minY - oy) / dy, b = (c.maxY - oy) / dy; if (a > b) { const t = a; a = b; b = t; } if (a > tmin) tmin = a; if (b < tmax) tmax = b; if (tmin > tmax) return -1; }
    if (Math.abs(dz) < 1e-9) { if (oz < c.minZ || oz > c.maxZ) return -1; }
    else { let a = (c.minZ - oz) / dz, b = (c.maxZ - oz) / dz; if (a > b) { const t = a; a = b; b = t; } if (a > tmin) tmin = a; if (b < tmax) tmax = b; if (tmin > tmax) return -1; }
    return tmin > 0.0001 ? tmin : -1; // origin inside the box -> ignore
  }
  function rayCyl(c, ox, oy, oz, dx, dy, dz) {
    const ax = ox - c.x, az = oz - c.z, a = dx * dx + dz * dz;
    if (a < 1e-9) return -1;
    const cc = ax * ax + az * az - c.r * c.r;
    if (cc < 0) return -1;
    const b = ax * dx + az * dz, disc = b * b - a * cc;
    if (disc < 0) return -1;
    const t = (-b - Math.sqrt(disc)) / a;
    if (t < 0.0001) return -1;
    const y = oy + dy * t;
    return y < c.y0 || y > c.y1 ? -1 : t;
  }

  const CELL = 3.2; // terrain cell size (m)
  const CS = 16; // collision grid cell size (m)

  function generate(seed) {
    seed = seed | 0 || 1337;
    const rng = mulberry32(seed);
    const half = CFG.MAP / 2, EXT = half + 64, N = Math.round((EXT * 2) / CELL), G1 = N + 1;
    const W = { seed, half, EXT, N, CELL, G1, buildings: [], towns: [], roads: [], trees: [], rocks: [], bushes: [], props: [], lootSpots: [], cols: [] };

    const rawH = (x, z) => {
      let h = (fbm(x * 0.0042, z * 0.0042, seed, 4) - 0.5) * 22 + (fbm(x * 0.018, z * 0.018, seed + 7, 2) - 0.5) * 3.2;
      h += sstep(0.9, 1.15, Math.max(Math.abs(x), Math.abs(z)) / half) * 42; // mountains around the map
      return h;
    };

    // ---- towns (flat plateaus) and buildings
    const names = ['Pine Village', 'Red Ridge', 'Old Mill', 'Sunset Farm', 'Iron Yard'];
    for (const name of names) {
      for (let k = 0; k < 900; k++) {
        const x = (rng() * 2 - 1) * (half - 110), z = (rng() * 2 - 1) * (half - 110);
        if (W.towns.every((t) => Math.hypot(t.x - x, z - t.z) > 165)) { W.towns.push({ name, x, z, r: 50, floorY: rawH(x, z) }); break; }
      }
    }
    const rects = [];
    const place = (kind, x, z, fy, town) => {
      const sz = BR.Buildings.size(kind, rng);
      if (Math.abs(x) + sz.w / 2 > half - 16 || Math.abs(z) + sz.d / 2 > half - 16) return false;
      for (const r of rects) if (Math.abs(r.x - x) < (r.w + sz.w) / 2 + 10 && Math.abs(r.z - z) < (r.d + sz.d) / 2 + 10) return false;
      const b = BR.Buildings.make(rng, kind, x, z, fy, sz);
      b.id = W.buildings.length; b.town = town;
      b.decor.push({ minX: b.x0 - 0.15, minY: fy - 3, minZ: b.z0 - 0.15, maxX: b.x1 + 0.15, maxY: fy + 0.02, maxZ: b.z1 + 0.15, role: 'foundation' });
      W.buildings.push(b); rects.push({ x, z, w: sz.w, d: sz.d });
      return true;
    };
    W.towns.forEach((t, ti) => {
      const n = 5 + ((rng() * 3) | 0);
      for (let i = 0, tries = 0; i < n && tries < 150; tries++) {
        const kind = i < 3 ? 'house' : ['house', 'house', 'cabin', 'barn'][(rng() * 4) | 0];
        const a = rng() * 6.283, r = 8 + Math.sqrt(rng()) * 38;
        if (place(kind, t.x + Math.cos(a) * r, t.z + Math.sin(a) * r, t.floorY, ti)) i++;
      }
    });
    const scattered = [];
    for (let i = 0, tries = 0; i < 11 && tries < 400; tries++) {
      const x = (rng() * 2 - 1) * (half - 40), z = (rng() * 2 - 1) * (half - 40);
      if (W.towns.some((t) => Math.hypot(t.x - x, t.z - z) < 105) || scattered.some((s) => Math.hypot(s.x - x, s.z - z) < 45)) continue;
      if (place(rng() < 0.7 ? 'cabin' : 'barn', x, z, rawH(x, z), -1)) { scattered.push({ x, z }); i++; }
    }

    // ---- height grid (towns + isolated buildings are flattened)
    const hg = new Float32Array(G1 * G1);
    const lone = W.buildings.filter((b) => b.town < 0);
    for (let j = 0; j <= N; j++) {
      for (let i = 0; i <= N; i++) {
        const x = -EXT + i * CELL, z = -EXT + j * CELL;
        let h = rawH(x, z);
        for (const t of W.towns) {
          const d = Math.hypot(x - t.x, z - t.z);
          if (d < 80) h += (t.floorY - h) * (1 - sstep(60, 80, d));
        }
        for (const b of lone) {
          const d = Math.hypot(Math.max(Math.abs(x - b.x) - b.w / 2, 0), Math.max(Math.abs(z - b.z) - b.d / 2, 0));
          if (d < 13) h += (b.floorY - h) * (1 - sstep(3.6, 13, d));
        }
        hg[j * G1 + i] = h;
      }
    }
    W.heights = hg;
    W.heightAt = (x, z) => {
      let gx = (x + EXT) / CELL, gz = (z + EXT) / CELL;
      gx = gx < 0 ? 0 : gx > N - 0.0001 ? N - 0.0001 : gx;
      gz = gz < 0 ? 0 : gz > N - 0.0001 ? N - 0.0001 : gz;
      const i = gx | 0, j = gz | 0, fx = gx - i, fz = gz - j, k = j * G1 + i;
      const h00 = hg[k], h10 = hg[k + 1], h01 = hg[k + G1], h11 = hg[k + G1 + 1];
      return fx + fz <= 1 ? h00 + fx * (h10 - h00) + fz * (h01 - h00) : h11 + (1 - fx) * (h01 - h11) + (1 - fz) * (h10 - h11);
    };

    // ---- collision registry (uniform grid)
    const GN = Math.ceil((EXT * 2) / CS);
    const grid = new Array(GN * GN);
    const cols = W.cols;
    const insert = (c, ax, az, bx, bz) => {
      const i0 = Math.max(0, Math.floor((ax + EXT) / CS)), i1 = Math.min(GN - 1, Math.floor((bx + EXT) / CS));
      const j0 = Math.max(0, Math.floor((az + EXT) / CS)), j1 = Math.min(GN - 1, Math.floor((bz + EXT) / CS));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) (grid[j * GN + i] || (grid[j * GN + i] = [])).push(c);
    };
    const addBox = (b) => { b.k = 0; b._s = 0; cols.push(b); insert(b, b.minX, b.minZ, b.maxX, b.maxZ); return b; };
    const addCyl = (c) => { c.k = 1; c._s = 0; cols.push(c); insert(c, c.x - c.r, c.z - c.r, c.x + c.r, c.z + c.r); return c; };
    for (const b of W.buildings) for (const bx of b.boxes) addBox(bx);

    let stamp = 1;
    W.nearby = (x, z, r, out) => {
      out.length = 0; stamp++;
      const i0 = Math.max(0, Math.floor((x - r + EXT) / CS)), i1 = Math.min(GN - 1, Math.floor((x + r + EXT) / CS));
      const j0 = Math.max(0, Math.floor((z - r + EXT) / CS)), j1 = Math.min(GN - 1, Math.floor((z + r + EXT) / CS));
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const cell = grid[j * GN + i];
          if (!cell) continue;
          for (let n = 0; n < cell.length; n++) { const c = cell[n]; if (c._s !== stamp) { c._s = stamp; out.push(c); } }
        }
      }
      return out;
    };
    const blocked = (x, z, r) => {
      const out = W.nearby(x, z, r + 1.5, []);
      for (const c of out) {
        if (c.k === 0 ? x > c.minX - r && x < c.maxX + r && z > c.minZ - r && z < c.maxZ + r : Math.hypot(x - c.x, z - c.z) < c.r + r) return true;
      }
      return false;
    };

    // terrain ray: coarse march + bisection
    function rayTerrain(ox, oy, oz, dx, dy, dz, maxT) {
      const step = 2.5;
      let prev = 0;
      for (let t = 0; t <= maxT; t += step) {
        const y = oy + dy * t, x = ox + dx * t, z = oz + dz * t;
        if (dy > 0 && y > 80) return Infinity;
        if (y < W.heightAt(x, z)) {
          let lo = prev, hi = t;
          for (let k = 0; k < 6; k++) {
            const m = (lo + hi) / 2;
            if (oy + dy * m < W.heightAt(ox + dx * m, oz + dz * m)) hi = m; else lo = m;
          }
          return hi;
        }
        prev = t;
      }
      return Infinity;
    }
    W.hit = { kind: '', role: '', col: null };
    // Returns the distance to the first thing hit (Infinity if nothing within maxT); details in W.hit.
    W.raycast = (ox, oy, oz, dx, dy, dz, maxT) => {
      let best = maxT, hk = '', hr = '', hc = null;
      stamp++;
      for (let s = 0; s <= maxT + 4; s += 4) {
        if (s > best + 1) break;
        const i = Math.floor((ox + dx * s + EXT) / CS), j = Math.floor((oz + dz * s + EXT) / CS);
        if (i < 0 || j < 0 || i >= GN || j >= GN) continue;
        const cell = grid[j * GN + i];
        if (!cell) continue;
        for (let n = 0; n < cell.length; n++) {
          const c = cell[n];
          if (c._s === stamp) continue;
          c._s = stamp;
          const t = c.k === 0 ? rayBox(c, ox, oy, oz, dx, dy, dz) : rayCyl(c, ox, oy, oz, dx, dy, dz);
          if (t >= 0 && t < best) { best = t; hk = c.k === 0 ? 'box' : 'cyl'; hr = c.role; hc = c; }
        }
      }
      const tt = rayTerrain(ox, oy, oz, dx, dy, dz, best);
      if (tt < best) { best = tt; hk = 'terrain'; hr = 'ground'; hc = null; }
      W.hit.kind = hk; W.hit.role = hr; W.hit.col = hc;
      return hk ? best : Infinity;
    };
    W.los = (x0, y0, z0, x1, y1, z1) => {
      const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0, len = Math.hypot(dx, dy, dz);
      return len < 0.05 || W.raycast(x0, y0, z0, dx / len, dy / len, dz / len, len - 0.3) === Infinity;
    };

    // ---- roads between towns (simple chain), used for ground colouring
    const order = W.towns.slice();
    for (let i = 0; i < order.length - 1; i++) {
      let bi = i + 1, bd = 1e9;
      for (let j = i + 1; j < order.length; j++) { const d = Math.hypot(order[i].x - order[j].x, order[i].z - order[j].z); if (d < bd) { bd = d; bi = j; } }
      const t = order[i + 1]; order[i + 1] = order[bi]; order[bi] = t;
    }
    for (let i = 0; i < order.length - 1; i++) {
      const a = order[i], b = order[i + 1], mx = (a.x + b.x) / 2 + (rng() - 0.5) * 60, mz = (a.z + b.z) / 2 + (rng() - 0.5) * 60;
      W.roads.push([{ x: a.x, z: a.z }, { x: mx, z: mz }, { x: b.x, z: b.z }]);
    }
    W.roadDist = (x, z) => {
      let best = 1e9;
      for (const r of W.roads) {
        for (let i = 0; i < r.length - 1; i++) {
          const ax = r[i].x, az = r[i].z, bx = r[i + 1].x, bz = r[i + 1].z, vx = bx - ax, vz = bz - az;
          const t = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / (vx * vx + vz * vz)));
          const d = Math.hypot(x - (ax + vx * t), z - (az + vz * t));
          if (d < best) best = d;
        }
      }
      return best;
    };
    W.townAt = (x, z) => { for (const t of W.towns) if (Math.hypot(x - t.x, z - t.z) < t.r + 12) return t; return null; };
    W.buildingAt = (x, z) => { for (const b of W.buildings) if (x > b.x0 && x < b.x1 && z > b.z0 && z < b.z1) return b; return null; };
    const nearBuilding = (x, z, m) => W.buildings.some((b) => x > b.x0 - m && x < b.x1 + m && z > b.z0 - m && z < b.z1 + m);

    // ---- crates and barrels around buildings (solid, jump-on-able)
    for (const b of W.buildings) {
      const n = 2 + ((rng() * 3) | 0);
      for (let i = 0; i < n; i++) {
        const side = (rng() * 4) | 0, off = 1.2 + rng() * 2.5;
        let x = side < 2 ? b.x + (rng() - 0.5) * b.w : side === 2 ? b.x0 - off : b.x1 + off;
        let z = side >= 2 ? b.z + (rng() - 0.5) * b.d : side === 0 ? b.z0 - off : b.z1 + off;
        if (Math.hypot(x - b.door.ox, z - b.door.oz) < 3.2 || blocked(x, z, 0.9)) continue;
        const g = W.heightAt(x, z), s = 0.9 + rng() * 0.4, role = rng() < 0.3 ? 'barrel' : 'crate';
        const bx = addBox({ minX: x - s / 2, minY: g - 0.3, minZ: z - s / 2, maxX: x + s / 2, maxY: g + 0.95, maxZ: z + s / 2, role });
        W.props.push(bx);
        if (role === 'crate' && rng() < 0.3) W.props.push(addBox({ minX: x - s / 2 + 0.1, minY: g + 0.95, minZ: z - s / 2 + 0.1, maxX: x + s / 2 - 0.1, maxY: g + 1.8, maxZ: z + s / 2 - 0.1, role: 'crate' }));
      }
    }

    // ---- trees, rocks, bushes
    const th = new Map();
    const treeKey = (x, z) => Math.floor(x / 4) * 10007 + Math.floor(z / 4);
    for (let tries = 0; tries < 16000 && W.trees.length < 900; tries++) {
      const x = (rng() * 2 - 1) * (half - 6), z = (rng() * 2 - 1) * (half - 6);
      const dens = fbm(x * 0.011, z * 0.011, seed + 500, 3);
      if (rng() > Math.max(0.06, Math.min(1, (dens - 0.4) * 2.6))) continue;
      if (W.towns.some((t) => Math.hypot(x - t.x, z - t.z) < t.r + 8) || nearBuilding(x, z, 5) || W.roadDist(x, z) < 5) continue;
      let ok = true;
      for (let a = -1; a <= 1 && ok; a++) for (let c = -1; c <= 1 && ok; c++) { const l = th.get(treeKey(x + a * 4, z + c * 4)); if (l && l.some((p) => Math.hypot(p.x - x, p.z - z) < 3.2)) ok = false; }
      if (!ok) continue;
      const s = 0.8 + rng() * 0.8, g = W.heightAt(x, z), type = rng() < 0.65 ? 0 : 1, tr = { x, z, y: g, s, type, ry: rng() * 6.28, tint: rng() };
      W.trees.push(tr);
      const k = treeKey(x, z); (th.get(k) || th.set(k, []).get(k)).push(tr);
      addCyl({ x, z, r: 0.42 * s, y0: g - 1, y1: g + 14, role: 'wood' });
    }
    for (let tries = 0; tries < 2000 && W.rocks.length < 110; tries++) {
      const x = (rng() * 2 - 1) * (half - 6), z = (rng() * 2 - 1) * (half - 6);
      if (nearBuilding(x, z, 6) || W.roadDist(x, z) < 4 || blocked(x, z, 1.5)) continue;
      const s = 0.8 + rng() * rng() * 2.4, g = W.heightAt(x, z);
      W.rocks.push({ x, z, y: g, s, ry: rng() * 6.28, tint: rng() });
      addCyl({ x, z, r: 0.9 * s, y0: g - 1, y1: g + 1.1 * s, role: 'rock' });
    }
    for (let tries = 0; tries < 3000 && W.bushes.length < 420; tries++) {
      const x = (rng() * 2 - 1) * (half - 4), z = (rng() * 2 - 1) * (half - 4);
      if (nearBuilding(x, z, 3) || W.roadDist(x, z) < 3) continue;
      W.bushes.push({ x, z, y: W.heightAt(x, z), s: 0.7 + rng() * 0.8, tint: rng() });
    }

    // ---- loot spots (the match decides what actually spawns on them)
    for (const b of W.buildings) {
      const tier = b.kind === 'house' && b.town >= 0 ? 2 : 1;
      for (const l of b.loot) W.lootSpots.push({ x: l.x, y: l.y, z: l.z, tier: l.roof ? 2 : tier });
      for (let i = 0; i < 2; i++) {
        const a = rng() * 6.28, x = b.door.ox + Math.cos(a) * 3, z = b.door.oz + Math.sin(a) * 3;
        if (!blocked(x, z, 0.6) && !W.buildingAt(x, z)) W.lootSpots.push({ x, y: W.heightAt(x, z), z, tier: 1 });
      }
    }
    for (let tries = 0, n = 0; tries < 800 && n < 80; tries++) {
      const x = (rng() * 2 - 1) * (half - 12), z = (rng() * 2 - 1) * (half - 12);
      if (blocked(x, z, 0.8) || W.buildingAt(x, z)) continue;
      W.lootSpots.push({ x, y: W.heightAt(x, z), z, tier: 0 }); n++;
    }
    return W;
  }

  BR.World = { generate, mulberry32, fbm, sstep };
})(typeof window !== 'undefined' ? window : globalThis);
