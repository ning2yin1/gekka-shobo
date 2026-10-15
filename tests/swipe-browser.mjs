import { chromium } from "playwright";
import assert from "node:assert/strict";
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
  args: ["--no-sandbox"],
});
try {
  const context = await browser.newContext({
    viewport: { width: 375, height: 667 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage(),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(process.env.APP_URL || "http://127.0.0.1:8003/gekka-shobo/");
  await page.waitForFunction(
    () =>
      !!navigator.serviceWorker.controller &&
      performance.getEntriesByType("navigation")[0]?.type === "reload",
  );
  await page.getByRole("heading", { name: "ことばに、月の栞を。" }).waitFor();
  await page.evaluate(async () => {
    const m = await import("./js/model.js"),
      db = await import("./js/db.js"),
      s = m.emptyState();
    s.entries = ["一", "二", "三", "四"].map((traditional, i) => {
      const e = m.makeEntry({ traditional, pinyin: "cí", meaning: "語" + i });
      e.starred = true;
      e.created_at = new Date(1700000000000 + i).toISOString();
      return e;
    });
    s.entries[1].mastered = true;
    s.settings.bgmVolume = 0.41;
    await db.saveState(s, await db.loadState());
  });
  await page.reload();
  await page.evaluate(() => (location.hash = "#study/all"));
  await page.locator(".flashcard").waitFor();
  const load = () =>
    page.evaluate(async () => (await import("./js/db.js")).loadState());
  await page.evaluate(() => {
    window.__pointerLog = [];
    for (const type of [
      "pointerdown",
      "pointermove",
      "pointerup",
      "pointercancel",
      "lostpointercapture",
      "gotpointercapture",
      "click",
    ])
      document.addEventListener(
        type,
        (ev) =>
          window.__pointerLog.push({
            type,
            target: ev.target.className,
            x: ev.clientX,
            y: ev.clientY,
            time: performance.now(),
          }),
        true,
      );
  });
  const initial = await load();
  assert.equal(
    await page.getByRole("button", { name: "次へ", exact: true }).count(),
    0,
  );
  assert.match(await page.locator("#toast").textContent(), /左右にスワイプ/);
  const cdp = await context.newCDPSession(page);
  const idle = () =>
    page.waitForFunction(
      () => !document.querySelector("#app").hasAttribute("aria-busy"),
    );
  const touch = async (dx, dy = 0, hold = 0) => {
    const b = await page.locator(".flashcard").boundingBox(),
      x = b.x + b.width / 2,
      y = b.y + b.height / 2;
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x, y }],
    });
    if (hold) await page.waitForTimeout(hold);
    for (let i = 1; i <= 5; i++)
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x: x + (dx * i) / 5, y: y + (dy * i) / 5 }],
      });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await idle();
  };
  const current = async () => {
    const s = await load();
    return s.sessions.find((s) => s.scope === "all");
  };
  const expect = async (text, round) => {
    try {
      await page.waitForFunction(
        (text) => document.querySelector(".traditional")?.textContent === text,
        text,
        { timeout: 4000 },
      );
    } catch (e) {
      console.error(
        await page.evaluate(() => ({
          events: window.__pointerLog,
          text: document.querySelector(".flashcard")?.textContent,
          selection: getSelection().toString(),
        })),
      );
      throw e;
    }
    assert.equal((await current()).round, round);
    assert.equal((await current()).back, false);
  };
  await touch(-110);
  await expect("三", 1);
  await touch(-110);
  await expect("四", 1);
  await touch(-110);
  await expect("一", 2);
  await touch(110);
  await expect("四", 2);
  const tapBox = await page.locator(".flashcard").boundingBox();
  await page.touchscreen.tap(tapBox.x + tapBox.width / 2, tapBox.y + 25);
  try {
    await page.locator(".meaning").waitFor({ timeout: 4000 });
  } catch (e) {
    console.error(
      await page.evaluate(() => ({
        log: window.__pointerLog.slice(-12),
        selection: getSelection().toString(),
      })),
    );
    throw e;
  }
  await touch(110);
  await expect("三", 2);
  const before = await current();
  await touch(-15);
  assert.deepEqual(await current(), before);
  await touch(-10, 65);
  assert.deepEqual(await current(), before);
  await touch(-110, 0, 550);
  assert.deepEqual(await current(), before);
  // Text selection suppresses both flip and navigation, preserving copyable text.
  await page.evaluate(() => {
    const r = document.createRange();
    r.selectNodeContents(document.querySelector(".traditional"));
    getSelection().removeAllRanges();
    getSelection().addRange(r);
  });
  await touch(-110);
  assert.deepEqual(await current(), before);
  assert.equal(await page.evaluate(() => getSelection().toString()), "三");
  await page.evaluate(() => getSelection().removeAllRanges());
  // Explicit cancellation and diagonal motion never commit navigation.
  const card = page.locator(".flashcard");
  const pointer = {
    pointerId: 44,
    pointerType: "touch",
    isPrimary: true,
    clientX: 200,
    clientY: 300,
  };
  await card.dispatchEvent("pointerdown", pointer);
  await card.dispatchEvent("pointermove", { ...pointer, clientX: 80 });
  assert.match(await card.getAttribute("style"), /translateX/);
  await card.dispatchEvent("pointercancel", pointer);
  await card.dispatchEvent("click");
  assert.deepEqual(await current(), before);
  for (let i = 0; i < 8; i++) await touch(-110);
  await expect("一", 5);
  assert.deepEqual((await load()).entries, initial.entries);
  assert.deepEqual((await load()).settings, initial.settings);
  await page.reload();
  await page.locator(".flashcard").waitFor();
  await expect("一", 5);
  assert.equal(await page.locator("#toast.visible").count(), 0);
  // Star mode includes mastered cards; slider does not change the round.
  await page.evaluate(() => (location.hash = "#study/star"));
  await page
    .getByRole("heading", { name: "星の栞 · ★学習", exact: true })
    .waitFor();
  await touch(-110);
  await page.waitForFunction(
    () => document.querySelector(".traditional")?.textContent === "二",
  );
  await page.getByRole("slider", { name: "カードの位置" }).fill("4");
  await page
    .getByRole("slider", { name: "カードの位置" })
    .dispatchEvent("change");
  await idle();
  await touch(-110);
  let s = await load();
  assert.equal(s.sessions.find((x) => x.scope === "star").round, 2);
  assert.deepEqual(s.entries, initial.entries);
  // A single eligible card remains front-facing without incrementing the round.
  await page.evaluate(async () => {
    const db = await import("./js/db.js"),
      s = await db.loadState();
    s.entries.forEach((e) => (e.mastered = e.traditional !== "一"));
    s.sessions = [];
    await db.saveState(s, await db.loadState());
  });
  await page.reload();
  await page.evaluate(() => (location.hash = "#study/all"));
  await page
    .getByRole("heading", { name: "すべてのことば", exact: true })
    .waitFor();
  await touch(-110);
  await touch(110);
  await expect("一", 1);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await touch(-110);
  assert.equal(
    await card.evaluate((el) => getComputedStyle(el).animationName),
    "none",
  );
  assert.deepEqual(errors, []);
  console.log(
    "Touch swipe checks passed: forward/backward wraps, rounds, tap, small/vertical/long/cancelled gestures, selected text, drag feedback, 8 rapid moves, persistence, flags/settings, star and singleton modes, once-only guidance, reduced motion. Chromium touch emulation; physical Safari untested.",
  );
} finally {
  await browser.close();
}
