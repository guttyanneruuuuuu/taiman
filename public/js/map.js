// Procedurally-built arena map. One seed = both clients get same layout.
// Light: low-poly boxes only, no shadows.
import * as THREE from 'three';

// Tiny seedable PRNG (mulberry32)
function rng(seed) {
  let a = seed >>> 0;
  return function() {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

export const MAP_SIZE = 40;      // 40x40 arena (half = 20)
export const WALL_HEIGHT = 2.2;

// Returns { obstacles:[{x,z,sx,sz,h}], pad:{x,z}, heal:{x,z} }
export function generateMap(seed) {
  const rand = rng(seed || 1);
  const obstacles = [];

  // Outer walls (4)
  const W = MAP_SIZE / 2;
  obstacles.push({ x: 0, z:  W, sx: MAP_SIZE, sz: 1, h: WALL_HEIGHT, kind:'wall' });
  obstacles.push({ x: 0, z: -W, sx: MAP_SIZE, sz: 1, h: WALL_HEIGHT, kind:'wall' });
  obstacles.push({ x:  W, z: 0, sx: 1, sz: MAP_SIZE, h: WALL_HEIGHT, kind:'wall' });
  obstacles.push({ x: -W, z: 0, sx: 1, sz: MAP_SIZE, h: WALL_HEIGHT, kind:'wall' });

  // Symmetric cover boxes (mirrored to keep it fair)
  function add(x, z, sx, sz, h=1.6) {
    obstacles.push({ x, z, sx, sz, h, kind:'cover' });
    obstacles.push({ x:-x, z:-z, sx, sz, h, kind:'cover' });
  }

  // a few hand-tuned + a few random pairs
  add(6, 8, 3, 1.2);
  add(10, 2, 1.2, 4);
  add(14, -6, 2, 2);
  add(4, -12, 3.5, 1);
  add(-9, 11, 1.2, 3.5);

  for (let i = 0; i < 3; i++) {
    const x = 3 + rand() * 12;
    const z = 3 + rand() * 12;
    const sx = 1 + rand() * 2.2;
    const sz = 1 + rand() * 2.2;
    add(x * (rand() < 0.5 ? -1 : 1), z * (rand() < 0.5 ? -1 : 1), sx, sz);
  }

  return {
    obstacles,
    pad:  { x: 0, z: 0 },              // center jump pad
    heal: { x: 0, z: 0 + 6 },          // heal orb spot (slightly off-center)
  };
}

// Build Three.js meshes for the map (returns group + collision rects)
export function buildMapMesh(mapData) {
  const group = new THREE.Group();

  // Ground
  const groundMat = new THREE.MeshLambertMaterial({ color: 0x2a2f4a });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(MAP_SIZE, MAP_SIZE), groundMat);
  ground.rotation.x = -Math.PI / 2;
  group.add(ground);

  // Grid lines (cheap fake style)
  const grid = new THREE.GridHelper(MAP_SIZE, 20, 0x3a4275, 0x252a48);
  grid.position.y = 0.01;
  group.add(grid);

  // Obstacles
  const colliders = [];
  const coverMat = new THREE.MeshLambertMaterial({ color: 0x4a5285 });
  const wallMat  = new THREE.MeshLambertMaterial({ color: 0x363c66 });
  mapData.obstacles.forEach((o) => {
    const mat = o.kind === 'wall' ? wallMat : coverMat;
    const m = new THREE.Mesh(new THREE.BoxGeometry(o.sx, o.h, o.sz), mat);
    m.position.set(o.x, o.h / 2, o.z);
    group.add(m);
    colliders.push({ minX: o.x - o.sx/2, maxX: o.x + o.sx/2,
                     minZ: o.z - o.sz/2, maxZ: o.z + o.sz/2,
                     h: o.h, kind: o.kind });
  });

  // Center jump pad (visual)
  const padMat = new THREE.MeshLambertMaterial({ color: 0xffd25a, emissive: 0x553300 });
  const pad = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 0.2, 24), padMat);
  pad.position.set(mapData.pad.x, 0.1, mapData.pad.z);
  pad.userData.kind = 'pad';
  group.add(pad);
  mapData.padMesh = pad;

  // Heal orb (visual, animated in main loop)
  const healMat = new THREE.MeshLambertMaterial({ color: 0x3df58a, emissive: 0x0a4a25 });
  const heal = new THREE.Mesh(new THREE.IcosahedronGeometry(0.5, 0), healMat);
  heal.position.set(mapData.heal.x, 1.1, mapData.heal.z);
  heal.userData.kind = 'heal';
  group.add(heal);
  mapData.healMesh = heal;
  mapData.healAvailable = true;
  mapData.healCooldown = 0;

  // Soft ambient + key light
  const amb = new THREE.AmbientLight(0xffffff, 0.6);
  const dir = new THREE.DirectionalLight(0xffffff, 0.8);
  dir.position.set(8, 16, 8);
  group.add(amb, dir);

  return { group, colliders };
}

// AABB collision with cylinder of radius r around (x,z); returns adjusted (x,z)
export function collideXZ(x, z, r, colliders) {
  for (const c of colliders) {
    if (c.kind !== 'wall' && c.kind !== 'cover') continue;
    const closestX = Math.max(c.minX, Math.min(x, c.maxX));
    const closestZ = Math.max(c.minZ, Math.min(z, c.maxZ));
    const dx = x - closestX;
    const dz = z - closestZ;
    const d2 = dx*dx + dz*dz;
    if (d2 < r*r) {
      const d = Math.sqrt(d2) || 0.0001;
      // push out
      const push = (r - d) + 0.001;
      x += (dx / d) * push;
      z += (dz / d) * push;
    }
  }
  // clamp to arena bounds with buffer
  const lim = MAP_SIZE/2 - r - 0.6;
  if (x >  lim) x =  lim;
  if (x < -lim) x = -lim;
  if (z >  lim) z =  lim;
  if (z < -lim) z = -lim;
  return [x, z];
}

// Ray vs map: returns t in [0,maxT] of first hit or maxT
export function raycastMap(ox, oz, dx, dz, maxT, colliders) {
  let bestT = maxT;
  for (const c of colliders) {
    // slab method 2D
    const invDx = dx !== 0 ? 1/dx : 1e9;
    const invDz = dz !== 0 ? 1/dz : 1e9;
    const tx1 = (c.minX - ox) * invDx;
    const tx2 = (c.maxX - ox) * invDx;
    const tz1 = (c.minZ - oz) * invDz;
    const tz2 = (c.maxZ - oz) * invDz;
    const tmin = Math.max(Math.min(tx1, tx2), Math.min(tz1, tz2));
    const tmax = Math.min(Math.max(tx1, tx2), Math.max(tz1, tz2));
    if (tmax >= Math.max(0, tmin) && tmin < bestT && tmin > 0) bestT = tmin;
  }
  return bestT;
}
