// =============================================================
//  Taiman - main client
//  Title -> Queue -> 3D match -> End -> rematch
// =============================================================
import * as THREE from 'three';
import { CHARACTERS, getCharacter } from './characters.js';
import { generateMap, buildMapMesh, collideXZ, raycastMap, MAP_SIZE } from './map.js';
import { buildPlayerMesh } from './player.js';
import { setupControls } from './controls.js';
import { Net } from './net.js';

// ---------- Global state ----------
const state = {
  inMatch: false,
  releaseFire: false,
  mouseDown: false,
  myCharId: 0,
  myName: 'YOU',
  oppName: 'OPP',
  oppCharId: 0,
  youSlot: 0,
  hpYou: 100,
  hpOpp: 100,
  remaining: 120,
  cooldown: 0,
  // gameplay
  me: { x: 0, z: 0, vx: 0, vz: 0, rotY: 0, aim: { active:false, dx:0, dy:0 } },
  opp: { x: 0, z: 0, rotY: 0, aim: null, vx:0, vz:0, lastX:0, lastZ:0, tLast:0 },
  bullets: [],
  effects: [],
};

// ---------- Title / character select ----------
const charList = document.getElementById('char-list');
let selectedChar = 0;

function buildCharCards() {
  charList.innerHTML = '';
  CHARACTERS.forEach((c, i) => {
    const el = document.createElement('div');
    el.className = 'char-card' + (i === selectedChar ? ' active' : '');
    el.innerHTML = `
      <div class="role">${c.role}</div>
      <div class="ico">${c.icon}</div>
      <div class="nm">${c.name}</div>
    `;
    el.style.background = `linear-gradient(180deg, #1a1f3a 60%, #${c.color.toString(16).padStart(6,'0')}33)`;
    el.addEventListener('click', () => {
      selectedChar = i;
      state.myCharId = i;
      [...charList.children].forEach((n, j) => n.classList.toggle('active', j === i));
    });
    charList.appendChild(el);
  });
}
buildCharCards();

document.getElementById('btn-find').addEventListener('click', () => {
  const name = (document.getElementById('name-input').value || 'YOU').slice(0,12);
  state.myName = name;
  state.myCharId = selectedChar;
  showScreen('queue');
  startNet();
});
document.getElementById('btn-cancel').addEventListener('click', () => {
  net.send({ t: 'leave' });
  showScreen('title');
});

document.getElementById('btn-again').addEventListener('click', () => {
  resetMatchUI();
  showScreen('queue');
  net.send({ t: 'queue', name: state.myName, charId: state.myCharId });
});
document.getElementById('btn-home').addEventListener('click', () => {
  resetMatchUI();
  showScreen('title');
});

function showScreen(which) {
  for (const id of ['title', 'queue', 'game', 'end']) {
    document.getElementById('screen-' + id).classList.toggle('hidden', id !== which);
  }
}

// ---------- Networking ----------
const net = new Net();
function startNet() {
  if (!net.connected) {
    net.connect();
    net.on('open', () => {
      net.send({ t: 'queue', name: state.myName, charId: state.myCharId });
    });
    net.on('close', () => {
      // if we were in match, end it
      if (state.inMatch) endMatchUI(-1, 'DISCONNECTED');
    });
  } else {
    net.send({ t: 'queue', name: state.myName, charId: state.myCharId });
  }
}

net.on('queued', () => {
  document.getElementById('queue-tip').textContent = 'Waiting for another player...';
});

net.on('matched', (m) => {
  state.youSlot   = m.you;
  state.oppCharId = m.opp.charId;
  state.oppName   = m.opp.name;
  startMatch(m.mapSeed);
});

net.on('state', (m) => {
  // Opponent state from server
  state.opp.lastX = state.opp.x;
  state.opp.lastZ = state.opp.z;
  state.opp.x = m.pos[0];
  state.opp.z = m.pos[1];
  state.opp.rotY = m.rotY;
  state.opp.aim = m.aim || null;
  state.hpOpp = m.hp ?? state.hpOpp;
  updateHpBars();
});

