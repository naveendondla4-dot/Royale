/* hud.js - on-screen information: health, ammo, zone timer, kill feed, minimap, big map, hit markers.
 * Plain DOM + 2D canvas. Reads the game state, never changes it. */
(function (G) {
  'use strict';
  const BR = (G.BR = G.BR || {});
  const CFG = BR.CFG;
  const $ = (id) => document.getElementById(id);
  const H = { base: null, baseScale: 1, el: {}, banT: 0, hitT: 0, lastWid: null, stepAcc: 0 };

  H.init = function () {
    ['alive', 'kills', 'zoneTxt', 'loc', 'hpFill', 'hpNum', 'arFill', 'wName', 'wAmmo', 'slots', 'medCount', 'cross', 'hitmark', 'prompt', 'banner', 'dmgv', 'zonev', 'scopeov', 'dirs', 'killfeed', 'minimap', 'bigmapCv', 'pickBtn', 'healBtn', 'reloadTxt', 'healBar', 'healBarFill'].forEach((k) => (H.el[k] = $(k)));
    H.mm = H.el.minimap ? H.el.minimap.getContext('2d') : null;
  };

  // ---- pre-render the terrain once (used by the minimap and the big map)
  H.buildMaps = function (W) {
    const S = 512, base = (H.baseScale = S / CFG.MAP), cv = document.createElement('canvas'); cv.width = cv.height = S;
    const g = cv.getContext('2d'), img = g.createImageData(S, S), d = img.data;
    for (let py = 0; py < S; py++) {
      for (let px = 0; px < S; px++) {
        const x = px / base - W.half, z = py / base - W.half, h = W.heightAt(x, z), dh = W.heightAt(x + 5, z + 5) - h, sh = 1 + dh * 0.07;
        let r, gg, b;
        if (h > 22) { r = 150; gg = 146; b = 140; } else if (h > 12) { r = 120; gg = 140; b = 80; } else { r = 78 + h * 2; gg = 150 - h; b = 62; }
        const k = (py * S + px) * 4; d[k] = Math.max(0, Math.min(255, r * sh)); d[k + 1] = Math.max(0, Math.min(255, gg * sh)); d[k + 2] = Math.max(0, Math.min(255, b * sh)); d[k + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    const P = (x, z) => [(x + W.half) * base, (z + W.half) * base];
    g.strokeStyle = 'rgba(214,190,140,0.95)'; g.lineWidth = 3; g.lineCap = 'round';
    for (const r of W.roads) { g.beginPath(); r.forEach((pt, i) => { const p = P(pt.x, pt.z); i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]); }); g.stroke(); }
    g.fillStyle = 'rgba(30,90,40,0.55)';
    for (const t of W.trees) { const p = P(t.x, t.z); g.fillRect(p[0] - 1, p[1] - 1, 2, 2); }
    for (const b of W.buildings) { const p = P(b.x0, b.z0); g.fillStyle = '#e8e2d2'; g.fillRect(p[0], p[1], b.w * base + 0.5, b.d * base + 0.5); g.strokeStyle = '#3a342a'; g.lineWidth = 1; g.strokeRect(p[0], p[1], b.w * base, b.d * base); }
    H.base = cv; H.world = W;
  };

  function ring(g, cx, cz, r, color, lw, base) { g.beginPath(); g.arc((cx + H.world.half) * base, (cz + H.world.half) * base, Math.max(0.1, r * base), 0, 6.2832); g.strokeStyle = color; g.lineWidth = lw; g.stroke(); }
  function drawZone(g, z, base, lw) {
    const W = H.world, full = W.half * 2 * base;
    g.save(); g.beginPath(); g.rect(-full, -full, full * 3, full * 3); g.arc((z.cx + W.half) * base, (z.cz + W.half) * base, Math.max(0.1, z.r * base), 0, 6.2832, true);
    g.fillStyle = 'rgba(255,50,50,0.28)'; g.fill('evenodd'); g.restore();
    ring(g, z.cx, z.cz, z.r, '#31b7ff', lw, base);
    if (z.state === 'wait' && z.tr > 0.5) ring(g, z.tcx, z.tcz, z.tr, '#ffffff', lw, base);
  }

  H.drawMinimap = function (S, me) {
    const g = H.mm; if (!g || !H.base) return;
    const c = H.el.minimap.width / 2, k = 0.95; // screen px per metre
    g.clearRect(0, 0, c * 2, c * 2);
    g.save(); g.beginPath(); g.arc(c, c, c - 1, 0, 6.2832); g.clip();
    g.fillStyle = '#1d2a1d'; g.fillRect(0, 0, c * 2, c * 2);
    g.translate(c, c); g.rotate(me.yaw); const s = k / H.baseScale; g.scale(s, s);
    g.translate(-(me.x + H.world.half) * H.baseScale, -(me.z + H.world.half) * H.baseScale);
    g.drawImage(H.base, 0, 0);
    drawZone(g, S.zone, H.baseScale, 2.2 / s);
    // gunfire pings
    for (const n of S.noise) { const a = S.time - n.t; if (a > 3 || n.id === me.id) continue; g.beginPath(); g.arc((n.x + H.world.half) * H.baseScale, (n.z + H.world.half) * H.baseScale, (6 + a * 10) * H.baseScale, 0, 6.2832); g.strokeStyle = 'rgba(255,200,60,' + (1 - a / 3) * 0.8 + ')'; g.lineWidth = 1.5 / s; g.stroke(); }
    g.restore();
    g.save(); g.translate(c, c); g.fillStyle = '#fff'; g.strokeStyle = '#000'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(0, -8); g.lineTo(6, 7); g.lineTo(0, 3); g.lineTo(-6, 7); g.closePath(); g.fill(); g.stroke(); g.restore();
  };
  H.drawBigMap = function (S, me) {
    const cv = H.el.bigmapCv; if (!cv || !H.base) return;
    const g = cv.getContext('2d'), size = cv.width, sc = size / (H.base.width), base = H.baseScale;
    g.clearRect(0, 0, size, size); g.save(); g.scale(sc, sc); g.drawImage(H.base, 0, 0); drawZone(g, S.zone, base, 3 / sc); g.restore();
    g.font = 'bold 13px sans-serif'; g.textAlign = 'center'; g.fillStyle = '#fff'; g.strokeStyle = '#000'; g.lineWidth = 3;
    for (const t of H.world.towns) { const x = (t.x + H.world.half) * base * sc, y = (t.z + H.world.half) * base * sc; g.strokeText(t.name, x, y - 14); g.fillText(t.name, x, y - 14); }
    const mx = (me.x + H.world.half) * base * sc, my = (me.z + H.world.half) * base * sc;
    g.save(); g.translate(mx, my); g.rotate(-me.yaw); g.fillStyle = '#ffe14d'; g.strokeStyle = '#000'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(0, -11); g.lineTo(8, 9); g.lineTo(0, 4); g.lineTo(-8, 9); g.closePath(); g.fill(); g.stroke(); g.restore();
  };

  // ---- feedback
  H.banner = function (text, sec) { const b = H.el.banner; if (!b) return; b.textContent = text; b.classList.add('show'); H.banT = sec || 3; };
  function retrigger(el, cls) { if (!el) return; el.classList.remove('show', 'head', 'kill'); void el.offsetWidth; if (cls) cls.split(' ').forEach((c) => el.classList.add(c)); }
  H.hitmarker = function (head, kill) { retrigger(H.el.hitmark, 'show' + (head ? ' head' : '') + (kill ? ' kill' : '')); };
  H.killfeed = function (S, e, myId) {
    const f = H.el.killfeed; if (!f) return;
    const v = S.players[e.victim], k = S.players[e.killer], d = document.createElement('div');
    const wn = e.cause === 'zone' ? 'the zone' : e.cause === 'fall' ? 'a fall' : CFG.WEAPONS[e.w] ? CFG.WEAPONS[e.w].name : '';
    d.className = 'kf' + (e.killer === myId ? ' mine' : e.victim === myId ? ' me' : '');
    d.innerHTML = (k ? '<b>' + esc(k.name) + '</b> ' : '') + (k ? '&#9656; ' : '') + '<b>' + esc(v.name) + '</b>' + (wn ? ' <i>' + wn + (e.head ? ' &#9679;' : '') + '</i>' : '');
    f.appendChild(d); while (f.children.length > 5) f.removeChild(f.firstChild);
    setTimeout(() => d.remove(), 6000);
  };
  function esc(s) { return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }
  H.damage = function (e, me, yaw) { // red flash + arrow towards the attacker
    const v = H.el.dmgv; if (v) { v.style.opacity = Math.min(0.8, 0.25 + e.dmg / 60); setTimeout(() => (v.style.opacity = 0), 160); }
    if (!H.el.dirs || e.att < 0) return;
    const dx = e.ax - me.x, dz = e.az - me.z, fx = -Math.sin(yaw), fz = -Math.cos(yaw), rx = Math.cos(yaw), rz = -Math.sin(yaw);
    const ang = Math.atan2(dx * rx + dz * rz, dx * fx + dz * fz), a = document.createElement('div');
    a.className = 'dirarrow'; a.style.transform = 'rotate(' + ang + 'rad) translateY(-120px)'; H.el.dirs.appendChild(a); setTimeout(() => a.remove(), 1300);
  };

  const mmss = (t) => { t = Math.max(0, Math.ceil(t)); return Math.floor(t / 60) + ':' + ('0' + (t % 60)).slice(-2); };
  H.update = function (S, me, dt, spread) {
    const e = H.el, z = S.zone, def = (me.weapons[me.cur] && CFG.WEAPONS[me.weapons[me.cur].id]) || null, w = me.weapons[me.cur];
    e.alive.textContent = S.aliveCount; e.kills.textContent = me.kills;
    const outside = Math.hypot(me.x - z.cx, me.z - z.cz) > z.r;
    e.zoneTxt.textContent = z.state === 'wait' ? 'Zone closes in ' + mmss(z.t) : z.state === 'shrink' ? 'Zone closing ' + mmss(z.t) : 'Final circle';
    e.zoneTxt.classList.toggle('warn', z.state === 'shrink');
    e.zonev.style.opacity = outside && me.alive ? 1 : 0;
    const t = S.world.townAt(me.x, me.z); e.loc.textContent = me.air !== 'ground' ? 'In the air' : t ? t.name : 'Wilderness';
    const hp = Math.max(0, me.hp); e.hpFill.style.width = hp + '%'; e.hpFill.className = hp > 60 ? '' : hp > 30 ? 'mid' : 'low'; e.hpNum.textContent = Math.ceil(hp);
    e.arFill.style.width = me.armor + '%';
    e.medCount.textContent = me.medkits;
    // weapon box
    if (w) {
      e.wName.textContent = def.name; e.wAmmo.innerHTML = '<b>' + w.mag + '</b> / ' + me.ammo;
      e.wAmmo.classList.toggle('low', w.mag <= def.mag * 0.25);
    } else { e.wName.textContent = 'No weapon'; e.wAmmo.textContent = ''; }
    const wid = w ? w.id : null;
    if (wid !== H.lastWid || H.lastCur !== me.cur) {
      H.lastWid = wid; H.lastCur = me.cur;
      e.slots.innerHTML = [0, 1].map((i) => '<span class="slot' + (i === me.cur ? ' on' : '') + '">' + (i + 1) + ' ' + (me.weapons[i] ? CFG.WEAPONS[me.weapons[i].id].name : '-') + '</span>').join('');
      const sb = document.querySelector('[data-act="scope"]'); if (sb) sb.textContent = (def ? def.zoom : 4) + 'x';
    }
    e.reloadTxt.style.opacity = me.reloadT > 0 ? 1 : 0;
    const healing = me.healT > 0; e.healBar.style.opacity = healing ? 1 : 0; if (healing) e.healBarFill.style.width = (100 * (1 - me.healT / CFG.HEAL.TIME)) + '%';
    // crosshair + scope
    e.cross.style.setProperty('--sp', Math.round(spread) + 'px'); e.cross.style.opacity = me.alive && !me.scope && me.air === 'ground' ? 1 : 0;
    e.scopeov.className = me.scope && me.alive ? (wid === 'sniper' ? 'on sniper' : 'on') : '';
    // pickup prompt
    const pk = me.alive && me.air === 'ground' ? BR.Sim.nearestWeaponPickup(S, me, 2.2) : null;
    if (pk) { const n = CFG.WEAPONS[pk.w].name; e.prompt.textContent = (document.body.classList.contains('touch') ? 'Tap PICK: ' : 'Press E: ') + n; e.prompt.classList.add('show'); } else e.prompt.classList.remove('show');
    e.pickBtn.classList.toggle('show', !!pk);
    if (H.banT > 0) { H.banT -= dt; if (H.banT <= 0) e.banner.classList.remove('show'); }
    H.drawMinimap(S, me);
  };

  BR.HUD = H;
})(window);
