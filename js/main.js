// =====================================================
// Taiman — main client.
// Modes: BOT (offline), HOST/JOIN (WebRTC P2P)
// =====================================================
import * as THREE from 'three';
import { CHARACTERS, getCharacter } from './characters.js';
import { generateMap, buildMapMesh, tickMovers, collideXZ, raycastMap, MAP_SIZE } from './map.js';
import { buildPlayerMesh } from './player.js';
import { setupControls } from './controls.js';
import { BotNet, PeerNet } from './net.js';
import { createAIController } from './ai.js';

// ============= Global state =============
const state = {
  inMatch: false,
  releaseFire: false,
  mouseDown: false,
  pressJump: false,
  pressDash: false,
  pressSkill: false,

  myCharId: 0,
  myName: 'YOU',
  oppName: 'OPP',
  oppCharId: 0,
  youSlot: 0,                // 0 = host, 1 = guest

  hpYou: 100,
  hpOpp: 100,
  remaining: 120,

  // Cooldowns
  cooldown: 0,
  cdJump: 0,
  cdDash: 0,
  cdSkill: 0,

  // Me
  me: {
    x: 0, z: 0, y: 0, vy: 0,
    vx: 0, vz: 0,
    rotY: 0,
    aim: { active:false, dx:0, dy:0 },
    dashing: 0, dashDx: 0, dashDz: 0,    // remaining dash time
    skillState: null,                     // for multi-frame skills (hover, mortar, etc)
  },

  // Opponent (network-synced)
  opp: {
    x: 0, z: 0, y: 0, rotY: 0,
    vx: 0, vz: 0,
    lastX: 0, lastZ: 0, lastY: 0,
    aim: null,
  },

  bullets: [],
  effects: [],

  // current AI controller (only used in BOT mode); null for P2P
  aiCtrl: null,
  // host-only authoritative timer
  isAuthority: false,
  timerTickAcc: 0,
};

// ============= Title / char select =============
const charList = document.getElementById('char-list');
const charInfoName = document.getElementById('char-info-name');
const charInfoDesc = document.getElementById('char-info-desc');
const charInfoStats = document.getElementById('char-info-stats');
let selectedChar = 0;

function buildCharCards() {
  charList.innerHTML = '';
  CHARACTERS.forEach((c, i) => {
    const el = document.createElement('div');
    el.className = 'char-card' + (i === selectedChar ? ' active' : '');
    el.innerHTML = `
      <div class="badge">${c.role}</div>
      <div class="ico">${c.icon}</div>
      <div class="nm">${c.name}</div>
    `;
    // tint card with character color subtly
    const hex = c.color.toString(16).padStart(6,'0');
    el.style.boxShadow = `inset 0 -28px 0 -10px #${hex}33`;
    el.addEventListener('click', () => {
      selectedChar = i;
      state.myCharId = i;
      [...charList.children].forEach((n, j) => n.classList.toggle('active', j === i));
      refreshCharInfo();
    });
    charList.appendChild(el);
  });
  refreshCharInfo();
}
function refreshCharInfo() {
  const c = CHARACTERS[selectedChar];
  charInfoName.textContent = `${c.name} — ${c.skill.label}`;
  charInfoDesc.textContent = c.desc;
  charInfoStats.innerHTML = `
    <div class="stat-pill"><div class="label">HP</div><div class="val">${c.hp}</div></div>
    <div class="stat-pill"><div class="label">SPD</div><div class="val">${c.speed.toFixed(1)}</div></div>
    <div class="stat-pill"><div class="label">DPS</div><div class="val">${Math.round((c.weapon.dmgPerPellet * c.weapon.pellets) / c.weapon.cooldown)}</div></div>
  `;
}
buildCharCards();

// ============= Mode selection =============
document.querySelectorAll('.mode-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const mode = btn.dataset.mode;
    state.myName = (document.getElementById('name-input').value || 'YOU').slice(0, 10);
    if (mode === 'bot') startBotMatch();
    else if (mode === 'host') openRoomScreen('host');
    else if (mode === 'join') openRoomScreen('join');
  });
});

document.getElementById('btn-room-back').addEventListener('click', () => {
  if (net && !net.isBot) net.disconnect();
  net = null;
  showScreen('title');
});

document.getElementById('btn-leave').addEventListener('click', () => {
  if (net && !net.isBot) try { net.send({ t:'end', winner: state.youSlot === 0 ? 1 : 0 }); } catch {}
  endMatchUI(state.youSlot === 0 ? 1 : 0, 'LEFT');
});

document.getElementById('btn-again').addEventListener('click', () => {
  // Restart same mode if possible
  if (lastMode === 'bot') startBotMatch();
  else if (lastMode === 'host') {
    // Same room is still open if conn alive
    if (net && net.conn && net.conn.open) startPeerMatchAsHost();
    else openRoomScreen('host');
  } else if (lastMode === 'join') {
    if (net && net.conn && net.conn.open) {
      // Guest waits for host to send 'start'
      showScreen('room');
      document.getElementById('room-status-join').textContent = '相手がリスタートするのを待ち中…';
    } else openRoomScreen('join');
  } else startBotMatch();
});
document.getElementById('btn-home').addEventListener('click', () => {
  if (net && !net.isBot) net.disconnect();
  net = null;
  showScreen('title');
});

function showScreen(which) {
  for (const id of ['title','room','game','end']) {
    document.getElementById('screen-' + id).classList.toggle('hidden', id !== which);
  }
}

// ============= NET =============
let net = null;
let lastMode = null;

// ---- Bot mode ----
function startBotMatch() {
  lastMode = 'bot';
  if (net && !net.isBot) { try { net.disconnect(); } catch {} }
  net = new BotNet();

  state.oppCharId = pickBotChar(state.myCharId);
  state.oppName = pickBotName();
  state.youSlot = 0;
  state.isAuthority = true;

  startMatch(Math.floor(Math.random() * 1e6), true);
}
function pickBotChar(exclude) {
  const ids = CHARACTERS.map(c => c.id).filter(i => i !== exclude);
  return ids[Math.floor(Math.random() * ids.length)];
}
const BOT_NAMES = ['ZIN','KAI','REI','RYU','AKI','MOMO','HAL','NIA','TARO','SORA'];
function pickBotName() { return BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)]; }

// ---- Peer (host/join) ----
function openRoomScreen(mode) {
  showScreen('room');
  document.getElementById('room-host').classList.toggle('hidden', mode !== 'host');
  document.getElementById('room-join').classList.toggle('hidden', mode !== 'join');
  if (mode === 'host') beginHost();
  // join waits for user to press JOIN
}

async function beginHost() {
  lastMode = 'host';
  const statusEl = document.getElementById('room-status-host');
  const codeEl = document.getElementById('room-code');
  codeEl.textContent = '------';
  statusEl.textContent = '合言葉を発行中…';
  try {
    if (net && !net.isBot) net.disconnect();
    net = new PeerNet();
    setupPeerHandlers();
    const code = await net.host();
    codeEl.textContent = code;
    statusEl.textContent = '相手の参加を待ち中…';
  } catch (err) {
    statusEl.textContent = 'エラー: ' + (err.message || err);
  }
}

document.getElementById('btn-copy').addEventListener('click', async () => {
  const code = document.getElementById('room-code').textContent;
  try {
    await navigator.clipboard.writeText(code);
    document.getElementById('room-status-host').textContent = 'コピーしたよ! 相手の参加を待ち中…';
  } catch {}
});

