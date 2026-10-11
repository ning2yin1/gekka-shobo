// Sound effects have their own bus. A future BGM bus can be independent.
export class AudioManager {
  constructor() {
    this.effects = { context: null, active: [], last: 0 };
  }
  play(kind, settings) {
    if (!settings.sound || settings.volume <= 0) return;
    try {
      const bus = this.effects,
        now = performance.now();
      if (now - bus.last < 70) return;
      bus.last = now;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      bus.context ||= new AC();
      const c = bus.context;
      c.resume();
      for (const old of bus.active) {
        try {
          old.stop();
        } catch {}
      }
      bus.active = [];
      const tones = {
        flip: [390, 510],
        next: [230],
        master: [660, 880, 1100],
        star: [660, 980],
        clear: [520, 660, 780, 1040],
      }[kind] || [440];
      tones.forEach((f, i) => {
        const o = c.createOscillator(),
          g = c.createGain(),
          t = c.currentTime + i * 0.055;
        o.type = "sine";
        o.frequency.setValueAtTime(f, t);
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(settings.volume * 0.12, t + 0.008);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.15);
        o.connect(g);
        g.connect(c.destination);
        o.start(t);
        o.stop(t + 0.16);
        o.onended = () => {
          o.disconnect();
          g.disconnect();
        };
        bus.active.push(o);
      });
    } catch {
      /* Sound support must never prevent learning. */
    }
  }
}
