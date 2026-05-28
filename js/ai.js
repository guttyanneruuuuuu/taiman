// =====================================================
// Simple but believable AI opponent.
// Behaviours:
//   - Stay near optimal range for its weapon
//   - Strafe sideways to dodge
//   - Aim with small leading at our movement
//   - Fire when in range and has line-of-sight
//   - Occasionally jump or dash to dodge incoming bullets
//   - Uses its SKILL when off cooldown and in range
// =====================================================
import { raycastMap } from './map.js';

export function createAIController(opp, char) {
  return {
    char,
    state: {
      // movement intent in world space
      mvx: 0, mvz: 0,
      strafeDir: 1,
      strafeTimer: 1.0,
      // perception
      seeYouT: 0,
      // timers
      aimTimer: 0,
      lastFire: 0,
      pendingDash: 0,
      pendingJump: 0,
      // skill
      skillTimer: 1.5, // small warmup before first skill
    },
    /**
     * Update bot.
     * @param {*} dt
     * @param {*} me   { x,z,y, vx,vz, rotY }
     * @param {*} self { x,z,y, hp, rotY, vy?, ... }
     * @param {*} colliders
     * @param {object} api { fire(dx,dz), useSkill(dx,dz), dash(dx,dz), jump() }
     */
    update(dt, me, self, colliders, api) {
      const s = this.state;
      const w = this.char.weapon;
      const skill = this.char.skill;

      // ---- Perception: line of sight to me ----
      const dx = me.x - self.x;
      const dz = me.z - self.z;
      const dist = Math.hypot(dx, dz) || 0.0001;
      const ndx = dx / dist, ndz = dz / dist;
      // bullet height ~1.0
      const t = raycastMap(self.x, self.z, ndx, ndz, dist, colliders, 1.0);
      const seeYou = t >= dist - 0.1;
      s.seeYouT = seeYou ? s.seeYouT + dt : 0;

      // ---- Movement strategy: keep optimal distance + strafe ----
      // Optimal range depends on weapon
      let optR = 6;
      if (w.kind === 'shotgun') optR = 3.5;
      else if (w.kind === 'rifle') optR = 11;
      else if (w.kind === 'rocket') optR = 8;
      else if (w.kind === 'smg') optR = 6;
      else if (w.kind === 'slash') optR = 2.5;

      let mvx = 0, mvz = 0;
      // approach/retreat along line
      const diff = dist - optR;
      if (Math.abs(diff) > 0.5) {
        const sign = diff > 0 ? 1 : -1;
        mvx += ndx * sign;
        mvz += ndz * sign;
      }
      // strafe perpendicular
      s.strafeTimer -= dt;
      if (s.strafeTimer <= 0) {
        s.strafeDir *= -1;
        s.strafeTimer = 0.8 + Math.random() * 1.4;
      }
      const px = -ndz, pz = ndx;
      mvx += px * s.strafeDir * 0.9;
      mvz += pz * s.strafeDir * 0.9;

      // Normalize
      const mmag = Math.hypot(mvx, mvz) || 1;
      mvx /= mmag; mvz /= mmag;

      // small smoothing
      s.mvx = s.mvx * 0.7 + mvx * 0.3;
      s.mvz = s.mvz * 0.7 + mvz * 0.3;

      // ---- Aim direction (with small lead) ----
      const lead = 0.18; // seconds
      const tx = me.x + (me.vx || 0) * lead;
      const tz = me.z + (me.vz || 0) * lead;
      let adx = tx - self.x, adz = tz - self.z;
      const amag = Math.hypot(adx, adz) || 1;
      adx /= amag; adz /= amag;
      self.aimDx = adx; self.aimDz = adz;

      // ---- Fire decision ----
      s.aimTimer -= dt;
      const canShoot =
        seeYou &&
        s.aimTimer <= 0 &&
        (w.kind === 'slash' ? dist < 3 : true) &&
        dist < (w.bulletSpeed * w.bulletLife * 0.95);

      if (canShoot && api.canFire()) {
        api.fire(adx, adz);
        // SMG fires fast, others throttle their decisions
        s.aimTimer = w.kind === 'smg' ? 0.0 : 0.05;
      }

      // ---- Use skill: when off cooldown, in roughly sensible range ----
      s.skillTimer -= dt;
      if (api.canSkill() && s.skillTimer <= 0) {
        let useIt = false;
        if (skill.kind === 'dash_strike' && dist < 8) useIt = true;
        else if (skill.kind === 'piercing_laser' && seeYou && dist > 6) useIt = true;
        else if (skill.kind === 'mortar' && dist > 4 && dist < 18) useIt = true;
        else if (skill.kind === 'hover_burst' && dist < 14) useIt = true;
        else if (skill.kind === 'aerial_slam' && dist < 4.5) useIt = true;
        if (useIt) {
          api.useSkill(adx, adz);
          s.skillTimer = 0.5 + Math.random() * 0.5;
        }
      }

      // ---- Dodge: if a bullet is coming our way, dash sideways ----
      if (api.incomingDanger > 0 && api.canDash() && Math.random() < 0.45) {
        // dash perpendicular to bullet direction (random side)
        const sign = (Math.random() < 0.5) ? 1 : -1;
        api.dash(px * sign, pz * sign);
      }

      // ---- Occasional jump (random twitch) when shot at ----
      if (api.incomingDanger > 0 && api.canJump() && Math.random() < 0.18) {
        api.jump();
      }

      // Return movement intent for the controller-less opponent
      return { mvx: s.mvx, mvz: s.mvz };
    }
  };
}
