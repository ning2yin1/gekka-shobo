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
  await page.goto(process.env.APP_URL || "http://127.0.0.1:8002/gekka-shobo/");
  // First activation reloads the app; wait for that reload before seeding.
  await page.waitForFunction(() => !!navigator.serviceWorker.controller &&
    performance.getEntriesByType("navigation")[0]?.type === "reload");
  await page.getByRole("heading", { name: "ことばに、月の栞を。" }).waitFor();
  await page.evaluate(async () => {
    const m = await import("./js/model.js"),
      db = await import("./js/db.js");
    const s = m.emptyState();
    s.entries = Array.from({ length: 29 }, (_, i) =>
      m.makeEntry({
        traditional: "詞語" + (i + 1),
        pinyin: "cí yǔ",
        meaning: "ことば" + (i + 1),
      }),
    );
    s.entries.forEach((e, i) => {
      e.starred = true;
      e.created_at = new Date(1700000000000 + i).toISOString();
    });
    s.entries[1].mastered = true;
    s.settings.bgmVolume = 0.42;
    s.settings.sound = true;
    s.settings.volume = 0.32;
    await db.saveState(s, await db.loadState());
  });
  await page.reload();
  await page.evaluate(() => (location.hash = "#study/all"));
  const range = page.getByRole("slider", { name: "カードの位置" });
  await range.waitFor();
  const state = () =>
    page.evaluate(async () => (await import("./js/db.js")).loadState());
  const seek = async (n) => {
    await range.fill(String(n));
    await range.dispatchEvent("change");
    await page.waitForFunction(
      (n) =>
        document
          .querySelector("#study-position")
          .textContent.startsWith(n + " /"),
      n,
    );
    await page.waitForFunction(
      () => !document.querySelector("#app").hasAttribute("aria-busy"),
    );
  };
  const initial = await state();
  await seek(3);
  assert.match(await page.locator(".traditional").textContent(), /詞語4/);
  await page.locator(".flashcard").click();
  await page.locator(".meaning").waitFor();
  await seek(2);
  assert.equal(
    await page.locator(".flashcard").getAttribute("aria-pressed"),
    "false",
  );
  assert.equal((await state()).sessions[0].round, 1);
  await page.reload();
  await range.waitFor();
  assert.equal(await range.inputValue(), "2");
  await page.getByRole("button", { name: "最後へ", exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector("#study-position").textContent === "28 / 28",
  );
  await page.getByRole("button", { name: "最初へ", exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector("#study-position").textContent === "1 / 28",
  );
  assert.deepEqual((await state()).entries, initial.entries);
  // Master, move elsewhere, then undo restores the marked card rather than the later position.
  await page.getByRole("button", { name: "覚えた！", exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector("#study-position").textContent === "1 / 27",
  );
  await seek(4);
  await page.getByRole("button", { name: "覚えた操作を元に戻す" }).click();
  await page.waitForFunction(
    () => document.querySelector("#study-position").textContent === "1 / 28",
  );
  assert.equal(
    (await state()).entries.find((e) => e.traditional === "詞語1").mastered,
    false,
  );
  assert.equal(
    (await state()).entries.find((e) => e.traditional === "詞語1").starred,
    true,
  );
  assert.deepEqual((await state()).settings, initial.settings);
  await page.evaluate(() => (location.hash = "#study/star"));
  await range.waitFor();
  assert.equal(await range.getAttribute("max"), "29");
  await seek(2);
  await page.getByRole("button", { name: "覚えた！", exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector("#study-position").textContent === "3 / 29",
  );
  await page.getByRole("button", { name: "覚えた操作を元に戻す" }).click();
  await page.waitForFunction(
    () => document.querySelector("#study-position").textContent === "2 / 29",
  );
  assert.equal(
    (await state()).entries.find((e) => e.traditional === "詞語2").mastered,
    true,
  );
  for (const [width, height] of [
    [320, 480],
    [320, 568],
    [375, 667],
    [390, 844],
    [430, 932],
  ]) {
    await page.setViewportSize({ width, height });
    const sizes = await page.evaluate(() => {
      const a = document.querySelector("main.study");
      return { scroll: a.scrollHeight, client: a.clientHeight };
    });
    assert.ok(
      sizes.scroll <= sizes.client + 1,
      JSON.stringify({ width, height, ...sizes }),
    );
    for (const name of [
      "次へ",
      "詳細を見る",
      "覚えた！",
      "★ 苦手",
      "最初へ",
      "最後へ",
    ]) {
      const b = await page
        .getByRole("button", { name, exact: true })
        .boundingBox();
      assert.ok(
        b.height >= 44 && b.y >= 0 && b.y + b.height <= height,
        JSON.stringify({ name, width, height, b }),
      );
    }
  }
  await page.screenshot({ path: ".test-results/navigation.png" });
  // Only remaining unmastered card -> clear screen -> undo.
  await page.evaluate(async () => {
    const db = await import("./js/db.js"),
      s = await db.loadState();
    s.entries.forEach((e) => (e.mastered = e.traditional !== "詞語1"));
    s.sessions = [];
    await db.saveState(s, await db.loadState());
  });
  await page.reload();
  await page.evaluate(() => (location.hash = "#study/all"));
  await page.getByRole("button", { name: "覚えた！", exact: true }).click();
  await page
    .getByRole("heading", { name: "すべてのことばに、月の栞。" })
    .waitFor();
  await page.getByRole("button", { name: "覚えた操作を元に戻す" }).click();
  await range.waitFor();
  assert.equal(await range.inputValue(), "1");
  assert.equal(
    (await state()).entries.find((e) => e.traditional === "詞語1").mastered,
    false,
  );
  assert.deepEqual(errors, []);
  console.log(
    "Navigation passed: saved seek, eligible order, flags/round retention, front reset, first/last, star/mastered queue, undo after move and completion, settings retention, five mobile sizes/44px controls.",
  );
} finally {
  await browser.close();
}
