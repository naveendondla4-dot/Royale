# ZONE ROYALE

An original 3D first-person battle royale that runs in the browser (phone or desktop). 30 players drop onto an island, loot weapons, fight, and stay inside a shrinking circle. You play against 29 bots. The code is split so a multiplayer server can be added later without touching the graphics, HUD or controls.

Frontend only today. No build step, no install.

## Run it

Browsers block some features on `file://`, so serve the folder:

```
cd game
python3 -m http.server 8000
```

Open http://localhost:8000 (on a phone: http://YOUR-PC-IP:8000 on the same Wi-Fi).

It needs internet for two things: the Three.js library (loaded from cdnjs, version r128) and the Rajdhani font. To work offline, download `three.min.js` r128 into `js/vendor/three.min.js`. `index.html` falls back to that file automatically.

URL options: `?seed=123` (different island), `?q=low|medium|high`, `?touch=1` (force touch controls), `?auto=1` (skip the menu).

## Put it online (GitHub Pages) and install as an app

Easiest, works from a phone: run `python3 build_single.py`, or take the ready `dist/` files. Upload these 5 files (no folders) to the root of a public GitHub repo:
`index.html`, `manifest.json`, `sw.js`, `icon-192.png`, `icon-512.png` (plus `icon-maskable-512.png`). Then Settings -> Pages -> branch main, folder / (root).

Open the site link on the phone. The menu shows **Install as app** (Android Chrome opens the install prompt; on iPhone use Share -> Add to Home Screen). The installed app opens fullscreen in landscape and works offline after the first visit.

If PLAY does nothing, the page now says on screen which file or library did not load.

## Controls

| | Desktop | Phone |
|---|---|---|
| Move | WASD | left stick |
| Aim | mouse | drag the right side of the screen |
| Fire | left click | FIRE (drag while holding to aim) |
| Scope | right click / Z | 4x |
| Run / jump / crouch | Shift / Space / C | RUN / JUMP / SIT |
| Reload / swap / heal | R / Q or 1-2 or wheel / H | RELOAD / SWAP / HEAL |
| Pick up weapon | E | PICK (appears near a weapon) |
| Big map | M | tap the minimap |
| Pause | Esc | pause button |

You jump from a cargo plane. While you fall and glide the camera is behind you (you see yourself, the full parachute and the plane); look up/down to swing it around. The parachute opens by itself at 60 m and the view returns to first person when you land. Steer toward a building. Ammo, medkits and armor are picked up by walking over them. Weapons need a pick-up press.

## Files

| File | Job |
|---|---|
| `index.html`, `style.css` | menu, HUD, touch buttons, screens |
| `js/config.js` | every number you may want to tune: speeds, weapons, loot odds, zone phases, bot count |
| `js/world.js`, `js/buildings.js` | deterministic island generator (terrain, towns, roads, trees, loot spots) and collision |
| `js/state.js` | the game rules: movement, shooting, damage, loot, zone, win. Runs in the browser or in Node |
| `js/bots.js` | bot AI. Bots produce the same input object a human does |
| `js/network.js` | where the state comes from. `LocalTransport` runs the sim in the page; `WebSocketTransport` is the multiplayer skeleton |
| `js/input.js` | keyboard / mouse / touch -> one input object |
| `js/audio.js` | all sounds, synthesized with Web Audio (no audio files) |
| `js/render_world.js`, `js/render_actors.js`, `js/renderer.js` | Three.js scene: terrain, buildings, trees, soldiers, effects, first-person gun |
| `js/hud.js` | health, ammo, zone timer, minimap, big map, kill feed |
| `js/game.js` | menu, loading, frame loop, pause / spectate / end screens |

Graphics levels (Low / Medium / High) change resolution, shadows, grass and fog. Low is the default on weaker phones.

## Adding multiplayer later

The simulation (`state.js`) has no knowledge of rendering. Frame flow in `game.js`:

```
Input.poll() -> net.step(dt, input) -> Renderer.update() -> events -> HUD
```

To go online, run the same `state.js` on a Node server as the authority and fill in `WebSocketTransport` in `network.js` (already sketched):

```
client -> server  {t:'join', name}   {t:'input', seq, input}
server -> client  {t:'welcome', id, seed, names:[...], bots}
                  {t:'snap', snap, events:[...]}
```

- The server calls `BR.Sim.tick(state, {playerId: input, ...})` at 60 Hz and sends `BR.Sim.snapshot(state)` about 20 times per second.
- Clients create the match from `seed` (the island is identical everywhere) and call `BR.Sim.applySnapshot` for each snapshot. The renderer already smooths soldier movement.
- `createMatch({humans:[...], bots:N})` accepts several human players. Empty slots can stay bots.
- Still to build for real online play: lobby / matchmaking, client-side prediction of your own movement, lag compensation for hits, anti-cheat checks on inputs, accounts.
- Start `?ws=ws://host:port` to switch `game.js` from `LocalTransport` to `WebSocketTransport`.

## Known limits

- Bots are decent but not smart: no vehicles, no grenades, no teamwork.
- One island, one match mode (solo).
- The 3D view was assembled and logic-tested without a real GPU in the build environment. If you see a visual glitch on your device, tell us the device and browser and the graphics level.