net.on('shoot', (m) => {
  // Opponent shot. Spawn matching bullets locally so we can render & dodge.
  const char = getCharacter(state.oppCharId);
  spawnBullets({
    char,
    ox: m.pos[0], oz: m.pos[1],
    dx: m.dir[0], dz: m.dir[1],
    owner: 'opp',
    kind: m.kind,
  });
});

net.on('hp', (m) => {
  state.hpYou = m.you;
  state.hpOpp = m.opp;
  updateHpBars();
});

net.on('timer', (m) => {
  state.remaining = m.remaining;
  updateTimer();
});

net.on('end', (m) => {
  const winner = m.winner;
  let title = 'DRAW';
  if (winner === state.youSlot) title = 'VICTORY';
  else if (winner === -1) title = 'DRAW';
  else title = 'DEFEAT';
  endMatchUI(winner, title);
});

// ---------- THREE.js setup ----------
let renderer, scene, camera;
let myMesh, oppMesh;
let mapData, mapColliders, mapGroup;
let lastTime = 0;
let controlsAPI;

function setupRenderer() {
  const canvas = document.getElementById('game-canvas');
  renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight, false);

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b0d17);
  scene.fog = new THREE.Fog(0x0b0d17, 30, 60);

  // Slightly tilted top-down camera (so 3D dodging is readable)
  camera = new THREE.PerspectiveCamera(58, window.innerWidth/window.innerHeight, 0.1, 200);

  window.addEventListener('resize', () => {
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  });
}

