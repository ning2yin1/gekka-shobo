export const SCHEMA_VERSION = 1;
export const textFields = [
  "traditional",
  "simplified",
  "pinyin",
  "meaning",
  "part_of_speech",
  "measure_word",
  "usage",
  "grammar_notes",
  "nuance",
  "register",
  "synonyms",
  "synonym_differences",
  "regional_usage",
  "regional_alternatives",
  "etymology",
  "notes",
];
export const uid = () => crypto.randomUUID();
export const normalized = (s) =>
  s.normalize("NFKC").trim().replace(/\s+/g, " ");
export function emptyState() {
  return {
    schema_version: 1,
    entries: [],
    books: [],
    memberships: [],
    sessions: [],
    settings: {
      direction: "zh-ja",
      sound: false,
      volume: 0.25,
      bgm: false,
      bgmVolume: 0.15,
    },
  };
}
export function makeEntry(input) {
  const now = new Date().toISOString(),
    e = {
      id: uid(),
      entry_type: "word",
      examples: [],
      mastered: false,
      starred: false,
      created_at: now,
      updated_at: now,
    };
  for (const key of textFields) e[key] = String(input[key] ?? "").trim();
  e.simplified ||= e.traditional;
  e.entry_type = ["word", "chunk", "grammar"].includes(input.entry_type)
    ? input.entry_type
    : "word";
  e.examples = (input.examples || [])
    .map((x) => ({
      chinese: String(x.chinese || "").trim(),
      pinyin: String(x.pinyin || "").trim(),
      translation: String(x.translation || "").trim(),
    }))
    .filter((x) => x.chinese || x.pinyin || x.translation);
  return e;
}
export function addMembership(s, entryId, bookId) {
  if (!s.memberships.some((m) => m.entryId === entryId && m.bookId === bookId))
    s.memberships.push({
      id: uid(),
      entryId,
      bookId,
      order:
        Math.max(
          -1,
          ...s.memberships
            .filter((m) => m.bookId === bookId)
            .map((m) => m.order),
        ) + 1,
    });
}
export function orderedEntries(s, scope = "all") {
  if (scope === "all" || scope === "star")
    return [...s.entries]
      .filter((e) => scope !== "star" || e.starred)
      .sort(
        (a, b) =>
          a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id),
      );
  const map = new Map(s.entries.map((e) => [e.id, e]));
  return s.memberships
    .filter((m) => m.bookId === scope)
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
    .map((m) => map.get(m.entryId))
    .filter(Boolean);
}
export function studyEntries(s, scope) {
  return orderedEntries(s, scope).filter(
    (e) => scope === "star" || !e.mastered,
  );
}
export function getSession(s, scope) {
  let session = s.sessions.find((x) => x.scope === scope);
  if (!session) {
    session = { scope, currentId: null, round: 1, back: false };
    s.sessions.push(session);
  }
  const entries = studyEntries(s, scope);
  if (!entries.some((e) => e.id === session.currentId)) {
    session.currentId = entries[0]?.id || null;
    session.back = false;
  }
  return session;
}
export function advance(s, scope, master = false) {
  const session = getSession(s, scope),
    before = studyEntries(s, scope),
    index = before.findIndex((e) => e.id === session.currentId);
  if (master && index >= 0) {
    before[index].mastered = true;
    before[index].updated_at = new Date().toISOString();
  }
  const remaining = studyEntries(s, scope);
  let next = before
    .slice(index + 1)
    .find((e) => remaining.some((r) => r.id === e.id));
  if (!next && remaining.length) {
    next = remaining[0];
    session.round++;
  }
  session.currentId = next?.id || null;
  session.back = false;
  return session;
}
// Change position within the current eligible queue without advancing a round.
export function seekStudy(s, scope, index) {
  const entries = studyEntries(s, scope);
  if (!Number.isInteger(index) || index < 0 || index >= entries.length) return;
  const session = getSession(s, scope);
  session.currentId = entries[index].id;
  session.back = false;
}
export function captureMasterUndo(s, scope) {
  const session = getSession(s, scope);
  const entry = s.entries.find((e) => e.id === session.currentId);
  return entry
    ? {
        scope,
        entryId: entry.id,
        mastered: entry.mastered,
        updated_at: entry.updated_at,
        session: structuredClone(session),
      }
    : null;
}
export function undoMaster(s, snapshot) {
  const entry = s.entries.find((e) => e.id === snapshot?.entryId);
  if (!entry) return false;
  entry.mastered = snapshot.mastered;
  entry.updated_at = new Date().toISOString();
  Object.assign(getSession(s, snapshot.scope), snapshot.session);
  return true;
}
export function classifyImport(records, state) {
  const seen = [];
  return records.map((r, index) => {
    const errors = [...(r.errors || [])],
      warnings = [...(r.warnings || [])];
    const entry = makeEntry(r.entry || r);
    if (!entry.traditional) errors.push("繁体字がありません");
    if (!entry.meaning) errors.push("意味がありません");
    const candidates = [...state.entries, ...seen].filter(
      (e) => normalized(e.traditional) === normalized(entry.traditional),
    );
    const match = candidates.find(
      (e) =>
        normalized(e.meaning) === normalized(entry.meaning) &&
        normalized(e.pinyin) === normalized(entry.pinyin),
    );
    let status = errors.length
      ? "error"
      : match
        ? "duplicate"
        : candidates.length
          ? "review"
          : "new";
    if (status === "review")
      warnings.push(
        "同じ繁体字で意味または拼音が異なります。別のエントリとして登録する場合に確認してください。",
      );
    if (!errors.length) seen.push(entry);
    return {
      entry,
      index: index + 1,
      errors,
      warnings,
      status,
      matchId: match?.id || null,
    };
  });
}
export function applyImport(s, rows, bookId, policy, allowDistinct = false) {
  let added = 0,
    updated = 0,
    linked = 0;
  for (const row of rows) {
    if (row.status === "error") continue;
    if (row.status === "review" && !allowDistinct) continue;
    let match = s.entries.find(
      (e) =>
        normalized(e.traditional) === normalized(row.entry.traditional) &&
        normalized(e.meaning) === normalized(row.entry.meaning) &&
        normalized(e.pinyin) === normalized(row.entry.pinyin),
    );
    if (match) {
      if (policy === "update") {
        const keep = {
          id: match.id,
          mastered: match.mastered,
          starred: match.starred,
          created_at: match.created_at,
        };
        Object.assign(match, row.entry, keep, {
          updated_at: new Date().toISOString(),
        });
        updated++;
      }
      if (bookId) {
        const before = s.memberships.length;
        addMembership(s, match.id, bookId);
        if (s.memberships.length > before) linked++;
      }
    } else {
      const e = { ...row.entry, id: uid() };
      s.entries.push(e);
      if (bookId) addMembership(s, e.id, bookId);
      added++;
    }
  }
  return { added, updated, linked };
}
const validString = (x) => typeof x === "string";
export function validateBackup(value) {
  if (!value || value.schema_version !== SCHEMA_VERSION)
    throw new Error("対応していないバックアップ形式／バージョンです");
  for (const key of ["entries", "books", "memberships", "sessions"])
    if (!Array.isArray(value[key]))
      throw new Error(`${key} が配列ではありません`);
  const unique = (items, key) => {
    const ids = new Set();
    for (const x of items) {
      if (!x || !validString(x[key]) || !x[key] || ids.has(x[key]))
        throw new Error(`${key} が不正または重複しています`);
      ids.add(x[key]);
    }
    return ids;
  };
  const entries = unique(value.entries, "id"),
    books = unique(value.books, "id");
  unique(value.memberships, "id");
  unique(value.sessions, "scope");
  for (const e of value.entries) {
    for (const k of textFields)
      if (!validString(e[k])) throw new Error(`単語の ${k} が不正です`);
    if (
      !e.traditional.trim() ||
      !e.simplified.trim() ||
      !e.meaning.trim() ||
      !["word", "chunk", "grammar"].includes(e.entry_type) ||
      typeof e.mastered !== "boolean" ||
      typeof e.starred !== "boolean"
    )
      throw new Error("単語の必須項目または状態が不正です");
    for (const k of ["created_at", "updated_at"])
      if (!validString(e[k]) || !Number.isFinite(Date.parse(e[k])))
        throw new Error("日時が不正です");
    if (
      !Array.isArray(e.examples) ||
      e.examples.some(
        (x) =>
          !x ||
          !["chinese", "pinyin", "translation"].every((k) => validString(x[k])),
      )
    )
      throw new Error("例文が不正です");
  }
  for (const b of value.books)
    if (
      !validString(b.name) ||
      !b.name.trim() ||
      !validString(b.created_at) ||
      !Number.isFinite(Date.parse(b.created_at))
    )
      throw new Error("単語帳が不正です");
  const pairs = new Set();
  for (const m of value.memberships) {
    const pair = JSON.stringify([m.bookId, m.entryId]);
    if (
      !entries.has(m.entryId) ||
      !books.has(m.bookId) ||
      !Number.isSafeInteger(m.order) ||
      m.order < 0 ||
      pairs.has(pair)
    )
      throw new Error("単語帳の所属関係が不正です");
    pairs.add(pair);
  }
  for (const x of value.sessions)
    if (
      (!["all", "star"].includes(x.scope) && !books.has(x.scope)) ||
      (x.currentId !== null && !entries.has(x.currentId)) ||
      !Number.isSafeInteger(x.round) ||
      x.round < 1 ||
      typeof x.back !== "boolean"
    )
      throw new Error("学習位置が不正です");
  const t = value.settings;
  if (
    !t ||
    !["zh-ja", "ja-zh"].includes(t.direction) ||
    typeof t.sound !== "boolean" ||
    typeof t.volume !== "number" ||
    !Number.isFinite(t.volume) ||
    t.volume < 0 ||
    t.volume > 1 ||
    (t.bgm !== undefined && typeof t.bgm !== "boolean") ||
    (t.bgmVolume !== undefined &&
      (typeof t.bgmVolume !== "number" ||
        !Number.isFinite(t.bgmVolume) ||
        t.bgmVolume < 0 ||
        t.bgmVolume > 1))
  )
    throw new Error("設定が不正です");
  // Whitelist the document shape, then detach it from the parsed input.
  return structuredClone({
    schema_version: SCHEMA_VERSION,
    entries: value.entries,
    books: value.books,
    memberships: value.memberships,
    sessions: value.sessions,
    settings: {
      direction: t.direction,
      sound: t.sound,
      volume: t.volume,
      bgm: t.bgm ?? false,
      bgmVolume: t.bgmVolume ?? 0.15,
    },
  });
}