document.getElementById('btn-join-go').addEventListener('click', async () => {
  const code = (document.getElementById('join-code-input').value || '').trim().toUpperCase();
  if (code.length < 4) {
    document.getElementById('room-status-join').textContent = '合言葉を入力してね';
    return;
  }
  lastMode = 'join';
  const statusEl = document.getElementById('room-status-join');
  statusEl.textContent = '接続中…';
  try {
    if (net && !net.isBot) net.disconnect();
    net = new PeerNet();
    setupPeerHandlers();
    await net.join(code);
    statusEl.textContent = '接続成功! ホストがスタートするのを待ち中…';
    // Send hello
    net.send({ t: 'hello', name: state.myName, charId: state.myCharId });
  } catch (err) {
    statusEl.textContent = 'エラー: ' + (err.message || err);
  }
});

function setupPeerHandlers() {
  net.on('open', () => {
    if (net.isHost) {
      // host's conn opened with a guest. Send our hello and wait for theirs
      net.send({ t: 'hello', name: state.myName, charId: state.myCharId });
    }
  });
  net.on('hello', (m) => {
    state.oppName = (m.name || 'OPP').slice(0, 10);
    state.oppCharId = m.charId | 0;
    if (net.isHost) {
      // Host starts the match
      startPeerMatchAsHost();
    } else {
      document.getElementById('room-status-join').textContent = `相手「${state.oppName}」に接続! 開始を待ち中…`;
    }
  });
  net.on('start', (m) => {
    state.youSlot = 1;
    state.isAuthority = false;
    startMatch(m.seed | 0, false);
  });
  net.on('input', (m) => {
    state.opp.lastX = state.opp.x; state.opp.lastZ = state.opp.z; state.opp.lastY = state.opp.y;
    state.opp.x = m.pos[0]; state.opp.z = m.pos[1];
    state.opp.y = m.y || 0;
    state.opp.rotY = m.rotY || 0;
    state.opp.aim = m.aim || null;
    // velocity for AI lead (rough estimate)
    state.opp.vx = (state.opp.x - state.opp.lastX) * 10;
    state.opp.vz = (state.opp.z - state.opp.lastZ) * 10;
  });
  net.on('shoot', (m) => {
    const char = getCharacter(state.oppCharId);
    spawnBullets({
      char, ox: m.pos[0], oz: m.pos[1], oy: m.y || 1.0,
      dx: m.dir[0], dz: m.dir[1],
      owner: 'opp', kind: m.kind, h: m.h || 1.0,
      arc: m.arc || false, dmgOverride: m.dmg,
    });
  });
  net.on('hit', (m) => {
    // Opponent says they took dmg from me. Authority is the host; either way we apply
    // to local hp state. If we're host: validate & broadcast official hp.
    if (state.isAuthority) {
      state.hpOpp = Math.max(0, state.hpOpp - clamp(m.dmg|0, 0, 80));
      net.send({ t: 'hp', you: state.hpYou, opp: state.hpOpp });
      updateHpBars();
      checkDeath();
    } else {
      // Guest: also locally subtract for snappy feel (will be reconciled by 'hp' message)
      state.hpOpp = Math.max(0, state.hpOpp - clamp(m.dmg|0, 0, 80));
      updateHpBars();
    }
  });
  net.on('damage', (m) => {
    // Opponent tells us we took damage (their bullet hit us, authority confirmed)
    state.hpYou = Math.max(0, state.hpYou - clamp(m.dmg|0, 0, 80));
    updateHpBars();
    checkDeath();
  });
  net.on('hp', (m) => {
    state.hpYou = m.you ?? state.hpYou;
    state.hpOpp = m.opp ?? state.hpOpp;
    updateHpBars();
  });
  net.on('heal', (m) => {
    // Opponent picked up the heal orb (notify host so host hides orb authoritatively)
    if (state.isAuthority) {
      // mark heal taken by opponent
      mapData.healAvailable = false;
      mapData.healMesh.visible = false;
      mapData.healCooldown = 18;
    }
  });
  net.on('timer', (m) => {
    if (!state.isAuthority) {
      state.remaining = m.remaining;
      updateTimer();
    }
  });
  net.on('end', (m) => {
    endMatchUI(m.winner, m.winner === state.youSlot ? 'VICTORY' : (m.winner === -1 ? 'DRAW' : 'DEFEAT'));
  });
  net.on('close', () => {
    if (state.inMatch) endMatchUI(state.youSlot, '相手が切断');
  });
  net.on('error', (err) => {
    console.warn('Net error', err);
  });
  // Guest reports they took damage from opp bullet => authority subtracts hpOpp (their hp)
  net.on('selfhit', (m) => {
    if (!state.isAuthority) return;
    state.hpOpp = Math.max(0, state.hpOpp - clamp(m.dmg|0, 0, 80));
    updateHpBars();
    net.send({ t:'hp', you: state.hpYou, opp: state.hpOpp });
    checkDeath();
  });
}

function startPeerMatchAsHost() {
  state.youSlot = 0;
  state.isAuthority = true;
  const seed = Math.floor(Math.random() * 1e6);
  net.send({ t: 'start', seed });
  startMatch(seed, false);
}

// ============= THREE.js setup =============
let renderer, scene, camera;
let myMesh, oppMesh;
let mapData, mapColliders, mapGroup;
let lastTime = 0;
let controlsAPI;
let aimLine = null;
let mortarPreview = null;

function setupRenderer() {
  const canvas = document.getElementById('game-canvas');
  renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight, false);

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x161a25);
  scene.fog = new THREE.Fog(0x161a25, 28, 70);

  camera = new THREE.PerspectiveCamera(58, window.innerWidth/window.innerHeight, 0.1, 200);

  window.addEventListener('resize', () => {
    if (!renderer) return;
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  });
}