function startMatch(seed) {
  showScreen('game');
  if (!renderer) setupRenderer();

  // Clear previous scene additions
  scene.clear();
  scene.background = new THREE.Color(0x0b0d17);
  scene.fog = new THREE.Fog(0x0b0d17, 30, 60);

  // Build map
  mapData = generateMap(seed);
  const m = buildMapMesh(mapData);
  mapGroup = m.group;
  mapColliders = m.colliders;
  scene.add(mapGroup);

  // Spawn positions (opposite corners)
  const spawnA = { x: -MAP_SIZE/2 + 4, z: -MAP_SIZE/2 + 4 };
  const spawnB = { x:  MAP_SIZE/2 - 4, z:  MAP_SIZE/2 - 4 };
  const mySpawn = state.youSlot === 0 ? spawnA : spawnB;
  const oppSpawn = state.youSlot === 0 ? spawnB : spawnA;

  state.me.x = mySpawn.x; state.me.z = mySpawn.z;
  state.me.rotY = Math.atan2(-mySpawn.x, -mySpawn.z); // face center
  state.opp.x = oppSpawn.x; state.opp.z = oppSpawn.z;
  state.opp.lastX = oppSpawn.x; state.opp.lastZ = oppSpawn.z;
  state.opp.rotY = Math.atan2(-oppSpawn.x, -oppSpawn.z);
  state.hpYou = getCharacter(state.myCharId).hp;
  state.hpOpp = getCharacter(state.oppCharId).hp;
  state.bullets = [];
  state.effects = [];
  state.remaining = 120;
  state.cooldown = 0;

  // Build player meshes
  myMesh  = buildPlayerMesh(getCharacter(state.myCharId), true);
  oppMesh = buildPlayerMesh(getCharacter(state.oppCharId), false);
  scene.add(myMesh, oppMesh);

  // HUD
  document.getElementById('hp-you-name').textContent = state.myName;
  document.getElementById('hp-opp-name').textContent = state.oppName;
  updateHpBars();
  updateTimer();

  state.inMatch = true;
  controlsAPI = controlsAPI || setupControls(state);

  lastTime = performance.now();
  if (!renderLoopStarted) { renderLoopStarted = true; requestAnimationFrame(loop); }

  // 20Hz state ticker to server
  if (!stateTickerStarted) {
    stateTickerStarted = true;
    setInterval(() => {
      if (!state.inMatch) return;
      net.send({ t:'input', pos:[state.me.x, state.me.z], rotY: state.me.rotY,
                 aim: state.me.aim?.active ? { dx: state.me.aim.dx, dy: state.me.aim.dy } : null });
    }, 50);
  }
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

// ---------- Game tick ----------
function tick(dt) {
  const myChar = getCharacter(state.myCharId);
  const input = controlsAPI.getInput();

  // ----- Move -----
  const speed = myChar.speed;
  // Camera-relative movement (camera looks toward +Z so forward is screen up)
  // Joystick: up (negative dy) -> away from camera (negative Z in our setup, but we use char y-rot for shooting)
  const moveX = input.mx * speed * dt;
  const moveZ = input.my * speed * dt;
  let nx = state.me.x + moveX;
  let nz = state.me.z + moveZ;
  [nx, nz] = collideXZ(nx, nz, 0.5, mapColliders);
  state.me.x = nx; state.me.z = nz;

  // Face direction: if aiming, face aim direction; else face movement
  if (input.aimActive && (Math.abs(input.ax) + Math.abs(input.ay) > 0.05)) {
    state.me.rotY = Math.atan2(input.ax, input.ay);
    state.me.aim = { active: true, dx: input.ax, dy: input.ay };
  } else if (Math.abs(moveX) + Math.abs(moveZ) > 0.001) {
    state.me.rotY = Math.atan2(moveX, moveZ);
    state.me.aim = { active: false, dx: 0, dy: 0 };
  } else {
    state.me.aim = { active: false, dx: 0, dy: 0 };
  }

  // ----- Cooldown / shoot -----
  state.cooldown = Math.max(0, state.cooldown - dt);
  const w = myChar.weapon;

  // Continuous fire on hold for some weapons, tap-fire (release) for snipy ones
  const holdToFire = (w.kind === 'smg' || w.kind === 'shotgun');
  const fireNow = state.cooldown === 0 && (
    (holdToFire && input.aimActive) ||
    (!holdToFire && state.releaseFire && state.me.aim.active)
  );
  if (state.releaseFire && !holdToFire && !state.me.aim.active) {
    // release without aim -> fire forward
    if (state.cooldown === 0) doShoot(myChar, Math.sin(state.me.rotY), Math.cos(state.me.rotY));
  } else if (fireNow) {
    doShoot(myChar, input.ax, input.ay);
  }
  state.releaseFire = false;
  updateCooldownBar();

  // ----- Update bullets -----
  updateBullets(dt);

  // ----- Effects -----
  for (let i = state.effects.length-1; i >= 0; i--) {
    const e = state.effects[i];
    e.life -= dt;
    if (e.update) e.update(e, dt);
    if (e.life <= 0) { scene.remove(e.mesh); state.effects.splice(i,1); }
  }

  // ----- Center gimmicks: jump pad + heal orb -----
  // Heal orb: pickup if close
  if (mapData.healAvailable) {
    mapData.healMesh.rotation.y += dt * 2;
    mapData.healMesh.position.y = 1.1 + Math.sin(performance.now()/300) * 0.1;
    const dx = state.me.x - mapData.heal.x;
    const dz = state.me.z - mapData.heal.z;
    if (dx*dx + dz*dz < 0.9*0.9 && state.hpYou < getCharacter(state.myCharId).hp) {
      mapData.healAvailable = false;
      mapData.healMesh.visible = false;
      mapData.healCooldown = 15;
      net.send({ t:'heal', amount: 30 });
      flashText('+30 HP', '#3df58a');
    }
  } else {
    mapData.healCooldown -= dt;
    if (mapData.healCooldown <= 0) {
      mapData.healAvailable = true;
      mapData.healMesh.visible = true;
    }
  }
  // Jump pad: visual rotation + small boost (vertical jump look)
  mapData.padMesh.rotation.y += dt * 0.8;
  const pdx = state.me.x - mapData.pad.x;
  const pdz = state.me.z - mapData.pad.z;
  if (pdx*pdx + pdz*pdz < 1.6*1.6 && state.me.y === undefined) {
    // trigger short hop
    state.me.y = 0;
    state.me.vy = 9;
  }

  // Vertical for me (jump pad)
  if (state.me.y !== undefined) {
    state.me.vy -= 22 * dt;
    state.me.y += state.me.vy * dt;
    if (state.me.y <= 0) { state.me.y = undefined; state.me.vy = 0; }
  }

  // ----- Sync meshes -----
  myMesh.position.set(state.me.x, state.me.y || 0, state.me.z);
  myMesh.rotation.y = state.me.rotY;

  // Smoothly interpolate opponent
  state.opp.lerpT = (state.opp.lerpT || 0) + dt * 10;
  const a = Math.min(1, state.opp.lerpT * 0.18 + 0.25);
  // simple lerp toward last received
  oppMesh.position.x = THREE.MathUtils.lerp(oppMesh.position.x, state.opp.x, 0.25);
  oppMesh.position.z = THREE.MathUtils.lerp(oppMesh.position.z, state.opp.z, 0.25);
  oppMesh.rotation.y = lerpAngle(oppMesh.rotation.y, state.opp.rotY, 0.25);

  // ----- Camera follow (slightly behind & above, portrait-friendly) -----
  // Tilted top-down: camera sits behind player & high. Fixed orientation (no spin) so the
  // thumb-stick directions always feel consistent.
  const camHeight = 15;
  const camBack = 10;
  // Look a little ahead in the direction you're aiming/moving (top-down arena feel)
  const lookOffsetX = (state.me.aim?.active ? state.me.aim.dx : 0) * 2.5;
  const lookOffsetZ = (state.me.aim?.active ? state.me.aim.dy : 0) * 2.5;
  const tx = state.me.x + lookOffsetX;
  const tz = state.me.z + lookOffsetZ;
  const camTarget = new THREE.Vector3(tx, 0, tz);
  const camPos = new THREE.Vector3(state.me.x, camHeight, state.me.z + camBack);
  camera.position.lerp(camPos, 0.18);
  camera.lookAt(camTarget);

  // ----- Aim indicator (3D arc on ground) -----
  drawAimIndicator(myChar, input);
}

// ---------- Aim indicator (a glowing line on the ground from player toward aim) ----------
let aimLine = null;
function drawAimIndicator(char, input) {
  if (!aimLine) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const mat = new THREE.LineBasicMaterial({ color: 0xffd25a, transparent: true, opacity: 0.85 });
    aimLine = new THREE.Line(geo, mat);
    scene.add(aimLine);

    // tip marker
    const tipGeo = new THREE.RingGeometry(0.25, 0.4, 16);
    const tipMat = new THREE.MeshBasicMaterial({ color:0xffd25a, side: THREE.DoubleSide, transparent:true, opacity:0.85 });
    aimLine.userData.tip = new THREE.Mesh(tipGeo, tipMat);
    aimLine.userData.tip.rotation.x = -Math.PI/2;
    scene.add(aimLine.userData.tip);
  }
  const visible = input.aimActive || (input.mx === 0 && input.my === 0 && state.cooldown === 0);
  aimLine.visible = input.aimActive;
  aimLine.userData.tip.visible = input.aimActive;
  if (!input.aimActive) return;

  const ox = state.me.x, oz = state.me.z;
  let dx = input.ax, dz = input.ay;
  const dmag = Math.hypot(dx, dz) || 1;
  dx /= dmag; dz /= dmag;
  // length depends on weapon
  const wl = char.weapon.bulletSpeed * char.weapon.bulletLife;
  const maxLen = Math.min(wl, 14);
  const hitT = raycastMap(ox, oz, dx, dz, maxLen, mapColliders);
  const ex = ox + dx * hitT;
  const ez = oz + dz * hitT;
  const arr = aimLine.geometry.attributes.position.array;
  arr[0] = ox; arr[1] = 0.05; arr[2] = oz;
  arr[3] = ex; arr[4] = 0.05; arr[5] = ez;
  aimLine.geometry.attributes.position.needsUpdate = true;
  aimLine.userData.tip.position.set(ex, 0.06, ez);
}

