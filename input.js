/* input.js - turns keyboard / mouse / touch into ONE "input" object (the same shape the simulation and
 * a network server use). Nothing in here knows about the 3D scene. */
(function (G) {
  'use strict';
  const BR = (G.BR = G.BR || {});
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const $ = (id) => document.getElementById(id);

  const Input = {
    enabled: false, touch: false, locked: false, sens: 1, zoomDiv: 1, yaw: 0, pitch: 0, onUI: null,
    out: { mx: 0, mz: 0, yaw: 0, pitch: 0, fire: false, jump: false, sit: false, run: false, reload: false, heal: false, swap: false, pick: false, scope: false, slot: -1 },
    edges: { jump: false, reload: false, heal: false, swap: false, pick: false, slot: -1 },
    keys: {}, sit: false, runT: false, scopeT: false, mouseFire: false, mouseScope: false, touchFire: false, joy: { x: 0, y: 0, mag: 0 },
  };
  let view = null, rmbDrag = false;

  function ui(name) { if (Input.onUI) Input.onUI(name); }
  function look(dx, dy, k) {
    const s = k * Input.sens / Math.sqrt(Input.zoomDiv);
    Input.yaw -= dx * s;
    Input.pitch = clamp(Input.pitch - dy * s, -1.5, 1.5);
  }
  function mark(act, on) { const b = document.querySelector('[data-act="' + act + '"]'); if (b) b.classList.toggle('on', !!on); }
  function press(act) {
    const e = Input.edges;
    if (act === 'jump') e.jump = true;
    else if (act === 'reload') e.reload = true;
    else if (act === 'heal') e.heal = true;
    else if (act === 'swap') e.swap = true;
    else if (act === 'pick') e.pick = true;
    else if (act === 'sit') { Input.sit = !Input.sit; mark('sit', Input.sit); }
    else if (act === 'run') { Input.runT = !Input.runT; mark('run', Input.runT); }
    else if (act === 'scope') { Input.scopeT = !Input.scopeT; mark('scope', Input.scopeT); }
    else if (act === 'map' || act === 'pause') ui(act);
  }

  Input.init = function () {
    view = $('view');
    const q = location.search;
    Input.touch = (window.matchMedia && matchMedia('(pointer: coarse)').matches) || /[?&]touch=1/.test(q);
    document.body.classList.toggle('touch', Input.touch);

    // ---------------- keyboard
    window.addEventListener('keydown', (ev) => {
      if (!Input.enabled) return;
      const c = ev.code;
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(c)) ev.preventDefault();
      if (Input.keys[c] && ev.repeat) return;
      Input.keys[c] = true;
      if (c === 'Space') Input.edges.jump = true;
      else if (c === 'KeyR') Input.edges.reload = true;
      else if (c === 'KeyH') Input.edges.heal = true;
      else if (c === 'KeyQ') Input.edges.swap = true;
      else if (c === 'KeyE' || c === 'KeyF') Input.edges.pick = true;
      else if (c === 'Digit1') Input.edges.slot = 0;
      else if (c === 'Digit2') Input.edges.slot = 1;
      else if (c === 'KeyC') Input.sit = !Input.sit;
      else if (c === 'KeyZ') Input.scopeT = !Input.scopeT;
      else if (c === 'KeyM') ui('map');
      else if (c === 'Escape') ui('pause');
    });
    window.addEventListener('keyup', (ev) => { Input.keys[ev.code] = false; });
    window.addEventListener('blur', () => Input.releaseAll());

    // ---------------- mouse (desktop)
    view.addEventListener('contextmenu', (e) => e.preventDefault());
    view.addEventListener('mousedown', (e) => {
      if (!Input.enabled || Input.touch) return;
      if (!Input.locked && view.requestPointerLock) { try { const r = view.requestPointerLock(); if (r && r.catch) r.catch(() => {}); } catch (_) {} }
      if (e.button === 0) Input.mouseFire = true;
      else if (e.button === 2) { Input.mouseScope = true; rmbDrag = true; }
    });
    window.addEventListener('mouseup', (e) => { if (e.button === 0) Input.mouseFire = false; else if (e.button === 2) { Input.mouseScope = false; rmbDrag = false; } });
    window.addEventListener('mousemove', (e) => {
      if (!Input.enabled || Input.touch) return;
      if (Input.locked || rmbDrag) look(e.movementX || 0, e.movementY || 0, 0.0022);
    });
    window.addEventListener('wheel', (e) => { if (Input.enabled && !Input.touch && Math.abs(e.deltaY) > 4) Input.edges.swap = true; }, { passive: true });
    document.addEventListener('pointerlockchange', () => {
      const was = Input.locked;
      Input.locked = document.pointerLockElement === view;
      if (was && !Input.locked && Input.enabled) ui('pause');
    });

    if (Input.touch) setupTouch();
  };

  function setupTouch() {
    const joyZone = $('joyzone'), base = $('joyBase'), knob = $('joyKnob'), pad = $('lookpad');
    // ---- joystick
    let jid = -1;
    const joyMove = (e) => {
      const r = base.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2, R = r.width / 2;
      let dx = e.clientX - cx, dy = e.clientY - cy; const d = Math.hypot(dx, dy);
      if (d > R) { dx = (dx / d) * R; dy = (dy / d) * R; }
      knob.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
      const m = Math.hypot(dx, dy) / R;
      if (m < 0.12) { Input.joy.x = Input.joy.y = Input.joy.mag = 0; } else { Input.joy.x = dx / R; Input.joy.y = -dy / R; Input.joy.mag = m; }
    };
    const joyEnd = (e) => { if (e.pointerId !== jid) return; jid = -1; knob.style.transform = ''; Input.joy.x = Input.joy.y = Input.joy.mag = 0; };
    joyZone.addEventListener('pointerdown', (e) => { if (jid !== -1) return; jid = e.pointerId; try { joyZone.setPointerCapture(jid); } catch (_) {} joyMove(e); e.preventDefault(); });
    joyZone.addEventListener('pointermove', (e) => { if (e.pointerId === jid) joyMove(e); });
    joyZone.addEventListener('pointerup', joyEnd); joyZone.addEventListener('pointercancel', joyEnd);

    // ---- look pad (right side of the screen)
    const last = {};
    pad.addEventListener('pointerdown', (e) => { last[e.pointerId] = [e.clientX, e.clientY]; try { pad.setPointerCapture(e.pointerId); } catch (_) {} e.preventDefault(); });
    pad.addEventListener('pointermove', (e) => {
      const l = last[e.pointerId]; if (!l) return;
      look(e.clientX - l[0], e.clientY - l[1], 0.0042); l[0] = e.clientX; l[1] = e.clientY;
    });
    const padEnd = (e) => { delete last[e.pointerId]; };
    pad.addEventListener('pointerup', padEnd); pad.addEventListener('pointercancel', padEnd);

    // ---- buttons (FIRE can also steer the camera while it is held)
    document.querySelectorAll('#touch [data-act]').forEach((b) => {
      const act = b.dataset.act; let pid = -1, lx = 0, ly = 0;
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault(); pid = e.pointerId; lx = e.clientX; ly = e.clientY;
        try { b.setPointerCapture(pid); } catch (_) {}
        b.classList.add('down');
        if (act === 'fire') Input.touchFire = true; else press(act);
      });
      b.addEventListener('pointermove', (e) => { if (act === 'fire' && e.pointerId === pid) { look(e.clientX - lx, e.clientY - ly, 0.0042); lx = e.clientX; ly = e.clientY; } });
      const up = (e) => { if (e.pointerId !== pid) return; pid = -1; b.classList.remove('down'); if (act === 'fire') Input.touchFire = false; };
      b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up);
    });
  }

  Input.setEnabled = function (on) { Input.enabled = !!on; if (!on) Input.releaseAll(); };
  Input.releaseAll = function () {
    Input.keys = {}; Input.mouseFire = false; Input.mouseScope = false; Input.touchFire = false; rmbDrag = false;
    Input.joy.x = Input.joy.y = Input.joy.mag = 0;
    const k = $('joyKnob'); if (k) k.style.transform = '';
  };
  Input.reset = function (yaw, pitch) {
    Input.yaw = yaw; Input.pitch = pitch; Input.sit = Input.runT = Input.scopeT = false;
    ['sit', 'run', 'scope'].forEach((a) => mark(a, false));
    Input.ackEdges();
  };
  Input.ackEdges = function () { const e = Input.edges; e.jump = e.reload = e.heal = e.swap = e.pick = false; e.slot = -1; };

  // Called once per rendered frame; returns the (reused) input object.
  Input.poll = function (dt) {
    const o = Input.out, k = Input.keys;
    if (!Input.enabled) { o.mx = o.mz = 0; o.fire = o.jump = o.reload = o.heal = o.swap = o.pick = o.scope = false; o.slot = -1; o.yaw = Input.yaw; o.pitch = Input.pitch; return o; }
    if (k.ArrowLeft) Input.yaw += 1.9 * dt; if (k.ArrowRight) Input.yaw -= 1.9 * dt;
    if (k.ArrowUp) Input.pitch = clamp(Input.pitch + 1.4 * dt, -1.5, 1.5); if (k.ArrowDown) Input.pitch = clamp(Input.pitch - 1.4 * dt, -1.5, 1.5);
    let mx = (k.KeyD ? 1 : 0) - (k.KeyA ? 1 : 0) + Input.joy.x, mz = (k.KeyW ? 1 : 0) - (k.KeyS ? 1 : 0) + Input.joy.y;
    const l = Math.hypot(mx, mz); if (l > 1) { mx /= l; mz /= l; }
    o.mx = mx; o.mz = mz; o.yaw = Input.yaw; o.pitch = Input.pitch;
    o.fire = Input.mouseFire || Input.touchFire;
    o.sit = Input.sit; o.run = !!(k.ShiftLeft || k.ShiftRight || Input.runT || Input.joy.mag > 0.95);
    o.scope = Input.scopeT || Input.mouseScope;
    const e = Input.edges; o.jump = e.jump; o.reload = e.reload; o.heal = e.heal; o.swap = e.swap; o.pick = e.pick; o.slot = e.slot;
    return o;
  };

  BR.Input = Input;
})(window);