function startMatch(seed, isBotMatch) {
  showScreen('game');
  if (!renderer) setupRenderer();

  scene.clear();
  scene.background = new THREE.Color(0x161a25);
  scene.fog = new THREE.Fog(0x161a25, 28, 70);
  aimLine = null;
  mortarPreview = null;

  mapData = generateMap(seed);
  const m = buildMapMesh(mapData);
  mapGroup = m.group;
  mapColliders = m.colliders;
  scene.add(mapGroup);

  // Spawn
  const spawnA = { x: -MAP_SIZE/2 + 5, z: -MAP_SIZE/2 + 5 };
  const spawnB = { x:  MAP_SIZE/2 - 5, z:  MAP_SIZE/2 - 5 };
  const mySpawn  = state.youSlot === 0 ? spawnA : spawnB;
  const oppSpawn = state.youSlot === 0 ? spawnB : spawnA;

  Object.assign(state.me, {
    x: mySpawn.x, z: mySpawn.z, y: 0, vy: 0,
    vx: 0, vz: 0,
    rotY: Math.atan2(-mySpawn.x, -mySpawn.z),
    aim: { active:false, dx:0, dy:0 },
    dashing: 0, dashDx:0, dashDz: 0,
    skillState: null,
  });
  Object.assign(state.opp, {
    x: oppSpawn.x, z: oppSpawn.z, y: 0,
    lastX: oppSpawn.x, lastZ: oppSpawn.z, lastY: 0,
    rotY: Math.atan2(-oppSpawn.x, -oppSpawn.z),
    aim: null, vx: 0, vz: 0,
  });
  state.hpYou = getCharacter(state.myCharId).hp;
  state.hpOpp = getCharacter(state.oppCharId).hp;
  state.bullets = [];
  state.effects = [];
  state.remaining = 120;
  state.cooldown = 0;
  state.cdJump = 0;
  state.cdDash = 0;
  state.cdSkill = 0;

  myMesh  = buildPlayerMesh(getCharacter(state.myCharId), true);
  oppMesh = buildPlayerMesh(getCharacter(state.oppCharId), false);
  scene.add(myMesh, oppMesh);

  // AI
  if (isBotMatch) {
    state.aiCtrl = createAIController(state.opp, getCharacter(state.oppCharId));
  } else {
    state.aiCtrl = null;
  }

  // HUD
  document.getElementById('hp-you-name').textContent = state.myName;
  document.getElementById('hp-opp-name').textContent = state.oppName;
  document.getElementById('btn-skill').textContent = getCharacter(state.myCharId).skill.label;
  updateHpBars();
  updateTimer();

  state.inMatch = true;
  controlsAPI = controlsAPI || setupControls(state);

  lastTime = performance.now();
  if (!renderLoopStarted) { renderLoopStarted = true; requestAnimationFrame(loop); }

  // P2P: send input at 20Hz
  if (!stateTickerStarted) {
    stateTickerStarted = true;
    setInterval(() => {
      if (!state.inMatch || !net || net.isBot) return;
      net.send({
        t:'input',
        pos:[state.me.x, state.me.z],
        y: state.me.y,
        rotY: state.me.rotY,
        aim: state.me.aim?.active ? { dx: state.me.aim.dx, dy: state.me.aim.dy } : null,
      });
    }, 50);
  }

  state.timerTickAcc = 0;
}

let renderLoopStarted = false;
let stateTickerStarted = false;

function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, (now - lastTime) / 1000);
  lastTime = now;
  if (state.inMatch) {
    tick(dt);
    render();
  }
}

// ============= Game tick =============
function tick(dt) {
  const myChar = getCharacter(state.myCharId);
  const w = myChar.weapon;
  const input = controlsAPI.getInput();

  // -------- Move (me) --------
  let moveX = 0, moveZ = 0;
  if (state.me.dashing > 0) {
    // dash overrides movement
    const dashSpeed = (state.me.skillState && state.me.skillState.kind === 'dash_strike')
      ? myChar.skill.dashSpeed
      : 15;
    state.me.dashing -= dt;
    moveX = state.me.dashDx * dashSpeed * dt;
    moveZ = state.me.dashDz * dashSpeed * dt;
    // dash_strike: hit opp on contact
    if (state.me.skillState && state.me.skillState.kind === 'dash_strike' && !state.me.skillState.struck) {
      const dx = oppMesh.position.x - state.me.x;
      const dz = oppMesh.position.z - state.me.z;
      if (dx*dx + dz*dz < (myChar.skill.radius + 0.6)*(myChar.skill.radius + 0.6)) {
        applyDamageToOpp(myChar.skill.damage);
        spawnExplosion(state.me.x + dx*0.5, state.me.z + dz*0.5, 1.2, 0xffaa66);
        state.me.skillState.struck = true;
      }
    }
    if (state.me.dashing <= 0) {
      state.me.dashing = 0;
      // clear dash_strike on end (skill duration matches)
      if (state.me.skillState && (state.me.skillState.kind === 'dash_strike')) {
        state.me.skillState = null;
      }
    }
  } else {
    const speed = myChar.speed;
    moveX = input.mx * speed * dt;
    moveZ = input.my * speed * dt;
  }

  let nx = state.me.x + moveX;
  let nz = state.me.z + moveZ;
  [nx, nz] = collideXZ(nx, nz, 0.5, mapColliders);
  state.me.vx = (nx - state.me.x) / Math.max(dt, 0.001);
  state.me.vz = (nz - state.me.z) / Math.max(dt, 0.001);
  state.me.x = nx; state.me.z = nz;

  // -------- Facing / aim --------
  if (input.aimActive && (Math.abs(input.ax) + Math.abs(input.ay) > 0.05)) {
    state.me.rotY = Math.atan2(input.ax, input.ay);
    state.me.aim = { active: true, dx: input.ax, dy: input.ay };
  } else if (Math.abs(moveX) + Math.abs(moveZ) > 0.001 && state.me.dashing <= 0) {
    state.me.rotY = Math.atan2(moveX, moveZ);
    state.me.aim = { active: false, dx: 0, dy: 0 };
  } else {
    state.me.aim = { active: false, dx: 0, dy: 0 };
  }

  // -------- Cooldowns --------
  state.cooldown = Math.max(0, state.cooldown - dt);
  state.cdJump   = Math.max(0, state.cdJump   - dt);
  state.cdDash   = Math.max(0, state.cdDash   - dt);
  state.cdSkill  = Math.max(0, state.cdSkill  - dt);

  // -------- Vertical (jump / gravity) --------
  if (state.me.y > 0 || state.me.vy > 0) {
    state.me.vy -= 28 * dt;
    state.me.y  += state.me.vy * dt;
    if (state.me.y <= 0) { state.me.y = 0; state.me.vy = 0; }
  }

  // -------- Action: JUMP --------
  if (state.pressJump) {
    state.pressJump = false;
    if (state.cdJump <= 0 && state.me.y <= 0.02 && !state.me.skillState) {
      state.me.vy = 11;
      state.me.y = 0.01;
      state.cdJump = 0.85;
    }
  }

  // -------- Action: DASH --------
  if (state.pressDash) {
    state.pressDash = false;
    if (state.cdDash <= 0 && !state.me.skillState) {
      let dx = input.mx, dz = input.my;
      const mag = Math.hypot(dx, dz);
      if (mag < 0.1) {
        // dash forward (facing)
        dx = Math.sin(state.me.rotY); dz = Math.cos(state.me.rotY);
      } else {
        dx /= mag; dz /= mag;
      }
      state.me.dashDx = dx; state.me.dashDz = dz;
      state.me.dashing = 0.22;
      state.cdDash = 1.6;
      // tiny i-frames could be added; for now just speed dodge
    }
  }

  // -------- Action: SKILL --------
  if (state.pressSkill) {
    state.pressSkill = false;
    if (state.cdSkill <= 0 && !state.me.skillState) {
      activateSkill(myChar);
    }
  }

  // Per-skill ongoing logic
  if (state.me.skillState) tickSkill(dt, myChar);

  // -------- Center gimmicks (jump pad + heal orb) --------
  mapData.padMesh.rotation.y += dt * 0.6;
  const pdx = state.me.x - mapData.pad.x;
  const pdz = state.me.z - mapData.pad.z;
  if (pdx*pdx + pdz*pdz < 1.4*1.4 && state.me.y <= 0.05 && state.me.vy <= 0.01) {
    state.me.vy = 14;
    state.me.y = 0.05;
  }

  if (mapData.healAvailable) {
    mapData.healMesh.rotation.y += dt * 2.5;
    mapData.healMesh.position.y = 1.1 + Math.sin(performance.now()/300) * 0.1;
    const hx = state.me.x - mapData.heal.x;
    const hz = state.me.z - mapData.heal.z;
    if (hx*hx + hz*hz < 0.9*0.9 && state.hpYou < getCharacter(state.myCharId).hp) {
      const max = getCharacter(state.myCharId).hp;
      const healAmt = Math.min(30, max - state.hpYou);
      state.hpYou = Math.min(max, state.hpYou + healAmt);
      mapData.healAvailable = false;
      mapData.healMesh.visible = false;
      mapData.healCooldown = 18;
      net?.send({ t:'heal' });
      flashText(`+${healAmt} HP`, '#6fb59a');
      updateHpBars();
    }
  } else {
    mapData.healCooldown -= dt;
    if (mapData.healCooldown <= 0) {
      mapData.healAvailable = true;
      mapData.healMesh.visible = true;
    }
  }

  // Moving pillars
  tickMovers(mapData, dt);

  // -------- Bullets --------
  updateBullets(dt);

  // -------- Effects --------
  for (let i = state.effects.length-1; i >= 0; i--) {
    const e = state.effects[i];
    e.life -= dt;
    if (e.update) e.update(e, dt);
    if (e.life <= 0) { scene.remove(e.mesh); state.effects.splice(i,1); }
  }

  // -------- Continuous fire (hold) for SMG/Shotgun --------
  const holdToFire = (w.kind === 'smg' || w.kind === 'shotgun');
  if (holdToFire && state.cooldown === 0 && input.aimActive && !state.me.skillState) {
    doShoot(myChar, input.ax, input.ay);
  }
  // Tap-release fire (rifle / rocket / slash)
  if (state.releaseFire && !holdToFire && state.cooldown === 0 && !state.me.skillState) {
    if (state.me.aim.active) {
      doShoot(myChar, state.me.aim.dx, state.me.aim.dy);
    } else {
      doShoot(myChar, Math.sin(state.me.rotY), Math.cos(state.me.rotY));
    }
  }
  state.releaseFire = false;
  updateCooldownBars();

  // -------- AI (bot) --------
  if (state.aiCtrl) {
    tickAI(dt);
    tickBotOppSkillsLocally(dt);
  }

  // -------- Sync meshes --------
  myMesh.position.set(state.me.x, state.me.y, state.me.z);
  myMesh.rotation.y = state.me.rotY;
  // visual: tilt slightly when dashing
  myMesh.children[0].rotation.x = state.me.dashing > 0 ? -0.25 : 0;

  if (state.aiCtrl) {
    // bot opp: position is moved by AI in tickAI; sync mesh directly
    oppMesh.position.set(state.opp.x, state.opp.y, state.opp.z);
    oppMesh.rotation.y = state.opp.rotY;
  } else {
    // peer opp: interpolate
    oppMesh.position.x = lerp(oppMesh.position.x, state.opp.x, 0.28);
    oppMesh.position.z = lerp(oppMesh.position.z, state.opp.z, 0.28);
    oppMesh.position.y = lerp(oppMesh.position.y, state.opp.y, 0.28);
    oppMesh.rotation.y = lerpAngle(oppMesh.rotation.y, state.opp.rotY, 0.28);
  }

  // -------- Camera follow --------
  const camHeight = 16;
  const camBack   = 11;
  const lookOffX = (state.me.aim?.active ? state.me.aim.dx : 0) * 2.2;
  const lookOffZ = (state.me.aim?.active ? state.me.aim.dy : 0) * 2.2;
  const camTarget = new THREE.Vector3(state.me.x + lookOffX, state.me.y * 0.3, state.me.z + lookOffZ);
  const camPos = new THREE.Vector3(state.me.x, camHeight + state.me.y * 0.2, state.me.z + camBack);
  camera.position.lerp(camPos, 0.16);
  camera.lookAt(camTarget);

  // -------- Aim indicator --------
  drawAimIndicator(myChar, input);

  // -------- Authority: tick the timer --------
  if (state.isAuthority) {
    state.timerTickAcc += dt;
    if (state.timerTickAcc >= 1.0) {
      state.timerTickAcc -= 1.0;
      state.remaining = Math.max(0, state.remaining - 1);
      updateTimer();
      if (!net.isBot) net.send({ t:'timer', remaining: state.remaining });
      if (state.remaining <= 0) {
        const winner = state.hpYou > state.hpOpp ? state.youSlot
                      : state.hpYou < state.hpOpp ? (1 - state.youSlot)
                      : -1;
        if (!net.isBot) net.send({ t:'end', winner });
        endMatchUI(winner, winner === state.youSlot ? 'VICTORY' : (winner === -1 ? 'DRAW' : 'DEFEAT'));
      }
    }
  }
}

