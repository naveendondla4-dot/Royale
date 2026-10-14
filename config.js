/* config.js - every tunable number lives here.
 * Shared by the browser client and (later) a Node backend, so it must not touch the DOM or THREE. */
(function (G) {
  'use strict';
  const BR = (G.BR = G.BR || {});

  BR.CFG = {
    NAME: 'ZONE ROYALE',
    DT: 1 / 60, // fixed simulation step (seconds)
    MAP: 640, // square map, centered at (0,0)
    BOTS: 29, // + 1 human = 30 players

    PLAYER: { R: 0.4, H: 1.75, H_SIT: 1.2, EYE: 1.6, EYE_SIT: 1.1, STEP: 0.5 },
    MOVE: { WALK: 4.6, RUN: 7.2, SIT: 2.4, ACCEL: 14, AIR_ACCEL: 2.5, JUMP: 6.3, GRAVITY: 20 },
    HP: 100,
    ARMOR: 100,

    // Everybody starts in the air: free fall, then the parachute opens automatically.
    DROP: { ALT: 380, FREE_V: 40, CHUTE_ALT: 60, CHUTE_V: 7, GLIDE_FREE: 26, GLIDE_CHUTE: 12 },
    HEAL: { TIME: 2.8, AMOUNT: 60, MAX: 4 },

    // Safe zone. wait = seconds before it starts closing, shrink = seconds it takes to close, r = new radius.
    ZONE: {
      START_R: 340,
      PHASES: [
        { wait: 70, shrink: 40, r: 210, dps: 1 },
        { wait: 35, shrink: 32, r: 130, dps: 2 },
        { wait: 28, shrink: 26, r: 75, dps: 3 },
        { wait: 22, shrink: 22, r: 38, dps: 5 },
        { wait: 16, shrink: 18, r: 14, dps: 8 },
        { wait: 10, shrink: 14, r: 0, dps: 12 },
      ],
    },

    // dmg = per pellet, rate = shots/sec, spread/move = cone (radians), kick = recoil (radians per shot),
    // zoom = scope magnification (the "4x" button), tier = rarity (0 common .. 3 epic, 4 legendary)
    WEAPONS: {
      pistol: { name: 'Sidekick', tier: 0, dmg: 24, rate: 5.0, auto: false, mag: 12, reload: 1.3, spread: 0.010, move: 0.020, range: 80, pellets: 1, kick: 0.012, zoom: 2 },
      smg: { name: 'Viper SMG', tier: 1, dmg: 15, rate: 14, auto: true, mag: 32, reload: 1.7, spread: 0.022, move: 0.030, range: 60, pellets: 1, kick: 0.008, zoom: 2 },
      ar: { name: 'Ranger AR', tier: 2, dmg: 26, rate: 9.5, auto: true, mag: 30, reload: 2.0, spread: 0.014, move: 0.028, range: 130, pellets: 1, kick: 0.010, zoom: 4 },
      shotgun: { name: 'Hammer SG', tier: 2, dmg: 12, rate: 1.15, auto: false, mag: 6, reload: 2.6, spread: 0.055, move: 0.020, range: 32, pellets: 8, kick: 0.07, zoom: 2 },
      sniper: { name: 'Longshot', tier: 3, dmg: 90, rate: 0.85, auto: false, mag: 5, reload: 2.9, spread: 0.0015, move: 0.06, range: 320, pellets: 1, kick: 0.10, zoom: 8, headMul: 2.5 },
    },
    HEAD_MUL: 2.0,
    RARITY_COLORS: ['#cfd8dc', '#66bb6a', '#29b6f6', '#ab47bc', '#ffb300'],

    // Loot generation. Spot tier: 0 = outdoors, 1 = cabins / barns, 2 = town houses.
    LOOT: {
      KIND_W: [
        { weapon: 0.28, ammo: 0.34, medkit: 0.14, armor: 0.08, none: 0.16 },
        { weapon: 0.36, ammo: 0.30, medkit: 0.16, armor: 0.12, none: 0.06 },
        { weapon: 0.42, ammo: 0.26, medkit: 0.16, armor: 0.14, none: 0.02 },
      ],
      WEAPON_W: [
        { pistol: 5, smg: 3, shotgun: 1.5, ar: 1 },
        { pistol: 2, smg: 3, ar: 3, shotgun: 2, sniper: 0.6 },
        { smg: 2, ar: 4, shotgun: 3, sniper: 1.5, pistol: 1 },
      ],
      AMMO_BOX: 45,
      ARMOR_GIVE: 60,
      START_AMMO: 60,
    },
  };
})(typeof window !== 'undefined' ? window : globalThis);