// ---------- Shooting ----------
function doShoot(char, ax, ay) {
  const mag = Math.hypot(ax, ay);
  let dx, dz;
  if (mag < 0.05) { dx = Math.sin(state.me.rotY); dz = Math.cos(state.me.rotY); }
  else { dx = ax/mag; dz = ay/mag; }
  state.cooldown = char.weapon.cooldown;

  // Local: spawn bullets
  spawnBullets({ char, ox: state.me.x, oz: state.me.z, dx, dz, owner: 'me', kind: char.weapon.kind });

  // Notify opponent (relay)
  net.send({ t:'shoot', pos:[state.me.x, state.me.z], dir:[dx, dz], kind: char.weapon.kind });
}

function spawnBullets({ char, ox, oz, dx, dz, owner, kind }) {
  const w = char.weapon;
  for (let i = 0; i < w.pellets; i++) {
    const spread = (w.spread > 0) ? (Math.random() * 2 - 1) * w.spread : 0;
    const cs = Math.cos(spread), sn = Math.sin(spread);
    const ddx = dx * cs - dz * sn;
    const ddz = dx * sn + dz * cs;

    // Visual bullet
    const color = (kind === 'rocket') ? 0xffb73d : (kind === 'slash' ? 0xddeeff : (owner === 'me' ? 0xffd25a : 0xff7676));
    const geo = (kind === 'slash')
      ? new THREE.BoxGeometry(w.bulletSize, 0.5, 0.4)
      : new THREE.SphereGeometry(w.bulletSize, 8, 6);
    const mat = new THREE.MeshBasicMaterial({ color });
    const mesh = new THREE.Mesh(geo, mat);
    const muzzleOff = 1.0;
    mesh.position.set(ox + ddx * muzzleOff, 1.0, oz + ddz * muzzleOff);
    scene.add(mesh);

    state.bullets.push({
      mesh, owner, kind,
      x: ox + ddx * muzzleOff, z: oz + ddz * muzzleOff,
      dx: ddx, dz: ddz,
      speed: w.bulletSpeed,
      life: w.bulletLife,
      dmg: w.dmgPerPellet,
      size: kind === 'slash' ? w.bulletSize : Math.max(0.2, w.bulletSize),
      explodeRadius: w.explodeRadius || 0,
    });
  }
  // muzzle flash
  spawnFlash(ox + dx * 0.7, oz + dz * 0.7);
}

