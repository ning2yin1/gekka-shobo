import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { emptyState, validateBackup } from "../js/model.js";
const old = JSON.parse(
  readFileSync(new URL("./fixtures/legacy-v1.json", import.meta.url), "utf8"),
);
test("legacy schema 1 backup retains every entry, flag, membership and session", () => {
  const next = validateBackup(old);
  for (const key of ["entries", "books", "memberships", "sessions"])
    assert.deepEqual(next[key], old[key]);
  assert.equal(next.schema_version, 1);
  assert.deepEqual(next.settings, {
    ...old.settings,
    bgm: false,
    bgmVolume: 0.15,
  });
  assert.equal("bgm" in old.settings, false);
});
test("BGM starts OFF at 15%, survives JSON roundtrip, rejects invalid preferences", () => {
  const s = emptyState();
  assert.equal(s.settings.bgm, false);
  assert.equal(s.settings.bgmVolume, 0.15);
  s.settings.bgm = true;
  s.settings.bgmVolume = 0.62;
  assert.deepEqual(validateBackup(JSON.parse(JSON.stringify(s))), s);
  for (const [key, value] of [
    ["bgm", "yes"],
    ["bgm", null],
    ["bgmVolume", -1],
    ["bgmVolume", 1.1],
    ["bgmVolume", null],
    ["bgmVolume", "0.15"],
  ]) {
    const invalid = structuredClone(s);
    invalid.settings[key] = value;
    assert.throws(() => validateBackup(invalid));
  }
});
