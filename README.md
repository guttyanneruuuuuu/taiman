# Taiman - 3D 1vs1 Online Brawler

A lightweight 3D online 1vs1 arena game playable in your phone browser (portrait mode).
Inspired by Brawl Stars but in 3D, with simple touch controls anyone can pick up.

## Concept
- **Portrait phone** layout. Left half: movement joystick. Right half: aim & shoot (drag).
- **2-minute matches** designed for "one more match!" replay value.
- **5 unique characters** with different weapons & playstyles.
- **One big arena map** with a central gimmick (jump pad + hazard).
- Built with **Three.js** (kept lean — low-poly, no shadows) + **Node.js / ws** for online matchmaking.

## How to run

```bash
npm install
npm start
```

Then open `http://localhost:3000` on two phones (or two browser tabs) and tap "Find Match".

## Characters
| # | Name      | Weapon       | Style                                |
|---|-----------|--------------|--------------------------------------|
| 1 | Blaze     | Shotgun      | Close-range burst                    |
| 2 | Sniper    | Rifle        | Long-range single shot, high damage  |
| 3 | Rocket    | Rocket       | Slow but big AoE                     |
| 4 | Rapid     | SMG          | Fast small-damage spray              |
| 5 | Slash     | Dash slash   | Melee dash attack                    |

## Controls
- **Left thumb**: drag to move.
- **Right thumb**: drag to aim, release (or hold) to fire. Yellow 3D arc shows aim.
- HP bar above each character.

## Map
- Large square arena ~ 40x40 units, with cover boxes/walls scattered.
- **Center gimmick**: a jump pad (launches you up) and a regenerating health orb every 15s.

## Architecture
- `server/index.js` — Express static + WebSocket relay + matchmaking queue + server-side authoritative timer.
- `public/` — Three.js client (single-page).

## License
MIT
