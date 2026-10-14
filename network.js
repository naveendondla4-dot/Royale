/* network.js - the ONLY place that decides where the game state comes from.
 *
 *   LocalTransport      (used now)  runs BR.Sim right here in the browser against bots.
 *   WebSocketTransport  (future)    sends your input to a server and applies its snapshots.
 *
 * Both expose the same tiny interface, so renderer / HUD / input never change when a backend is added:
 *     start(opts)        -> Promise<state>
 *     step(dt, input)    -> number of simulation ticks that ran (so input edges can be acknowledged)
 *     state              -> current game state (BR.Sim state shape)
 *     localId            -> id of the player this browser controls
 *     close()
 *
 * Wire protocol for the future server (JSON, see README):
 *   client -> server  {t:'join', name}   {t:'input', seq, input}
 *   server -> client  {t:'welcome', id, seed, names:[...], bots}   {t:'snap', snap, events:[...]}
 */
(function (G) {
  'use strict';
  const BR = (G.BR = G.BR || {});
  const CFG = BR.CFG;

  class LocalTransport {
    constructor() { this.state = null; this.localId = 0; this.acc = 0; this.world = null; this.tmp = {}; }
    start(opts) {
      this.state = BR.Sim.createMatch({ seed: opts.seed, matchSeed: opts.matchSeed, world: this.world, humans: [{ name: opts.name || 'Player' }] });
      this.world = this.state.world; // re-use the generated map for "play again" with the same seed
      this.localId = 0; this.acc = 0;
      return Promise.resolve(this.state);
    }
    step(dt, input) {
      const S = this.state; if (!S) return 0;
      this.acc = Math.min(this.acc + dt, 0.25);
      let n = 0;
      const first = input, rest = this.tmp;
      while (this.acc >= CFG.DT) {
        let inp = first;
        if (n > 0) { Object.assign(rest, input); rest.jump = rest.reload = rest.heal = rest.swap = rest.pick = false; rest.slot = -1; inp = rest; } // one-shot presses only count once
        BR.Sim.tick(S, { [this.localId]: inp }, CFG.DT);
        this.acc -= CFG.DT; n++;
        if (S.over) break;
      }
      return n;
    }
    close() { this.state = null; }
  }

  // Skeleton for online play. Not connected to anything yet: pass a ws:// URL when you have a server.
  class WebSocketTransport {
    constructor(url) { this.url = url; this.ws = null; this.state = null; this.localId = -1; this.seq = 0; this.pending = []; this.sendAcc = 0; }
    start(opts) {
      return new Promise((resolve, reject) => {
        const ws = (this.ws = new WebSocket(this.url));
        ws.onopen = () => ws.send(JSON.stringify({ t: 'join', name: opts.name || 'Player' }));
        ws.onerror = () => reject(new Error('Could not reach the game server'));
        ws.onmessage = (m) => {
          const msg = JSON.parse(m.data);
          if (msg.t === 'welcome') {
            this.localId = msg.id;
            this.state = BR.Sim.createMatch({ seed: msg.seed, humans: msg.names.map((n) => ({ name: n })), bots: msg.bots || 0 });
            resolve(this.state);
          } else if (msg.t === 'snap' && this.state) {
            BR.Sim.applySnapshot(this.state, msg.snap);
            for (const e of msg.events || []) this.state.events.push(e);
          }
        };
      });
    }
    step(dt, input) {
      this.sendAcc += dt;
      if (this.ws && this.ws.readyState === 1 && this.sendAcc >= 1 / 30) { // 30 input packets per second
        this.sendAcc = 0;
        this.ws.send(JSON.stringify({ t: 'input', seq: ++this.seq, input }));
        input.jump = input.reload = input.heal = input.swap = input.pick = false;
      }
      return 1; // the server owns time; the client just renders the newest snapshot
    }
    close() { if (this.ws) this.ws.close(); }
  }

  BR.Net = { LocalTransport, WebSocketTransport, create: (url) => (url ? new WebSocketTransport(url) : new LocalTransport()) };
})(window);
