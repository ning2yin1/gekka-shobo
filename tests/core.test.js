import test from "node:test";
import assert from "node:assert/strict";
import {
  emptyState,
  makeEntry,
  addMembership,
  orderedEntries,
  studyEntries,
  getSession,
  advance,
  classifyImport,
  applyImport,
  validateBackup,
} from "../js/model.js";
import { parseCSV, csvRecords, textRecords, exportCSV } from "../js/parsers.js";
const sample = () => {
  const s = emptyState();
  s.books = [
    { id: "book1", name: "一冊", created_at: new Date().toISOString() },
    { id: "book2", name: "二冊", created_at: new Date().toISOString() },
  ];
  s.entries = ["口感", "沒想到", "計程車"].map((x, i) =>
    makeEntry({ traditional: x, meaning: "意味" + i, pinyin: "test" }),
  );
  s.entries.forEach((e) => addMembership(s, e.id, "book1"));
  return s;
};
test("registered order, round, mastering, manual return and star independence", () => {
  const s = sample(),
    [a, b, c] = s.entries;
  assert.equal(getSession(s, "book1").currentId, a.id);
  advance(s, "book1");
  assert.equal(getSession(s, "book1").currentId, b.id);
  advance(s, "book1", true);
  assert.equal(b.mastered, true);
  assert.equal(getSession(s, "book1").currentId, c.id);
  advance(s, "book1");
  assert.equal(getSession(s, "book1").currentId, a.id);
  assert.equal(getSession(s, "book1").round, 2);
  advance(s, "book1", true);
  advance(s, "book1", true);
  assert.equal(studyEntries(s, "book1").length, 0);
  b.mastered = false;
  assert.equal(getSession(s, "book1").currentId, b.id);
  a.starred = true;
  assert.equal(studyEntries(s, "star")[0].id, a.id);
  advance(s, "star", true);
  assert.equal(a.starred, true);
  assert.equal(studyEntries(s, "star").length, 1);
});
test("shared entry membership and full-study deduplication", () => {
  const s = sample();
  addMembership(s, s.entries[0].id, "book2");
  addMembership(s, s.entries[0].id, "book2");
  assert.equal(s.memberships.length, 4);
  assert.equal(orderedEntries(s, "all").length, 3);
  s.memberships = s.memberships.filter((m) => m.bookId !== "book1");
  assert.equal(s.entries.length, 3);
  assert.equal(orderedEntries(s, "book2").length, 1);
});
test("removed or mastered current cards resolve safely", () => {
  const s = sample();
  getSession(s, "book1");
  s.entries[0].mastered = true;
  assert.equal(getSession(s, "book1").currentId, s.entries[1].id);
  s.entries = s.entries.slice(2);
  s.memberships = s.memberships.filter((m) => m.entryId === s.entries[0].id);
  assert.equal(getSession(s, "book1").currentId, s.entries[0].id);
});
test("label text arbitrary examples, exact standalone separators and warnings", () => {
  const records = textRecords(
    "繁体字： 沒想到\n意味: まさか\n例文1: A\n例文拼音1: B\n訳1: C\n例文3: 三\n訳3: 三つ\n用例: --- は内容\n未知: foo\n---\n繁体字: 口感\n意味: 食感\n—\n意味: incomplete",
  );
  assert.equal(records.length, 3);
  assert.equal(records[0].entry.examples.length, 2);
  assert.equal(records[0].entry.usage, "--- は内容");
  assert.equal(records[0].warnings.length, 2);
  const rows = classifyImport(records, emptyState());
  assert.equal(rows[2].status, "error");
  assert.equal(rows[1].entry.simplified, "口感");
});
test("RFC4180 comma, quotes, CRLF, multiline and CSV roundtrip with 4 examples", () => {
  const e = makeEntry({
    traditional: "口感",
    meaning: '食感, "口当たり"\n改行',
    examples: Array.from({ length: 4 }, (_, i) => ({
      chinese: "例" + i,
      pinyin: "pīn",
      translation: '訳, "引用"\n続き',
    })),
    notes: "multi\nline",
  });
  const records = csvRecords(exportCSV([e]));
  assert.equal(records.length, 1);
  assert.equal(records[0].entry.meaning, e.meaning);
  assert.deepEqual(records[0].entry.examples, e.examples);
  assert.equal(records[0].entry.notes, e.notes);
  assert.deepEqual(parseCSV('a,b\r\n"x,y","z""q"'), [
    ["a", "b"],
    ["x,y", 'z"q'],
  ]);
  assert.throws(() => parseCSV('"open'));
  assert.throws(() => parseCSV('"a"x,b'));
  assert.throws(() => csvRecords("traditional,traditional,meaning\na,b,c"));
});
test("100+ CSV records, invalid column counts", () => {
  const text =
    "traditional,meaning\n" +
    Array.from({ length: 150 }, (_, i) => `語${i},意味${i}`).join("\n");
  assert.equal(csvRecords(text).length, 150);
  assert.equal(csvRecords("traditional,meaning\na,b,c")[0].errors.length, 1);
});
test("duplicate skip/update preserve ID, flags and all memberships; meaning differences require confirmation", () => {
  const s = sample(),
    e = s.entries[0];
  e.mastered = true;
  e.starred = true;
  const rows = classifyImport(
    [
      { entry: { ...e, notes: "更新" } },
      { entry: { ...e, meaning: "異なる意味" } },
    ],
    s,
  );
  assert.equal(rows[0].status, "duplicate");
  assert.equal(rows[1].status, "review");
  const id = e.id;
  applyImport(s, rows, "book2", "skip");
  assert.equal(e.notes, "");
  assert.equal(s.entries.length, 3);
  assert.ok(
    s.memberships.some((m) => m.bookId === "book2" && m.entryId === id),
  );
  applyImport(s, rows, "book2", "update", true);
  assert.equal(e.notes, "更新");
  assert.equal(e.id, id);
  assert.equal(e.mastered, true);
  assert.equal(e.starred, true);
  assert.equal(s.entries.length, 4);
  assert.equal(s.memberships.filter((m) => m.entryId === id).length, 2);
});
test("duplicates within the same batch share one entry", () => {
  const s = sample(),
    rows = classifyImport(
      [
        { traditional: "新", meaning: "新しい" },
        { traditional: "新", meaning: "新しい" },
      ],
      s,
    );
  assert.equal(rows[1].status, "duplicate");
  const result = applyImport(s, rows, "book1", "skip");
  assert.equal(result.added, 1);
  assert.equal(s.entries.length, 4);
});
test("complete JSON validates and rejects corruption before mutation", () => {
  const s = sample();
  getSession(s, "book1").back = true;
  s.entries[0].starred = true;
  assert.deepEqual(validateBackup(JSON.parse(JSON.stringify(s))), s);
  for (const mutate of [
    (x) => (x.schema_version = 2),
    (x) => (x.entries[0].simplified = null),
    (x) => (x.memberships[0].entryId = "missing"),
    (x) => x.entries.push(x.entries[0]),
    (x) => (x.settings.volume = 2),
    (x) => (x.entries[0].mastered = "true"),
    (x) => (x.sessions[0].currentId = "missing"),
  ]) {
    const bad = structuredClone(s);
    mutate(bad);
    assert.throws(() => validateBackup(bad));
  }
  assert.equal(s.entries.length, 3);
});
