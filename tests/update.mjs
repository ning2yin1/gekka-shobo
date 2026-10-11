// Serve two shell versions without modifying repository files.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve, extname } from "node:path";
import { chromium } from "playwright";
import assert from "node:assert/strict";
const root = fileURLToPath(new URL("../", import.meta.url));
let version = 1;
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
    const relative = decodeURIComponent(
      new URL(req.url, "http://localhost").pathname,
    ).replace(/^\/gekka-shobo\//, "");
    const file = resolve(root, relative || "index.html");
    if (!file.startsWith(root)) {
      res.writeHead(403).end();
      return;
    }
    let bytes = await readFile(file);
    if (relative === "sw.js")
      bytes = Buffer.from(
        bytes.toString().replace(/shell-v\d+/, `shell-test${version}`),
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
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const url = `http://127.0.0.1:${server.address().port}/gekka-shobo/`;
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
  headless: true,
  args: ["--no-sandbox"],
});
try {
  const context = await browser.newContext(),
    page = await context.newPage();
  await page.goto(url);
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await page.getByRole("heading", { name: "ことばに、月の栞を。" }).waitFor();
  const before = await page.evaluate(async () => {
    const { emptyState, makeEntry, addMembership, getSession } = await import(
      "./js/model.js"
    );
    const { saveState } = await import("./js/db.js");
    const s = emptyState();
    s.books = [
      {
        id: "update-book",
        name: "更新しても残る",
        created_at: new Date().toISOString(),
      },
    ];
    const e = makeEntry({
      traditional: "月光",
      simplified: "月光",
      pinyin: "yuè guāng",
      meaning: "月の光",
    });
    e.starred = true;
    s.entries = [e];
    addMembership(s, e.id, s.books[0].id);
    getSession(s, "all").back = true;
    s.settings.direction = "ja-zh";
    await saveState(s);
    return s;
  });
  await page.reload();
  await page.getByRole("heading", { name: "更新しても残る" }).waitFor();
  version = 2;
  await page.evaluate(async () => {
    await (await navigator.serviceWorker.getRegistration()).update();
  });
  await page.waitForFunction(
    async () => !!(await navigator.serviceWorker.getRegistration()).waiting,
  );
  await page.evaluate(() => (location.hash = "#settings"));
  await page
    .getByRole("button", { name: "新しい版に更新", exact: true })
    .click();
  const updatedPageLoaded = page.waitForEvent("load");
  await page.locator("#confirm-dialog button[value=ok]").click();
  await updatedPageLoaded;
  await page.waitForFunction(async () => {
    const keys = await caches.keys();
    return (
      keys.includes("gekka-shobo-shell-test2") &&
      !keys.includes("gekka-shobo-shell-test1")
    );
  });
  await page.getByRole("heading", { name: "書房の設定" }).waitFor();
  const after = await page.evaluate(async () =>
    (await import("./js/db.js")).loadState(),
  );
  for (const key of ["entries", "books", "memberships", "sessions", "settings"])
    assert.deepEqual(after[key], before[key]);
  await context.setOffline(true);
  await page.reload();
  await page.getByRole("heading", { name: "書房の設定" }).waitFor();
  console.log(
    "PWA update passed: waiting worker, user-controlled switch, old-cache cleanup, IndexedDB/settings/session preservation, offline after update.",
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