// ============= AI tick =============
function tickAI(dt) {
  const oppChar = getCharacter(state.oppCharId);
  // basic projectile danger metric: any bullet headed at opp recently
  let danger = 0;
  for (const b of state.bullets) {
    if (b.owner !== 'me') continue;
    const dx = state.opp.x - b.x, dz = state.opp.z - b.z;
    const tow = dx*b.dx + dz*b.dz;
    if (tow > 0 && dx*dx + dz*dz < 16) danger++;
  }
  const api = {
    incomingDanger: danger,
    canFire: () => state.opp.cdFire ? state.opp.cdFire <= 0 : true,
    canDash: () => (state.opp.cdDash || 0) <= 0,
    canJump: () => (state.opp.cdJump || 0) <= 0 && (state.opp.y || 0) <= 0.02,
    canSkill: () => (state.opp.cdSkill || 0) <= 0,
    fire: (dx, dz) => {
      // Spawn bullets where opp is, aimed
      spawnBullets({
        char: oppChar, ox: state.opp.x, oz: state.opp.z, oy: 1.0 + (state.opp.y || 0),
        dx, dz, owner: 'opp', kind: oppChar.weapon.kind, h: oppChar.weapon.verticalHeight + (state.opp.y || 0),
      });
      state.opp.cdFire = oppChar.weapon.cooldown;
      // face shoot
      state.opp.rotY = Math.atan2(dx, dz);
    },
    dash: (dx, dz) => {
      state.opp.dashing = 0.22;
      state.opp.dashDx = dx; state.opp.dashDz = dz;
      state.opp.cdDash = 1.6;
    },
    jump: () => {
      state.opp.vy = 11;
      state.opp.y = 0.01;
      state.opp.cdJump = 0.85;
    },
    useSkill: (dx, dz) => {
      activateBotSkill(oppChar, dx, dz);
      state.opp.cdSkill = oppChar.skill.cooldown;
    },
  };
  // cooldown timers for opp
  state.opp.cdFire  = Math.max(0, (state.opp.cdFire  || 0) - dt);
  state.opp.cdDash  = Math.max(0, (state.opp.cdDash  || 0) - dt);
  state.opp.cdJump  = Math.max(0, (state.opp.cdJump  || 0) - dt);
  state.opp.cdSkill = Math.max(0, (state.opp.cdSkill || 0) - dt);

  const me = { x: state.me.x, z: state.me.z, y: state.me.y, vx: state.me.vx, vz: state.me.vz, rotY: state.me.rotY };
  const intent = state.aiCtrl.update(dt, me, state.opp, mapColliders, api);

  // Apply movement to opp
  let mvx = intent.mvx || 0, mvz = intent.mvz || 0;
  const speed = oppChar.speed;
  let nx, nz;
  if ((state.opp.dashing || 0) > 0) {
    state.opp.dashing -= dt;
    const ds = 15;
    nx = state.opp.x + state.opp.dashDx * ds * dt;
    nz = state.opp.z + state.opp.dashDz * ds * dt;
    if (state.opp.dashing <= 0) state.opp.dashing = 0;
  } else {
    nx = state.opp.x + mvx * speed * dt;
    nz = state.opp.z + mvz * speed * dt;
  }
  [nx, nz] = collideXZ(nx, nz, 0.5, mapColliders);
  state.opp.lastX = state.opp.x; state.opp.lastZ = state.opp.z;
  state.opp.x = nx; state.opp.z = nz;
  state.opp.vx = (state.opp.x - state.opp.lastX) / Math.max(dt, 0.001);
  state.opp.vz = (state.opp.z - state.opp.lastZ) / Math.max(dt, 0.001);
  // gravity for opp
  if ((state.opp.y || 0) > 0 || (state.opp.vy || 0) > 0) {
    state.opp.vy = (state.opp.vy || 0) - 28 * dt;
    state.opp.y  = (state.opp.y || 0) + state.opp.vy * dt;
    if (state.opp.y <= 0) { state.opp.y = 0; state.opp.vy = 0; }
  }
  // face movement if no aim
  if (!state.aiCtrl) {} // (always has aim from AI; rotY set on fire)
}

