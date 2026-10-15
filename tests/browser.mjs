import { chromium } from "playwright";
import { exportCSV } from "../js/parsers.js";
import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
  args: ["--no-sandbox"],
});
const context = await browser.newContext({
  viewport: { width: 375, height: 667 },
  deviceScaleFactor: 1,
  isMobile: true,
  hasTouch: true,
  acceptDownloads: true,
});
const page = await context.newPage(),
  errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const base = process.env.APP_URL || "http://127.0.0.1:8000/gekka-shobo/";
const click = async (text) =>
  page.getByRole("button", { name: text, exact: true }).click();
const waitText = async (text) =>
  page.getByText(text, { exact: true }).first().waitFor();
const confirm = async () =>
  page.locator("#confirm-dialog button[value=ok]").click();
const nav = async (route) => {
  await page.evaluate((hash) => (location.hash = hash), route);
  await page.waitForTimeout(120);
};
try {
  await page.goto(base);
  await page.getByRole("heading", { name: "ことばに、月の栞を。" }).waitFor();
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await page.waitForTimeout(200);
  await click("最初の単語帳を作る");
  await page.getByRole("textbox", { name: "単語帳名" }).fill("日々の台湾華語");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "保存", exact: true })
    .click();
  await page.getByRole("heading", { name: "日々の台湾華語" }).waitFor();
  await nav("#add");
  await page.locator("[name=traditional]").fill("口感");
  assert.equal(await page.locator("[name=simplified]").inputValue(), "口感");
  await page.locator("[name=pinyin]").fill("kǒu gǎn");
  await page.locator("[name=meaning]").fill("食感、口当たり");
  for (let i = 0; i < 3; i++) {
    await click("＋ 例文を追加");
    const block = page.locator("#example-fields section").nth(i);
    await block.locator("[data-field=chinese]").fill("這個蛋糕的口感很特別。");
    await block
      .locator("[data-field=translation]")
      .fill("このケーキは食感が独特だ。");
  }
  await click("登録前に確認");
  await waitText("新規 1 ／ 重複 0 ／ エラー 0 ／ 要確認 0");
  await click("確認して登録");
  await confirm();
  await page.getByRole("heading", { name: "ことばの目録" }).waitFor();
  await page.getByRole("heading", { name: "口感", exact: true }).waitFor();
  await nav("#home");
  await click("＋ 単語帳");
  await page.getByRole("textbox", { name: "単語帳名" }).fill("表現ノート");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "保存", exact: true })
    .click();
  await nav("#list");
  await click("所属・移動");
  await page
    .getByRole("dialog")
    .getByLabel("表現ノート", { exact: true })
    .check();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "保存", exact: true })
    .click();
  await nav("#add");
  await click("テキスト");
  await page
    .getByRole("textbox", { name: "読み込むテキスト" })
    .fill(
      "繁体字: 沒想到\n簡体字: 没想到\n拼音: méi xiǎng dào\n意味: 思いもよらなかった\n---\n繁体字: 計程車\n簡体字: 计程车\n拼音: jì chéng chē\n意味: タクシー",
    );
  await click("読み込んでプレビュー");
  await click("確認して登録");
  await confirm();
  await page.getByRole("heading", { name: "ことばの目録" }).waitFor();
  await nav("#home");
  await page
    .getByRole("link", { name: "学習する", exact: true })
    .first()
    .click();
  await page.locator(".flashcard .traditional").waitFor();
  assert.equal(
    await page.locator(".flashcard .traditional").textContent(),
    "口感",
  );
  assert.equal(
    await page.locator(".flashcard .simplified").textContent(),
    "口感",
  );
  await page.locator(".flashcard").click();
  await page.locator(".flashcard .meaning").waitFor();
  await click("詳細を見る");
  await waitText("例文 3");
  await page.getByRole("link", { name: "← 元の画面へ" }).click();
  assert.equal(
    await page.locator(".flashcard .meaning").textContent(),
    "食感、口当たり",
  );
  await page.getByRole("combobox", { name: "出題方向" }).selectOption("ja-zh");
  await page.waitForTimeout(100);
  assert.equal(
    await page.locator(".flashcard .meaning").textContent(),
    "食感、口当たり",
  );
  await page.locator(".flashcard").click();
  await page.locator(".flashcard .traditional").waitFor();
  await page.evaluate(() => {
    const r = document.createRange();
    r.selectNodeContents(document.querySelector(".traditional"));
    getSelection().removeAllRanges();
    getSelection().addRange(r);
  });
  await page.locator(".flashcard").dispatchEvent("click");
  assert.equal(await page.locator(".flashcard .traditional").count(), 1);
  await page.evaluate(() => getSelection().removeAllRanges());
  await click("★ 苦手");
  await click("覚えた！");
  await page.waitForTimeout(150);
  assert.equal(
    await page.locator(".flashcard .meaning").textContent(),
    "思いもよらなかった",
  );
  await page.locator(".flashcard").press("ArrowLeft");
  await page.waitForTimeout(100);
  assert.equal(
    await page.locator(".flashcard .meaning").textContent(),
    "タクシー",
  );
  await page.locator(".flashcard").press("ArrowLeft");
  await page.waitForTimeout(100);
  assert.equal(
    await page.locator(".flashcard .meaning").textContent(),
    "思いもよらなかった",
  );
  await page.reload();
  await page.locator(".flashcard").waitFor();
  assert.equal(
    await page.locator(".flashcard .meaning").textContent(),
    "思いもよらなかった",
  );
  await click("覚えた！");
  await page.waitForTimeout(100);
  await click("覚えた！");
  await page
    .getByRole("heading", { name: "すべてのことばに、月の栞。" })
    .waitFor();
  await nav("#study/star");
  await page.locator(".flashcard").waitFor();
  assert.equal(
    await page.locator(".flashcard .meaning").textContent(),
    "食感、口当たり",
  );
  await click("覚えた！");
  await page.waitForTimeout(100);
  assert.equal(await page.locator(".flashcard").count(), 1);
  assert.equal(
    await page.getByRole("button", { name: "★ 苦手", exact: true }).count(),
    1,
  );
  await nav("#list");
  await page.getByRole("searchbox").fill("没");
  await page.waitForTimeout(250);
  assert.equal(await page.locator(".entry").count(), 1);
  await page.getByRole("searchbox").fill("食感");
  await page.waitForTimeout(250);
  assert.equal(await page.locator(".entry").count(), 1);
  await click("未習得に戻す");
  await page.waitForTimeout(100);
  await nav("#study/all");
  assert.equal(
    await page.locator(".flashcard .meaning").textContent(),
    "食感、口当たり",
  );
  // XSS must remain literal text.
  await nav("#add");
  await page.locator("[name=traditional]").fill("<img src=x onerror=alert(1)>");
  await page.locator("[name=meaning]").fill("長い意味".repeat(45));
  await click("登録前に確認");
  await click("確認して登録");
  await confirm();
  await page.getByRole("heading", { name: "ことばの目録" }).waitFor();
  assert.equal(await page.locator("main img").count(), 0);
  await nav("#settings");
  await page.getByLabel("効果音を有効にする").check();
  await page.getByRole("slider", { name: "効果音の音量" }).fill("15");
  await page
    .getByRole("slider", { name: "効果音の音量" })
    .dispatchEvent("change");
  await click("音を試す");
  const dl = page.waitForEvent("download");
  await click("完全JSONバックアップ");
  const download = await dl;
  const backup = JSON.parse(await readFile(await download.path(), "utf8"));
  assert.equal(backup.entries.length, 4);
  assert.equal(backup.books.length, 2);
  assert.equal(
    backup.memberships.filter(
      (m) =>
        m.entryId === backup.entries.find((e) => e.traditional === "口感").id,
    ).length,
    2,
  );
  assert.equal(backup.settings.volume, 0.15);
  await page.getByLabel("JSONバックアップを選択").setInputFiles({
    name: "bad.json",
    mimeType: "application/json",
    buffer: Buffer.from('{"schema_version":1}'),
  });
  await page.waitForTimeout(150);
  assert.equal(
    await page
      .getByRole("button", { name: "全置換で復元", exact: true })
      .count(),
    0,
  );
  await page.getByLabel("JSONバックアップを選択").setInputFiles({
    name: "backup.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(backup)),
  });
  await click("全置換で復元");
  await confirm();
  await page.waitForTimeout(150);
  // Force a mid-transaction failure and verify that no earlier write commits.
  const atomic = await page.evaluate(async () => {
    const { loadState, saveState } = await import("./js/db.js");
    const before = await loadState(),
      candidate = structuredClone(before);
    candidate.entries[0].notes = "must not commit";
    const original = IDBObjectStore.prototype.put;
    let writes = 0,
      failed = false;
    IDBObjectStore.prototype.put = function (...args) {
      if (++writes === 2)
        throw new DOMException("Simulated quota failure", "QuotaExceededError");
      return original.apply(this, args);
    };
    try {
      await saveState(candidate);
    } catch {
      failed = true;
    } finally {
      IDBObjectStore.prototype.put = original;
    }
    const after = await loadState();
    return failed && JSON.stringify(before) === JSON.stringify(after);
  });
  assert.equal(atomic, true);
  const csvDownloadPromise = page.waitForEvent("download");
  await click("全語CSVを書き出す");
  assert.ok(
    (await readFile(await (await csvDownloadPromise).path(), "utf8")).includes(
      "example3",
    ),
  );
  // CSV file import and duplicate update keep all flags, ID and shared memberships.
  const originalWord = backup.entries.find((e) => e.traditional === "口感");
  await nav("#add");
  await click("CSV");
  await page.getByLabel("CSVファイル選択").setInputFiles({
    name: "update.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(exportCSV([{ ...originalWord, notes: "CSVで更新" }])),
  });
  await click("読み込んでプレビュー");
  await page.getByLabel("重複処理").selectOption("update");
  await click("確認して登録");
  await confirm();
  await page.getByRole("heading", { name: "ことばの目録" }).waitFor();
  const updated = await page.evaluate(async () =>
    (await import("./js/db.js")).loadState(),
  );
  const updatedWord = updated.entries.find((e) => e.id === originalWord.id);
  assert.equal(updatedWord.notes, "CSVで更新");
  assert.equal(updatedWord.starred, originalWord.starred);
  assert.equal(updatedWord.mastered, originalWord.mastered);
  assert.equal(updatedWord.examples.length, 3);
  assert.equal(
    updated.memberships.filter((m) => m.entryId === originalWord.id).length,
    2,
  );
  await nav("#add");
  await click("CSV");
  await page
    .getByRole("textbox", { name: "読み込むテキスト" })
    .fill("traditional,meaning\n取消語,登録しない");
  await click("読み込んでプレビュー");
  await page.getByLabel("重複処理").selectOption("cancel");
  await click("確認して登録");
  assert.equal(
    (await page.evaluate(async () => (await import("./js/db.js")).loadState()))
      .entries.length,
    4,
  );
  await page
    .getByRole("textbox", { name: "読み込むテキスト" })
    .fill(
      "traditional,meaning\n" +
        Array.from({ length: 130 }, (_, i) => `試験語${i},意味${i}`).join("\n"),
    );
  await click("読み込んでプレビュー");
  await click("確認して登録");
  await confirm();
  await page.getByRole("heading", { name: "ことばの目録" }).waitFor();
  assert.equal(await page.locator(".entry").count(), 30);
  await click("次のページ");
  assert.equal(await page.locator(".entry").count(), 30);
  await page.getByRole("searchbox").fill("食感");
  await page.waitForTimeout(250);
  await click("所属・移動");
  await page
    .getByRole("dialog")
    .getByLabel("日々の台湾華語", { exact: true })
    .uncheck();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "保存", exact: true })
    .click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  const detached = await page.evaluate(async () =>
    (await import("./js/db.js")).loadState(),
  );
  assert.equal(detached.entries.length, 134);
  assert.equal(
    detached.memberships.filter((m) => m.entryId === originalWord.id).length,
    1,
  );
  await page.getByRole("searchbox").fill("<img");
  await page.waitForTimeout(250);
  await click("完全削除");
  await confirm();
  await page.waitForTimeout(150);
  const removed = await page.evaluate(async () =>
    (await import("./js/db.js")).loadState(),
  );
  assert.equal(removed.entries.length, 133);
  assert.equal(
    removed.entries.some((e) => e.traditional.startsWith("<img")),
    false,
  );
  await page
    .getByRole("combobox", { name: "単語帳", exact: true })
    .selectOption("all");
  await page.getByRole("searchbox").fill("口感");
  await page.waitForTimeout(250);
  assert.equal(await page.locator(".entry").count(), 1);
  for (const [value, count] of [
    ["mastered", 0],
    ["unmastered", 1],
    ["star", 1],
    ["all", 1],
  ]) {
    await page
      .getByRole("combobox", { name: "状態フィルタ" })
      .selectOption(value);
    assert.equal(await page.locator(".entry").count(), count);
  }
  // The second open tab cannot overwrite a stale copy of the database.
  const secondTab = await context.newPage();
  await secondTab.goto(base);
  await secondTab
    .getByRole("heading", { name: "書房を開けませんでした" })
    .waitFor();
  await secondTab.close();
  await nav("#home");
  await context.setOffline(true);
  await page.reload();
  await page.getByRole("heading", { name: "ことばに、月の栞を。" }).waitFor();
  await nav("#study/star");
  await page.locator(".flashcard").waitFor();
  assert.equal(
    await page.locator(".flashcard .meaning").textContent(),
    "食感、口当たり",
  );
  // Both faces fit the actual viewport, including a short browser viewport.
  for (const [width, height] of [
    [320, 480],
    [320, 568],
    [375, 667],
    [390, 844],
    [430, 932],
  ]) {
    await page.setViewportSize({ width, height });
    for (let face = 0; face < 2; face++) {
      const box = await page
        .getByRole("button", { name: "覚えた！", exact: true })
        .boundingBox();
      assert.ok(
        box.y + box.height <= height,
        JSON.stringify({ width, height, box }),
      );
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      );
      assert.equal(
        await page
          .locator("main.study")
          .evaluate((el) => el.scrollHeight <= el.clientHeight),
        true,
      );
      assert.equal(await page.locator(".bottom-nav").isVisible(), false);
      for (const name of ["覚えた！", "詳細を見る", "★ 苦手"]) {
        const buttonBox = await page
          .getByRole("button", { name, exact: true })
          .boundingBox();
        assert.ok(buttonBox.height >= 44);
      }
      await page.locator(".flashcard").click();
      await page.waitForTimeout(100);
    }
  }
  await page.setViewportSize({ width: 375, height: 667 });
  const safeArea = await page.addStyleTag({
    content: "body.is-study main.study{padding-top:56px;padding-bottom:46px}",
  });
  assert.equal(
    await page
      .locator("main.study")
      .evaluate((el) => el.scrollHeight <= el.clientHeight),
    true,
  );
  await page.locator(".flashcard").click();
  await page.locator(".traditional").waitFor();
  assert.equal(
    await page
      .locator("main.study")
      .evaluate((el) => el.scrollHeight <= el.clientHeight),
    true,
  );
  await safeArea.evaluate((el) => el.remove());
  // Extremely long content can scroll without hiding or clipping controls.
  const originalTraditional = await page.locator(".traditional").textContent();
  await page
    .locator(".traditional")
    .evaluate((el) => (el.textContent = "月光照進靜靜的書房".repeat(40)));
  assert.ok(
    await page
      .locator(".card-text")
      .evaluate((el) => el.scrollHeight > el.clientHeight),
  );
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await page
    .locator(".card-text")
    .evaluate((el) => (el.scrollTop = el.scrollHeight));
  const lastControl = await page
    .getByRole("button", { name: "覚えた！", exact: true })
    .boundingBox();
  assert.ok(lastControl.y + lastControl.height <= 667);
  await page
    .locator(".traditional")
    .evaluate((el, text) => (el.textContent = text), originalTraditional);
  await page.locator(".card-text").evaluate((el) => (el.scrollTop = 0));
  await page.emulateMedia({ reducedMotion: "reduce" });
  assert.equal(
    await page
      .locator(".flashcard")
      .evaluate((el) => getComputedStyle(el).animationName),
    "none",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await mkdir(".test-results", { recursive: true });
  await page.screenshot({ path: ".test-results/card.png", fullPage: true });
  await nav("#home");
  await page.screenshot({ path: ".test-results/home.png", fullPage: true });
  assert.deepEqual(errors, []);
  console.log(
    "Browser checks passed: registration, 3 examples, shared books, both directions, selection, detail return, rounds, mastery, stars, search, IndexedDB reload, XSS, sound settings, JSON validation/restore, transaction rollback, CSV file/update/cancel/130 rows/export, membership removal/deletion, tab lock, subpath, offline, 5 mobile sizes/both faces/no-scroll/safe-area simulation/long text, reduced motion.",
  );
} finally {
  await browser.close();
}
