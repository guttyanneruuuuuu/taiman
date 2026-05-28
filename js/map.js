// =====================================================
// Arena map.
// - 72x72 bright open ground (much wider than the first build)
// - Symmetric cover so it's fair regardless of which spawn
// - Center: jump pad + heal orb (regen 18s)
// - 3D-only gimmicks: low cover can be jumped over, updraft pads,
//   elevated ring markers, and moving pillars that require vertical dodges
// =====================================================
import * as THREE from 'three';

// seedable PRNG (mulberry32) — both clients use same seed = same layout
function rng(seed) {
  let a = (seed >>> 0) || 1;
  return function() {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

export const MAP_SIZE = 72;
export const WALL_HEIGHT = 2.4;
export const COVER_LOW_H = 1.1;   // duckable / jumpable cover
export const COVER_TALL_H = 2.0;  // tall cover (must go around)

export function generateMap(seed) {
  const rand = rng(seed || 1);
  const obstacles = [];

  // Outer walls
  const W = MAP_SIZE / 2;
  obstacles.push({ x: 0, z:  W, sx: MAP_SIZE, sz: 1, h: WALL_HEIGHT, kind: 'wall' });
  obstacles.push({ x: 0, z: -W, sx: MAP_SIZE, sz: 1, h: WALL_HEIGHT, kind: 'wall' });
  obstacles.push({ x:  W, z: 0, sx: 1, sz: MAP_SIZE, h: WALL_HEIGHT, kind: 'wall' });
  obstacles.push({ x: -W, z: 0, sx: 1, sz: MAP_SIZE, h: WALL_HEIGHT, kind: 'wall' });

  // Symmetric cover (point-mirror)
  function addPair(x, z, sx, sz, h, kind = 'cover') {
    obstacles.push({ x,    z,    sx, sz, h, kind });
    obstacles.push({ x:-x, z:-z, sx, sz, h, kind });
  }

  // Hand-placed cover (mix of low/tall). Wider lanes give room for 1v1 mind games.
  addPair(  7,   8, 3.2, 1.2, COVER_LOW_H);
  addPair( 11,   2, 1.2, 4.0, COVER_TALL_H);
  addPair( 16,  -9, 2.8, 2.8, COVER_TALL_H);
  addPair(  5, -15, 4.6, 1.0, COVER_LOW_H);
  addPair(-13,  16, 1.2, 4.8, COVER_TALL_H);
  addPair(  2,   5, 2.0, 1.0, COVER_LOW_H);
  addPair( -4, -10, 2.6, 1.8, COVER_LOW_H);
  addPair( 21,  12, 6.0, 1.0, COVER_LOW_H);
  addPair( 24,  -2, 1.2, 5.6, COVER_TALL_H);
  addPair(-18,  -6, 4.0, 1.0, COVER_LOW_H);
  addPair(  9,  23, 1.0, 4.2, COVER_LOW_H);
  addPair( -8, -24, 4.8, 1.0, COVER_TALL_H);

  // Seeded mini covers outside the center so every match feels slightly different.
  for (let i = 0; i < 4; i++) {
    const x = 8 + rand() * 18;
    const z = 8 + rand() * 18;
    const sx = 1.2 + rand() * 2.0;
    const sz = 1.0 + rand() * 2.0;
    const h = rand() < 0.58 ? COVER_LOW_H : COVER_TALL_H;
    addPair(x * (rand() < 0.5 ? -1 : 1), z * (rand() < 0.5 ? -1 : 1), sx, sz, h);
  }

  // Moving pillars (rotating around center) — moving tall cover for dash/jump timing.
  const movers = [
    { orbitR: 8.4, angle: 0,           speed:  0.50, radius: 1.05, h: COVER_TALL_H },
    { orbitR: 8.4, angle: Math.PI,     speed: -0.50, radius: 1.05, h: COVER_TALL_H },
    { orbitR: 13.2, angle: Math.PI/2,  speed:  0.34, radius: 0.90, h: COVER_LOW_H  },
    { orbitR: 13.2, angle:-Math.PI/2,  speed: -0.34, radius: 0.90, h: COVER_LOW_H  },
  ];

  return {
    obstacles,
    movers,
    pad:  { x: 0, z: 0 },
    heal: { x: 0, z: -8 },
    updrafts: [
      { x: -17, z:  17, r: 1.55, boost: 17 },
      { x:  17, z: -17, r: 1.55, boost: 17 },
      { x: -24, z:  -4, r: 1.35, boost: 14 },
      { x:  24, z:   4, r: 1.35, boost: 14 },
    ],
  };
}

// ===== Build Three.js meshes for the map =====
export function buildMapMesh(mapData) {
  const group = new THREE.Group();

  // Ground (bright warm white, non-neon)
  const groundMat = new THREE.MeshLambertMaterial({ color: 0xf4f7fb });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(MAP_SIZE, MAP_SIZE), groundMat);
  ground.rotation.x = -Math.PI / 2;
  group.add(ground);

  // Tile lines (subtle blue-grey, no glow)
  const grid = new THREE.GridHelper(MAP_SIZE, 36, 0xc9d7ef, 0xe6edf7);
  grid.position.y = 0.01;
  group.add(grid);

  // Outer ring (clear playable zone border)
  const ringMat = new THREE.MeshBasicMaterial({ color: 0xdbe6f5 });
  const ringGeo = new THREE.RingGeometry(MAP_SIZE/2 - 0.6, MAP_SIZE/2 + 6, 32);
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.02;
  group.add(ring);

  // Obstacles
  const colliders = [];
  const coverLowMat  = new THREE.MeshLambertMaterial({ color: 0x75a7e6 });
  const coverTallMat = new THREE.MeshLambertMaterial({ color: 0xe36f6f });
  const wallMat      = new THREE.MeshLambertMaterial({ color: 0xffffff });
  mapData.obstacles.forEach((o) => {
    const mat = o.kind === 'wall' ? wallMat : (o.h >= COVER_TALL_H ? coverTallMat : coverLowMat);
    const m = new THREE.Mesh(new THREE.BoxGeometry(o.sx, o.h, o.sz), mat);
    m.position.set(o.x, o.h / 2, o.z);
    group.add(m);
    colliders.push({
      type: 'aabb',
      minX: o.x - o.sx/2, maxX: o.x + o.sx/2,
      minZ: o.z - o.sz/2, maxZ: o.z + o.sz/2,
      h: o.h, kind: o.kind,
    });
  });

  // Center jump pad
  const padMat = new THREE.MeshLambertMaterial({ color: 0x2f80ed });
  const pad = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 0.18, 24), padMat);
  pad.position.set(mapData.pad.x, 0.09, mapData.pad.z);
  group.add(pad);
  mapData.padMesh = pad;

  // Heal orb
  const healMat = new THREE.MeshLambertMaterial({ color: 0x35b779 });
  const heal = new THREE.Mesh(new THREE.IcosahedronGeometry(0.5, 0), healMat);
  heal.position.set(mapData.heal.x, 1.1, mapData.heal.z);
  group.add(heal);
  mapData.healMesh = heal;
  mapData.healAvailable = true;
  mapData.healCooldown = 0;

  // Moving pillars (visual + collider stored in dataset, updated each tick)
  const moverMat = new THREE.MeshLambertMaterial({ color: 0xffb15f });
  mapData.moverMeshes = [];
  mapData.moverColliders = [];
  for (const mv of mapData.movers) {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(mv.radius, mv.radius, mv.h, 16), moverMat);
    group.add(mesh);
    mapData.moverMeshes.push(mesh);
    const col = { type: 'circle', x: 0, z: 0, r: mv.radius, h: mv.h, kind: 'cover' };
    mapData.moverColliders.push(col);
    colliders.push(col);
  }

  // Updraft jump circles: 3D-only vertical routes to dodge shots and shoot over low cover.
  const upMat = new THREE.MeshLambertMaterial({ color: 0x5aa7ff, transparent: true, opacity: 0.82 });
  mapData.updraftMeshes = [];
  for (const u of mapData.updrafts || []) {
    const up = new THREE.Mesh(new THREE.CylinderGeometry(u.r, u.r, 0.12, 28), upMat);
    up.position.set(u.x, 0.07, u.z);
    group.add(up);
    mapData.updraftMeshes.push(up);
  }

  // Raised height markers make airborne states readable on phones.
  const arcMat = new THREE.MeshBasicMaterial({ color: 0x2f80ed, transparent: true, opacity: 0.42, side: THREE.DoubleSide });
  for (let i = 0; i < 4; i++) {
    const arc = new THREE.Mesh(new THREE.TorusGeometry(7 + i * 5, 0.035, 6, 72), arcMat);
    arc.rotation.x = Math.PI / 2;
    arc.position.y = 0.12 + i * 0.012;
    group.add(arc);
  }

  // Lights — bright soft daylight
  const amb = new THREE.AmbientLight(0xffffff, 0.95);
  const dir = new THREE.DirectionalLight(0xffffff, 0.72);
  dir.position.set(12, 22, 8);
  group.add(amb, dir);

  return { group, colliders };
}

