import test from "node:test";
import assert from "node:assert/strict";
import {
  emptyState,
  makeEntry,
  getSession,
  studyEntries,
  seekStudy,
  captureMasterUndo,
  advance,
  undoMaster,
  addMembership,
} from "../js/model.js";
function fixture() {
  const s = emptyState();
  s.entries = ["一", "二", "三", "四"].map((traditional, i) =>
    makeEntry({ traditional, meaning: String(i) }),
  );
  s.entries.forEach((e) => (e.starred = true));
  s.entries[1].mastered = true;
  s.books.push({
    id: "book",
    name: "本",
    created_at: new Date().toISOString(),
  });
  for (const e of [...s.entries].reverse()) addMembership(s, e.id, "book");
  return s;
}
test("seeking respects eligibility and book order, preserves flags/round and faces front", () => {
  for (const scope of ["all", "star", "book"]) {
    const s = fixture(),
      queue = studyEntries(s, scope),
      session = getSession(s, scope);
    const flags = s.entries.map((e) => [e.mastered, e.starred]);
    session.round = 4;
    session.back = true;
    seekStudy(s, scope, queue.length - 1);
    assert.equal(session.currentId, queue.at(-1).id);
    assert.equal(session.round, 4);
    assert.equal(session.back, false);
    assert.deepEqual(
      s.entries.map((e) => [e.mastered, e.starred]),
      flags,
    );
    seekStudy(s, scope, 0);
    assert.equal(session.currentId, queue[0].id);
    assert.equal(
      getSession(JSON.parse(JSON.stringify(s)), scope).currentId,
      queue[0].id,
    );
    seekStudy(s, scope, -1);
    seekStudy(s, scope, 99);
    assert.equal(session.currentId, queue[0].id);
  }
});
test("undo mastery restores position/round/face including completion and mastered stars, preserving other edits", () => {
  for (const scope of ["all", "star"]) {
    const s = fixture(),
      q = studyEntries(s, scope);
    seekStudy(s, scope, q.length - 1);
    const session = getSession(s, scope);
    session.round = 5;
    session.back = true;
    const before = structuredClone(session),
      snapshot = captureMasterUndo(s, scope);
    advance(s, scope, true);
    s.entries[0].notes = "取り消し前の編集";
    if (scope === "all")
      s.entries.find((e) => e.id === snapshot.entryId).starred = false;
    assert.equal(undoMaster(s, snapshot), true);
    assert.deepEqual(getSession(s, scope), before);
    assert.equal(
      s.entries.find((e) => e.id === snapshot.entryId).mastered,
      snapshot.mastered,
    );
    assert.equal(s.entries[0].notes, "取り消し前の編集");
    assert.equal(
      s.entries.find((e) => e.id === snapshot.entryId).starred,
      scope === "star",
    );
  }
  const s = fixture();
  s.entries.forEach((e, i) => (e.mastered = i !== 0));
  const snap = captureMasterUndo(s, "all");
  advance(s, "all", true);
  assert.equal(studyEntries(s, "all").length, 0);
  undoMaster(s, snap);
  assert.equal(studyEntries(s, "all").length, 1);
});
