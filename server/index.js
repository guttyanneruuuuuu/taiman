// Taiman - server
// - Express serves /public
// - WebSocket relay handles matchmaking (queue of 2 -> match) and forwards messages between the two peers
// - We keep the server "thin" (relay + simple authoritative timer / damage validation).
//
// Wire format (JSON):
//   client -> server:
//     { t:"queue", name, charId }                // join matchmaking
//     { t:"leave" }                              // leave queue / match
//     { t:"input", pos:[x,z], rotY, fire, aim }  // 20Hz state from each client
//     { t:"shoot", id, pos, dir, kind, dmg }     // shot event
//     { t:"hit",   target, dmg }                 // client-reported hit (validated loosely)
//     { t:"pong", time }
//
//   server -> client:
//     { t:"matched", you:0|1, opp:{name,charId}, mapSeed }
//     { t:"state",   opp:{pos,rotY,hp,aim} }     // broadcast 20Hz
//     { t:"shoot",   ...originalShoot, by:0|1 }
//     { t:"hp",      you, opp }                  // updated hp
//     { t:"end",     winner }                    // 0/1/-1 (draw)
//     { t:"timer",   remaining }                 // seconds left
//     { t:"ping", time }

const express = require('express');
const http = require('http');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const app = express();
app.use(express.static(path.join(__dirname, '..', 'public')));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// ---------- Matchmaking ----------
let queue = [];           // sockets waiting for match
let matches = new Map();  // matchId -> { players:[ws,ws], hp:[ , ], timerId, remaining }
let nextMatchId = 1;

function safeSend(ws, obj) {
  try { if (ws.readyState === 1) ws.send(JSON.stringify(obj)); } catch (e) {}
}

function startMatch(a, b) {
  const id = nextMatchId++;
  const mapSeed = Math.floor(Math.random() * 1e6);
  const match = {
    id,
    players: [a, b],
    hp: [100, 100],
    remaining: 120,
    ended: false,
    timerId: null,
  };
  a.matchId = id; a.slot = 0;
  b.matchId = id; b.slot = 1;
  matches.set(id, match);

  safeSend(a, { t: 'matched', you: 0, opp: { name: b.playerName, charId: b.charId }, mapSeed });
  safeSend(b, { t: 'matched', you: 1, opp: { name: a.playerName, charId: a.charId }, mapSeed });

  match.timerId = setInterval(() => {
    if (match.ended) return;
    match.remaining--;
    if (match.remaining <= 0) {
      // Time over: higher HP wins, else draw
      let winner = -1;
      if (match.hp[0] > match.hp[1]) winner = 0;
      else if (match.hp[1] > match.hp[0]) winner = 1;
      endMatch(match, winner);
    } else {
      // broadcast timer every 1s
      match.players.forEach((p) => safeSend(p, { t: 'timer', remaining: match.remaining }));
    }
  }, 1000);
}

function endMatch(match, winner) {
  if (match.ended) return;
  match.ended = true;
  clearInterval(match.timerId);
  match.players.forEach((p) => safeSend(p, { t: 'end', winner }));
  // cleanup
  match.players.forEach((p) => { p.matchId = null; p.slot = null; });
  matches.delete(match.id);
}

function tryMatch() {
  while (queue.length >= 2) {
    const a = queue.shift();
    const b = queue.shift();
    if (a.readyState !== 1) { if (b.readyState === 1) queue.unshift(b); continue; }
    if (b.readyState !== 1) { if (a.readyState === 1) queue.unshift(a); continue; }
    startMatch(a, b);
  }
}

// ---------- Connection ----------
wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.matchId = null;
  ws.slot = null;
  ws.playerName = 'Player';
  ws.charId = 0;

  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch (e) { return; }

    if (msg.t === 'queue') {
      ws.playerName = (msg.name || 'Player').toString().slice(0, 12);
      ws.charId = Number(msg.charId) || 0;
      if (!queue.includes(ws) && ws.matchId == null) {
        queue.push(ws);
        safeSend(ws, { t: 'queued' });
        tryMatch();
      }
      return;
    }

    if (msg.t === 'leave') {
      queue = queue.filter((w) => w !== ws);
      const m = ws.matchId != null ? matches.get(ws.matchId) : null;
      if (m) endMatch(m, ws.slot === 0 ? 1 : 0);
      return;
    }

    // In-match messages
    const m = ws.matchId != null ? matches.get(ws.matchId) : null;
    if (!m || m.ended) return;
    const opp = m.players[1 - ws.slot];

    if (msg.t === 'input') {
      // Forward as opponent state
      safeSend(opp, {
        t: 'state',
        pos: msg.pos,
        rotY: msg.rotY,
        aim: msg.aim || null,
        hp: m.hp[ws.slot],
      });
    } else if (msg.t === 'shoot') {
      safeSend(opp, { t: 'shoot', pos: msg.pos, dir: msg.dir, kind: msg.kind, by: ws.slot });
    } else if (msg.t === 'hit') {
      // Client reports it got hit. Validate loosely (dmg in range).
      const dmg = Math.max(0, Math.min(60, Number(msg.dmg) || 0));
      m.hp[ws.slot] = Math.max(0, m.hp[ws.slot] - dmg);
      m.players.forEach((p, i) =>
        safeSend(p, { t: 'hp', you: m.hp[i], opp: m.hp[1 - i] })
      );
      if (m.hp[ws.slot] <= 0) {
        endMatch(m, 1 - ws.slot);
      }
    } else if (msg.t === 'heal') {
      // Pickup heal orb, client reports — give them +30 hp once per 15s window (trust loose)
      const heal = Math.max(0, Math.min(30, Number(msg.amount) || 0));
      m.hp[ws.slot] = Math.min(100, m.hp[ws.slot] + heal);
      m.players.forEach((p, i) =>
        safeSend(p, { t: 'hp', you: m.hp[i], opp: m.hp[1 - i] })
      );
    } else if (msg.t === 'ping') {
      safeSend(ws, { t: 'pong', time: msg.time });
    }
  });

  ws.on('close', () => {
    queue = queue.filter((w) => w !== ws);
    const m = ws.matchId != null ? matches.get(ws.matchId) : null;
    if (m && !m.ended) endMatch(m, ws.slot === 0 ? 1 : 0);
  });
});

// keepalive
setInterval(() => {
  wss.clients.forEach((ws) => {
    if (!ws.isAlive) { try { ws.terminate(); } catch (e) {} return; }
    ws.isAlive = false;
    try { ws.ping(); } catch (e) {}
  });
}, 30000);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Taiman server listening on :${PORT}`);
});
