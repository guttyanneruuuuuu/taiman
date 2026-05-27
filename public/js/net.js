// Thin WebSocket wrapper.
export class Net {
  constructor() {
    this.ws = null;
    this.handlers = {};
    this.connected = false;
  }
  on(t, fn) { this.handlers[t] = fn; }
  connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const url = `${proto}://${location.host}`;
    this.ws = new WebSocket(url);
    this.ws.onopen = () => { this.connected = true; this.handlers['open']?.(); };
    this.ws.onclose = () => { this.connected = false; this.handlers['close']?.(); };
    this.ws.onerror = () => { this.handlers['error']?.(); };
    this.ws.onmessage = (e) => {
      let m; try { m = JSON.parse(e.data); } catch { return; }
      if (this.handlers[m.t]) this.handlers[m.t](m);
    };
  }
  send(obj) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(obj));
  }
}
