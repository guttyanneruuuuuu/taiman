// Touch controls: left half = movement joystick, right half = aim & fire joystick.
// Designed for portrait phones; touches outside any UI register on the half they belong to.

export function setupControls(state) {
  const left  = document.getElementById('pad-left');
  const right = document.getElementById('pad-right');
  const stickL = document.getElementById('stick-left');
  const stickR = document.getElementById('stick-right');
  const baseL  = left.querySelector('.pad-base');
  const baseR  = right.querySelector('.pad-base');

  const padRadius = 60; // px

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
    const pad = side === 'left' ? left : right;
    pad.classList.remove('active');
  }

  function whichHalf(x) {
    return x < window.innerWidth / 2 ? 'left' : 'right';
  }

  function onStart(e) {
    if (!state.inMatch) return;
    for (const t of e.changedTouches) {
      const side = whichHalf(t.clientX);
      const d = touchData[side];
      if (d.id !== null) continue;
      d.id = t.identifier;
      d.sx = t.clientX; d.sy = t.clientY;
      d.dx = 0; d.dy = 0;
      d.active = true;
      placeBaseAndStick(side, t.clientX, t.clientY, 0, 0);
    }
    e.preventDefault();
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
        // For right pad: if user dragged enough, fire on release; tap also fires straight ahead
        if (side === 'right') {
          state.releaseFire = true;
        }
        d.id = null; d.dx = 0; d.dy = 0; d.active = false;
        clearPad(side);
      }
    }
    e.preventDefault();
  }

  // Listen on whole window so touches don't get blocked by HUD
  window.addEventListener('touchstart', onStart, { passive: false });
  window.addEventListener('touchmove',  onMove,  { passive: false });
  window.addEventListener('touchend',   onEnd,   { passive: false });
  window.addEventListener('touchcancel',onEnd,   { passive: false });

  // Keyboard fallback for desktop testing
  const keys = { w:false, a:false, s:false, d:false, space:false };
  window.addEventListener('keydown', (e) => {
    if (e.key === 'w' || e.key === 'ArrowUp') keys.w = true;
    if (e.key === 'a' || e.key === 'ArrowLeft') keys.a = true;
    if (e.key === 's' || e.key === 'ArrowDown') keys.s = true;
    if (e.key === 'd' || e.key === 'ArrowRight') keys.d = true;
    if (e.key === ' ') keys.space = true;
  });
  window.addEventListener('keyup', (e) => {
    if (e.key === 'w' || e.key === 'ArrowUp') keys.w = false;
    if (e.key === 'a' || e.key === 'ArrowLeft') keys.a = false;
    if (e.key === 's' || e.key === 'ArrowDown') keys.s = false;
    if (e.key === 'd' || e.key === 'ArrowRight') keys.d = false;
    if (e.key === ' ') { keys.space = false; state.releaseFire = true; }
  });

  // Mouse fallback aim
  let mouseAim = null;
  window.addEventListener('mousemove', (e) => {
    mouseAim = { x: e.clientX, y: e.clientY };
  });
  window.addEventListener('mousedown', () => { state.mouseDown = true; });
  window.addEventListener('mouseup',   () => { state.mouseDown = false; state.releaseFire = true; });

  // Public API: poll current input vectors (normalized to [-1,1])
  function getInput() {
    let mx = touchData.left.dx / padRadius;
    let my = touchData.left.dy / padRadius;
    // keyboard add
    if (keys.a) mx -= 1; if (keys.d) mx += 1;
    if (keys.w) my -= 1; if (keys.s) my += 1;
    const mmag = Math.hypot(mx, my);
    if (mmag > 1) { mx /= mmag; my /= mmag; }

    let ax = touchData.right.dx / padRadius;
    let ay = touchData.right.dy / padRadius;
    let aimActive = touchData.right.active;
    // mouse aim
    if (!aimActive && mouseAim && state.mouseDown) {
      const cx = window.innerWidth/2, cy = window.innerHeight/2;
      ax = (mouseAim.x - cx) / 120;
      ay = (mouseAim.y - cy) / 120;
      const m = Math.hypot(ax, ay); if (m > 1) { ax/=m; ay/=m; }
      aimActive = true;
    }
    return { mx, my, ax, ay, aimActive };
  }

  return { getInput };
}