function activateBotSkill(char, dx, dz) {
  switch (char.skill.kind) {
    case 'dash_strike':
      state.opp.dashing = char.skill.dashTime;
      state.opp.dashDx = dx; state.opp.dashDz = dz;
      state.opp._dashStrike = { damage: char.skill.damage, radius: char.skill.radius, struck: false };
      break;
    case 'piercing_laser': {
      spawnBullets({
        char, ox: state.opp.x, oz: state.opp.z, oy: 1.05,
        dx, dz, owner: 'opp', kind: 'laser', h: 1.05, piercing: true,
        dmgOverride: char.skill.damage, range: char.skill.range,
      });
      break;
    }
    case 'mortar': {
      // estimated target position 0.5s ahead
      const tx = state.me.x + state.me.vx * 0.4;
      const tz = state.me.z + state.me.vz * 0.4;
      spawnMortar({ ox: state.opp.x, oz: state.opp.z, tx, tz, owner:'opp',
        damage: char.skill.damage, radius: char.skill.radius });
      break;
    }
    case 'hover_burst': {
      // opp hovers in place and rapid-fires
      state.opp.vy = 10;
      state.opp.y = 0.05;
      state.opp._hover = { time: char.skill.hoverTime, shotsLeft: char.skill.shots, every: char.skill.hoverTime / char.skill.shots, t: 0 };
      break;
    }
    case 'aerial_slam': {
      state.opp.vy = 15;
      state.opp.y = 0.05;
      state.opp._slam = { stage: 'rising', damage: char.skill.damage, radius: char.skill.radius };
      break;
    }
  }
}

// ============= Skill activation (me) =============
function activateSkill(char) {
  const dx0 = state.me.aim.active ? state.me.aim.dx : Math.sin(state.me.rotY);
  const dz0 = state.me.aim.active ? state.me.aim.dy : Math.cos(state.me.rotY);
  const mag = Math.hypot(dx0, dz0) || 1;
  const dx = dx0/mag, dz = dz0/mag;
  state.cdSkill = char.skill.cooldown;
  switch (char.skill.kind) {
    case 'dash_strike': {
      state.me.skillState = { kind:'dash_strike', struck: false };
      state.me.dashing = char.skill.dashTime;
      state.me.dashDx = dx; state.me.dashDz = dz;
      state.me.rotY = Math.atan2(dx, dz);
      spawnFlash(state.me.x, state.me.z, 0xffb88c);
      break;
    }
    case 'piercing_laser': {
      // Big visible laser line in front
      const range = char.skill.range;
      const t = raycastMap(state.me.x, state.me.z, dx, dz, range, mapColliders, 1.05);
      // It pierces cover walls of low height (handled by raycastMap via bulletH already; ours is 1.05 < walls 2.4 so it WILL hit walls). For pierce we want to ignore covers but stop at walls.
      // We'll use a fixed "no clipping" for now—pierce up to first wall.
      spawnLaser(state.me.x, state.me.z, dx, dz, t, 'me', char.skill.damage);
      net?.send({ t:'shoot', pos:[state.me.x, state.me.z], y: 1.05, dir:[dx, dz], kind: 'laser', h:1.05, piercing:true, dmg: char.skill.damage });
      break;
    }
    case 'mortar': {
      // Throw an arcing bomb to where the aim points (clamped distance)
      const dist = Math.min(14, 4 + Math.hypot(state.me.aim.dx||0, state.me.aim.dy||0) * 12);
      const tx = state.me.x + dx * dist;
      const tz = state.me.z + dz * dist;
      spawnMortar({ ox: state.me.x, oz: state.me.z, tx, tz, owner:'me',
        damage: char.skill.damage, radius: char.skill.radius });
      net?.send({ t:'shoot', pos:[state.me.x, state.me.z], y: 1.0, dir:[dx, dz], kind: 'mortar', h:1.0, arc: true, dmg: char.skill.damage, tx, tz, radius: char.skill.radius });
      break;
    }
    case 'hover_burst': {
      // Lift, then auto-fire 6 shots in current aim direction
      state.me.vy = 10;
      state.me.y = 0.05;
      state.me.skillState = {
        kind: 'hover_burst',
        time: char.skill.hoverTime,
        shotsLeft: char.skill.shots,
        every: char.skill.hoverTime / char.skill.shots,
        t: 0,
        damage: char.skill.damagePerShot,
      };
      break;
    }
    case 'aerial_slam': {
      state.me.vy = 15;
      state.me.y = 0.05;
      state.me.skillState = { kind:'aerial_slam', stage:'rising', damage: char.skill.damage, radius: char.skill.radius };
      break;
    }
  }
}

function tickSkill(dt, char) {
  const s = state.me.skillState;
  if (!s) return;
  if (s.kind === 'hover_burst') {
    s.time -= dt;
    s.t += dt;
    // Gently stay aloft
    if (state.me.y < 2.5) state.me.vy = Math.max(state.me.vy, 1.5);
    state.me.vy *= 0.95; // dampen
    if (s.t >= s.every && s.shotsLeft > 0) {
      s.t = 0;
      s.shotsLeft--;
      const ax = state.me.aim.dx || Math.sin(state.me.rotY);
      const az = state.me.aim.dy || Math.cos(state.me.rotY);
      const mag = Math.hypot(ax, az) || 1;
      const dx = ax/mag, dz = az/mag;
      // Slightly downward-angled shots; use h=current player y + 1
      spawnBullets({
        char, ox: state.me.x, oz: state.me.z, oy: state.me.y + 1.0,
        dx, dz, owner:'me', kind:'smg', h: state.me.y + 1.0, dmgOverride: s.damage,
      });
      net?.send({ t:'shoot', pos:[state.me.x, state.me.z], y: state.me.y + 1.0, dir:[dx, dz], kind:'smg', h: state.me.y + 1.0, dmg: s.damage });
    }
    if (s.time <= 0) {
      state.me.skillState = null;
    }
  } else if (s.kind === 'aerial_slam') {
    if (s.stage === 'rising' && state.me.vy <= 0) {
      s.stage = 'falling';
      state.me.vy = -22; // slam down
    }
    if (s.stage === 'falling' && state.me.y <= 0.05) {
      // impact
      state.me.y = 0; state.me.vy = 0;
      const dx = oppMesh.position.x - state.me.x;
      const dz = oppMesh.position.z - state.me.z;
      const r = s.radius;
      if (dx*dx + dz*dz < r*r) {
        applyDamageToOpp(s.damage);
      }
      spawnExplosion(state.me.x, state.me.z, r * 1.1, 0x9bd9b2);
      state.me.skillState = null;
    }
  }
  // dash_strike clears on dashing end (handled above)
}