// Called every frame from main loop to animate movers
export function tickMovers(mapData, dt) {
  for (let i = 0; i < mapData.movers.length; i++) {
    const mv = mapData.movers[i];
    mv.angle += mv.speed * dt;
    const x = Math.cos(mv.angle) * mv.orbitR;
    const z = Math.sin(mv.angle) * mv.orbitR;
    mapData.moverMeshes[i].position.set(x, mv.h / 2, z);
    mapData.moverColliders[i].x = x;
    mapData.moverColliders[i].z = z;
  }
}

// Collide a cylinder (radius r) around (x,z) with all colliders, return adjusted [x,z].
// playerY lets airborne fighters jump over low cover, which is the core 3D dodge mechanic.
export function collideXZ(x, z, r, colliders, playerY = 0) {
  for (const c of colliders) {
    if (playerY > c.h + 0.18 && c.kind !== 'wall') continue;
    if (c.type === 'aabb') {
      const closestX = Math.max(c.minX, Math.min(x, c.maxX));
      const closestZ = Math.max(c.minZ, Math.min(z, c.maxZ));
      const dx = x - closestX, dz = z - closestZ;
      const d2 = dx*dx + dz*dz;
      if (d2 < r*r) {
        const d = Math.sqrt(d2) || 0.0001;
        const push = (r - d) + 0.001;
        x += (dx / d) * push;
        z += (dz / d) * push;
      }
    } else if (c.type === 'circle') {
      const dx = x - c.x, dz = z - c.z;
      const d2 = dx*dx + dz*dz;
      const rr = (r + c.r);
      if (d2 < rr*rr) {
        const d = Math.sqrt(d2) || 0.0001;
        const push = (rr - d) + 0.001;
        x += (dx / d) * push;
        z += (dz / d) * push;
      }
    }
  }
  const lim = MAP_SIZE/2 - r - 0.6;
  if (x >  lim) x =  lim;
  if (x < -lim) x = -lim;
  if (z >  lim) z =  lim;
  if (z < -lim) z = -lim;
  return [x, z];
}

