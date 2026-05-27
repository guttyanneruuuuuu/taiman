// 5 characters with distinct weapons & feel.
// Kept simple so the game stays light and the differences are obvious.

export const CHARACTERS = [
  {
    id: 0,
    name: 'BLAZE',
    role: 'SHOTGUN',
    icon: '🔥',
    color: 0xff5a3d,
    hp: 100,
    speed: 5.5,
    weapon: {
      kind: 'shotgun',
      cooldown: 0.85,      // seconds between shots
      pellets: 5,
      spread: 0.22,        // radians half-angle
      bulletSpeed: 28,
      bulletLife: 0.45,    // short range
      dmgPerPellet: 12,
      bulletSize: 0.22,
    },
  },
  {
    id: 1,
    name: 'SNIPER',
    role: 'RIFLE',
    icon: '🎯',
    color: 0x6cc6ff,
    hp: 80,
    speed: 5.2,
    weapon: {
      kind: 'rifle',
      cooldown: 1.4,
      pellets: 1,
      spread: 0,
      bulletSpeed: 60,
      bulletLife: 1.2,
      dmgPerPellet: 55,
      bulletSize: 0.18,
    },
  },
  {
    id: 2,
    name: 'ROCKET',
    role: 'AOE',
    icon: '💥',
    color: 0xffb73d,
    hp: 110,
    speed: 4.6,
    weapon: {
      kind: 'rocket',
      cooldown: 1.7,
      pellets: 1,
      spread: 0,
      bulletSpeed: 22,
      bulletLife: 1.4,
      dmgPerPellet: 40,
      bulletSize: 0.4,
      explodeRadius: 2.6,
    },
  },
  {
    id: 3,
    name: 'RAPID',
    role: 'SMG',
    icon: '⚡',
    color: 0xb86bff,
    hp: 90,
    speed: 6.2,
    weapon: {
      kind: 'smg',
      cooldown: 0.13,
      pellets: 1,
      spread: 0.07,
      bulletSpeed: 36,
      bulletLife: 0.8,
      dmgPerPellet: 9,
      bulletSize: 0.14,
    },
  },
  {
    id: 4,
    name: 'SLASH',
    role: 'MELEE',
    icon: '⚔️',
    color: 0x3df58a,
    hp: 130,
    speed: 6.0,
    weapon: {
      kind: 'slash',     // dash + slash, short range arc
      cooldown: 0.9,
      pellets: 1,
      spread: 0,
      bulletSpeed: 38,   // dash speed
      bulletLife: 0.18,  // dash duration
      dmgPerPellet: 32,
      bulletSize: 1.6,   // big slash hitbox
    },
  },
];

export function getCharacter(id) {
  return CHARACTERS[Math.max(0, Math.min(CHARACTERS.length - 1, id | 0))];
}
