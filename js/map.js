// =====================================================
// Arena map.
// - 48x48 ground
// - Symmetric cover so it's fair regardless of which spawn
// - Center: jump pad + heal orb (regen 18s)
// - Moving gimmick: 2 rotating circular pillars that act as
//   moving cover and force you to use jumps/dashes around them
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

export const MAP_SIZE = 48;
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

  // Hand-placed cover (mix of low/tall)
  addPair( 7,  8, 3.2, 1.2, COVER_LOW_H);
  addPair(11,  2, 1.2, 4.0, COVER_TALL_H);
  addPair(14, -7, 2.4, 2.4, COVER_TALL_H);
  addPair( 4,-12, 3.8, 1.0, COVER_LOW_H);
  addPair(-9, 12, 1.2, 3.6, COVER_TALL_H);
  addPair( 2,  4, 1.8, 1.0, COVER_LOW_H);
  addPair(-3, -8, 2.0, 1.8, COVER_LOW_H);

  // A few small random pairs (seeded)
  for (let i = 0; i < 2; i++) {
    const x = 3 + rand() * 11;
    const z = 3 + rand() * 11;
    const sx = 1.2 + rand() * 1.4;
    const sz = 1.2 + rand() * 1.4;
    const h = rand() < 0.5 ? COVER_LOW_H : COVER_TALL_H;
    addPair(x * (rand() < 0.5 ? -1 : 1), z * (rand() < 0.5 ? -1 : 1), sx, sz, h);
  }

  // Moving pillars (rotating around center) — handled at runtime in main.js
  // They are circles of radius 1.0, orbiting at radius 6.5 (mirrored), one slow one faster.
  const movers = [
    { orbitR: 6.8, angle: 0,           speed:  0.6, radius: 1.0, h: COVER_TALL_H },
    { orbitR: 6.8, angle: Math.PI,     speed: -0.6, radius: 1.0, h: COVER_TALL_H },
  ];

  return {
    obstacles,
    movers,
    pad:  { x: 0, z: 0 },
    heal: { x: 0, z: -6 },
  };
}

// ===== Build Three.js meshes for the map =====
export function buildMapMesh(mapData) {
  const group = new THREE.Group();

  // Ground (calm slate)
  const groundMat = new THREE.MeshLambertMaterial({ color: 0x2e3445 });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(MAP_SIZE, MAP_SIZE), groundMat);
  ground.rotation.x = -Math.PI / 2;
  group.add(ground);

  // Tile lines (subtle, no neon)
  const grid = new THREE.GridHelper(MAP_SIZE, 24, 0x3a4258, 0x252b3a);
  grid.position.y = 0.01;
  group.add(grid);

  // Outer ring (slightly darker to mark playable zone)
  const ringMat = new THREE.MeshBasicMaterial({ color: 0x1a1f2b });
  const ringGeo = new THREE.RingGeometry(MAP_SIZE/2 - 0.6, MAP_SIZE/2 + 6, 32);
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.02;
  group.add(ring);

  // Obstacles
  const colliders = [];
  const coverLowMat  = new THREE.MeshLambertMaterial({ color: 0x4a5063 });
  const coverTallMat = new THREE.MeshLambertMaterial({ color: 0x3c4255 });
  const wallMat      = new THREE.MeshLambertMaterial({ color: 0x353b4d });
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
  const padMat = new THREE.MeshLambertMaterial({ color: 0xd97c4f });
  const pad = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 0.18, 24), padMat);
  pad.position.set(mapData.pad.x, 0.09, mapData.pad.z);
  group.add(pad);
  mapData.padMesh = pad;

  // Heal orb
  const healMat = new THREE.MeshLambertMaterial({ color: 0x6fb59a });
  const heal = new THREE.Mesh(new THREE.IcosahedronGeometry(0.5, 0), healMat);
  heal.position.set(mapData.heal.x, 1.1, mapData.heal.z);
  group.add(heal);
  mapData.healMesh = heal;
  mapData.healAvailable = true;
  mapData.healCooldown = 0;

  // Moving pillars (visual + collider stored in dataset, updated each tick)
  const moverMat = new THREE.MeshLambertMaterial({ color: 0x6c7488 });
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

  // Lights — flat soft
  const amb = new THREE.AmbientLight(0xffffff, 0.7);
  const dir = new THREE.DirectionalLight(0xffffff, 0.55);
  dir.position.set(10, 18, 6);
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

// Collide a cylinder (radius r) around (x,z) with all colliders, return adjusted [x,z]
export function collideXZ(x, z, r, colliders) {
  for (const c of colliders) {
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
