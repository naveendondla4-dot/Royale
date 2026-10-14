/* renderer.js - owns the WebGL renderer, camera, lights, first-person gun, zone walls, loot visuals and effects.
 * It only READS the game state (BR.Sim state) and draws it. */
(function (G) {
  'use strict';
  const BR = (G.BR = G.BR || {});
  const CFG = BR.CFG;

  const QUALITY = {
    low: { pr: 0.8, shadows: false, shadowSize: 0, grass: 0, stride: 2, fog: [45, 260], far: 450, aa: false, std: false, clouds: false },
    medium: { pr: 1, shadows: true, shadowSize: 1024, grass: 5000, stride: 1, fog: [80, 380], far: 800, aa: false, std: false, clouds: true },
    high: { pr: 1.6, shadows: true, shadowSize: 2048, grass: 14000, stride: 1, fog: [100, 520], far: 1000, aa: true, std: true, clouds: true },
  };
  const FOG = 0xcfe3f2;

  const R = {
    QUALITY, ready: false, bobT: 0, dip: 0, lightT: 0, flashT: 0, pkT: 0, time: 0, fov: 75, actors: [], pk: new Map(), errors: [],
  };

  function wallMaterial(THREE, hex, op) {
    return new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false,
      uniforms: { col: { value: new THREE.Color(hex) }, time: { value: 0 }, op: { value: op } },
      vertexShader: 'varying vec2 vUv; varying vec3 vW; void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
      fragmentShader: 'uniform vec3 col; uniform float time; uniform float op; varying vec2 vUv; varying vec3 vW;' +
        'void main(){ float s = 0.5 + 0.5 * sin(vW.y * 0.3 + time * 1.6 + vUv.x * 80.0); gl_FragColor = vec4(col, op * (0.45 + 0.55 * s)); }',
    });
  }

  R.init = function (canvas, qname) {
    const THREE = G.THREE;
    if (!THREE) throw new Error('Three.js did not load (check your internet connection)');
    const q = (R.q = Object.assign({ fogColor: FOG, name: qname }, QUALITY[qname] || QUALITY.medium));
    R.THREE = THREE; R.canvas = canvas;
    const r = (R.renderer = new THREE.WebGLRenderer({ canvas, antialias: q.aa, powerPreference: 'high-performance' }));
    r.outputEncoding = THREE.sRGBEncoding; r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.0;
    r.setPixelRatio(Math.min(G.devicePixelRatio || 1, q.pr)); r.autoClear = false;
    r.shadowMap.enabled = q.shadows; r.shadowMap.type = THREE.PCFSoftShadowMap;
    const scene = (R.scene = new THREE.Scene());
    scene.fog = new THREE.Fog(FOG, q.fog[0], q.fog[1]);
    R.camera = new THREE.PerspectiveCamera(75, 1, 0.08, q.far); R.camera.rotation.order = 'YXZ';

    R.hemi = new THREE.HemisphereLight(0xcfe4ff, 0x5d6b3a, 0.85); scene.add(R.hemi);
    const sun = (R.sun = new THREE.DirectionalLight(0xfff0d8, 2.1));
    if (q.shadows) {
      sun.castShadow = true; sun.shadow.mapSize.set(q.shadowSize, q.shadowSize);
      const c = sun.shadow.camera; c.left = c.bottom = -65; c.right = c.top = 65; c.near = 10; c.far = 340; c.updateProjectionMatrix();
      sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.5;
    }
    scene.add(sun); scene.add(sun.target);
    R.muzzleLight = new THREE.PointLight(0xffb060, 0, 14, 2); scene.add(R.muzzleLight);
    R.sunDir = new THREE.Vector3(-0.45, 0.62, -0.5).normalize();

    // first-person weapon lives in its own scene so it never clips into walls
    R.vmScene = new THREE.Scene(); R.vmCam = new THREE.PerspectiveCamera(55, 1, 0.01, 10);
    R.vmScene.add(new THREE.HemisphereLight(0xffffff, 0x777766, 1.1));
    const vl = new THREE.DirectionalLight(0xffffff, 1.6); vl.position.set(1, 2, 1.5); R.vmScene.add(vl);
    const vg = (R.vm = { group: new THREE.Group(), gunId: null, gun: null, kick: 0, draw: 0 });
    R.vmScene.add(vg.group);
    const skin = new THREE.MeshLambertMaterial({ color: new THREE.Color(0xe0b48c).convertSRGBToLinear() }), sleeve = new THREE.MeshLambertMaterial({ color: new THREE.Color(0x3a4a5a).convertSRGBToLinear() });
    const part = (w, h, d, m, x, y, z, rx) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.set(x, y, z); if (rx) b.rotation.x = rx; vg.group.add(b); return b; };
    part(0.065, 0.075, 0.09, skin, 0, -0.065, 0.03); part(0.085, 0.085, 0.3, sleeve, 0.0, -0.12, 0.24, -0.35);
    vg.lhand = part(0.065, 0.07, 0.1, skin, -0.02, -0.04, -0.3); vg.lsleeve = part(0.08, 0.08, 0.3, sleeve, -0.07, -0.1, -0.12, 0.25);
    vg.flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: G.BR.Actors.flashTexture(THREE), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, depthTest: false })); vg.flash.visible = false;

    R.fx = new BR.Actors.Effects(THREE, scene);
    R.actorGroup = new THREE.Group(); scene.add(R.actorGroup);
    R.pickupGroup = new THREE.Group(); scene.add(R.pickupGroup);
    const wallGeo = new THREE.CylinderGeometry(1, 1, 400, 72, 1, true);
    R.zoneWall = new THREE.Mesh(wallGeo, wallMaterial(THREE, 0x2fb8ff, 0.36)); R.zoneWall.position.y = 100; R.zoneWall.frustumCulled = false; scene.add(R.zoneWall);
    R.nextWall = new THREE.Mesh(wallGeo, wallMaterial(THREE, 0xffffff, 0.16)); R.nextWall.position.y = 100; R.nextWall.frustumCulled = false; scene.add(R.nextWall);
    R.resize(); R.ready = true;
  };

  R.resize = function () {
    if (!R.renderer) return;
    const w = G.innerWidth, h = G.innerHeight;
    R.renderer.setSize(w, h, false);
    R.camera.aspect = w / h; R.camera.updateProjectionMatrix();
    R.vmCam.aspect = w / h; R.vmCam.updateProjectionMatrix();
  };

  R.buildWorld = function (world, log) {
    const res = BR.RenderWorld.build(R.THREE, R.scene, world, R.q, (m) => { R.errors.push(m); if (log) log(m); });
    R.world = world; R.sky = res.sky; R.clouds = res.clouds || [];
    if (res.sunDir) R.sunDir.copy(res.sunDir);
  };

  // new match: fresh soldiers + loot visuals
  R.resetMatch = function (S) {
    for (const a of R.actors) R.actorGroup.remove(a.root);
    R.actors = S.players.map((p) => { const a = BR.Actors.makeSoldier(R.THREE, p); R.actorGroup.add(a.root); return a; });
    for (const e of R.pk.values()) R.pickupGroup.remove(e.g);
    R.pk.clear(); R.pkT = 0; R.dip = 0;
  };

  R.onEvent = function (S, e, view) {
    const T = R.THREE;
    if (e.t === 'shot') {
      const mine = e.id === view.id && view.mode === 'fps';
      const cam = R.camera.position;
      let sx, sy, sz;
      if (mine) {
        R.camera.updateMatrixWorld(); const v = new T.Vector3(0.17, -0.12, -0.95).applyMatrix4(R.camera.matrixWorld); sx = v.x; sy = v.y; sz = v.z;
        R.vm.kick = 1; R.flashT = 0.05; R.muzzleLight.position.copy(v); R.muzzleLight.intensity = 2.5; R.lightT = 0.05;
      } else {
        const p = S.players[e.id], yaw = p ? p.yaw : 0;
        sx = e.ox - Math.sin(yaw) * 0.8; sy = e.oy - 0.25; sz = e.oz - Math.cos(yaw) * 0.8;
        if (Math.hypot(sx - cam.x, sz - cam.z) < 160) R.fx.flash(sx, sy, sz);
      }
      if (Math.hypot(e.ex - cam.x, e.ez - cam.z) < 320 || Math.hypot(sx - cam.x, sz - cam.z) < 320) R.fx.tracer(sx, sy, sz, e.ex, e.ey, e.ez);
      if (e.hit !== '-') R.fx.burst(e.ex, e.ey, e.ez, e.role, e.hit === 'p' ? 10 : 7);
    } else if (e.t === 'land' && e.id === view.id) R.dip = 0.3;
  };

  function updatePickups(S, dt) {
    R.pkT -= dt;
    const cam = R.camera.position, T = R.THREE;
    if (R.pkT <= 0) {
      R.pkT = 0.2;
      const alive = new Set();
      for (const k of S.pickups) {
        const d2 = (k.x - cam.x) * (k.x - cam.x) + (k.z - cam.z) * (k.z - cam.z);
        if (d2 > 3600) continue;
        alive.add(k.id);
        if (!R.pk.has(k.id)) { const e = BR.Actors.makePickup(T, k); R.pickupGroup.add(e.g); R.pk.set(k.id, e); }
      }
      for (const [id, e] of R.pk) if (!alive.has(id)) { R.pickupGroup.remove(e.g); e.g.traverse((o) => { if (o.material && o.material.transparent) o.material.dispose(); }); R.pk.delete(id); }
    }
    for (const [id, e] of R.pk) { e.inner.rotation.y += dt * 1.8; e.inner.position.y = 0.55 + Math.sin(R.time * 2 + id) * 0.07; }
  }

  // view = { id, mode: 'fps' | 'spectate' };  ui = { scopeZoom }
  R.update = function (S, dt, view, ui) {
    if (!R.ready) return;
    R.time += dt;
    const T = R.THREE, cam = R.camera, me = S.players[view.id], fps = view.mode === 'fps' && me && me.alive, vm = R.vm;
    const baseFov = cam.aspect < 1 ? 95 : 75;

    // ---- camera
    if (me) {
      if (fps) {
        if (me.air === 'ground') R.bobT += me.speed * dt * 1.7;
        const amp = me.air === 'ground' && me.onGround ? Math.min(1, me.speed / 5) : 0;
        R.dip = Math.max(0, R.dip - dt * 1.4);
        const eye = BR.Sim.eyeY(me);
        cam.position.set(me.x, eye + Math.abs(Math.sin(R.bobT)) * 0.035 * amp - Math.sin(Math.min(1, R.dip / 0.3) * 3.14) * 0.1 * R.dip, me.z);
        cam.rotation.set(me.pitch + me.recoil, me.yaw, Math.cos(R.bobT) * 0.008 * amp);
        const zoom = me.scope ? ui.scopeZoom || 1 : 1;
        const tf = (2 * Math.atan(Math.tan((baseFov * Math.PI) / 360) / zoom) * 180) / Math.PI + (me.speed > 6 && !me.scope ? 4 : 0) + (me.air === 'free' ? 10 : 0);
        R.fov += (tf - R.fov) * Math.min(1, 14 * dt);
      } else {
        const a = R.actors[me.id];
        if (a) {
          const px = a.x + Math.sin(me.yaw) * 5.5, pz = a.z + Math.cos(me.yaw) * 5.5, py = Math.max(a.y + 2.8, S.world.heightAt(px, pz) + 1.5);
          cam.position.set(px, py, pz); cam.lookAt(a.x, a.y + 1.3, a.z);
        }
        R.fov += (baseFov - R.fov) * Math.min(1, 6 * dt);
      }
      if (Math.abs(cam.fov - R.fov) > 0.05) { cam.fov = R.fov; cam.updateProjectionMatrix(); }
    }
    cam.updateMatrixWorld();

    // ---- sky, clouds, sun + shadow follow the camera
    if (R.sky) R.sky.position.copy(cam.position);
    for (const c of R.clouds) { c.position.x += c.userData.sp * dt; if (c.position.x > 700) c.position.x = -700; }
    const ts = R.q.shadows ? 130 / R.q.shadowSize : 1, tx = Math.round(cam.position.x / ts) * ts, tz = Math.round(cam.position.z / ts) * ts;
    R.sun.target.position.set(tx, cam.position.y - 2, tz);
    R.sun.position.set(tx + R.sunDir.x * 160, cam.position.y - 2 + R.sunDir.y * 160, tz + R.sunDir.z * 160);
    R.sun.target.updateMatrixWorld();

    // ---- soldiers
    for (const p of S.players) {
      const a = R.actors[p.id]; if (!a) continue;
      const hide = (fps && p.id === view.id) || Math.hypot(p.x - cam.position.x, p.z - cam.position.z) > (p.alive ? 230 : 120) || (p.air !== 'ground' && !p.alive);
      a.root.visible = !hide;
      if (hide) { a.x = p.x; a.y = p.y; a.z = p.z; continue; }
      const w = p.weapons[p.cur];
      BR.Actors.setGun(T, a, p.alive ? (w ? w.id : null) : null);
      BR.Actors.poseSoldier(a, p, dt, S.time);
    }

    // ---- zone walls
    const z = S.zone;
    R.zoneWall.visible = z.r > 0.5; R.zoneWall.position.set(z.cx, 100, z.cz); R.zoneWall.scale.set(Math.max(z.r, 0.01), 1, Math.max(z.r, 0.01)); R.zoneWall.material.uniforms.time.value = R.time;
    R.nextWall.visible = z.state === 'wait' && z.tr > 0.5; R.nextWall.position.set(z.tcx, 100, z.tcz); R.nextWall.scale.set(Math.max(z.tr, 0.01), 1, Math.max(z.tr, 0.01)); R.nextWall.material.uniforms.time.value = R.time;

    updatePickups(S, dt);
    R.fx.update(dt);
    if (R.lightT > 0) { R.lightT -= dt; if (R.lightT <= 0) R.muzzleLight.intensity = 0; }

    // ---- first-person weapon
    const w = me && me.weapons[me.cur], wid = w ? w.id : null;
    const showVm = !!(fps && me.air === 'ground' && !me.scope && wid);
    vm.group.visible = showVm; R.showVm = showVm;
    if (showVm) {
      if (wid !== vm.gunId) {
        if (vm.gun) vm.group.remove(vm.gun);
        vm.gunId = wid; vm.gun = BR.Actors.gunMesh(T, wid); vm.group.add(vm.gun); vm.gun.add(vm.flash);
        vm.flash.position.set(0, 0.03, -(vm.gun.userData.len + 0.06)); vm.draw = 1;
        vm.lhand.visible = vm.lsleeve.visible = wid !== 'pistol';
      }
      vm.kick *= Math.exp(-14 * dt); vm.draw = Math.max(0, vm.draw - dt * 3.2);
      const amp = me.onGround ? Math.min(1, me.speed / 5) : 0, running = me.speed > 6;
      let x = 0.17 + Math.sin(R.bobT) * 0.012 * amp, y = -0.19 + Math.abs(Math.cos(R.bobT)) * 0.012 * amp - vm.draw * 0.3, rz = 0, rx = vm.kick * 0.1, ry = 0;
      if (running) { y -= 0.04; ry = 0.35; rx -= 0.15; }
      if (me.reloadT > 0) { const prog = 1 - me.reloadT / CFG.WEAPONS[wid].reload, dip = Math.sin(prog * Math.PI); y -= dip * 0.2; rx -= dip * 0.6; rz = dip * 0.4; }
      if (me.healT > 0) y -= 0.35;
      vm.group.position.set(x, y, -0.2 + vm.kick * 0.06); vm.group.rotation.set(rx, ry, rz);
      R.flashT -= dt; vm.flash.visible = R.flashT > 0; if (vm.flash.visible) vm.flash.scale.setScalar(0.18 + Math.random() * 0.1);
    }
  };

  R.render = function () {
    if (!R.ready) return;
    R.renderer.clear();
    R.renderer.render(R.scene, R.camera);
    if (R.showVm) { R.renderer.clearDepth(); R.renderer.render(R.vmScene, R.vmCam); }
  };

  BR.Renderer = R;
})(window);
