import test from "node:test";
import assert from "node:assert/strict";
import {
  emptyState,
  makeEntry,
  getSession,
  moveStudy,
  seekStudy,
  studyEntries,
} from "../js/model.js";
import { swipeDirection } from "../js/gestures.js";
test("swipes cycle eligible cards and count forward wraps only; sliders never count", () => {
  for (const scope of ["all", "star"]) {
    const s = emptyState();
    s.entries = ["一", "二", "三"].map((traditional, i) => {
      const e = makeEntry({ traditional, meaning: traditional });
      e.created_at = new Date(1700000000000 + i).toISOString();
      e.starred = true;
      e.mastered = i === 1;
      return e;
    });
    const original = structuredClone(s.entries),
      queue = studyEntries(s, scope),
      session = getSession(s, scope);
    session.back = true;
    moveStudy(s, scope, -1);
    assert.equal(session.currentId, queue.at(-1).id);
    assert.equal(session.round, 1);
    assert.equal(session.back, false);
    moveStudy(s, scope, 1);
    assert.equal(session.currentId, queue[0].id);
    assert.equal(session.round, 2);
    seekStudy(s, scope, queue.length - 1);
    assert.equal(session.round, 2);
    moveStudy(s, scope, -1);
    assert.equal(session.round, 2);
    assert.deepEqual(s.entries, original);
    assert.deepEqual(getSession(JSON.parse(JSON.stringify(s)), scope), session);
  }
});
test("one eligible card stays put without a new round; empty queues remain safe", () => {
  const s = emptyState();
  s.entries = [makeEntry({ traditional: "一", meaning: "一" })];
  const session = getSession(s, "all");
  session.back = true;
  for (let i = 0; i < 10; i++) {
    moveStudy(s, "all", 1);
    moveStudy(s, "all", -1);
  }
  assert.equal(session.currentId, s.entries[0].id);
  assert.equal(session.round, 1);
  assert.equal(session.back, false);
  s.entries[0].mastered = true;
  moveStudy(s, "all", 1);
  assert.equal(session.currentId, null);
});
test("horizontal quick intent only; taps, short drags, vertical and long presses rejected", () => {
  assert.equal(swipeDirection(-100, 5, 150, 320), 1);
  assert.equal(swipeDirection(100, 5, 150, 320), -1);
  for (const args of [
    [1, 0, 50, 320],
    [-30, 0, 100, 320],
    [-90, 100, 100, 320],
    [-80, 60, 100, 320],
    [-100, 0, 450, 320],
    [-100, 0, 900, 320],
  ])
    assert.equal(swipeDirection(...args), 0);
});