// Ray vs map (2D). Returns t in [0, maxT] of first hit.
// bulletH = current bullet altitude — low bullets pass over tall cover only if they
// can pass UNDER... we don't have that; instead bullets with h above collider.h pass over it.
export function raycastMap(ox, oz, dx, dz, maxT, colliders, bulletH = 1.0) {
  let bestT = maxT;
  for (const c of colliders) {
    // bullets above this collider's height pass over it
    if (bulletH > c.h + 0.05) continue;

    if (c.type === 'aabb') {
      const invDx = dx !== 0 ? 1/dx : 1e9;
      const invDz = dz !== 0 ? 1/dz : 1e9;
      const tx1 = (c.minX - ox) * invDx;
      const tx2 = (c.maxX - ox) * invDx;
      const tz1 = (c.minZ - oz) * invDz;
      const tz2 = (c.maxZ - oz) * invDz;
      const tmin = Math.max(Math.min(tx1, tx2), Math.min(tz1, tz2));
      const tmax = Math.min(Math.max(tx1, tx2), Math.max(tz1, tz2));
      if (tmax >= Math.max(0, tmin) && tmin < bestT && tmin > 0) bestT = tmin;
    } else if (c.type === 'circle') {
      // Ray-circle in 2D
      const fx = ox - c.x, fz = oz - c.z;
      const a = dx*dx + dz*dz;
      const b = 2 * (fx*dx + fz*dz);
      const cc = fx*fx + fz*fz - c.r*c.r;
      const disc = b*b - 4*a*cc;
      if (disc < 0) continue;
      const sq = Math.sqrt(disc);
      const t1 = (-b - sq) / (2*a);
      if (t1 > 0 && t1 < bestT) bestT = t1;
    }
  }
  return bestT;
}
