// ============================================================
// Net abstraction.
// 3 transports, all expose the same .send(obj) / on(t, fn) API:
//   - BotNet   : single-player offline. The "opponent" is an AI driven
//                in main.js. Net just echoes shoot/hit locally.
//   - PeerNet  : WebRTC P2P via PeerJS (free public broker). Either side
//                opens a room with a short code; other side joins.
//   - (future)  WS server transport — removed for GitHub Pages.
//
// Messages we use (between the two peers):
//   {t:'hello', name, charId}
//   {t:'input', pos:[x,z], y, rotY, aim:{dx,dy}|null}
//   {t:'shoot', pos:[x,z], y, dir:[dx,dz], kind, h, skillKind?}
//   {t:'hit',   dmg}             // I tell opponent: "I took dmg"
//   {t:'heal',  amount}
//   {t:'timer', remaining}       // host-only broadcast
//   {t:'start', seed}            // host -> guest: start a match
//   {t:'end',   winner}          // 0/1/-1, sent by host when game ends
// ============================================================

class EventBus {
  constructor() { this.handlers = {}; }
  on(t, fn) { this.handlers[t] = fn; }
  emit(t, m) { if (this.handlers[t]) this.handlers[t](m); }
}

// ----- BotNet: solo vs AI -----
export class BotNet extends EventBus {
  constructor() { super(); this.isBot = true; this.isHost = true; }
  connect() { setTimeout(() => this.emit('open'), 0); }
  send(obj) {
    // Most messages are local-only; we ignore them. Bot AI lives in main.js
    // and writes directly to state. We just forward a few that need
    // round-trip semantics: 'hit' to compute hp; 'heal' to grant hp.
    // Those are also handled in main.js's gameplay code.
  }
  disconnect() {}
}

// ----- PeerNet: P2P via PeerJS broker -----
// PeerJS docs: https://peerjs.com/
// We load it lazily from CDN. Either side becomes "host" (creates a Peer with a
// human-friendly short id) or "guest" (connects to that id).
//
// Room code is a 6-char base36 string, prefixed so we never collide with random ids
// on PeerJS's public broker. e.g. "taiman-x3k9q2".
// ----------------------------------------------------------------------
const PEERJS_CDN = 'https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js';
let _peerJSLoadPromise = null;
function loadPeerJS() {
  if (window.Peer) return Promise.resolve();
  if (_peerJSLoadPromise) return _peerJSLoadPromise;
  _peerJSLoadPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = PEERJS_CDN;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('PeerJS load failed'));
    document.head.appendChild(s);
  });
  return _peerJSLoadPromise;
}

function makeRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no confusing chars
  let s = '';
  for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

function roomToPeerId(code) {
  return 'taiman-' + code.toUpperCase();
}

export class PeerNet extends EventBus {
  constructor() {
    super();
    this.isBot = false;
    this.peer = null;
    this.conn = null;
    this.isHost = false;
    this.roomCode = null;
  }

  async host() {
    await loadPeerJS();
    return new Promise((resolve, reject) => {
      // Try short codes until one is free
      const attempt = () => {
        const code = makeRoomCode();
        const peerId = roomToPeerId(code);
        const peer = new Peer(peerId, { debug: 0 });
        let opened = false;
        peer.on('open', (id) => {
          opened = true;
          this.peer = peer;
          this.isHost = true;
          this.roomCode = code;
          this.emit('roomOpened', { code });
          // Wait for guest
          peer.on('connection', (conn) => {
            this.conn = conn;
            this._wireConn(conn);
          });
          resolve(code);
        });
        peer.on('error', (err) => {
          // If id is taken, retry with another
          if (!opened && (err.type === 'unavailable-id' || /taken/i.test(err.message))) {
            try { peer.destroy(); } catch {}
            return attempt();
          }
          if (!opened) {
            reject(err);
          } else {
            this.emit('error', err);
          }
        });
      };
      attempt();
    });
  }

  async join(code) {
    await loadPeerJS();
    return new Promise((resolve, reject) => {
      const peer = new Peer(undefined, { debug: 0 });
      this.peer = peer;
      this.isHost = false;
      this.roomCode = code.toUpperCase();
      peer.on('open', () => {
        const conn = peer.connect(roomToPeerId(this.roomCode), { reliable: true });
        this.conn = conn;
        this._wireConn(conn, resolve, reject);
      });
      peer.on('error', (err) => {
        if (err.type === 'peer-unavailable') {
          reject(new Error('合言葉が見つからない'));
        } else {
          reject(err);
        }
      });
      // Timeout
      setTimeout(() => {
        if (!this.conn || !this.conn.open) {
          try { peer.destroy(); } catch {}
          reject(new Error('接続タイムアウト'));
        }
      }, 12000);
    });
  }

  _wireConn(conn, resolveOpen, rejectOpen) {
    conn.on('open', () => {
      this.emit('open');
      if (resolveOpen) resolveOpen();
    });
    conn.on('data', (data) => {
      // PeerJS handles serialization, but we expect JSON-like objects
      if (data && data.t && this.handlers[data.t]) this.handlers[data.t](data);
    });
    conn.on('close', () => {
      this.emit('close');
    });
    conn.on('error', (err) => {
      this.emit('error', err);
      if (rejectOpen) rejectOpen(err);
    });
  }

  send(obj) {
    if (this.conn && this.conn.open) {
      try { this.conn.send(obj); } catch (e) { /* swallow */ }
    }
  }

  disconnect() {
    try { if (this.conn) this.conn.close(); } catch {}
    try { if (this.peer) this.peer.destroy(); } catch {}
    this.conn = null;
    this.peer = null;
  }
}
