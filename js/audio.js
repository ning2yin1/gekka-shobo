import { BGM_TRACK } from "./music.js";

// A shared AudioContext has independent effects and music gain buses. Effects
// never stop the music element or recreate it on navigation.
export class AudioManager {
  constructor(track = BGM_TRACK) {
    this.track = track;
    this.context = null;
    this.effects = { gain: null, voices: [], last: -Infinity, noise: null };
    this.music = {
      element: null,
      gain: null,
      source: null,
      enabled: false,
      status: track.available ? "off" : "unavailable",
      generation: 0,
    };
    this.onMusicStatus = () => {};
    document.addEventListener("visibilitychange", () => {
      if (document.hidden && this.music.enabled) this.pauseMusic("paused");
    });
    window.addEventListener("pagehide", () => this.pauseMusic("paused"));
  }

  get musicAvailable() {
    return this.track.available;
  }
  get musicStatus() {
    return this.music.status;
  }
  status(value) {
    this.music.status = value;
    this.onMusicStatus(value);
  }

  unlock() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    if (!this.context) {
      this.context = new AC();
      this.effects.gain = this.context.createGain();
      this.effects.gain.connect(this.context.destination);
    }
    // Call synchronously from a user gesture, before IndexedDB promises.
    this.context.resume().catch(() => {
      if (this.music.enabled) this.status("blocked");
    });
    return this.context;
  }

  setMusicVolume(value) {
    const gain = this.music.gain,
      c = this.context;
    if (!gain || !c) return;
    const target = Math.min(1, Math.max(0, value));
    gain.gain.cancelScheduledValues(c.currentTime);
    gain.gain.setTargetAtTime(target, c.currentTime, 0.08);
  }

  startMusic(settings) {
    if (!settings.bgm) {
      this.music.enabled = false;
      this.pauseMusic("off");
      return Promise.resolve(false);
    }
    this.music.enabled = true;
    if (!this.track.available) {
      this.status("unavailable");
      return Promise.resolve(false);
    }
    if (document.hidden) {
      this.pauseMusic("paused");
      return Promise.resolve(false);
    }
    try {
      const c = this.unlock();
      if (!c) {
        this.status("blocked");
        return Promise.resolve(false);
      }
      if (!this.music.element) {
        const element = new Audio(this.track.src);
        element.loop = true;
        element.preload = "auto";
        element.setAttribute("playsinline", "");
        const gain = c.createGain();
        // Mobile Safari ignores HTMLMediaElement.volume; a Web Audio gain node
        // controls the actual volume. There is no unattenuated destination path.
        gain.gain.value = 0;
        const source = c.createMediaElementSource(element);
        source.connect(gain);
        gain.connect(c.destination);
        Object.assign(this.music, { element, gain, source });
        element.addEventListener("error", () => {
          if (this.music.enabled) this.status("error");
        });
        element.addEventListener("playing", () => {
          if (this.music.enabled && !document.hidden) this.status("playing");
          else element.pause();
        });
      }
      this.setMusicVolume(settings.bgmVolume);
      const generation = ++this.music.generation;
      this.status("loading");
      // Invoked in the same gesture as AudioContext.resume(), not after save.
      const started = this.music.element.play();
      return Promise.resolve(started)
        .then(() => {
          if (
            generation !== this.music.generation ||
            !this.music.enabled ||
            document.hidden
          )
            return false;
          this.status(c.state === "running" ? "playing" : "blocked");
          return c.state === "running";
        })
        .catch((error) => {
          if (generation === this.music.generation)
            this.status(error.name === "NotAllowedError" ? "blocked" : "error");
          return false;
        });
    } catch {
      this.status("error");
      return Promise.resolve(false);
    }
  }

  pauseMusic(status = "paused") {
    this.music.generation++;
    this.music.element?.pause();
    if (this.music.enabled || status === "off") this.status(status);
  }

  applyPreferences(settings) {
    this.music.enabled = settings.bgm;
    if (!settings.bgm)
      this.pauseMusic(this.track.available ? "off" : "unavailable");
    // Never autoplay on startup or a route change. A saved ON needs a gesture.
    else if (!this.track.available) this.status("unavailable");
    else if (
      ["off", "unavailable"].includes(this.music.status) ||
      (this.music.status === "playing" && this.music.element?.paused)
    )
      this.status("paused");
    this.setMusicVolume(settings.bgmVolume);
  }

  noise(c) {
    if (this.effects.noise) return this.effects.noise;
    const buffer = c.createBuffer(
      1,
      Math.floor(c.sampleRate * 0.45),
      c.sampleRate,
    );
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    this.effects.noise = buffer;
    return buffer;
  }

  play(kind, settings) {
    if (!settings.sound || settings.volume <= 0) return;
    const now = performance.now();
    if (now - this.effects.last < 85) return;
    this.effects.last = now;
    try {
      const c = this.unlock();
      if (!c) return;
      const t = c.currentTime,
        group = c.createGain();
      group.gain.value = settings.volume * 0.34;
      group.connect(this.effects.gain);
      // Brief, restrained reflection gives crystal tones depth without a long
      // convolution buffer. Every voice is disconnected after its tail.
      const delay = c.createDelay(0.2),
        echo = c.createGain();
      delay.delayTime.value = 0.055;
      echo.gain.value = 0.14;
      group.connect(delay);
      delay.connect(echo);
      echo.connect(this.effects.gain);
      const voice = {
        group,
        nodes: [group, delay, echo],
        sources: [],
        timer: null,
      };
      this.effects.voices.push(voice);
      while (this.effects.voices.length > 3) {
        const oldest = this.effects.voices.shift();
        oldest.group.gain.setTargetAtTime(0, t, 0.015);
        setTimeout(() => this.dispose(oldest), 70);
      }
      const tone = (freq, offset, duration, amplitude, type = "sine") => {
        const o = c.createOscillator(),
          g = c.createGain(),
          start = t + offset;
        o.type = type;
        o.frequency.setValueAtTime(freq, start);
        g.gain.setValueAtTime(0, start);
        g.gain.linearRampToValueAtTime(amplitude, start + 0.008);
        g.gain.exponentialRampToValueAtTime(0.0001, start + duration);
        o.connect(g);
        g.connect(group);
        o.start(start);
        o.stop(start + duration + 0.02);
        voice.nodes.push(o, g);
        voice.sources.push(o);
      };
      const crystal = (freq, offset, length = 0.42, level = 0.17) => {
        tone(freq, offset, length, level);
        tone(freq * 2.71, offset, length * 0.54, level * 0.23);
        tone(freq * 4.13, offset, length * 0.28, level * 0.065);
      };
      const rustle = (length, level, frequency) => {
        const source = c.createBufferSource(),
          filter = c.createBiquadFilter(),
          g = c.createGain();
        source.buffer = this.noise(c);
        filter.type = "bandpass";
        filter.frequency.setValueAtTime(frequency, t);
        filter.frequency.exponentialRampToValueAtTime(
          frequency * 0.55,
          t + length,
        );
        filter.Q.value = 0.6;
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(level, t + 0.018);
        g.gain.exponentialRampToValueAtTime(0.0001, t + length);
        source.connect(filter);
        filter.connect(g);
        g.connect(group);
        source.start(t);
        source.stop(t + length + 0.01);
        voice.nodes.push(source, filter, g);
        voice.sources.push(source);
      };
      if (kind === "flip") {
        rustle(0.19, 0.21, 1800);
        crystal(1174, 0.025, 0.23, 0.042);
      } else if (kind === "next") {
        tone(290, 0, 0.11, 0.26, "triangle");
        tone(583, 0, 0.075, 0.05);
        rustle(0.065, 0.035, 650);
      } else if (kind === "star") {
        crystal(1318, 0, 0.34, 0.14);
        crystal(1760, 0.045, 0.28, 0.07);
      } else if (kind === "clear") {
        [587.33, 739.99, 880, 1174.66].forEach((f, i) =>
          crystal(f, i * 0.095, 0.62, 0.14),
        );
      } else {
        [880, 1174.66, 1479.98].forEach((f, i) =>
          crystal(f, i * 0.06, 0.42, 0.16),
        );
      }
      voice.timer = setTimeout(() => this.dispose(voice), 1100);
    } catch {
      /* Audio must never prevent learning or storing a word. */
    }
  }

  dispose(voice) {
    clearTimeout(voice.timer);
    for (const source of voice.sources) {
      try {
        source.stop();
      } catch {}
    }
    for (const node of voice.nodes) {
      try {
        node.disconnect();
      } catch {}
    }
    this.effects.voices = this.effects.voices.filter((x) => x !== voice);
  }
}
