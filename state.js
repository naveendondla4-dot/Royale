/* state.js - the whole game simulation (movement, weapons, loot, zone, deaths).
 * It only reads "inputs" and writes "events", so the exact same code can run in the browser (offline mode)
 * or on a Node server (online mode). No THREE / DOM in here.
 *
 * input = { mx, mz, yaw, pitch, fire, jump, sit, run, reload, heal, swap, pick, scope, slot }
 *   mx = strafe (-1 left .. 1 right), mz = forward (-1 .. 1), yaw/pitch absolute radians,
 *   fire/sit/run/scope = held states, jump/reload/heal/swap/pick = one-shot presses, slot = -1 | 0 | 1.
 * Yaw 0 faces -Z. forward = (-sin yaw, -cos yaw), right = (cos yaw, -sin yaw). */
(function (G) {
  'use strict';
  const BR = (G.BR = G.BR || {});
  const CFG = BR.CFG, P = CFG.PLAYER, M = CFG.MOVE, D = CFG.DROP;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const tmp = [];
  const IDLE = { mx: 0, mz: 0, yaw: 0, pitch: 0, fire: false, jump: false, sit: false, run: false, reload: false, heal: false, swap: false, pick: false, scope: false, slot: -1 };
  const NAMES = ['Shadow', 'Blaze', 'Viper', 'Ghost', 'Raven', 'Nova', 'Titan', 'Rogue', 'Falcon', 'Storm', 'Ninja', 'Jinx', 'Hunter', 'Cobra', 'Wolf', 'Zero', 'Rex', 'Echo', 'Spark', 'Blitz', 'Tiger', 'Pixel', 'Comet', 'Drift', 'Fury', 'Orion', 'Bolt', 'Mamba', 'Havoc', 'Sniper', 'Rider', 'Ace', 'Ember', 'Frost', 'Axel'];

  const eyeY = (p) => p.y + (p.sit ? P.EYE_SIT : P.EYE);
  const bodyH = (p) => (p.sit ? P.H_SIT : P.H);
  const yawTo = (dx, dz) => Math.atan2(-dx, -dz);

  // ------------------------------------------------------------------ match setup
  function createMatch(opts) {
    opts = opts || {};
    const seed = opts.seed || ((Math.random() * 1e9) | 0) || 1;
    const world = opts.world && opts.world.seed === seed ? opts.world : BR.World.generate(seed);
    const rng = BR.World.mulberry32((opts.matchSeed || seed) ^ 0x9e3779b9); // the island follows `seed`; spawns / loot / zone follow `matchSeed`
    const S = { seed, world, rng, time: 0, tick: 0, players: [], pickups: [], pickupVer: 0, events: [], noise: [], zone: null, aliveCount: 0, over: false, winner: -1, nextPickup: 1, humanCount: 0 };
    const humans = opts.humans || [{ name: 'Player' }];
    const total = humans.length + (opts.bots == null ? CFG.BOTS : opts.bots);
    const half = world.half, ang = rng() * 6.283, rx = Math.cos(ang), rz = Math.sin(ang);
    const used = {};
    for (let i = 0; i < total; i++) {
      const isBot = i >= humans.length;
      let name = isBot ? NAMES[(rng() * NAMES.length) | 0] : humans[i].name;
      if (isBot) { while (used[name]) name += (rng() * 10) | 0; used[name] = 1; }
      const f = (i === 0 ? 0 : rng() - 0.5) * 2 * half * 0.9, off = (rng() - 0.5) * 70;
      const x = clamp(rx * f - rz * off, -half + 25, half - 25), z = clamp(rz * f + rx * off, -half + 25, half - 25);
      const p = {
        id: i, name, isBot, alive: true, x, y: D.ALT + rng() * 14, z, vx: 0, vy: 0, vz: 0,
        yaw: yawTo(-x, -z) + (rng() - 0.5), pitch: -0.5, recoil: 0, hp: CFG.HP, armor: 0,
        air: 'free', sit: false, scope: false, onGround: false, weapons: [{ id: 'pistol', mag: 12 }, null], cur: 0, ammo: 36, medkits: 0,
        fireCd: 0, reloadT: 0, healT: 0, fireWas: false, kills: 0, dmgDealt: 0, rank: 0, killedBy: -1, t: 0, lastHit: -99, lastAtt: -1,
        outfit: (rng() * 8) | 0, speed: 0, zoneAcc: 0, ai: null,
      };
      if (i === 0) p.yaw = yawTo(rx, rz); // the first player faces the way the plane flies
      S.players.push(p);
      if (isBot && BR.Bots) BR.Bots.init(S, p);
    }
    const h0 = S.players[0]; S.route = { x: h0.x, y: h0.y + 5, z: h0.z, dx: rx, dz: rz, speed: 62 }; // drop plane: starts right above the first player and flies along the route
    S.humanCount = humans.length;
    S.aliveCount = total;
    spawnLoot(S);
    initZone(S);
    return S;
  }

  function weightedPick(rng, table) {
    let sum = 0;
    for (const k in table) sum += table[k];
    let r = rng() * sum;
    for (const k in table) { r -= table[k]; if (r <= 0) return k; }
    return Object.keys(table)[0];
  }
  function addPickup(S, kind, x, y, z, extra) {
    const pk = Object.assign({ id: S.nextPickup++, kind, x, y, z }, extra);
    S.pickups.push(pk); S.pickupVer++;
    return pk;
  }
  function spawnLoot(S) {
    const L = CFG.LOOT;
    for (const s of S.world.lootSpots) {
      const kind = weightedPick(S.rng, L.KIND_W[s.tier]);
      if (kind === 'none') continue;
      if (kind === 'weapon') { const w = weightedPick(S.rng, L.WEAPON_W[s.tier]); addPickup(S, 'weapon', s.x, s.y, s.z, { w, mag: CFG.WEAPONS[w].mag, bonus: CFG.WEAPONS[w].mag }); }
      else if (kind === 'ammo') addPickup(S, 'ammo', s.x, s.y, s.z, { n: L.AMMO_BOX });
      else if (kind === 'medkit') addPickup(S, 'medkit', s.x, s.y, s.z, { n: 1 });
      else addPickup(S, 'armor', s.x, s.y, s.z, { n: L.ARMOR_GIVE });
    }
  }

  // ------------------------------------------------------------------ safe zone
  function pickTarget(S, z) {
    const Ph = CFG.ZONE.PHASES[z.phase], half = S.world.half;
    const maxOff = Math.max(0, z.r - Ph.r) * 0.9, a = S.rng() * 6.283, o = Math.sqrt(S.rng()) * maxOff;
    const lim = Math.max(0, half - 10 - Ph.r);
    z.tcx = clamp(z.cx + Math.cos(a) * o, -lim, lim);
    z.tcz = clamp(z.cz + Math.sin(a) * o, -lim, lim);
    z.tr = Ph.r;
  }
  function initZone(S) {
    const z = { cx: (S.rng() - 0.5) * 60, cz: (S.rng() - 0.5) * 60, r: CFG.ZONE.START_R, phase: 0, state: 'wait', t: CFG.ZONE.PHASES[0].wait, dps: CFG.ZONE.PHASES[0].dps, scx: 0, scz: 0, sr: 0, tcx: 0, tcz: 0, tr: 0 };
    pickTarget(S, z);
    S.zone = z;
  }
  function updateZone(S, dt) {
    const z = S.zone, PH = CFG.ZONE.PHASES;
    if (z.state === 'final') return;
    z.t -= dt;
    if (z.state === 'wait') {
      if (z.t <= 0) {
        z.state = 'shrink'; z.t = PH[z.phase].shrink; z.scx = z.cx; z.scz = z.cz; z.sr = z.r; z.dps = PH[z.phase].dps;
        S.events.push({ t: 'zone', state: 'shrink', phase: z.phase });
      }
    } else {
      const k = 1 - clamp(z.t / PH[z.phase].shrink, 0, 1);
      z.cx = z.scx + (z.tcx - z.scx) * k; z.cz = z.scz + (z.tcz - z.scz) * k; z.r = z.sr + (z.tr - z.sr) * k;
      if (z.t <= 0) {
        z.cx = z.tcx; z.cz = z.tcz; z.r = z.tr; z.phase++;
        if (z.phase >= PH.length) { z.state = 'final'; return; }
        z.state = 'wait'; z.t = PH[z.phase].wait; pickTarget(S, z);
        S.events.push({ t: 'zone', state: 'wait', phase: z.phase });
      }
    }
  }

  // ------------------------------------------------------------------ physics helpers
  function support(S, x, y, z) {
    const W = S.world;
    let g = W.heightAt(x, z);
    const list = W.nearby(x, z, 0.3, tmp);
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if (c.k === 0 && x > c.minX - 0.15 && x < c.maxX + 0.15 && z > c.minZ - 0.15 && z < c.maxZ + 0.15 && c.maxY <= y + P.STEP && c.maxY > g) g = c.maxY;
    }
    return g;
  }
  function moveXZ(S, p, dt) {
    const W = S.world, h = bodyH(p), lim = W.half - 2;
    let nx = clamp(p.x + p.vx * dt, -lim, lim), nz = clamp(p.z + p.vz * dt, -lim, lim);
    for (let pass = 0; pass < 2; pass++) {
      const list = W.nearby(nx, nz, P.R + 0.1, tmp);
      for (let i = 0; i < list.length; i++) {
        const c = list[i];
        if (c.k === 0) {
          if (c.maxY - p.y <= P.STEP || p.y + h <= c.minY) continue;
          const cx = nx < c.minX ? c.minX : nx > c.maxX ? c.maxX : nx, cz = nz < c.minZ ? c.minZ : nz > c.maxZ ? c.maxZ : nz;
          const dx = nx - cx, dz = nz - cz, d2 = dx * dx + dz * dz;
          if (d2 >= P.R * P.R) continue;
          if (d2 > 1e-9) { const d = Math.sqrt(d2), k = (P.R - d) / d; nx += dx * k; nz += dz * k; }
          else {
            const l = nx - c.minX, r = c.maxX - nx, t = nz - c.minZ, b = c.maxZ - nz, m = Math.min(l, r, t, b);
            if (m === l) nx = c.minX - P.R; else if (m === r) nx = c.maxX + P.R; else if (m === t) nz = c.minZ - P.R; else nz = c.maxZ + P.R;
          }
        } else {
          if (c.y1 - p.y <= P.STEP || p.y + h <= c.y0) continue;
          const dx = nx - c.x, dz = nz - c.z, d = Math.hypot(dx, dz), md = P.R + c.r;
          if (d >= md) continue;
          if (d > 1e-6) { const k = (md - d) / d; nx += dx * k; nz += dz * k; } else nx += md;
        }
      }
    }
    p.vx = (nx - p.x) / dt; p.vz = (nz - p.z) / dt;
    p.x = nx; p.z = nz;
  }

  // ------------------------------------------------------------------ one player, one tick
  function flyPlayer(S, p, inp, dt) {
    const W = S.world, alt = p.y - W.heightAt(p.x, p.z);
    if (p.air === 'free' && alt < D.CHUTE_ALT) { p.air = 'chute'; S.events.push({ t: 'chute', id: p.id }); }
    const g = p.air === 'free' ? D.GLIDE_FREE : D.GLIDE_CHUTE, sy = Math.sin(p.yaw), cy = Math.cos(p.yaw);
    let ix = inp.mx, iz = inp.mz; const len = Math.hypot(ix, iz); if (len > 1) { ix /= len; iz /= len; }
    p.vx += ((-sy * iz + cy * ix) * g - p.vx) * Math.min(1, 2.5 * dt);
    p.vz += ((-cy * iz - sy * ix) * g - p.vz) * Math.min(1, 2.5 * dt);
    p.vy += ((p.air === 'free' ? -D.FREE_V : -D.CHUTE_V) - p.vy) * Math.min(1, 3 * dt);
    const lim = W.half - 2;
    p.x = clamp(p.x + p.vx * dt, -lim, lim); p.z = clamp(p.z + p.vz * dt, -lim, lim); p.y += p.vy * dt;
    p.speed = 0;
    const sup = support(S, p.x, p.y, p.z);
    if (p.y <= sup) { p.y = sup; p.vy = 0; p.air = 'ground'; p.onGround = true; p.vx *= 0.2; p.vz *= 0.2; S.events.push({ t: 'land', id: p.id, x: p.x, y: p.y, z: p.z }); }
  }

  function switchTo(p, slot) {
    if (slot < 0 || slot > 1 || slot === p.cur || !p.weapons[slot]) return;
    p.cur = slot; p.reloadT = 0; p.fireCd = Math.max(p.fireCd, 0.25);
  }
  function startReload(S, p) {
    const w = p.weapons[p.cur];
    if (!w || p.reloadT > 0 || p.healT > 0) return;
    const def = CFG.WEAPONS[w.id];
    if (w.mag >= def.mag || p.ammo <= 0) return;
    p.reloadT = def.reload; S.events.push({ t: 'reload', id: p.id, w: w.id });
  }
  function startHeal(S, p) {
    if (p.medkits <= 0 || p.hp >= CFG.HP || p.healT > 0 || p.reloadT > 0) return;
    p.healT = CFG.HEAL.TIME; S.events.push({ t: 'heal', id: p.id, s: 'start' });
  }
  function nearestWeaponPickup(S, p, r) {
    let best = null, bd = r * r;
    for (const k of S.pickups) {
      if (k.kind !== 'weapon') continue;
      const dx = k.x - p.x, dz = k.z - p.z, d = dx * dx + dz * dz;
      if (d < bd && Math.abs(k.y - p.y) < 2.2) { bd = d; best = k; }
    }
    return best;
  }
  function removePickup(S, k) {
    const i = S.pickups.indexOf(k);
    if (i >= 0) { S.pickups[i] = S.pickups[S.pickups.length - 1]; S.pickups.pop(); S.pickupVer++; }
  }
  function takeWeapon(S, p, k) {
    let slot = p.weapons[p.cur] ? (p.weapons[1 - p.cur] ? p.cur : 1 - p.cur) : p.cur;
    const old = p.weapons[slot];
    if (old) addPickup(S, 'weapon', p.x + 0.6, p.y, p.z + 0.4, { w: old.id, mag: old.mag, bonus: 0 });
    p.weapons[slot] = { id: k.w, mag: k.mag }; p.ammo += k.bonus || 0; p.cur = slot; p.reloadT = 0;
    removePickup(S, k);
    S.events.push({ t: 'pickup', id: p.id, kind: 'weapon', w: k.w });
  }
  function collect(S, p) {
    for (let i = S.pickups.length - 1; i >= 0; i--) {
      const k = S.pickups[i];
      if (k.kind === 'weapon') {
        if (p.weapons[0] && p.weapons[1]) continue;
      }
      const dx = k.x - p.x, dz = k.z - p.z;
      if (dx * dx + dz * dz > 1.7 || Math.abs(k.y - p.y) > 2.2) continue;
      if (k.kind === 'weapon') { takeWeapon(S, p, k); continue; }
      if (k.kind === 'ammo') p.ammo += k.n;
      else if (k.kind === 'medkit') { if (p.medkits >= CFG.HEAL.MAX) continue; p.medkits++; }
      else if (k.kind === 'armor') { if (p.armor >= CFG.ARMOR) continue; p.armor = Math.min(CFG.ARMOR, p.armor + k.n); }
      S.pickups[i] = S.pickups[S.pickups.length - 1]; S.pickups.pop(); S.pickupVer++;
      S.events.push({ t: 'pickup', id: p.id, kind: k.kind });
    }
  }

  function rayPlayer(q, ox, oy, oz, dx, dy, dz) {
    const ax = ox - q.x, az = oz - q.z, a = dx * dx + dz * dz;
    if (a < 1e-9) return -1;
    const r = 0.42, cc = ax * ax + az * az - r * r, b = ax * dx + az * dz, disc = b * b - a * cc;
    if (disc < 0 || cc < 0) return -1;
    const t = (-b - Math.sqrt(disc)) / a;
    if (t < 0) return -1;
    const y = oy + dy * t;
    return y < q.y || y > q.y + bodyH(q) ? -1 : t;
  }

  function fireWeapon(S, p, w, def) {
    w.mag--; p.fireCd += 1 / def.rate;
    const W = S.world, ox = p.x, oy = eyeY(p), oz = p.z, pitch = p.pitch + p.recoil;
    let sp = def.spread + clamp(Math.hypot(p.vx, p.vz) / M.RUN, 0, 1) * def.move + (p.onGround ? 0 : 0.05);
    if (p.sit) sp *= 0.6;
    if (p.scope) sp *= 0.5;
    const cp = Math.cos(pitch), sP = Math.sin(pitch), sy = Math.sin(p.yaw), cy = Math.cos(p.yaw);
    const fx = -sy * cp, fy = sP, fz = -cy * cp, rx = cy, rz = -sy, ux = sy * sP, uy = cp, uz = cy * sP;
    const dmgTo = {}; let firstEnd = null, anyHead = false;
    for (let n = 0; n < def.pellets; n++) {
      const a = S.rng() * 6.283, rr = Math.sqrt(S.rng()) * sp * (def.pellets > 1 ? 1 : 0.6 + 0.4 * S.rng());
      let dx = fx + (rx * Math.cos(a) + ux * Math.sin(a)) * rr, dy = fy + uy * Math.sin(a) * rr, dz = fz + (rz * Math.cos(a) + uz * Math.sin(a)) * rr;
      const l = Math.hypot(dx, dy, dz); dx /= l; dy /= l; dz /= l;
      let tw = W.raycast(ox, oy, oz, dx, dy, dz, def.range), role = W.hit.role;
      let victim = null, tv = tw, head = false;
      for (const q of S.players) {
        if (!q.alive || q === p) continue;
        const ddx = q.x - ox, ddz = q.z - oz;
        if (ddx * ddx + ddz * ddz > (def.range + 2) * (def.range + 2)) continue;
        const t = rayPlayer(q, ox, oy, oz, dx, dy, dz);
        if (t >= 0 && t < tv && t <= def.range) { tv = t; victim = q; head = oy + dy * t > q.y + bodyH(q) - 0.3; }
      }
      const tEnd = victim ? tv : tw === Infinity ? def.range : tw;
      if (n === 0) firstEnd = { x: ox + dx * tEnd, y: oy + dy * tEnd, z: oz + dz * tEnd, hit: victim ? 'p' : tw === Infinity ? '-' : 'w', role: victim ? 'body' : role };
      if (victim) {
        const fall = 1 - 0.4 * clamp((tv - def.range * 0.5) / (def.range * 0.5), 0, 1);
        const dmg = def.dmg * fall * (head ? def.headMul || CFG.HEAD_MUL : 1);
        const e = dmgTo[victim.id] || (dmgTo[victim.id] = { v: victim, d: 0, head: false });
        e.d += dmg; if (head) e.head = true; anyHead = anyHead || head;
      }
    }
    S.events.push({ t: 'shot', id: p.id, w: w.id, ox, oy, oz, ex: firstEnd.x, ey: firstEnd.y, ez: firstEnd.z, hit: firstEnd.hit, role: firstEnd.role });
    S.noise.push({ x: p.x, z: p.z, t: S.time, id: p.id }); if (S.noise.length > 14) S.noise.shift();
    p.recoil = Math.min(0.3, p.recoil + def.kick * 2 * (0.7 + 0.6 * S.rng()));
    for (const id in dmgTo) { const e = dmgTo[id]; damage(S, e.v, e.d, p, w.id, e.head, 'gun'); }
  }

  // ------------------------------------------------------------------ damage and death
  function damage(S, v, amount, att, wid, head, cause, silent) {
    if (!v.alive || amount <= 0) return;
    let loss = amount;
    if (v.armor > 0 && cause === 'gun') { const ab = Math.min(v.armor, amount * 0.55); v.armor -= ab; loss = amount - ab; }
    v.hp -= loss; v.lastHit = S.time; v.lastAtt = att ? att.id : -1;
    if (v.healT > 0) { v.healT = 0; S.events.push({ t: 'heal', id: v.id, s: 'cancel' }); }
    if (att) att.dmgDealt += amount;
    if (!silent) S.events.push({ t: 'hit', att: att ? att.id : -1, vic: v.id, dmg: Math.round(amount), head: !!head, w: wid, ax: att ? att.x : v.x, az: att ? att.z : v.z });
    if (v.hp <= 0) kill(S, v, att, wid, head, cause);
  }
  function kill(S, v, att, wid, head, cause) {
    v.hp = 0; v.alive = false; v.rank = S.aliveCount; S.aliveCount--; v.killedBy = att ? att.id : -1; v.deathT = S.time;
    if (att && att !== v) att.kills++;
    v.weapons.forEach((w, i) => { if (w) addPickup(S, 'weapon', v.x + (i ? 0.7 : -0.7), v.y, v.z + 0.3, { w: w.id, mag: w.mag, bonus: 0 }); });
    if (v.ammo > 8) addPickup(S, 'ammo', v.x, v.y, v.z - 0.7, { n: Math.floor(v.ammo * 0.6) });
    if (v.medkits > 0) addPickup(S, 'medkit', v.x - 0.6, v.y, v.z - 0.5, { n: v.medkits });
    if (v.armor > 20) addPickup(S, 'armor', v.x + 0.6, v.y, v.z - 0.5, { n: Math.floor(v.armor) });
    S.events.push({ t: 'kill', killer: att ? att.id : -1, victim: v.id, w: wid, head: !!head, cause, x: v.x, y: v.y, z: v.z });
    if (S.aliveCount <= 1 && !S.over) {
      S.over = true; S.winner = -1;
      for (const q of S.players) if (q.alive) { S.winner = q.id; q.rank = 1; }
      S.events.push({ t: 'win', id: S.winner });
    }
  }

  // ------------------------------------------------------------------ the per-tick update
  function updatePlayer(S, p, inp, dt) {
    p.t += dt;
    p.yaw = isFinite(inp.yaw) ? inp.yaw : p.yaw;
    p.pitch = clamp(isFinite(inp.pitch) ? inp.pitch : 0, -1.45, 1.45);
    p.recoil = Math.max(0, p.recoil - p.recoil * 4 * dt - 0.02 * dt);
    p.fireCd = Math.max(-dt, p.fireCd - dt);
    if (p.air !== 'ground') { flyPlayer(S, p, inp, dt); return; }

    p.sit = !!inp.sit; p.scope = !!inp.scope;
    if (inp.slot >= 0) switchTo(p, inp.slot); else if (inp.swap) switchTo(p, 1 - p.cur);
    if (inp.reload) startReload(S, p);
    if (inp.heal) startHeal(S, p);
    if (inp.pick) { const k = nearestWeaponPickup(S, p, 2.2); if (k) takeWeapon(S, p, k); }
    if (p.reloadT > 0) {
      p.reloadT -= dt;
      if (p.reloadT <= 0) { const w = p.weapons[p.cur]; if (w) { const take = Math.min(CFG.WEAPONS[w.id].mag - w.mag, p.ammo); w.mag += take; p.ammo -= take; } p.reloadT = 0; }
    }
    if (p.healT > 0) {
      p.healT -= dt;
      if (p.healT <= 0) { p.healT = 0; p.hp = Math.min(CFG.HP, p.hp + CFG.HEAL.AMOUNT); p.medkits--; S.events.push({ t: 'heal', id: p.id, s: 'done' }); }
    }

    // movement
    let ix = inp.mx || 0, iz = inp.mz || 0; const len = Math.hypot(ix, iz); if (len > 1) { ix /= len; iz /= len; }
    let sp = p.sit ? M.SIT : inp.run && iz > 0.3 && !p.scope ? M.RUN : M.WALK;
    if (p.scope) sp *= 0.7;
    if (p.healT > 0) sp *= 0.6;
    const sy = Math.sin(p.yaw), cy = Math.cos(p.yaw), k = Math.min(1, (p.onGround ? M.ACCEL : M.AIR_ACCEL) * dt);
    p.vx += ((-sy * iz + cy * ix) * sp - p.vx) * k;
    p.vz += ((-cy * iz - sy * ix) * sp - p.vz) * k;
    if (inp.jump && p.onGround && !p.sit) { p.vy = M.JUMP; p.onGround = false; S.events.push({ t: 'jump', id: p.id }); }
    p.vy -= M.GRAVITY * dt;
    moveXZ(S, p, dt);
    p.speed = Math.hypot(p.vx, p.vz);
    p.y += p.vy * dt;
    const sup = support(S, p.x, p.y, p.z);
    if (p.y <= sup + 0.001) {
      if (p.vy < -13) damage(S, p, (-p.vy - 13) * 4, null, 'fall', false, 'fall');
      p.y = sup; p.vy = 0; p.onGround = true;
    } else if (p.onGround && p.vy <= 0 && p.y - sup < 0.35) { p.y = sup; p.vy = 0; } else p.onGround = false;
    if (!p.alive) return;

    // shooting
    const w = p.weapons[p.cur];
    if (w && inp.fire && p.healT <= 0 && p.reloadT <= 0 && p.fireCd <= 0) {
      const def = CFG.WEAPONS[w.id];
      if (def.auto || !p.fireWas) { if (w.mag > 0) fireWeapon(S, p, w, def); else { p.fireCd = 0.3; if (p.ammo > 0) startReload(S, p); else S.events.push({ t: 'dry', id: p.id }); } }
    }
    p.fireWas = !!inp.fire;
    if (w && w.mag === 0 && p.reloadT <= 0 && p.ammo > 0 && !inp.fire) startReload(S, p);

    // loot + zone
    if ((S.tick + p.id) % 3 === 0) collect(S, p);
    const z = S.zone;
    if (Math.hypot(p.x - z.cx, p.z - z.cz) > z.r) {
      p.zoneAcc += z.dps * dt;
      if (p.zoneAcc >= 1) { const a = Math.floor(p.zoneAcc); p.zoneAcc -= a; damage(S, p, a, null, 'zone', false, 'zone', true); }
    }
  }

  function step(S, inputs, dt) {
    if (S.over) return;
    S.time += dt; S.tick++;
    updateZone(S, dt);
    const ps = S.players;
    for (let i = 0; i < ps.length; i++) { const p = ps[i]; if (p.alive) updatePlayer(S, p, inputs[p.id] || IDLE, dt); }
    for (let i = 0; i < ps.length; i++) {
      const a = ps[i]; if (!a.alive || a.air !== 'ground') continue;
      for (let j = i + 1; j < ps.length; j++) {
        const b = ps[j]; if (!b.alive || b.air !== 'ground' || Math.abs(a.y - b.y) > 1.5) continue;
        const dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz);
        if (d < 0.75 && d > 1e-4) { const k = ((0.75 - d) / d) * 0.5; a.x -= dx * k; a.z -= dz * k; b.x += dx * k; b.z += dz * k; }
      }
    }
  }
  // one server tick: bots think, then everything moves
  function tick(S, humanInputs, dt) {
    const inputs = humanInputs || {};
    if (BR.Bots) for (const p of S.players) if (p.isBot && p.alive) inputs[p.id] = BR.Bots.think(S, p, dt);
    step(S, inputs, dt || CFG.DT);
  }

  // ------------------------------------------------------------------ network snapshots (for the future backend)
  function snapshot(S) {
    return {
      tick: S.tick, time: S.time, over: S.over, winner: S.winner, zone: Object.assign({}, S.zone),
      players: S.players.map((p) => [p.id, p.alive ? 1 : 0, p.x, p.y, p.z, p.vx, p.vz, p.yaw, p.pitch, p.hp, p.armor, p.air, p.sit ? 1 : 0, p.cur, p.weapons, p.ammo, p.medkits, p.kills]),
      pickups: S.pickups, pickupVer: S.pickupVer,
    };
  }
  function applySnapshot(S, snap) {
    S.tick = snap.tick; S.time = snap.time; S.over = snap.over; S.winner = snap.winner; S.zone = snap.zone;
    for (const a of snap.players) {
      const p = S.players[a[0]]; if (!p) continue;
      p.alive = !!a[1]; p.x = a[2]; p.y = a[3]; p.z = a[4]; p.vx = a[5]; p.vz = a[6]; p.yaw = a[7]; p.pitch = a[8]; p.hp = a[9]; p.armor = a[10]; p.air = a[11]; p.sit = !!a[12]; p.cur = a[13]; p.weapons = a[14]; p.ammo = a[15]; p.medkits = a[16]; p.kills = a[17];
      p.speed = Math.hypot(p.vx, p.vz);
    }
    if (snap.pickupVer !== S.pickupVer) { S.pickups = snap.pickups; S.pickupVer = snap.pickupVer; }
    S.aliveCount = S.players.filter((p) => p.alive).length;
  }

  BR.Sim = { IDLE, createMatch, step, tick, snapshot, applySnapshot, damage, eyeY, bodyH, yawTo, support, nearestWeaponPickup, startReload, startHeal, switchTo };
})(typeof window !== 'undefined' ? window : globalThis);
