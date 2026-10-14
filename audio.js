/* audio.js - every sound is generated with the Web Audio API (no sound files needed).
 * Gun shots, hits, footsteps, pickups, parachute wind, zone alarm, kill / win jingles. */
(function (G) {
  'use strict';
  const BR = (G.BR = G.BR || {});
  const A = { ctx: null, master: null, noise: null, vol: 0.7, muted: false, lx: 0, lz: 0, lyaw: 0, wind: null };

  const GUNS = {
    pistol: { n: 'bandpass', f0: 2600, f1: 900, q: 0.8, dur: 0.13, g: 0.8, t0: 170, t1: 60, td: 0.1, tg: 0.7 },
    smg: { n: 'bandpass', f0: 3000, f1: 1100, q: 0.7, dur: 0.09, g: 0.7, t0: 150, t1: 70, td: 0.07, tg: 0.55 },
    ar: { n: 'bandpass', f0: 1800, f1: 600, q: 0.6, dur: 0.16, g: 0.95, t0: 130, t1: 50, td: 0.12, tg: 0.85 },
    shotgun: { n: 'lowpass', f0: 2400, f1: 300, q: 0.7, dur: 0.32, g: 1.1, t0: 100, t1: 35, td: 0.2, tg: 1.0 },
    sniper: { n: 'lowpass', f0: 2800, f1: 200, q: 0.7, dur: 0.55, g: 1.2, t0: 90, t1: 30, td: 0.28, tg: 1.1 },
  };

  A.init = function () {
    if (A.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try { A.ctx = new AC(); } catch (e) { return; }
    const c = A.ctx;
    const comp = c.createDynamicsCompressor();
    A.master = c.createGain(); A.master.gain.value = A.muted ? 0 : A.vol;
    A.master.connect(comp); comp.connect(c.destination);
    const len = c.sampleRate * 2, buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    A.noise = buf;
    // looping wind (louder while falling)
    const s = c.createBufferSource(); s.buffer = buf; s.loop = true;
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 520;
    const g = c.createGain(); g.gain.value = 0.02;
    s.connect(f); f.connect(g); g.connect(A.master); s.start();
    A.wind = { g, f };
  };
  A.resume = function () { if (A.ctx && A.ctx.state === 'suspended') A.ctx.resume(); };
  A.ok = () => A.ctx && A.ctx.state === 'running';
  A.setVolume = function (v) { A.vol = v; if (A.master) A.master.gain.value = A.muted ? 0 : v; };
  A.setMuted = function (m) { A.muted = m; if (A.master) A.master.gain.value = m ? 0 : A.vol; };
  A.setListener = function (x, z, yaw) { A.lx = x; A.lz = z; A.lyaw = yaw; };
  A.setWind = function (level) { // 0 = calm, 1 = free fall
    if (!A.wind || !A.ok()) return;
    const t = A.ctx.currentTime;
    A.wind.g.gain.setTargetAtTime(0.02 + level * 0.32, t, 0.3);
    A.wind.f.frequency.setTargetAtTime(520 + level * 1800, t, 0.3);
  };

  // ---- small helpers
  function dest(gain, pan, lp) {
    const c = A.ctx, g = c.createGain(); g.gain.value = gain;
    let tail = g;
    if (lp && lp < 15000) { const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lp; tail.connect(f); tail = f; }
    if (pan && c.createStereoPanner) { const p = c.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, pan)); tail.connect(p); tail = p; }
    tail.connect(A.master);
    return g;
  }
  function noiseBurst(t, dur, type, f0, f1, q, g, d) {
    const c = A.ctx, s = c.createBufferSource(); s.buffer = A.noise;
    const f = c.createBiquadFilter(); f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
    const e = c.createGain(); e.gain.setValueAtTime(0.0001, t); e.gain.exponentialRampToValueAtTime(g, t + 0.004); e.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(e); e.connect(d); s.start(t, Math.random()); s.stop(t + dur + 0.05);
  }
  function tone(t, type, f0, f1, dur, g, d) {
    const c = A.ctx, o = c.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
    const e = c.createGain(); e.gain.setValueAtTime(0.0001, t); e.gain.exponentialRampToValueAtTime(g, t + 0.006); e.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(e); e.connect(d); o.start(t); o.stop(t + dur + 0.05);
  }

  // ---- gameplay sounds
  // x,z = where the shot happened; own = fired by the local player
  A.shot = function (wid, x, z, own) {
    if (!A.ok()) return;
    const gun = GUNS[wid] || GUNS.pistol, dx = x - A.lx, dz = z - A.lz, d = own ? 0 : Math.hypot(dx, dz);
    if (d > 280) return;
    const pan = own ? 0 : (dx * Math.cos(A.lyaw) - dz * Math.sin(A.lyaw)) / Math.max(d, 1);
    const out = dest((own ? 1 : 1 / (1 + d / 16)) * 0.9, pan, 7000 / (1 + d / 45)), t = A.ctx.currentTime;
    noiseBurst(t, gun.dur, gun.n, gun.f0, gun.f1, gun.q, gun.g, out);
    noiseBurst(t, 0.02, 'highpass', 5000, 3000, 0.5, gun.g * 0.5, out); // crack
    tone(t, 'sine', gun.t0, gun.t1, gun.td, gun.tg, out); // thump
    if (wid === 'sniper' || wid === 'shotgun') noiseBurst(t + 0.03, 0.7, 'lowpass', 500, 120, 0.5, gun.g * 0.35, out); // tail
  };
  A.hit = function (head) {
    if (!A.ok()) return; const t = A.ctx.currentTime, o = dest(0.5);
    tone(t, 'square', head ? 2600 : 1700, head ? 2200 : 1300, 0.05, 0.25, o);
    if (head) tone(t + 0.04, 'sine', 3200, 3000, 0.18, 0.25, o);
  };
  A.hurt = function (dmg) {
    if (!A.ok()) return; const t = A.ctx.currentTime, o = dest(Math.min(1, 0.4 + dmg / 40));
    tone(t, 'sine', 120, 45, 0.18, 0.9, o); noiseBurst(t, 0.12, 'lowpass', 900, 200, 0.7, 0.5, o);
  };
  A.step = function (vol) {
    if (!A.ok()) return; const t = A.ctx.currentTime, o = dest(vol * 0.5);
    noiseBurst(t, 0.07, 'lowpass', 500 + Math.random() * 300, 160, 0.8, 0.45, o);
  };
  A.pickup = function (kind) {
    if (!A.ok()) return; const t = A.ctx.currentTime, o = dest(0.5), b = kind === 'weapon' ? 520 : kind === 'medkit' ? 700 : 880;
    tone(t, 'triangle', b, b * 1.5, 0.1, 0.5, o); tone(t + 0.08, 'triangle', b * 1.5, b * 2, 0.14, 0.5, o);
  };
  A.reload = function (dur) {
    if (!A.ok()) return; const t = A.ctx.currentTime, o = dest(0.6);
    noiseBurst(t + 0.05, 0.04, 'bandpass', 3500, 2500, 3, 0.7, o); noiseBurst(t + Math.max(0.2, dur * 0.7), 0.05, 'bandpass', 2600, 1800, 3, 0.9, o);
  };
  A.dry = function () { if (!A.ok()) return; const o = dest(0.4); noiseBurst(A.ctx.currentTime, 0.03, 'bandpass', 4200, 3500, 4, 0.6, o); };
  A.heal = function (done) {
    if (!A.ok()) return; const t = A.ctx.currentTime, o = dest(0.45);
    if (done) { [523, 659, 784, 1046].forEach((f, i) => tone(t + i * 0.08, 'sine', f, f, 0.25, 0.5, o)); } else { tone(t, 'sine', 440, 520, 0.4, 0.3, o); }
  };
  A.zone = function () { // alarm when the circle starts closing
    if (!A.ok()) return; const t = A.ctx.currentTime, o = dest(0.45);
    for (let i = 0; i < 3; i++) { tone(t + i * 0.32, 'sawtooth', 520, 520, 0.14, 0.35, o); tone(t + i * 0.32 + 0.16, 'sawtooth', 780, 780, 0.14, 0.35, o); }
  };
  A.zoneTick = function () { if (!A.ok()) return; const o = dest(0.4); tone(A.ctx.currentTime, 'sine', 220, 110, 0.22, 0.8, o); };
  A.chute = function () { if (!A.ok()) return; const t = A.ctx.currentTime, o = dest(0.8); noiseBurst(t, 0.6, 'bandpass', 600, 2400, 0.6, 0.8, o); tone(t, 'sine', 90, 40, 0.3, 0.8, o); };
  A.land = function () { if (!A.ok()) return; const t = A.ctx.currentTime, o = dest(0.7); tone(t, 'sine', 90, 40, 0.2, 0.8, o); noiseBurst(t, 0.15, 'lowpass', 800, 150, 0.6, 0.6, o); };
  A.jump = function () { if (!A.ok()) return; noiseBurst(A.ctx.currentTime, 0.08, 'lowpass', 700, 300, 0.7, 0.25, dest(0.35)); };
  A.kill = function () { // you eliminated someone
    if (!A.ok()) return; const t = A.ctx.currentTime, o = dest(0.55);
    [660, 880, 1320].forEach((f, i) => tone(t + i * 0.07, 'square', f, f, 0.16, 0.22, o));
  };
  A.win = function () { if (!A.ok()) return; const t = A.ctx.currentTime, o = dest(0.6); [523, 659, 784, 1046, 784, 1046, 1318].forEach((f, i) => tone(t + i * 0.16, 'triangle', f, f, 0.3, 0.5, o)); };
  A.lose = function () { if (!A.ok()) return; const t = A.ctx.currentTime, o = dest(0.55); [392, 330, 262, 196].forEach((f, i) => tone(t + i * 0.22, 'sawtooth', f, f * 0.97, 0.3, 0.3, o)); };
  A.click = function () { if (!A.ok()) return; tone(A.ctx.currentTime, 'square', 900, 700, 0.04, 0.2, dest(0.4)); };

  BR.Audio = A;
})(window);
