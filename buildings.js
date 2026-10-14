/* buildings.js - generates one flat-roofed building (walls with doors/windows, roof deck with parapet,
 * furniture, loot points). Pure data (boxes), no THREE. Shared by client and a future server. */
(function (G) {
  'use strict';
  const BR = (G.BR = G.BR || {});

  const T = 0.35; // wall thickness
  const PALETTES = [
    { wall: 0xe9dcc3, trim: 0x4a3626, roof: 0x8e3b2f, floor: 0x8b6b4a },
    { wall: 0xcfd8dc, trim: 0x37474f, roof: 0x546e7a, floor: 0x6d5a45 },
    { wall: 0xf0e3a0, trim: 0x6b4a2b, roof: 0x3b6e4f, floor: 0x9a7b55 },
    { wall: 0xd9886b, trim: 0x3e2a22, roof: 0x2f3a46, floor: 0x7d6246 },
    { wall: 0xb9c7a3, trim: 0x4f4a3a, roof: 0x7a5a3a, floor: 0x8a7050 },
    { wall: 0xe6e6e6, trim: 0x2c3e50, roof: 0xb23a3a, floor: 0x76624a },
  ];
  const BARN_PAL = { wall: 0x8a3b2e, trim: 0xeeeeee, roof: 0x4a4f55, floor: 0x6f5a40 };
  const KINDS = {
    cabin: { w: [6.5, 8], d: [6, 7.5], H: 3.0 },
    house: { w: [10, 12.5], d: [8, 10], H: 3.3 },
    barn: { w: [14, 17], d: [10, 12], H: 4.6 },
  };

  function size(kind, rng) {
    const k = KINDS[kind];
    return { w: k.w[0] + rng() * (k.w[1] - k.w[0]), d: k.d[0] + rng() * (k.d[1] - k.d[0]), H: k.H };
  }

  function make(rng, kind, cx, cz, floorY, sz) {
    const { w, d, H } = sz;
    const fy = floorY;
    const x0 = cx - w / 2, x1 = cx + w / 2, z0 = cz - d / 2, z1 = cz + d / 2;
    const pal = kind === 'barn' ? BARN_PAL : PALETTES[(rng() * PALETTES.length) | 0];
    const B = { kind, x: cx, z: cz, w, d, H, floorY: fy, x0, x1, z0, z1, pal, boxes: [], decor: [], glass: [], loot: [], door: null };
    const box = (arr, a, b, c, d2, e, f, role, extra) => {
      const o = { minX: a, minY: b, minZ: c, maxX: d2, maxY: e, maxZ: f, role };
      if (extra) Object.assign(o, extra);
      arr.push(o);
      return o;
    };

    // ---- floor (visual only; terrain is flattened to floorY under the building)
    box(B.decor, x0, fy - 0.3, z0, x1, fy + 0.03, z1, 'floor');

    // ---- wall helper: splits a wall line around openings (doors / windows)
    const wall = (axis, fixed, a, b, thick, ops, role, h) => {
      ops.sort((p, q) => p.c - q.c);
      let cur = a;
      const seg = (s, e, ya, yb) => {
        if (e - s < 0.02 || yb - ya < 0.02) return;
        if (axis === 'x') box(B.boxes, s, fy + ya, fixed - thick / 2, e, fy + yb, fixed + thick / 2, role);
        else box(B.boxes, fixed - thick / 2, fy + ya, s, fixed + thick / 2, fy + yb, e, role);
      };
      for (const o of ops) {
        const l = o.c - o.wd / 2, r = o.c + o.wd / 2;
        seg(cur, l, 0, h);
        if (o.y0 > 0) seg(l, r, 0, o.y0);
        if (o.y1 < h) seg(l, r, o.y1, h);
        cur = r;
      }
      seg(cur, b, 0, h);
    };
    const frame = (axis, fixed, o) => {
      const l = o.c - o.wd / 2, r = o.c + o.wd / 2, t = 0.12, p = T / 2 + 0.05;
      const ya = fy + o.y0, yb = fy + o.y1;
      const add = (s0, e0, a, b) => (axis === 'x' ? box(B.decor, s0, a, fixed - p, e0, b, fixed + p, 'trim') : box(B.decor, fixed - p, a, s0, fixed + p, b, e0, 'trim'));
      add(l - t, r + t, yb, yb + t);
      add(l - t, l, ya, yb);
      add(r, r + t, ya, yb);
      if (o.type === 'window') {
        add(l - t, r + t, ya - t, ya);
        if (axis === 'x') box(B.glass, l, ya, fixed - 0.03, r, yb, fixed + 0.03, 'glass');
        else box(B.glass, fixed - 0.03, ya, l, fixed + 0.03, yb, r, 'glass');
      }
    };

    // ---- openings per side
    const sides = ['n', 's', 'e', 'w'];
    const ds = sides[(rng() * 4) | 0];
    const ops = { n: [], s: [], e: [], w: [] };
    const alongLen = { n: w, s: w, e: d, w: d };
    const mid = { n: cx, s: cx, e: cz, w: cz };
    const dc = mid[ds] + (rng() - 0.5) * alongLen[ds] * 0.35;
    if (kind === 'barn') {
      ops[ds].push({ c: dc - 2.0, wd: 3.0, y0: 0, y1: 3.2, type: 'door' }, { c: dc + 2.0, wd: 3.0, y0: 0, y1: 3.2, type: 'door' });
    } else {
      ops[ds].push({ c: dc, wd: 1.5, y0: 0, y1: 2.3, type: 'door' });
      for (const s of sides) {
        if (alongLen[s] < 5.5) continue;
        const n = alongLen[s] > 9 ? 2 : 1;
        for (let i = 0; i < n; i++) {
          const c = mid[s] + (n === 2 ? (i ? 1 : -1) * alongLen[s] * 0.25 : (rng() - 0.5) * 1.5);
          if (s === ds && Math.abs(c - dc) < 2.6) continue;
          ops[s].push({ c, wd: 1.4, y0: 1.0, y1: 2.2, type: 'window' });
        }
      }
    }
    wall('x', z0, x0 - T / 2, x1 + T / 2, T, ops.n, 'wall', H);
    wall('x', z1, x0 - T / 2, x1 + T / 2, T, ops.s, 'wall', H);
    wall('z', x0, z0 + T / 2, z1 - T / 2, T, ops.w, 'wall', H);
    wall('z', x1, z0 + T / 2, z1 - T / 2, T, ops.e, 'wall', H);
    for (const o of ops.n) frame('x', z0, o);
    for (const o of ops.s) frame('x', z1, o);
    for (const o of ops.w) frame('z', x0, o);
    for (const o of ops.e) frame('z', x1, o);

    const dd = kind === 'barn' ? dc - 2.0 : dc; // barns have two openings; aim for the first one
    const door = { side: ds, c: dd };
    if (ds === 'n') Object.assign(door, { x: dd, z: z0, ox: dd, oz: z0 - 2.4, ix: dd, iz: z0 + 1.9 });
    if (ds === 's') Object.assign(door, { x: dd, z: z1, ox: dd, oz: z1 + 2.4, ix: dd, iz: z1 - 1.9 });
    if (ds === 'w') Object.assign(door, { x: x0, z: dd, ox: x0 - 2.4, oz: dd, ix: x0 + 1.9, iz: dd });
    if (ds === 'e') Object.assign(door, { x: x1, z: dd, ox: x1 + 2.4, oz: dd, ix: x1 - 1.9, iz: dd });
    B.door = door;

    // ---- interior partition (houses only)
    const solid = []; // rectangles to keep loot away from
    if (kind === 'house') {
      const alongZ = ds === 'n' || ds === 's';
      let p = alongZ ? cx + (rng() - 0.5) * w * 0.4 : cz + (rng() - 0.5) * d * 0.4;
      if (Math.abs(p - dc) < 2.2) p = dc + (rng() < 0.5 ? -2.4 : 2.4);
      const lo = alongZ ? x0 + 2.2 : z0 + 2.2, hi = alongZ ? x1 - 2.2 : z1 - 2.2;
      p = Math.max(lo, Math.min(hi, p));
      const gap = [{ c: (alongZ ? cz : cx) + (rng() - 0.5) * 2, wd: 1.4, y0: 0, y1: 2.2, type: 'door' }];
      if (alongZ) {
        wall('z', p, z0 + T / 2, z1 - T / 2, 0.2, gap, 'wall', H);
        solid.push([p - 0.8, z0, p + 0.8, z1]);
      } else {
        wall('x', p, x0 + T / 2, x1 - T / 2, 0.2, gap, 'wall', H);
        solid.push([x0, p - 0.8, x1, p + 0.8]);
      }
    }

    // ---- roof deck with parapet (players can stand on it)
    const ry = fy + H;
    box(B.boxes, x0 - 0.4, ry, z0 - 0.4, x1 + 0.4, ry + 0.3, z1 + 0.4, 'roof', { stand: true });
    const py = ry + 0.3, ph = 0.9, pt = 0.3;
    box(B.boxes, x0 - 0.4, py, z0 - 0.4, x1 + 0.4, py + ph, z0 - 0.4 + pt, 'parapet');
    box(B.boxes, x0 - 0.4, py, z1 + 0.4 - pt, x1 + 0.4, py + ph, z1 + 0.4, 'parapet');
    box(B.boxes, x0 - 0.4, py, z0 - 0.4 + pt, x0 - 0.4 + pt, py + ph, z1 + 0.4 - pt, 'parapet');
    box(B.boxes, x1 + 0.4 - pt, py, z0 - 0.4 + pt, x1 + 0.4, py + ph, z1 + 0.4 - pt, 'parapet');
    // rooftop unit / tank stand (solid, standable)
    const ax = cx + (rng() < 0.5 ? -1 : 1) * (w * 0.25), az = cz + (rng() < 0.5 ? -1 : 1) * (d * 0.25);
    box(B.boxes, ax - 0.7, py, az - 0.5, ax + 0.7, py + 0.8, az + 0.5, 'metal', { stand: true });
    if (kind !== 'cabin') box(B.decor, ax - 0.5, py + 0.8, az - 0.3, ax + 0.5, py + 1.1, az + 0.3, 'metal');

    // ---- furniture / crates along the inner walls
    const nf = kind === 'barn' ? 5 : kind === 'house' ? 3 : 2;
    const inDoorZone = (x, z) => Math.hypot(x - door.ix, z - door.iz) < 2.4;
    for (let i = 0; i < nf; i++) {
      const sx = kind === 'barn' ? 1 + rng() * 1.2 : 0.8 + rng() * 1.2;
      const sz2 = kind === 'barn' ? 1 + rng() * 1.2 : 0.6 + rng() * 0.6;
      const hh = kind === 'barn' ? 1.0 + rng() * 0.9 : 0.7 + rng() * 0.5;
      const fx = x0 + T / 2 + 0.2 + sx / 2 + rng() * Math.max(0.1, w - T - 0.4 - sx);
      const onN = rng() < 0.5;
      const fz = onN ? z0 + T / 2 + 0.15 + sz2 / 2 : z1 - T / 2 - 0.15 - sz2 / 2;
      if (inDoorZone(fx, fz) || solid.some((r) => fx > r[0] - sx / 2 && fx < r[2] + sx / 2 && fz > r[1] - sz2 / 2 && fz < r[3] + sz2 / 2)) continue;
      box(B.boxes, fx - sx / 2, fy, fz - sz2 / 2, fx + sx / 2, fy + hh, fz + sz2 / 2, kind === 'barn' ? 'crate' : 'wood', { stand: true });
      solid.push([fx - sx / 2 - 0.3, fz - sz2 / 2 - 0.3, fx + sx / 2 + 0.3, fz + sz2 / 2 + 0.3]);
    }

    // ---- interior loot points
    const nl = kind === 'barn' ? 6 : kind === 'house' ? 5 : 3;
    for (let i = 0, tries = 0; i < nl && tries < 60; tries++) {
      const lx = x0 + 1.2 + rng() * (w - 2.4), lz = z0 + 1.2 + rng() * (d - 2.4);
      if (inDoorZone(lx, lz) || solid.some((r) => lx > r[0] && lx < r[2] && lz > r[1] && lz < r[3])) continue;
      B.loot.push({ x: lx, y: fy, z: lz });
      i++;
    }
    if (kind !== 'cabin') B.loot.push({ x: cx + (ax > cx ? -2 : 2), y: py, z: cz + (az > cz ? -1.5 : 1.5), roof: true });
    return B;
  }

  BR.Buildings = { KINDS, PALETTES, size, make };
})(typeof window !== 'undefined' ? window : globalThis);
