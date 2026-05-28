// =====================================================
// Characters: 5 fighters, each with a distinct weapon and
// a unique 3D skill that makes the third dimension matter.
// =====================================================
//
// Common to all: 1 jump (hop) + 1 dash (short ground-burst).
// Per-character SKILL is something only meaningful in 3D
// (vertical attack, arcing projectile, aerial spray, etc).
// =====================================================

export const CHARACTERS = [
  {
    id: 0,
    name: 'BLAZE',
    role: 'SHOTGUN',
    icon: '🔥',
    color: 0xe07a4a,
    hp: 110,
    speed: 5.3,
    desc: '近距離の散弾。スキルで前方にバースト突進し、密着で大ダメージ。',
    weapon: {
      kind: 'shotgun',
      cooldown: 0.85,
      pellets: 6,
      spread: 0.22,
      bulletSpeed: 28,
      bulletLife: 0.42,
      dmgPerPellet: 11,    // close: ~66, far: ~22
      bulletSize: 0.22,
      verticalHeight: 1.0, // height of bullet (jumping over it works at ~1.6+)
    },
    skill: {
      kind: 'dash_strike',
      cooldown: 8.0,
      dashSpeed: 22,
      dashTime: 0.32,
      damage: 35,
      radius: 1.6,
      label: 'BURST RUSH',
    },
  },
  {
    id: 1,
    name: 'SNIPER',
    role: 'RIFLE',
    icon: '🎯',
    color: 0x6c9ed1,
    hp: 75,
    speed: 5.0,
    desc: '長距離・高威力の単発。スキルで貫通する遠距離レーザーを発射。',
    weapon: {
      kind: 'rifle',
      cooldown: 1.35,
      pellets: 1,
      spread: 0,
      bulletSpeed: 58,
      bulletLife: 1.4,
      dmgPerPellet: 48,
      bulletSize: 0.18,
      verticalHeight: 1.05,
    },
    skill: {
      kind: 'piercing_laser',
      cooldown: 10.0,
      damage: 60,
      range: 26,
      label: 'PIERCE',
    },
  },
  {
    id: 2,
    name: 'ROCKET',
    role: 'AOE',
    icon: '💥',
    color: 0xc8a24a,
    hp: 120,
    speed: 4.5,
    desc: '遅いが範囲爆発。スキルで山なり弾道のロブを撃ち、上から叩く。',
    weapon: {
      kind: 'rocket',
      cooldown: 1.6,
      pellets: 1,
      spread: 0,
      bulletSpeed: 22,
      bulletLife: 1.5,
      dmgPerPellet: 36,
      bulletSize: 0.4,
      explodeRadius: 2.6,
      verticalHeight: 1.0,
    },
    skill: {
      kind: 'mortar',
      cooldown: 9.0,
      damage: 55,
      radius: 3.0,
      label: 'MORTAR',
    },
  },
  {
    id: 3,
    name: 'RAPID',
    role: 'SMG',
    icon: '⚡',
    color: 0xa07ec0,
    hp: 85,
    speed: 6.0,
    desc: '高連射の小ダメージ。スキルで滞空して三連射、上空から優位に。',
    weapon: {
      kind: 'smg',
      cooldown: 0.13,
      pellets: 1,
      spread: 0.07,
      bulletSpeed: 36,
      bulletLife: 0.85,
      dmgPerPellet: 8,
      bulletSize: 0.14,
      verticalHeight: 1.05,
    },
    skill: {
      kind: 'hover_burst',
      cooldown: 9.5,
      hoverTime: 1.6,
      shots: 6,
      damagePerShot: 10,
      label: 'HOVER',
    },
  },
  {
    id: 4,
    name: 'SLASH',
    role: 'MELEE',
    icon: '⚔️',
    color: 0x6db58a,
    hp: 130,
    speed: 5.8,
    desc: '近接ダッシュ斬り。スキルで上空からの叩き斬り、ジャンプ中の敵も狙える。',
    weapon: {
      kind: 'slash',
      cooldown: 0.7,
      pellets: 1,
      spread: 0,
      bulletSpeed: 26,
      bulletLife: 0.18,
      dmgPerPellet: 28,
      bulletSize: 1.7,
      verticalHeight: 1.0,
    },
    skill: {
      kind: 'aerial_slam',
      cooldown: 9.0,
      damage: 42,
      radius: 2.4,
      label: 'AERIAL SLAM',
    },
  },
];

export function getCharacter(id) {
  return CHARACTERS[Math.max(0, Math.min(CHARACTERS.length - 1, id | 0))];
}