function updateBullets(dt) {
  for (let i = state.bullets.length - 1; i >= 0; i--) {
    const b = state.bullets[i];
    // raycast step
    const stepX = b.dx * b.speed * dt;
    const stepZ = b.dz * b.speed * dt;
    // map hit
    const t = raycastMap(b.x, b.z, b.dx, b.dz, b.speed * dt, mapColliders);
    let hitMap = false;
    if (t < b.speed * dt) {
      b.x += b.dx * t; b.z += b.dz * t;
      hitMap = true;
    } else {
      b.x += stepX; b.z += stepZ;
    }
    b.mesh.position.set(b.x, 1.0, b.z);
    b.life -= dt;

    // hit detection only when I'm the owner (authoritative-ish for me)
    let hitPlayer = false;
    if (b.owner === 'me') {
      // check vs opponent mesh position (server-synced)
      const ex = oppMesh.position.x, ez = oppMesh.position.z;
      const dx = b.x - ex, dz = b.z - ez;
      if (dx*dx + dz*dz < (b.size + 0.6) * (b.size + 0.6)) {
        hitPlayer = true;
        net.send({ t:'hit', dmg: b.dmg });
        spawnHit(b.x, b.z);
      }
    } else if (b.owner === 'opp') {
      // Check vs me
      const dx = b.x - state.me.x, dz = b.z - state.me.z;
      if (dx*dx + dz*dz < (b.size + 0.6) * (b.size + 0.6)) {
        hitPlayer = true;
        // Opponent's shot hit me -> server gets a 'hit' from them ideally, but for redundancy:
        // We don't double-apply HP locally; server is the source of truth via 'hp' messages.
        spawnHit(b.x, b.z);
      }
    }

    if (hitPlayer || hitMap || b.life <= 0) {
      if (b.kind === 'rocket' && b.explodeRadius) {
        spawnExplosion(b.x, b.z, b.explodeRadius);
        if (b.owner === 'me') {
          const dx = state.me.x - b.x, dz = state.me.z - b.z;
          if (dx*dx + dz*dz < b.explodeRadius*b.explodeRadius) {
            // hurt self a bit? skip, but visible push
          }
          const ex = oppMesh.position.x, ez = oppMesh.position.z;
          const ddx = ex - b.x, ddz = ez - b.z;
          if (ddx*ddx + ddz*ddz < b.explodeRadius*b.explodeRadius && !hitPlayer) {
            net.send({ t:'hit', dmg: Math.floor(b.dmg * 0.7) });
          }
        }
      }
      scene.remove(b.mesh);
      state.bullets.splice(i, 1);
    }
  }
}

