// Player visual: simple low-poly capsule + head + weapon stub.
import * as THREE from 'three';

export function buildPlayerMesh(character, isYou) {
  const group = new THREE.Group();
  const color = character.color;

  // Body
  const bodyMat = new THREE.MeshLambertMaterial({ color });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.55, 1.2, 12), bodyMat);
  body.position.y = 0.6;
  group.add(body);

  // Head
  const headMat = new THREE.MeshLambertMaterial({ color: 0xf0e3cf });
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.34, 12, 10), headMat);
  head.position.y = 1.5;
  group.add(head);

  // Visor (so you can read facing direction)
  const visorMat = new THREE.MeshLambertMaterial({ color: 0x1a1f2b });
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.1, 0.05), visorMat);
  visor.position.set(0, 1.52, 0.32);
  group.add(visor);

  // Weapon stub
  const weaponMat = new THREE.MeshLambertMaterial({ color: 0x222633 });
  let weapon;
  switch (character.weapon.kind) {
    case 'shotgun':
      weapon = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.9), weaponMat); break;
    case 'rifle':
      weapon = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.13, 1.25), weaponMat); break;
    case 'rocket':
      weapon = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.9, 10), weaponMat);
      weapon.rotation.x = Math.PI / 2; break;
    case 'smg':
      weapon = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.17, 0.6), weaponMat); break;
    case 'slash':
      weapon = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.5, 1.1),
        new THREE.MeshLambertMaterial({ color: 0xc8d4e0 })); break;
  }
  weapon.position.set(0.35, 0.95, 0.45);
  group.add(weapon);
  group.userData.weapon = weapon;

  // Ground ring (you / enemy color hint)
  const ringMat = new THREE.MeshBasicMaterial({
    color: isYou ? 0x6fb59a : 0xd96a6a,
    side: THREE.DoubleSide, transparent: true, opacity: 0.7,
  });
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.7, 0.86, 28), ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.025;
  group.add(ring);
  group.userData.ring = ring;

  return group;
}
