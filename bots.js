/* bots.js - computer players. A bot produces the SAME input object a human does (see state.js),
 * so the simulation cannot tell them apart. That is what makes real multiplayer easy later:
 * just replace a bot's input with a network player's input. */
(function (G) {
  'use strict';
  const BR = (G.BR = G.BR || {});
  const CFG = BR.CFG;
  const PI2 = Math.PI * 2;
  const POWER = { pistol: 1, smg: 2.6, shotgun: 3, ar: 4, sniper: 3.4 };
  const IDEAL = { pistol: 18, smg: 20, shotgun: 9, ar: 34, sniper: 75 };
  const wrap = (a) => { a = (a + Math.PI) % PI2; if (a < 0) a += PI2; return a - Math.PI; };
  const turn = (cur, target, step) => { const d = wrap(target - cur); return Math.abs(d) <= step ? cur + d : cur + Math.sign(d) * step; };
  const yawTo = (dx, dz) => Math.atan2(-dx, -dz);

  function init(S, p) {
    const W = S.world, r = S.rng;
    let lx, lz;
    const used = S.landUsed || (S.landUsed = {});
    let b = null;
    if (W.buildings.length && r() < 0.75) { // any unused building we can still glide to
      const near = W.buildings.filter((c) => !used[c.id] && Math.hypot(c.x - p.x, c.z - p.z) < 250);
      if (near.length) b = near[(r() * near.length) | 0];
    }
    if (b) { used[b.id] = 1; lx = b.x + (r() - 0.5) * 6; lz = b.z + (r() - 0.5) * 6; }
    else { const a = r() * PI2, d = 40 + r() * 150; lx = Math.max(-W.half + 20, Math.min(W.half - 20, p.x + Math.cos(a) * d)); lz = Math.max(-W.half + 20, Math.min(W.half - 20, p.z + Math.sin(a) * d)); }
    p.ai = {
      skill: 0.2 + r() * 0.6, aggr: 0.2 + r() * 0.8, grace: 20 + r() * 25, t: 0, landX: lx, landZ: lz, yaw: p.yaw, pitch: -0.7,
      inp: { mx: 0, mz: 0, yaw: p.yaw, pitch: 0, fire: false, jump: false, sit: false, run: false, reload: false, heal: false, swap: false, pick: false, scope: false, slot: -1 },
      senseT: r() * 0.4, enemy: -1, unseen: 99, react: 0, last: null, noiseX: 0, noiseZ: 0, invest: null,
      goal: null, goalT: 0, route: null, strafe: 1, strafeT: 0, burstOn: false, burstT: 0, fireToggle: false, swapCd: 0, sitT: 0,
      avoidYaw: 0, avoidT: 0, stuckT: 0, stuckN: 0, lastX: p.x, lastZ: p.z, unstuckT: 0, unstuckYaw: 0, unstuckBase: 0, aimT: 0, nYaw: 0, nPitch: 0,
    };
  }

  const bestPower = (p) => Math.max(p.weapons[0] ? POWER[p.weapons[0].id] : 0, p.weapons[1] ? POWER[p.weapons[1].id] : 0);
  function bestSlot(p, d) {
    let bs = p.cur, bsc = -99;
    for (let i = 0; i < 2; i++) {
      const w = p.weapons[i];
      if (!w || (w.mag <= 0 && p.ammo <= 0)) continue;
      const s = POWER[w.id] - Math.abs(Math.log((d + 1) / IDEAL[w.id])) * 1.3 + (i === p.cur ? 0.4 : 0);
      if (s > bsc) { bsc = s; bs = i; }
    }
    return bs;
  }

  // ---- perception
  function sense(S, p, ai) {
    const W = S.world, Sim = BR.Sim, w = p.weapons[p.cur];
    const range = Math.min(110, Math.max(45, (w ? CFG.WEAPONS[w.id].range : 60) * 0.6));
    const eye = Sim.eyeY(p), cands = [];
    for (const q of S.players) {
      if (!q.alive || q === p || q.air !== 'ground') continue;
      const dx = q.x - p.x, dz = q.z - p.z, d2 = dx * dx + dz * dz, rr = q.sit ? range * 0.7 : range;
      if (d2 > rr * rr) continue;
      if (ai.enemy !== q.id && Math.abs(wrap(yawTo(dx, dz) - ai.yaw)) > 1.3 && d2 > 100) continue; // outside field of view
      cands.push({ q, d2 });
    }
    cands.sort((a, b) => a.d2 - b.d2);
    for (let i = 0; i < cands.length && i < 3; i++) {
      const q = cands[i].q;
      if (W.los(p.x, eye, p.z, q.x, q.y + 1.25, q.z)) {
        if (ai.enemy !== q.id) { ai.react = 0.35 + (1 - ai.skill) * 0.9; ai.aimT = 0; }
        ai.enemy = q.id; ai.unseen = 0; ai.last = { x: q.x, z: q.z };
        return;
      }
    }
    if (ai.unseen > 5) ai.enemy = -1;
    if (ai.enemy < 0) { // listen for gunfire
      for (const n of S.noise) {
        if (n.id === p.id || S.time - n.t > 2.5) continue;
        if (Math.hypot(n.x - p.x, n.z - p.z) < 70) { ai.invest = { x: n.x, z: n.z }; break; }
      }
    }
  }

  // ---- navigation
  function probe(W, p, want) {
    const dirs = [0, 0.8, -0.8, 1.6, -1.6, 2.4], sgn = Math.random() < 0.5 ? 1 : -1;
    for (const off of dirs) {
      const yw = want + off * sgn, fx = -Math.sin(yw), fz = -Math.cos(yw);
      let t = W.raycast(p.x, p.y + 0.55, p.z, fx, 0, fz, 2.4);
      if (t !== Infinity && W.hit.kind !== 'terrain') continue;
      t = W.raycast(p.x, p.y + 1.3, p.z, fx, 0, fz, 2.4);
      if (t !== Infinity && W.hit.kind !== 'terrain') continue;
      return off * sgn;
    }
    return 0;
  }
  function steer(S, p, ai, inp, tx, tz, dt, run) {
    const dx = tx - p.x, dz = tz - p.z, dist = Math.hypot(dx, dz);
    let want = yawTo(dx, dz);
    if (ai.unstuckT > 0) { ai.unstuckT -= dt; want = ai.unstuckBase + ai.unstuckYaw; }
    else {
      ai.avoidT -= dt;
      if (ai.avoidT <= 0) { ai.avoidT = 0.25; ai.avoidYaw = probe(S.world, p, want); }
      want += ai.avoidYaw;
    }
    ai.yaw = turn(ai.yaw, want, (5 + ai.skill * 3) * dt);
    inp.mz = Math.abs(wrap(want - ai.yaw)) > 1.2 ? 0 : 1;
    inp.run = !!run && dist > 6;
    if (ai.unstuckT > 0 && ai.unstuckT < 0.6 && p.onGround) inp.jump = true;
    // stuck detection
    ai.stuckT += dt;
    if (ai.stuckT > 0.6) {
      if (inp.mz && Math.hypot(p.x - ai.lastX, p.z - ai.lastZ) < 0.3) {
        ai.stuckN++;
        if (ai.stuckN >= 2) { ai.unstuckT = 0.9; ai.unstuckYaw = (S.rng() < 0.5 ? -1 : 1) * (1.0 + S.rng() * 1.4); ai.unstuckBase = want - ai.avoidYaw; ai.stuckN = 0; ai.route = null; }
      } else ai.stuckN = 0;
      ai.stuckT = 0; ai.lastX = p.x; ai.lastZ = p.z;
    }
    return dist;
  }
  function setGoal(ai, kind, x, z, pk, ttl) { ai.goal = { kind, x, z, pk }; ai.goalT = ttl; ai.route = null; }
  function waypoint(S, p, ai) {
    const g = ai.goal, W = S.world;
    if (!ai.route) {
      const route = [], bp = W.buildingAt(p.x, p.z), bg = W.buildingAt(g.x, g.z), onRoof = bp && p.y > bp.floorY + 2.5;
      if (bp && (onRoof || bp !== bg)) { if (!onRoof) route.push({ x: bp.door.ix, z: bp.door.iz }); route.push({ x: bp.door.ox, z: bp.door.oz }); }
      if (bg && bg !== bp) { route.push({ x: bg.door.ox, z: bg.door.oz }); route.push({ x: bg.door.ix, z: bg.door.iz }); }
      route.push({ x: g.x, z: g.z });
      ai.route = route;
    }
    while (ai.route.length > 1 && Math.hypot(ai.route[0].x - p.x, ai.route[0].z - p.z) < 1.4) ai.route.shift();
    return ai.route[0];
  }
  function findLoot(S, p) {
    const z = S.zone; let best = null, bs = -1e9;
    const roof = S.world.buildingAt(p.x, p.z) && p.y > S.world.buildingAt(p.x, p.z).floorY + 2.5;
    for (const k of S.pickups) {
      const d = Math.hypot(k.x - p.x, k.z - p.z);
      if (d > 90 || Math.hypot(k.x - z.cx, k.z - z.cz) > z.r - 4) continue;
      if (k.y > p.y + 2.5 && !roof) continue;
      let v;
      if (k.kind === 'weapon') { const pw = POWER[k.w]; if (!p.weapons[0] || !p.weapons[1]) v = 6 + pw; else if (pw > bestPower(p) + 0.5) v = 5 + pw - bestPower(p); else continue; }
      else if (k.kind === 'ammo') v = p.ammo < 40 ? 6 : p.ammo < 90 ? 2 : 0.2;
      else if (k.kind === 'medkit') v = p.medkits < 2 ? 4 : 0.5;
      else v = p.armor < 40 ? 4.5 : p.armor < 80 ? 1.5 : 0;
      if (v <= 0.3) continue;
      const sc = v * 10 - d * 0.35;
      if (sc > bs) { bs = sc; best = k; }
    }
    return best;
  }
  function roamPoint(S) {
    const z = S.zone, W = S.world, r = S.rng;
    const cands = W.buildings.filter((b) => Math.hypot(b.x - z.tcx, b.z - z.tcz) < z.tr - 6);
    if (cands.length && r() < 0.6) { const b = cands[(r() * cands.length) | 0]; return { x: b.door.ox, z: b.door.oz }; }
    const a = r() * PI2, rad = Math.sqrt(r()) * z.tr * 0.8;
    return { x: z.tcx + Math.cos(a) * rad, z: z.tcz + Math.sin(a) * rad };
  }

  // ---- the brain: runs every simulation tick
  function think(S, p, dt) {
    const ai = p.ai, inp = ai.inp, W = S.world, Sim = BR.Sim, z = S.zone;
    inp.jump = inp.reload = inp.heal = inp.swap = inp.pick = inp.fire = inp.run = inp.sit = inp.scope = false;
    inp.slot = -1; inp.mx = 0; inp.mz = 0;
    ai.t += dt;

    if (p.air !== 'ground') { // parachuting: steer to the landing spot
      const dx = ai.landX - p.x, dz = ai.landZ - p.z, d = Math.hypot(dx, dz);
      ai.yaw = turn(ai.yaw, yawTo(dx, dz), 3 * dt); ai.pitch = -1.1;
      inp.mz = d > 14 ? 1 : 0; inp.yaw = ai.yaw; inp.pitch = ai.pitch;
      return inp;
    }

    ai.unseen += dt; ai.react -= dt; ai.swapCd -= dt; ai.goalT -= dt; ai.sitT -= dt; ai.aimT -= dt;
    ai.senseT -= dt;
    if (ai.senseT <= 0) { ai.senseT = 0.2 + S.rng() * 0.15; sense(S, p, ai); }
    let enemy = ai.enemy >= 0 ? S.players[ai.enemy] : null;
    if (enemy && !enemy.alive) { ai.enemy = -1; enemy = null; }
    const w = p.weapons[p.cur], def = w ? CFG.WEAPONS[w.id] : null;

    // safe zone awareness
    const cdist = Math.hypot(p.x - z.cx, p.z - z.cz), tdist = Math.hypot(p.x - z.tcx, p.z - z.tcz);
    const outside = cdist > z.r - 4;
    const mustMove = outside || (z.state !== 'final' && (z.state === 'shrink' || z.t < 18) && tdist > z.tr - 10);
    const seen = enemy && ai.unseen < 0.8, remembered = enemy && ai.unseen < 4;
    let ed = 0;
    if (enemy) ed = Math.hypot(enemy.x - p.x, enemy.z - p.z);
    const grace = ai.t < ai.grace; // just landed: loot first, fight only if cornered
    const engage = enemy && (grace ? (ed < 14 || p.lastHit > S.time - 4) : ed < 22 || p.lastHit > S.time - 5 || ed < 25 + 80 * ai.aggr * (bestPower(p) >= 2.5 ? 1 : 0.35));
    const fighting = remembered && engage && !(mustMove && outside && ed > 22);

    let tYaw = ai.yaw, tPitch = 0, moveTo = null, run = false;

    if (fighting && enemy) {
      // ---------------- combat
      const eyeY = Sim.eyeY(p), ty = enemy.y + (enemy.sit ? 0.8 : 1.35);
      if (ai.aimT <= 0) { // re-roll aim error a few times per second
        ai.aimT = 0.3; const err = (1 - ai.skill) * 0.09 + ed * 0.0006;
        ai.nYaw = (S.rng() + S.rng() - 1) * err; ai.nPitch = (S.rng() + S.rng() - 1) * err * 0.7;
      }
      const base = seen ? { x: enemy.x, z: enemy.z } : ai.last || { x: enemy.x, z: enemy.z };
      const dx = base.x - p.x, dz = base.z - p.z, hd = Math.max(0.1, Math.hypot(dx, dz));
      tYaw = yawTo(dx, dz) + ai.nYaw; tPitch = Math.atan2(ty - eyeY, hd) + ai.nPitch;
      if (seen) {
        if (ai.swapCd <= 0) { const s = bestSlot(p, ed); if (s !== p.cur) { inp.slot = s; ai.swapCd = 1.5; } }
        const ideal = w ? IDEAL[w.id] : 15;
        ai.strafeT -= dt; if (ai.strafeT <= 0) { ai.strafe = S.rng() < 0.5 ? -1 : 1; ai.strafeT = 0.7 + S.rng() * 1.1; }
        inp.mx = ai.strafe * (0.5 + 0.5 * ai.skill);
        inp.mz = ed > ideal * 1.3 ? 1 : ed < ideal * 0.55 ? -1 : 0;
        inp.run = ed > 45 && inp.mz > 0;
        if (ed > 45 && ai.skill > 0.6 && ai.sitT < -1.5 && S.rng() < 0.02) ai.sitT = 1.5;
        inp.sit = ai.sitT > 0 && ed > 40;
        if (def && ed < def.range * 0.9 && ai.react <= 0) {
          const tol = 0.03 + 0.5 / Math.max(ed, 4);
          if (Math.abs(wrap(tYaw - ai.yaw)) < tol * 2.2) {
            if (def.auto) {
              ai.burstT -= dt;
              if (ai.burstT <= 0) { ai.burstOn = !ai.burstOn; ai.burstT = ai.burstOn ? 0.5 + S.rng() * 1.0 : 0.2 + S.rng() * 0.5 * (1.3 - ai.skill); }
              inp.fire = ai.burstOn;
            } else inp.fire = ai.fireToggle = !ai.fireToggle;
          }
        }
        if (w && w.mag === 0 && p.ammo > 0) inp.reload = true;
        if (p.hp < 40 && p.medkits > 0 && ed > 25 && p.healT <= 0 && S.rng() < 0.01) inp.heal = true;
      } else if (ai.last) { moveTo = ai.last; run = true; }
    } else {
      // ---------------- out of combat
      if (p.hp < 65 && p.medkits > 0 && p.healT <= 0 && ai.unseen > 2) inp.heal = true;
      if (p.healT > 0) { /* stand still while healing */ }
      else {
        if (w && w.mag < def.mag * 0.4 && p.ammo > 0 && ai.unseen > 1.5) inp.reload = true;
        if (ai.swapCd <= 0) { const s = bestSlot(p, 25); if (s !== p.cur) { inp.slot = s; ai.swapCd = 2; } }
        // goal selection
        const g = ai.goal;
        if (mustMove && (!g || g.kind !== 'zone' || ai.goalT <= 0)) {
          const a = S.rng() * PI2, rad = Math.sqrt(S.rng()) * z.tr * 0.6;
          setGoal(ai, 'zone', z.tcx + Math.cos(a) * rad, z.tcz + Math.sin(a) * rad, null, 6);
        } else if (!mustMove && (!g || g.kind === 'zone' || ai.goalT <= 0 || (g.pk && !S.pickups.includes(g.pk)) || Math.hypot(g.x - p.x, g.z - p.z) < 1.5)) {
          const k = findLoot(S, p);
          if (k) setGoal(ai, 'loot', k.x, k.z, k, 14);
          else if (ai.invest && S.rng() < 0.5) { setGoal(ai, 'invest', ai.invest.x, ai.invest.z, null, 8); ai.invest = null; }
          else { const r = roamPoint(S); setGoal(ai, 'roam', r.x, r.z, null, 16); }
        }
        const goal = ai.goal;
        if (goal) {
          const wp = waypoint(S, p, ai);
          moveTo = wp; run = goal.kind !== 'loot' || Math.hypot(goal.x - p.x, goal.z - p.z) > 10;
          if (goal.pk && goal.kind === 'loot' && goal.pk.kind === 'weapon' && p.weapons[0] && p.weapons[1] && Math.hypot(goal.x - p.x, goal.z - p.z) < 1.8 && ai.t % 0.5 < dt) inp.pick = true;
        }
      }
    }

    if (moveTo) steer(S, p, ai, inp, moveTo.x, moveTo.z, dt, run);
    else if (fighting) ai.yaw = turn(ai.yaw, tYaw, (5 + ai.skill * 7) * dt);
    if (fighting && moveTo === null) { /* yaw already updated above */ }
    if (fighting && enemy && seen) { ai.yaw = turn(ai.yaw, tYaw, (5 + ai.skill * 7) * dt); }
    ai.pitch = turn(ai.pitch, fighting && seen ? tPitch : 0, 4 * dt);
    inp.yaw = ai.yaw; inp.pitch = ai.pitch;
    if (p.healT > 0) { inp.mx = 0; inp.mz = 0; inp.run = false; }
    return inp;
  }

  BR.Bots = { init, think };
})(typeof window !== 'undefined' ? window : globalThis);
