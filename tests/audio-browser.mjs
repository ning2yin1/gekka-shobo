// Generated PCM is served only by this test. It is not the requested MP3 and
// is never written into the application or committed as a substitute track.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve, extname } from "node:path";
import { chromium } from "playwright";
import assert from "node:assert/strict";
const root = fileURLToPath(new URL("../", import.meta.url));
const legacy = JSON.parse(
  await readFile(new URL("./fixtures/legacy-v1.json", import.meta.url), "utf8"),
);
function testWave() {
  const rate = 22050,
    frames = rate * 2,
    bytes = Buffer.alloc(44 + frames * 2);
  bytes.write("RIFF", 0);
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write("WAVEfmt ", 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(rate, 24);
  bytes.writeUInt32LE(rate * 2, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36);
  bytes.writeUInt32LE(frames * 2, 40);
  for (let i = 0; i < frames; i++)
    bytes.writeInt16LE(
      Math.round(Math.sin((i / rate) * 2 * Math.PI * 220) * 800),
      44 + i * 2,
    );
  return bytes;
}
const realMusic = process.env.TEST_REAL_BGM === "1";
const wave = realMusic
  ? await readFile(resolve(root, "audio/bgm.mp3"))
  : testWave();
let musicRequests = 0;
const mime = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json",
};
const server = createServer(async (req, res) => {
  try {
    const path = new URL(req.url, "http://localhost").pathname.replace(
      /^\/gekka-shobo\//,
      "",
    );
    if (path === "seed.html") {
      res
        .writeHead(200, { "Content-Type": "text/html" })
        .end("<html><title>Seed old database</title></html>");
      return;
    }
    if (path === "audio/bgm.mp3") {
      musicRequests++;
      res.writeHead(200, {
        "Content-Type": realMusic ? "audio/mpeg" : "audio/wav",
        "Content-Length": wave.length,
      });
      res.end(wave);
      return;
    }
    const file = resolve(root, path || "index.html");
    if (!file.startsWith(root)) {
      res.writeHead(403).end();
      return;
    }
    let bytes = await readFile(file);
    if (path === "js/music.js")
      bytes = Buffer.from(
        bytes.toString().replace("available: false", "available: true"),
      );
    res.writeHead(200, {
      "Content-Type": mime[extname(file)] || "text/plain",
      "Cache-Control": "no-store",
    });
    res.end(bytes);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}/gekka-shobo/`;
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
  headless: true,
  args: ["--no-sandbox"],
});
try {
  const context = await browser.newContext({
      viewport: { width: 375, height: 667 },
    }),
    page = await context.newPage(),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(() => {
    window.__music = [];
    const NativeAudio = window.Audio;
    window.Audio = function (...args) {
      const audio = new NativeAudio(...args);
      window.__music.push(audio);
      return audio;
    };
    window.Audio.prototype = NativeAudio.prototype;
    const original = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function (...args) {
      this.__plays = (this.__plays || 0) + 1;
      if (window.__blockPlay) {
        window.__blockPlay = false;
        return Promise.reject(
          new DOMException("test autoplay restriction", "NotAllowedError"),
        );
      }
      return original.apply(this, args);
    };
    const connect = MediaElementAudioSourceNode.prototype.connect;
    MediaElementAudioSourceNode.prototype.connect = function (
      destination,
      ...args
    ) {
      window.__musicGain = destination;
      return connect.call(this, destination, ...args);
    };
  });
  await page.goto(base + "seed.html");
  await page.evaluate(
    (data) =>
      new Promise((resolve, reject) => {
        const req = indexedDB.open("gekka-shobo", 1),
          names = ["entries", "books", "memberships", "sessions", "settings"];
        req.onupgradeneeded = () => {
          for (const name of names)
            req.result.createObjectStore(name, {
              keyPath:
                name === "sessions"
                  ? "scope"
                  : name === "settings"
                    ? "key"
                    : "id",
            });
        };
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const db = req.result,
            tx = db.transaction(names, "readwrite");
          for (const name of names) {
            const store = tx.objectStore(name);
            if (name === "settings")
              store.put({ key: "preferences", value: data.settings });
            else data[name].forEach((e) => store.put(e));
          }
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
    legacy,
  );
  await page.goto(base);
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await page.getByRole("heading", { name: "昔からの書房" }).waitFor();
  const preserved = await page.evaluate(async () =>
    (await import("./js/db.js")).loadState(),
  );
  for (const key of ["entries", "books", "memberships", "sessions"])
    assert.deepEqual(preserved[key], legacy[key]);
  assert.deepEqual(preserved.settings, {
    ...legacy.settings,
    bgm: false,
    bgmVolume: 0.15,
  });
  await page.evaluate(() => (location.hash = "#settings"));
  await page.getByRole("heading", { name: "書房の設定" }).waitFor();
  assert.equal(await page.getByLabel("BGMを有効にする").isChecked(), false);
  assert.equal(
    await page.getByRole("slider", { name: "BGMの音量" }).inputValue(),
    "15",
  );
  assert.equal(await page.evaluate(() => window.__music.length), 0);
  // Deterministic autoplay rejection, followed by an explicit successful retry.
  await page.evaluate(() => (window.__blockPlay = true));
  await page.getByLabel("BGMを有効にする").check();
  await page
    .getByText("再生が許可されていません。再生ボタンを押してください。", {
      exact: true,
    })
    .waitFor();
  await page.getByRole("button", { name: "BGMを再生", exact: true }).click();
  await page.getByText("BGMを再生中です。", { exact: true }).waitFor();
  await page.waitForFunction(() => window.__music[0].currentTime > 0.15);
  assert.equal(await page.evaluate(() => window.__music[0].loop), true);
  const initial = await page.evaluate(() => ({
    time: window.__music[0].currentTime,
    plays: window.__music[0].__plays,
  }));
  await page.evaluate(() => (location.hash = "#study/star"));
  await page.locator(".flashcard").waitFor();
  const afterRoute = await page.evaluate(() => ({
    time: window.__music[0].currentTime,
    plays: window.__music[0].__plays,
    count: window.__music.length,
    paused: window.__music[0].paused,
  }));
  assert.equal(afterRoute.count, 1);
  assert.equal(afterRoute.plays, initial.plays);
  assert.equal(afterRoute.paused, false);
  assert.ok(afterRoute.time >= initial.time);
  await page.locator(".flashcard").press("ArrowLeft");
  assert.equal(await page.evaluate(() => window.__music[0].paused), false);
  // Tone synthesis uses multiple partials / filtered noise and bounded voices.
  const effects = await page.evaluate(async () => {
    const { AudioManager } = await import("./js/audio.js");
    const a = new AudioManager({ available: false, src: "" }),
      settings = { sound: true, volume: 0.2 };
    const counts = {};
    for (const kind of ["flip", "next", "master", "star", "clear"]) {
      a.effects.last = -Infinity;
      a.play(kind, settings);
      counts[kind] = a.effects.voices.at(-1).sources.length;
    }
    for (let i = 0; i < 30; i++) {
      a.effects.last = -Infinity;
      a.play("master", settings);
    }
    const bounded = a.effects.voices.length <= 3;
    a.effects.voices.forEach((v) => a.dispose(v));
    await a.context.close();
    return { counts, bounded };
  });
  assert.deepEqual(effects.counts, {
    flip: 4,
    next: 3,
    master: 9,
    star: 6,
    clear: 12,
  });
  assert.equal(effects.bounded, true);
  // A real background event is simulated; resume remains a separate gesture.
  await page.evaluate(() => {
    window.__hidden = true;
    Object.defineProperty(document, "hidden", {
      configurable: true,
      get: () => window.__hidden,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  assert.equal(await page.evaluate(() => window.__music[0].paused), true);
  await page.evaluate(() => {
    window.__hidden = false;
    document.dispatchEvent(new Event("visibilitychange"));
  });
  assert.equal(await page.evaluate(() => window.__music[0].paused), true);
  await page
    .getByRole("button", { name: "BGMを再開", exact: true })
    .filter({ visible: true })
    .click();
  await page.waitForFunction(() => !window.__music[0].paused);
  await page.evaluate(() => (location.hash = "#settings"));
  await page.getByRole("slider", { name: "BGMの音量" }).fill("42");
  await page.waitForTimeout(350);
  assert.ok(
    Math.abs(
      (await page.evaluate(() => window.__musicGain.gain.value)) - 0.42,
    ) < 0.02,
  );
  const settings = await page.evaluate(
    async () => (await (await import("./js/db.js")).loadState()).settings,
  );
  assert.equal(settings.bgm, true);
  assert.equal(settings.bgmVolume, 0.42);
  assert.equal(settings.volume, 0.32);
  await page.getByLabel("BGMを有効にする").uncheck();
  assert.equal(await page.evaluate(() => window.__music[0].paused), true);
  await page.getByLabel("BGMを有効にする").check();
  await page.getByText("BGMを再生中です。", { exact: true }).waitFor();
  // Seek near the supplied track end to verify native looping without a 3-minute wait.
  if (realMusic) {
    const duration = await page.evaluate(() => window.__music[0].duration);
    assert.ok(duration > 189 && duration < 191);
    await page.evaluate(() => {
      window.__music[0].currentTime = window.__music[0].duration - 0.6;
    });
    await page.waitForFunction(() => !window.__music[0].seeking);
  }
  await page.evaluate(
    () => (window.__lastTime = window.__music[0].currentTime),
  );
  await page.waitForFunction(
    () => {
      const time = window.__music[0].currentTime,
        last = window.__lastTime;
      window.__lastTime = time;
      return time < last - 0.3;
    },
    {},
    { timeout: 5000 },
  );
  const cached = await page.evaluate(async () => {
    const c = await caches.open("gekka-shobo-shell-v7");
    return !!(await c.match(new URL("./audio/bgm.mp3", location.href)));
  });
  assert.equal(cached, true);
  await context.setOffline(true);
  await page.reload();
  await page.getByRole("heading", { name: "書房の設定" }).waitFor();
  assert.equal(await page.evaluate(() => window.__music.length), 0);
  assert.equal(await page.getByLabel("BGMを有効にする").isChecked(), true);
  await page.getByRole("button", { name: "BGMを再生", exact: true }).click();
  await page.getByText("BGMを再生中です。", { exact: true }).waitFor();
  const ranges = await page.evaluate(async () => {
    const ok = await fetch("./audio/bgm.mp3", {
        headers: { Range: "bytes=0-43" },
      }),
      bad = await fetch("./audio/bgm.mp3", {
        headers: { Range: "bytes=999999999-" },
      });
    return {
      status: ok.status,
      length: (await ok.arrayBuffer()).byteLength,
      invalid: bad.status,
    };
  });
  assert.deepEqual(ranges, { status: 206, length: 44, invalid: 416 });
  const downloads = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "完全JSONバックアップ", exact: true })
    .click();
  const backup = JSON.parse(
    await readFile(await (await downloads).path(), "utf8"),
  );
  assert.equal(backup.settings.bgm, true);
  assert.equal(backup.settings.bgmVolume, 0.42);
  await page.getByLabel("JSONバックアップを選択").setInputFiles({
    name: "old.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(legacy)),
  });
  await page.getByRole("button", { name: "全置換で復元", exact: true }).click();
  await page.locator("#confirm-dialog button[value=ok]").click();
  await page.getByText("BGMはOFFです。", { exact: true }).waitFor();
  const restored = await page.evaluate(async () =>
    (await import("./js/db.js")).loadState(),
  );
  for (const key of ["entries", "books", "memberships", "sessions"])
    assert.deepEqual(restored[key], legacy[key]);
  assert.equal(restored.settings.bgm, false);
  assert.equal(restored.settings.bgmVolume, 0.15);
  assert.deepEqual(errors, []);
  assert.ok(musicRequests >= 1);
  console.log(
    (realMusic ? "Supplied MP3" : "Synthetic WAV") +
      " audio and legacy-data checks passed: old DB/JSON retention, gestures/autoplay retry, loop, independent/smoothed volumes, route continuity, background pause/manual resume, bounded harmonic/noise effects, saved preferences, offline audio and Range requests. Physical iPhone remains untested.",
  );
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
}