// Bot opp continuous skills (hover/slam)
function tickBotOppSkillsLocally(dt) {
  // Handled inline in tickAI's gravity + via flags
  if (state.opp._hover) {
    const h = state.opp._hover;
    h.time -= dt; h.t = (h.t || 0) + dt;
    if (state.opp.y < 2.5) state.opp.vy = Math.max(state.opp.vy || 0, 1.5);
    state.opp.vy *= 0.95;
    if (h.t >= h.every && h.shotsLeft > 0) {
      h.t = 0; h.shotsLeft--;
      const adx = state.me.x - state.opp.x;
      const adz = state.me.z - state.opp.z;
      const m = Math.hypot(adx, adz) || 1;
      const dx = adx/m, dz = adz/m;
      const oppChar = getCharacter(state.oppCharId);
      spawnBullets({
        char: oppChar, ox: state.opp.x, oz: state.opp.z, oy: state.opp.y + 1.0,
        dx, dz, owner:'opp', kind:'smg', h: state.opp.y + 1.0, dmgOverride: oppChar.skill.damagePerShot,
      });
    }
    if (h.time <= 0) state.opp._hover = null;
  }
  if (state.opp._slam) {
    const s = state.opp._slam;
    if (s.stage === 'rising' && state.opp.vy <= 0) { s.stage = 'falling'; state.opp.vy = -22; }
    if (s.stage === 'falling' && (state.opp.y || 0) <= 0.05) {
      state.opp.y = 0; state.opp.vy = 0;
      const dx = state.me.x - state.opp.x, dz = state.me.z - state.opp.z;
      if (dx*dx + dz*dz < s.radius * s.radius) {
        applyDamageToMe(s.damage);
      }
      spawnExplosion(state.opp.x, state.opp.z, s.radius * 1.1, 0x9bd9b2);
      state.opp._slam = null;
    }
  }
  if (state.opp._dashStrike && (state.opp.dashing || 0) > 0 && !state.opp._dashStrike.struck) {
    const dx = state.me.x - state.opp.x, dz = state.me.z - state.opp.z;
    if (dx*dx + dz*dz < (state.opp._dashStrike.radius + 0.6)**2) {
      applyDamageToMe(state.opp._dashStrike.damage);
      spawnExplosion(state.opp.x + dx*0.4, state.opp.z + dz*0.4, 1.2, 0xffaa66);
      state.opp._dashStrike.struck = true;
    }
  } else if (state.opp._dashStrike && (state.opp.dashing || 0) <= 0) {
    state.opp._dashStrike = null;
  }
}

// ============= Aim indicator =============
function drawAimIndicator(char, input) {
  if (!aimLine) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const mat = new THREE.LineBasicMaterial({ color: 0xd97c4f, transparent: true, opacity: 0.85 });
    aimLine = new THREE.Line(geo, mat);
    scene.add(aimLine);

    const tipGeo = new THREE.RingGeometry(0.25, 0.4, 18);
    const tipMat = new THREE.MeshBasicMaterial({ color: 0xd97c4f, side: THREE.DoubleSide, transparent: true, opacity: 0.85 });
    aimLine.userData.tip = new THREE.Mesh(tipGeo, tipMat);
    aimLine.userData.tip.rotation.x = -Math.PI/2;
    scene.add(aimLine.userData.tip);
  }
  aimLine.visible = input.aimActive;
  aimLine.userData.tip.visible = input.aimActive;
  if (!input.aimActive) {
    if (mortarPreview) mortarPreview.visible = false;
    return;
  }

  let dx = input.ax, dz = input.ay;
  const mag = Math.hypot(dx, dz) || 1;
  dx /= mag; dz /= mag;

  // Special preview for mortar skill (only if currently selected char's skill is mortar and ready)
  if (char.skill.kind === 'mortar' && state.cdSkill <= 0) {
    const dist = Math.min(14, 4 + Math.hypot(input.ax, input.ay) * 12);
    const tx = state.me.x + dx * dist;
    const tz = state.me.z + dz * dist;
    if (!mortarPreview) {
      const rg = new THREE.RingGeometry(2.5, 2.9, 32);
      const rm = new THREE.MeshBasicMaterial({ color: 0xd97c4f, side: THREE.DoubleSide, transparent: true, opacity: 0.5 });
      mortarPreview = new THREE.Mesh(rg, rm);
      mortarPreview.rotation.x = -Math.PI/2;
      scene.add(mortarPreview);
    }
    mortarPreview.visible = true;
    mortarPreview.position.set(tx, 0.06, tz);
  } else if (mortarPreview) {
    mortarPreview.visible = false;
  }

  const ox = state.me.x, oz = state.me.z;
  const wl = char.weapon.bulletSpeed * char.weapon.bulletLife;
  const maxLen = Math.min(wl, 14);
  const bulletH = (char.weapon.verticalHeight || 1.0) + (state.me.y || 0);
  const hitT = raycastMap(ox, oz, dx, dz, maxLen, mapColliders, bulletH);
  const ex = ox + dx * hitT;
  const ez = oz + dz * hitT;
  const arr = aimLine.geometry.attributes.position.array;
  arr[0]=ox; arr[1]=0.05; arr[2]=oz;
  arr[3]=ex; arr[4]=0.05; arr[5]=ez;
  aimLine.geometry.attributes.position.needsUpdate = true;
  aimLine.userData.tip.position.set(ex, 0.06, ez);
}

// ============= Shooting =============
function doShoot(char, ax, ay) {
  const mag = Math.hypot(ax, ay);
  let dx, dz;
  if (mag < 0.05) { dx = Math.sin(state.me.rotY); dz = Math.cos(state.me.rotY); }
  else { dx = ax/mag; dz = ay/mag; }
  state.cooldown = char.weapon.cooldown;

  const oy = 1.0 + state.me.y;
  spawnBullets({ char, ox: state.me.x, oz: state.me.z, oy, dx, dz, owner: 'me', kind: char.weapon.kind, h: oy });

  net?.send({ t:'shoot', pos:[state.me.x, state.me.z], y: oy, dir:[dx, dz], kind: char.weapon.kind, h: oy });
}

