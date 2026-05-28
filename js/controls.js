// Touch controls: left half = movement, right half = aim & fire.
// Important: action buttons (JUMP/DASH/SKILL) sit at the top-center
// and grab their own touches so they don't conflict with joysticks.

export function setupControls(state) {
  const left  = document.getElementById('pad-left');
  const right = document.getElementById('pad-right');
  const stickL = document.getElementById('stick-left');
  const stickR = document.getElementById('stick-right');
  const baseL  = left.querySelector('.pad-base');
  const baseR  = right.querySelector('.pad-base');

  const padRadius = 60;

  const touchData = {
    left:  { id: null, sx:0, sy:0, dx:0, dy:0 },
    right: { id: null, sx:0, sy:0, dx:0, dy:0, active:false },
  };

  function placeBaseAndStick(side, x, y, dx, dy) {
    const base  = side === 'left' ? baseL  : baseR;
    const stick = side === 'left' ? stickL : stickR;
    const pad   = side === 'left' ? left   : right;
    const rect = pad.getBoundingClientRect();
    base.style.left = (x - rect.left) + 'px';
    base.style.top  = (y - rect.top)  + 'px';
    stick.style.left= (x - rect.left + dx) + 'px';
    stick.style.top = (y - rect.top  + dy) + 'px';
    pad.classList.add('active');
  }
  function clearPad(side) {
    (side === 'left' ? left : right).classList.remove('active');
  }
  function whichHalf(x) {
    return x < window.innerWidth / 2 ? 'left' : 'right';
  }

  // ignore touches that started on an action button or HUD
  function isUIElement(target) {
    if (!target || !target.closest) return false;
    return !!(target.closest('button') || target.closest('#hud-top') || target.closest('#action-bar') || target.closest('#cooldown-stack'));
  }

  function onStart(e) {
    if (!state.inMatch) return;
    for (const t of e.changedTouches) {
      if (isUIElement(t.target)) continue;
      const side = whichHalf(t.clientX);
      const d = touchData[side];
      if (d.id !== null) continue;
      d.id = t.identifier;
      d.sx = t.clientX; d.sy = t.clientY;
      d.dx = 0; d.dy = 0;
      d.active = true;
      placeBaseAndStick(side, t.clientX, t.clientY, 0, 0);
    }
  }

  function onMove(e) {
    if (!state.inMatch) return;
    for (const t of e.changedTouches) {
      for (const side of ['left', 'right']) {
        const d = touchData[side];
        if (d.id !== t.identifier) continue;
        let dx = t.clientX - d.sx;
        let dy = t.clientY - d.sy;
        const mag = Math.hypot(dx, dy);
        if (mag > padRadius) { dx = dx / mag * padRadius; dy = dy / mag * padRadius; }
        d.dx = dx; d.dy = dy;
        placeBaseAndStick(side, d.sx, d.sy, dx, dy);
      }
    }
    e.preventDefault();
  }

  function onEnd(e) {
    for (const t of e.changedTouches) {
      for (const side of ['left', 'right']) {
        const d = touchData[side];
        if (d.id !== t.identifier) continue;
        if (side === 'right') {
          // Drag-release on aim side -> fire in the released direction.
          // Preserve the last aim vector because touchend clears the joystick before the next tick.
          state.releaseFire = true;
          state.fireAim = { dx: d.dx / padRadius, dy: d.dy / padRadius };
        }
        d.id = null; d.dx = 0; d.dy = 0; d.active = false;
        clearPad(side);
      }
    }
  }

  window.addEventListener('touchstart', onStart, { passive: true });
  window.addEventListener('touchmove',  onMove,  { passive: false });
  window.addEventListener('touchend',   onEnd,   { passive: true });
  window.addEventListener('touchcancel',onEnd,   { passive: true });

  // ---------- Keyboard fallback (desktop) ----------
  const keys = { w:false, a:false, s:false, d:false };
  window.addEventListener('keydown', (e) => {
    if (e.key === 'w' || e.key === 'ArrowUp') keys.w = true;
    if (e.key === 'a' || e.key === 'ArrowLeft') keys.a = true;
    if (e.key === 's' || e.key === 'ArrowDown') keys.s = true;
    if (e.key === 'd' || e.key === 'ArrowRight') keys.d = true;
    if (e.key === ' ' || e.code === 'Space') state.pressJump = true;
    if (e.key === 'Shift' || e.code === 'ShiftLeft') state.pressDash = true;
    if (e.key === 'q' || e.key === 'Q') state.pressSkill = true;
  });
  window.addEventListener('keyup', (e) => {
    if (e.key === 'w' || e.key === 'ArrowUp') keys.w = false;
    if (e.key === 'a' || e.key === 'ArrowLeft') keys.a = false;
    if (e.key === 's' || e.key === 'ArrowDown') keys.s = false;
    if (e.key === 'd' || e.key === 'ArrowRight') keys.d = false;
  });

  // Mouse fallback for aim (desktop)
  let mouseAim = null;
  window.addEventListener('mousemove', (e) => {
    if (!state.inMatch) return;
    mouseAim = { x: e.clientX, y: e.clientY };
  });
  window.addEventListener('mousedown', (e) => {
    if (isUIElement(e.target)) return;
    state.mouseDown = true;
  });
  window.addEventListener('mouseup', (e) => {
    if (state.mouseDown) {
      state.releaseFire = true;
      if (mouseAim) {
        const cx = window.innerWidth/2, cy = window.innerHeight/2 + 80;
        let ax = (mouseAim.x - cx) / 120;
        let ay = (mouseAim.y - cy) / 120;
        const m = Math.hypot(ax, ay); if (m > 1) { ax/=m; ay/=m; }
        state.fireAim = { dx: ax, dy: ay };
      }
    }
    state.mouseDown = false;
  });

  // ---------- Action buttons ----------
  // Use pointerdown so it works on both touch and mouse without conflicting with joystick
  function bindBtn(id, flagName, getDisabled) {
    const el = document.getElementById(id);
    const handler = (e) => {
      e.preventDefault();
      if (!state.inMatch) return;
      if (getDisabled && getDisabled()) return;
      state[flagName] = true;
    };
    el.addEventListener('pointerdown', handler);
  }
  bindBtn('btn-jump',  'pressJump',  () => state.cdJump  > 0 || (state.me.y || 0) > 0.01);
  bindBtn('btn-dash',  'pressDash',  () => state.cdDash  > 0);
  bindBtn('btn-skill', 'pressSkill', () => state.cdSkill > 0);

  function getInput() {
    let mx = touchData.left.dx / padRadius;
    let my = touchData.left.dy / padRadius;
    if (keys.a) mx -= 1; if (keys.d) mx += 1;
    if (keys.w) my -= 1; if (keys.s) my += 1;
    const mmag = Math.hypot(mx, my);
    if (mmag > 1) { mx /= mmag; my /= mmag; }

    let ax = touchData.right.dx / padRadius;
    let ay = touchData.right.dy / padRadius;
    let aimActive = touchData.right.active;
    // mouse aim: only when mouse held down
    if (!aimActive && mouseAim && state.mouseDown) {
      // Convert screen mouse to direction relative to canvas center
      const cx = window.innerWidth/2, cy = window.innerHeight/2 + 80; // bias down toward character
      ax = (mouseAim.x - cx) / 120;
      ay = (mouseAim.y - cy) / 120;
      const m = Math.hypot(ax, ay); if (m > 1) { ax/=m; ay/=m; }
      aimActive = true;
    }
    return { mx, my, ax, ay, aimActive };
  }

  return { getInput };
}
