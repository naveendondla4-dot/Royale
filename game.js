/* game.js - the glue: menu, loading, the frame loop, pause / map / spectate / end screens.
 *
 * Every frame:   input -> network.step (runs the simulation) -> renderer.update -> events (sound + HUD) -> HUD -> render
 * It never touches game rules itself, so a multiplayer server can replace BR.Net without changes here.
 *
 * URL options (handy for testing):  ?seed=123  ?q=low|medium|high  ?touch=1  ?auto=1  ?ws=ws://host:port (future server)
 */
(function (G) {
  'use strict';
  const BR = G.BR, CFG = BR.CFG, A = BR.Audio, I = BR.Input, H = BR.HUD, R = BR.Renderer;
  const $ = (id) => document.getElementById(id);
  const show = (id) => { const e = $(id); if (e) e.classList.remove('hidden'); };
  const hide = (id) => { const e = $(id); if (e) e.classList.add('hidden'); };
  const store = {
    get(k, d) { try { const v = localStorage.getItem('zr_' + k); return v == null ? d : v; } catch (_) { return d; } },
    set(k, v) { try { localStorage.setItem('zr_' + k, v); } catch (_) {} },
  };
  const qs = new URLSearchParams(location.search);
  const SEED = parseInt(qs.get('seed'), 10) || 2024; // the island is the same every game; spawns / loot / zone change
  const QUALITIES = ['low', 'medium', 'high'];

  const M = {
    S: null, net: null, quality: 'medium', loading: false, worldBuilt: false, paused: false, mapOpen: false,
    spectating: false, specId: -1, endT: -1, endShown: false, deathInfo: null,
    last: 0, spread: 8, stepAcc: 0, windT: 0, zoneTickT: 0, mapT: 0, errors: [], frameErrs: 0,
    view: { id: 0, mode: 'fps' }, ui: { scopeZoom: 1 },
  };

  // ------------------------------------------------------------------ small helpers
  const mmss = (t) => { t = Math.max(0, Math.floor(t)); return Math.floor(t / 60) + ':' + ('0' + (t % 60)).slice(-2); };
  const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const wait = (ms) => new Promise((res) => setTimeout(res, ms));
  function lockPointer() { if (I.touch) return; try { const r = $('view').requestPointerLock(); if (r && r.catch) r.catch(() => {}); } catch (_) {} }
  function exitLock() { try { if (document.exitPointerLock) document.exitPointerLock(); } catch (_) {} }
  function playerName() { const n = ($('nameIn').value || '').replace(/[<>&]/g, '').trim().slice(0, 14); return n || 'Player'; }
  function defaultQuality() {
    if (!I.touch) return 'medium';
    return (navigator.hardwareConcurrency || 4) >= 6 && (navigator.deviceMemory || 4) >= 4 ? 'medium' : 'low';
  }
  function log(m) { M.errors.push(String(m)); if (G.console) console.warn('[ZoneRoyale]', m); }

  function fail(e) {
    log(e && e.stack ? e.stack : e);
    if (G.console) console.error(e);
    let msg = (e && e.message) || String(e);
    if (/WebGL|context/i.test(msg)) msg += ' - this device or browser could not start WebGL 3D graphics. Try Chrome, or lower the graphics setting.';
    $('errTxt').textContent = msg;
    M.loading = false; hide('loading'); show('err'); exitLock(); I.setEnabled(false);
  }
  G.addEventListener('error', (ev) => { log((ev.message || 'error') + ' @' + (ev.filename || '').split('/').pop() + ':' + ev.lineno); if (M.loading) fail(ev.error || new Error(ev.message)); });
  G.addEventListener('unhandledrejection', (ev) => { log('promise: ' + (ev.reason && ev.reason.message || ev.reason)); if (M.loading) fail(ev.reason || new Error('Unknown error')); });

  // ------------------------------------------------------------------ starting a match
  function tryFullscreen() {
    if (!I.touch) return;
    try {
      const el = document.documentElement, f = el.requestFullscreen || el.webkitRequestFullscreen;
      if (f && !document.fullscreenElement) { const r = f.call(el); if (r && r.catch) r.catch(() => {}); }
      if (screen.orientation && screen.orientation.lock) { const r2 = screen.orientation.lock('landscape'); if (r2 && r2.catch) r2.catch(() => {}); }
    } catch (_) {}
  }

  function startMatch() {
    if (M.loading) return;
    M.loading = true; M.S = null;
    A.init(); A.resume(); tryFullscreen(); lockPointer();
    ['menu', 'end', 'pause', 'err', 'hud', 'touch', 'bigmap', 'specBar'].forEach(hide);
    $('loadTxt').textContent = 'Generating the island...'; show('loading');
    M.paused = false; M.mapOpen = false; M.spectating = false; M.endShown = false; M.endT = -1; M.deathInfo = null; M.spread = 8;
    I.setEnabled(false);
    $('killfeed').innerHTML = ''; $('dirs').innerHTML = '';
    store.set('name', playerName());
    wait(60).then(() => {
      if (!R.ready) R.init($('view'), M.quality);
      if (!M.net) M.net = BR.Net.create(qs.get('ws'));
      return M.net.start({ seed: SEED, matchSeed: (Math.random() * 1e9 | 0) || 1, name: playerName() });
    }).then((S) => {
      $('loadTxt').textContent = 'Building trees and houses...';
      return wait(60).then(() => {
        if (!M.worldBuilt) { R.buildWorld(S.world, log); H.buildMaps(S.world); M.worldBuilt = true; }
        R.resetMatch(S);
        const me = S.players[M.net.localId];
        I.reset(me.yaw, me.pitch);
        M.view.id = M.net.localId; M.view.mode = 'fps'; M.specId = -1;
        M.S = S; M.last = performance.now(); M.loading = false;
        hide('loading'); show('hud'); if (I.touch) show('touch');
        I.setEnabled(true);
        H.banner(I.touch ? 'Drag the stick to steer - land near a building' : 'WASD to steer - land near a building', 4);
        if (I.touch && G.innerHeight > G.innerWidth) setTimeout(() => H.banner('Rotate your phone sideways for best play', 4), 4200);
      });
    }).catch(fail);
  }

  // ------------------------------------------------------------------ pause / map / spectate / end
  function doPause() {
    if (!M.S || M.paused || M.loading || M.endShown || M.spectating) return;
    M.paused = true; I.setEnabled(false); exitLock();
    $('btnGfx').textContent = 'Graphics: ' + M.quality.toUpperCase() + ' (tap to change)';
    $('btnMute').textContent = 'Sound: ' + (A.muted ? 'OFF' : 'ON');
    show('pause'); hide('touch');
  }
  function resume() {
    if (!M.paused) return;
    M.paused = false; hide('pause'); if (I.touch) show('touch');
    const me = M.S && M.S.players[M.net.localId];
    I.setEnabled(!!(me && me.alive && !M.S.over)); lockPointer(); M.last = performance.now();
  }
  function toggleMap() {
    if (!M.S || M.paused || M.endShown) return;
    M.mapOpen = !M.mapOpen;
    $('bigmap').classList.toggle('hidden', !M.mapOpen);
    if (M.mapOpen) { H.drawBigMap(M.S, M.S.players[M.view.id]); M.mapT = 0.2; }
  }
  I.onUI = (name) => { if (name === 'pause') (M.paused ? resume() : doPause()); else if (name === 'map') toggleMap(); };

  function pickSpectate(S, prefer) {
    const P = S.players, me = P[M.net.localId];
    if (prefer >= 0 && P[prefer] && P[prefer].alive) return prefer;
    let best = -1, bd = 1e18;
    for (const p of P) { if (!p.alive || p.id === me.id) continue; const d = (p.x - me.x) ** 2 + (p.z - me.z) ** 2; if (d < bd) { bd = d; best = p.id; } }
    return best >= 0 ? best : me.id;
  }
  function cycleSpectate() {
    const S = M.S; if (!S) return;
    const alive = S.players.filter((p) => p.alive && p.id !== M.net.localId); if (!alive.length) return;
    const i = alive.findIndex((p) => p.id === M.specId); M.specId = alive[(i + 1) % alive.length].id;
  }
  function startSpectate() {
    hide('end'); show('specBar'); M.spectating = true; M.endShown = false; M.endT = -1; I.setEnabled(false);
  }

  function renderEnd() {
    const S = M.S, me = S.players[M.net.localId], won = S.over && S.winner === me.id, d = M.deathInfo;
    let title = won ? 'WINNER WINNER!' : S.over ? 'MATCH OVER' : 'ELIMINATED', sub;
    if (won) sub = 'You are the last one standing.';
    else {
      const who = d && d.killer >= 0 && S.players[d.killer] ? S.players[d.killer].name : '';
      const how = !d ? '' : d.cause === 'zone' ? 'You were caught outside the safe zone.' : d.cause === 'fall' ? 'You fell too hard.' : who ? 'Eliminated by ' + who + (CFG.WEAPONS[d.w] ? ' with the ' + CFG.WEAPONS[d.w].name : '') + (d.head ? ' (headshot)' : '') + '.' : '';
      sub = how + (S.over && S.winner >= 0 && S.players[S.winner] ? ' ' + S.players[S.winner].name + ' won the match.' : '');
    }
    $('endTitle').textContent = title; $('endSub').textContent = sub.trim();
    const rank = won ? 1 : me.rank || S.players.length, t = won ? S.time : me.deathT != null ? me.deathT : S.time;
    $('endStats').innerHTML = '<div><b>#' + rank + '</b>RANK</div><div><b>' + me.kills + '</b>KILLS</div><div><b>' + Math.round(me.dmgDealt) + '</b>DAMAGE</div><div><b>' + mmss(t) + '</b>SURVIVED</div>';
    $('btnSpectate').classList.toggle('hidden', S.over || won);
  }
  function showEnd() {
    M.endShown = true; M.endT = -1; M.spectating = false; M.mapOpen = false;
    I.setEnabled(false); exitLock(); renderEnd();
    hide('specBar'); hide('bigmap'); hide('touch'); show('end');
  }

  // ------------------------------------------------------------------ game events -> sound / HUD / effects
  function handleEvents(S, me) {
    const ev = S.events, myId = M.net.localId, view = M.view;
    for (let i = 0; i < ev.length; i++) {
      const e = ev[i];
      switch (e.t) {
        case 'shot':
          A.shot(e.w, e.ox, e.oz, e.id === view.id && view.mode === 'fps');
          R.onEvent(S, e, view);
          break;
        case 'hit':
          if (e.att === myId && e.vic !== myId) { A.hit(e.head); H.hitmarker(e.head, false); }
          if (e.vic === myId) { A.hurt(e.dmg); H.damage(e, me, me.yaw); }
          break;
        case 'kill': {
          H.killfeed(S, e, myId);
          if (e.killer === myId && e.victim !== myId) { A.kill(); H.hitmarker(e.head, true); H.banner('ELIMINATED ' + S.players[e.victim].name.toUpperCase(), 2.2); }
          if (e.victim === myId) {
            M.deathInfo = e; A.lose(); I.setEnabled(false); exitLock(); M.mapOpen = false; hide('bigmap');
            if (M.endT < 0 && !M.endShown) M.endT = 2.4;
            M.specId = pickSpectate(S, e.killer);
          }
          break;
        }
        case 'win':
          if (e.id === myId) { A.win(); I.setEnabled(false); M.endT = 1.8; } else if (M.endShown) renderEnd(); else if (M.endT < 0) M.endT = 1.2;
          if (M.endShown) renderEnd();
          break;
        case 'pickup': if (e.id === myId) A.pickup(e.kind); break;
        case 'reload': if (e.id === myId) A.reload(CFG.WEAPONS[e.w].reload); break;
        case 'dry': if (e.id === myId) A.dry(); break;
        case 'heal': if (e.id === myId && e.s !== 'cancel') A.heal(e.s === 'done'); break;
        case 'zone':
          A.zone();
          H.banner(e.state === 'shrink' ? 'THE ZONE IS CLOSING - MOVE!' : 'NEW SAFE ZONE MARKED ON THE MAP', 3.2);
          break;
        case 'chute': if (e.id === myId) { A.chute(); H.banner('PARACHUTE OPEN', 2); } break;
        case 'land': if (e.id === myId) { A.land(); R.onEvent(S, e, view); } break;
        case 'jump': if (e.id === myId) A.jump(); break;
      }
    }
    ev.length = 0;
  }

  function crossSpread(me, dt) {
    const w = me.weapons[me.cur], def = w && CFG.WEAPONS[w.id];
    if (!def) return M.spread;
    let sp = def.spread + Math.min(1, me.speed / CFG.MOVE.RUN) * def.move + (me.onGround ? 0 : 0.05);
    if (me.sit) sp *= 0.6; if (me.scope) sp *= 0.5;
    const px = 7 + (sp + me.recoil * 0.5) * (G.innerHeight * 0.5) / Math.tan((R.camera.fov * Math.PI) / 360);
    M.spread += (Math.min(110, px) - M.spread) * Math.min(1, 14 * dt);
    return M.spread;
  }

  // ------------------------------------------------------------------ the frame loop
  function tickFrame(dt) {
    const S = M.S, net = M.net, myId = net.localId, me = S.players[myId], view = M.view, ui = M.ui;

    // 1) simulate (single-player: freeze while paused or after the match ends)
    if (!M.paused && !S.over) { const inp = I.poll(dt); if (net.step(dt, inp) > 0) I.ackEdges(); }

    // 2) what are we looking through?
    if (me.alive) { view.id = myId; view.mode = 'fps'; }
    else {
      const t = S.players[M.specId];
      if (!t || !t.alive || t.id === myId) M.specId = pickSpectate(S, t ? t.killedBy : me.killedBy);
      view.id = M.specId; view.mode = 'spectate';
    }
    const cur = S.players[view.id], w = cur.weapons[cur.cur], def = w && CFG.WEAPONS[w.id];
    ui.scopeZoom = def ? def.zoom || 1 : 1;
    I.zoomDiv = view.mode === 'fps' && me.scope ? ui.scopeZoom : 1;

    // 3) camera, actors, effects
    R.update(S, dt, view, ui);

    // 4) events -> sound, hit markers, kill feed, banners
    handleEvents(S, me);

    // 5) ambient audio
    const cam = R.camera.position;
    A.setListener(cam.x, cam.z, cur.yaw);
    if (me.alive && !M.paused) {
      if (me.air === 'ground' && me.onGround && me.speed > 1.6) {
        M.stepAcc += me.speed * dt;
        const stride = me.speed > 6 ? 2.6 : 2.0;
        if (M.stepAcc > stride) { M.stepAcc = 0; A.step(me.sit ? 0.3 : me.speed > 6 ? 0.95 : 0.6); }
      }
      M.windT -= dt;
      if (M.windT <= 0) { M.windT = 0.2; A.setWind(me.air === 'free' ? 1 : me.air === 'chute' ? 0.22 : 0); }
      if (me.air === 'ground' && Math.hypot(me.x - S.zone.cx, me.z - S.zone.cz) > S.zone.r) { M.zoneTickT -= dt; if (M.zoneTickT <= 0) { M.zoneTickT = 1; A.zoneTick(); } } else M.zoneTickT = 0;
    } else if (!me.alive) { A.setWind(0); }

    // 6) HUD (while spectating it shows the player we are watching)
    H.update(S, cur, dt, view.mode === 'fps' ? crossSpread(me, dt) : 10);
    if (view.mode !== 'fps') {
      H.el.prompt.classList.remove('show'); H.el.pickBtn.classList.remove('show'); H.el.scopeov.className = ''; H.el.cross.style.opacity = 0;
      $('specName').textContent = (S.over ? 'Winner: ' : 'Watching: ') + cur.name;
    }
    if (M.mapOpen) { M.mapT -= dt; if (M.mapT <= 0) { M.mapT = 0.15; H.drawBigMap(S, cur); } }

    // 7) end-of-match timers
    if (M.endT > 0 && !M.paused) { M.endT -= dt; if (M.endT <= 0) showEnd(); }

    // 8) draw
    R.render();
  }

  function frame(now) {
    G.requestAnimationFrame(frame);
    const dt = Math.min(0.1, Math.max(0.0001, (now - M.last) / 1000)); M.last = now;
    if (!M.S) return;
    try { tickFrame(dt); } catch (err) {
      M.frameErrs++; log('frame: ' + (err && err.stack || err));
      if (M.frameErrs === 20) fail(err); // keep playing through a few glitches, stop if it never recovers
    }
  }

  // ------------------------------------------------------------------ boot: menu wiring
  function boot() {
    I.init(); H.init();
    const nameIn = $('nameIn'); nameIn.value = store.get('name', 'Player');

    const qq = qs.get('q');
    M.quality = QUALITIES.indexOf(qq) >= 0 ? qq : (QUALITIES.indexOf(store.get('q', '')) >= 0 ? store.get('q', '') : defaultQuality());
    const qbtns = document.querySelectorAll('.qbtn');
    const markQ = () => qbtns.forEach((b) => b.classList.toggle('on', b.dataset.q === M.quality));
    qbtns.forEach((b) => b.addEventListener('click', () => { M.quality = b.dataset.q; store.set('q', M.quality); markQ(); }));
    markQ();

    const sens = $('sens'), vol = $('vol');
    sens.value = store.get('sens', '1'); I.sens = parseFloat(sens.value) || 1;
    sens.addEventListener('input', () => { I.sens = parseFloat(sens.value) || 1; store.set('sens', sens.value); });
    vol.value = store.get('vol', '0.7'); A.setVolume(parseFloat(vol.value));
    vol.addEventListener('input', () => { A.setVolume(parseFloat(vol.value)); store.set('vol', vol.value); });

    $('btnPlay').addEventListener('click', startMatch);
    $('btnResume').addEventListener('click', resume);
    $('btnMute').addEventListener('click', () => { A.setMuted(!A.muted); $('btnMute').textContent = 'Sound: ' + (A.muted ? 'OFF' : 'ON'); });
    $('btnGfx').addEventListener('click', () => { store.set('q', QUALITIES[(QUALITIES.indexOf(M.quality) + 1) % 3]); location.reload(); });
    $('btnQuit').addEventListener('click', () => { location.reload(); });
    $('btnAgain').addEventListener('click', startMatch);
    $('btnSpectate').addEventListener('click', startSpectate);
    $('btnMenu').addEventListener('click', () => { location.reload(); });
    $('btnNext').addEventListener('click', cycleSpectate);
    $('btnLeave').addEventListener('click', () => { location.reload(); });
    $('bigmap').addEventListener('click', toggleMap);
    $('minimap').addEventListener('pointerdown', (e) => { if (I.touch) { e.preventDefault(); toggleMap(); } }); // tap the minimap = big map

    G.addEventListener('resize', () => R.resize());
    G.addEventListener('orientationchange', () => setTimeout(() => R.resize(), 250));
    document.addEventListener('visibilitychange', () => { if (document.hidden) doPause(); });
    document.addEventListener('contextmenu', (e) => { if (M.S) e.preventDefault(); });

    G.requestAnimationFrame(frame);
    if (qs.get('auto')) startMatch();
  }

  G.__BR = { M, startMatch, SEED, fail };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})(window);
