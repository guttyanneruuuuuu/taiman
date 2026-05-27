// Player visual: simple low-poly capsule + head + weapon stub.
// Each player is one Group; we expose helpers to update pose/aim.
import * as THREE from 'three';

export function buildPlayerMesh(character, isYou) {
  const group = new THREE.Group();
  const color = character.color;

  // Body (rounded box-ish)
  const bodyMat = new THREE.MeshLambertMaterial({ color });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.55, 1.2, 12), bodyMat);
  body.position.y = 0.6;
  group.add(body);

  // Head
  const headMat = new THREE.MeshLambertMaterial({ color: 0xfff0d8 });
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.35, 12, 10), headMat);
  head.position.y = 1.5;
  group.add(head);

  // Visor (so we can see facing direction)
  const visorMat = new THREE.MeshLambertMaterial({ color: 0x111122, emissive: 0x222233 });
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.1, 0.05), visorMat);
  visor.position.set(0, 1.5, 0.34);
  group.add(visor);

  // Weapon stub (a forward-pointing box) — different look per kind
  const weaponMat = new THREE.MeshLambertMaterial({ color: 0x222233 });
  let weapon;
  switch (character.weapon.kind) {
    case 'shotgun':
      weapon = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.18, 0.9), weaponMat);
      break;
    case 'rifle':
      weapon = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 1.2), weaponMat);
      break;
    case 'rocket':
      weapon = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.9, 8), weaponMat);
      weapon.rotation.x = Math.PI / 2;
      break;
    case 'smg':
      weapon = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.16, 0.6), weaponMat);
      break;
    case 'slash':
      weapon = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.5, 1.0), new THREE.MeshLambertMaterial({ color:0xddeeff, emissive:0x224455 }));
      break;
  }
  weapon.position.set(0.35, 0.95, 0.45);
  group.add(weapon);
  group.userData.weapon = weapon;

  // "You" indicator ring on the ground
  if (isYou) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.7, 0.85, 24),
      new THREE.MeshBasicMaterial({ color: 0x6cf2ff, side: THREE.DoubleSide, transparent: true, opacity: 0.7 })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.02;
    group.add(ring);
  } else {
    // enemy marker (red ring)
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.7, 0.85, 24),
      new THREE.MeshBasicMaterial({ color: 0xff5a5a, side: THREE.DoubleSide, transparent: true, opacity: 0.6 })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.02;
    group.add(ring);
  }

  return group;
}