function spawnBullets({ char, ox, oz, oy=1.0, dx, dz, owner, kind, h=1.0, arc=false, dmgOverride=null, piercing=false, range=null }) {
  const w = char.weapon;
  const count = (kind === 'laser') ? 1 : w.pellets;
  const baseSize = (kind === 'laser') ? 0.18 : w.bulletSize;
  const speed = (kind === 'laser') ? 90 : w.bulletSpeed;
  const life = (kind === 'laser') ? 0.35 : w.bulletLife;
  const spread = (kind === 'laser') ? 0 : w.spread;
  const dmg = dmgOverride != null ? dmgOverride : w.dmgPerPellet;

  for (let i = 0; i < count; i++) {
    const sp = (spread > 0) ? (Math.random() * 2 - 1) * spread : 0;
    const cs = Math.cos(sp), sn = Math.sin(sp);
    const ddx = dx * cs - dz * sn;
    const ddz = dx * sn + dz * cs;
    const color = bulletColor(kind, owner);
    const geo = (kind === 'slash')
      ? new THREE.BoxGeometry(baseSize, 0.5, 0.4)
      : (kind === 'laser')
        ? new THREE.CylinderGeometry(0.08, 0.08, range || 26, 8)
        : new THREE.SphereGeometry(baseSize, 8, 6);
    const mat = new THREE.MeshBasicMaterial({ color });
    const mesh = new THREE.Mesh(geo, mat);
    const muzzleOff = 1.0;
    mesh.position.set(ox + ddx * muzzleOff, oy, oz + ddz * muzzleOff);
    if (kind === 'laser') {
      mesh.rotation.x = Math.PI / 2;
      mesh.rotation.z = -Math.atan2(ddx, ddz);
      mesh.position.set(ox + ddx * (range || 26) / 2, oy, oz + ddz * (range || 26) / 2);
    }
    scene.add(mesh);

    state.bullets.push({
      mesh, owner, kind,
      x: ox + ddx * muzzleOff, z: oz + ddz * muzzleOff,
      y: oy, vy: 0,
      dx: ddx, dz: ddz,
      speed, life,
      dmg,
      size: kind === 'slash' ? baseSize : Math.max(0.2, baseSize),
      explodeRadius: w.explodeRadius || 0,
      h,
      arc: !!arc,
      piercing: !!piercing,
      range,
      // For lasers: vanish in time without movement
      static: kind === 'laser',
    });
  }
  spawnFlash(ox + dx * 0.7, oz + dz * 0.7, bulletColor(kind, owner));
}
function bulletColor(kind, owner) {
  if (kind === 'rocket') return 0xe07a4a;
  if (kind === 'slash')  return 0xc8d4e0;
  if (kind === 'laser')  return owner === 'me' ? 0xff9a6c : 0xff6c8a;
  return owner === 'me' ? 0xf0c188 : 0xff8a8a;
}

function spawnMortar({ ox, oz, tx, tz, owner, damage, radius }) {
  // arcing bomb that lands at (tx,tz) after ~1.0s
  const dx = tx - ox, dz = tz - oz;
  const T = 1.1;
  const vx = dx / T, vz = dz / T;
  const startY = 1.0;
  // y(t) = y0 + vy*t - .5*g*t^2 ; want y(T) = 0 ; choose vy so peak ~4.5
  const g = 22;
  const vy = g * T / 2 + 1.5;

  const mat = new THREE.MeshLambertMaterial({ color: 0xd97c4f });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.32, 10, 8), mat);
  mesh.position.set(ox, startY, oz);
  scene.add(mesh);
  // Shadow ring to telegraph landing position
  const ringGeo = new THREE.RingGeometry(radius - 0.3, radius, 28);
  const ringMat = new THREE.MeshBasicMaterial({ color: owner === 'me' ? 0xd97c4f : 0xd96a6a, side: THREE.DoubleSide, transparent: true, opacity: 0.5 });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(tx, 0.06, tz);
  scene.add(ring);

  state.bullets.push({
    mortar: true, ringMesh: ring,
    mesh, owner, kind: 'mortar',
    x: ox, z: oz, y: startY,
    vx, vy, vz, g,
    tx, tz,
    life: T + 0.2,
    dmg: damage,
    radius,
  });
}

function spawnLaser(ox, oz, dx, dz, length, owner, dmg) {
  const geo = new THREE.CylinderGeometry(0.1, 0.1, length, 8);
  const mat = new THREE.MeshBasicMaterial({ color: owner === 'me' ? 0xff9a6c : 0xff6c8a, transparent:true, opacity: 0.85 });
  const m = new THREE.Mesh(geo, mat);
  m.rotation.x = Math.PI / 2;
  m.rotation.z = -Math.atan2(dx, dz);
  m.position.set(ox + dx * length/2, 1.05, oz + dz * length/2);
  scene.add(m);
  state.effects.push({ mesh: m, life: 0.35, update: (e, dt) => { e.mesh.material.opacity *= 0.9; } });

  // Hit check (only if owner is me)
  if (owner === 'me') {
    const ex = oppMesh.position.x, ez = oppMesh.position.z;
    const ax = ex - ox, az = ez - oz;
    const t = ax*dx + az*dz;
    if (t > 0 && t < length) {
      const px = ox + dx*t, pz = oz + dz*t;
      const d = Math.hypot(px - ex, pz - ez);
      // also must be below the wall the laser stopped at... we already clipped by raycast length
      if (d < 0.8 && (oppMesh.position.y || 0) < 2.0) {
        applyDamageToOpp(dmg);
        spawnHit(ex, ez);
      }
    }
  }
}

// ============= Bullet update =============
function updateBullets(dt) {
  for (let i = state.bullets.length - 1; i >= 0; i--) {
    const b = state.bullets[i];
    if (b.mortar) {
      // arcing
      b.x += b.vx * dt;
      b.z += b.vz * dt;
      b.vy -= b.g * dt;
      b.y += b.vy * dt;
      b.life -= dt;
      b.mesh.position.set(b.x, b.y, b.z);
      if (b.y <= 0.0 || b.life <= 0) {
        // detonate
        spawnExplosion(b.tx, b.z, b.radius * 1.05, 0xe07a4a);
        scene.remove(b.mesh);
        scene.remove(b.ringMesh);
        if (b.owner === 'me') {
          const dx = oppMesh.position.x - b.tx;
          const dz = oppMesh.position.z - b.z;
          if (dx*dx + dz*dz < b.radius * b.radius && (oppMesh.position.y || 0) < 2.4) {
            applyDamageToOpp(b.dmg);
          }
        } else {
          const dx = state.me.x - b.tx;
          const dz = state.me.z - b.z;
          if (dx*dx + dz*dz < b.radius * b.radius && state.me.y < 2.4) {
            applyDamageToMe(b.dmg);
          }
        }
        state.bullets.splice(i, 1);
      }
      continue;
    }
    if (b.static) {
      // lasers: instant hit done in spawnLaser; just decay life
      b.life -= dt;
      b.mesh.material.opacity = Math.max(0, b.life / 0.35) * 0.85;
      if (b.life <= 0) { scene.remove(b.mesh); state.bullets.splice(i, 1); }
      continue;
    }

    const t = raycastMap(b.x, b.z, b.dx, b.dz, b.speed * dt, mapColliders, b.h);
    let hitMap = false;
    if (t < b.speed * dt) { b.x += b.dx * t; b.z += b.dz * t; hitMap = true; }
    else { b.x += b.dx * b.speed * dt; b.z += b.dz * b.speed * dt; }
    b.mesh.position.set(b.x, b.y, b.z);
    b.life -= dt;

    let hitPlayer = false;
    if (b.owner === 'me') {
      const ex = oppMesh.position.x, ez = oppMesh.position.z;
      const ey = oppMesh.position.y || 0;
      const dx = b.x - ex, dz = b.z - ez;
      // height check: opp is from y..y+1.7
      if (dx*dx + dz*dz < (b.size + 0.55) * (b.size + 0.55)
          && b.y >= ey + 0.2 && b.y <= ey + 1.75) {
        hitPlayer = true;
        applyDamageToOpp(b.dmg);
        spawnHit(b.x, b.z);
      }
    } else {
      const dx = b.x - state.me.x, dz = b.z - state.me.z;
      const ey = state.me.y || 0;
      if (dx*dx + dz*dz < (b.size + 0.55) * (b.size + 0.55)
          && b.y >= ey + 0.2 && b.y <= ey + 1.75) {
        hitPlayer = true;
        applyDamageToMe(b.dmg);
        spawnHit(b.x, b.z);
      }
    }

    if ((hitPlayer && !b.piercing) || hitMap || b.life <= 0) {
      if (b.kind === 'rocket' && b.explodeRadius) {
        spawnExplosion(b.x, b.z, b.explodeRadius, 0xe07a4a);
        if (b.owner === 'me' && !hitPlayer) {
          const ex = oppMesh.position.x, ez = oppMesh.position.z;
          const ddx = ex - b.x, ddz = ez - b.z;
          if (ddx*ddx + ddz*ddz < b.explodeRadius*b.explodeRadius && (oppMesh.position.y || 0) < 2.4) {
            applyDamageToOpp(Math.floor(b.dmg * 0.7));
          }
        } else if (b.owner === 'opp' && !hitPlayer) {
          const ddx = state.me.x - b.x, ddz = state.me.z - b.z;
          if (ddx*ddx + ddz*ddz < b.explodeRadius*b.explodeRadius && state.me.y < 2.4) {
            applyDamageToMe(Math.floor(b.dmg * 0.7));
          }
        }
      }
      scene.remove(b.mesh);
      state.bullets.splice(i, 1);
    }
  }
}