// ---------- Effects ----------
function spawnFlash(x, z) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 6),
    new THREE.MeshBasicMaterial({ color: 0xfff0a0, transparent:true, opacity: 0.8 }));
  m.position.set(x, 1.0, z);
  scene.add(m);
  state.effects.push({ mesh:m, life:0.12, update:(e,dt)=>{ e.mesh.material.opacity *= 0.7; e.mesh.scale.multiplyScalar(1.15);} });
}
function spawnHit(x, z) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(0.4, 10, 8),
    new THREE.MeshBasicMaterial({ color: 0xff5050, transparent:true, opacity: 0.9 }));
  m.position.set(x, 1.0, z);
  scene.add(m);
  state.effects.push({ mesh:m, life:0.25, update:(e,dt)=>{ e.mesh.material.opacity *= 0.85; e.mesh.scale.multiplyScalar(1.18);} });
}
function spawnExplosion(x, z, r) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r * 0.5, 16, 12),
    new THREE.MeshBasicMaterial({ color: 0xffb73d, transparent:true, opacity: 0.85 }));
  m.position.set(x, 1.0, z);
  scene.add(m);
  state.effects.push({ mesh:m, life:0.45, update:(e,dt)=>{ e.mesh.material.opacity *= 0.85; e.mesh.scale.multiplyScalar(1.08);} });
}

// ---------- HUD ----------
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
function updateCooldownBar() {
  const cd = getCharacter(state.myCharId).weapon.cooldown;
  const ratio = 1 - state.cooldown / cd;
  document.getElementById('cooldown-fill').style.width = (ratio*100) + '%';
}

function flashText(text, color='#ffd25a') {
  const el = document.getElementById('killfeed');
  el.textContent = text;
  el.style.color = color;
  el.classList.add('show');
  clearTimeout(flashText._t);
  flashText._t = setTimeout(()=>el.classList.remove('show'), 1100);
}

function endMatchUI(winner, title) {
  state.inMatch = false;
  document.getElementById('end-title').textContent = title;
  document.getElementById('end-title').className = (title === 'VICTORY') ? 'victory' : (title === 'DEFEAT' ? 'defeat' : 'draw');
  showScreen('end');
}
function resetMatchUI() {
  // remove canvas content; will be rebuilt on next match
}

// ---------- Render ----------
function render() {
  renderer.render(scene, camera);
}

// ---------- Utils ----------
function lerpAngle(a, b, t) {
  const diff = ((b - a + Math.PI*3) % (Math.PI*2)) - Math.PI;
  return a + diff * t;
}

// Init
showScreen('title');

// Dev helper: ?dev=1 starts a solo match for visual testing (no opponent)
if (location.search.includes('dev=1')) {
  state.myCharId = 0; state.myName = 'DEV';
  state.oppCharId = 1; state.oppName = 'BOT';
  state.youSlot = 0;
  // skip net
  net.send = () => {};
  startMatch(12345);
}