// ============= Damage routing =============
// In bot mode, both apply locally (authority on host).
// In P2P:
//   When MY bullet hits OPP -> I'm telling OPP "you took dmg"; and (if I'm authority) update hp & broadcast.
//   When OPP bullet hits ME -> just play the visual; the actual HP comes via authority's "hp" message OR (since opp shot is reported by opp) we can apply ourselves and tell opp.
function applyDamageToOpp(dmg) {
  if (!net) return;
  if (state.isAuthority) {
    state.hpOpp = Math.max(0, state.hpOpp - dmg);
    updateHpBars();
    if (!net.isBot) net.send({ t:'damage', dmg });  // tell guest THEY took dmg
    if (!net.isBot) net.send({ t:'hp', you: state.hpYou, opp: state.hpOpp });
    checkDeath();
  } else {
    // guest: tell host I hit them
    net.send({ t:'hit', dmg });
    // local snappy hp pred
    state.hpOpp = Math.max(0, state.hpOpp - dmg);
    updateHpBars();
  }
}
function applyDamageToMe(dmg) {
  if (!net) return;
  if (state.isAuthority) {
    state.hpYou = Math.max(0, state.hpYou - dmg);
    updateHpBars();
    if (!net.isBot) net.send({ t:'hp', you: state.hpYou, opp: state.hpOpp });
    checkDeath();
  } else {
    // guest: I took damage from opp's bullet. Tell host so they can subtract from hpYou (which is my hp).
    // Use 'hit' but with negative semantics... Simpler: send a 'selfhit' to host
    net.send({ t:'selfhit', dmg });
    state.hpYou = Math.max(0, state.hpYou - dmg);
    updateHpBars();
  }
}
function checkDeath() {
  if (!state.inMatch) return;
  if (state.hpYou <= 0 || state.hpOpp <= 0) {
    let winner;
    if (state.hpYou <= 0 && state.hpOpp <= 0) winner = -1;
    else if (state.hpYou <= 0) winner = 1 - state.youSlot;
    else winner = state.youSlot;
    if (net && !net.isBot) net.send({ t:'end', winner });
    endMatchUI(winner, winner === state.youSlot ? 'VICTORY' : (winner === -1 ? 'DRAW' : 'DEFEAT'));
  }
}

// ============= Effects =============
function spawnFlash(x, z, color = 0xfff0c0) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 6),
    new THREE.MeshBasicMaterial({ color, transparent:true, opacity: 0.85 }));
  m.position.set(x, 1.0, z);
  scene.add(m);
  state.effects.push({ mesh:m, life:0.12, update:(e,dt)=>{ e.mesh.material.opacity *= 0.7; e.mesh.scale.multiplyScalar(1.18);} });
}
function spawnHit(x, z) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(0.4, 10, 8),
    new THREE.MeshBasicMaterial({ color: 0xff7878, transparent:true, opacity: 0.9 }));
  m.position.set(x, 1.0, z);
  scene.add(m);
  state.effects.push({ mesh:m, life:0.22, update:(e,dt)=>{ e.mesh.material.opacity *= 0.85; e.mesh.scale.multiplyScalar(1.2);} });
}
function spawnExplosion(x, z, r, color = 0xe07a4a) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r * 0.5, 16, 12),
    new THREE.MeshBasicMaterial({ color, transparent:true, opacity: 0.85 }));
  m.position.set(x, 1.0, z);
  scene.add(m);
  state.effects.push({ mesh:m, life:0.42, update:(e,dt)=>{ e.mesh.material.opacity *= 0.85; e.mesh.scale.multiplyScalar(1.08);} });
}

// ============= HUD =============
function updateHpBars() {
  const myMax  = getCharacter(state.myCharId).hp;
  const oppMax = getCharacter(state.oppCharId).hp;
  document.getElementById('hp-you-fill').style.width = Math.max(0, state.hpYou/myMax*100) + '%';
  document.getElementById('hp-opp-fill').style.width = Math.max(0, state.hpOpp/oppMax*100) + '%';
}
function updateTimer() {
  const m = Math.floor(state.remaining / 60);
  const s = state.remaining % 60;
  document.getElementById('hud-timer').textContent = `${m}:${s.toString().padStart(2,'0')}`;
}
function updateCooldownBars() {
  const c = getCharacter(state.myCharId);
  const cdF = c.weapon.cooldown;
  document.getElementById('cd-fire').style.width  = (1 - state.cooldown / cdF) * 100 + '%';
  document.getElementById('cd-dash').style.width  = (1 - state.cdDash / 1.6) * 100 + '%';
  document.getElementById('cd-skill').style.width = (1 - state.cdSkill / c.skill.cooldown) * 100 + '%';

  document.getElementById('btn-skill').disabled = state.cdSkill > 0;
  document.getElementById('btn-dash').disabled  = state.cdDash > 0;
  document.getElementById('btn-jump').disabled  = state.cdJump > 0 || state.me.y > 0.02;
}
function flashText(text, color='#e6e9f2') {
  const el = document.getElementById('killfeed');
  el.textContent = text;
  el.style.color = color;
  el.classList.add('show');
  clearTimeout(flashText._t);
  flashText._t = setTimeout(()=>el.classList.remove('show'), 1100);
}

function endMatchUI(winner, title) {
  if (!state.inMatch) return;
  state.inMatch = false;
  document.getElementById('end-title').textContent = title;
  document.getElementById('end-title').className =
    (title === 'VICTORY') ? 'victory' :
    (title === 'DEFEAT')  ? 'defeat'  :
    (title === 'DRAW')    ? 'draw'    : '';
  showScreen('end');
}

// ============= Render =============
function render() { renderer.render(scene, camera); }

// ============= Utils =============
function lerp(a, b, t) { return a + (b - a) * t; }
function lerpAngle(a, b, t) {
  const diff = ((b - a + Math.PI*3) % (Math.PI*2)) - Math.PI;
  return a + diff * t;
}
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

// ============= Init =============
showScreen('title');

// Dev quick start
if (location.search.includes('dev=1')) {
  startBotMatch();
}
