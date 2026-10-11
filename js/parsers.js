import { textFields } from "./model.js";
export function parseCSV(text) {
  text = text.replace(/^\uFEFF/, "");
  if (!text.trim()) return [];
  const rows = [];
  let row = [],
    cell = "",
    quoted = false,
    closed = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
          closed = true;
        }
      } else cell += c;
    } else if (c === '"') {
      if (cell || closed) throw new Error("CSVの引用符の位置が不正です");
      quoted = true;
    } else if (c === ",") {
      row.push(cell);
      cell = "";
      closed = false;
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some((x) => x !== "")) rows.push(row);
      row = [];
      cell = "";
      closed = false;
    } else {
      if (closed) throw new Error("CSVの閉じ引用符の後に文字があります");
      cell += c;
    }
  }
  if (quoted) throw new Error("CSVの引用符が閉じていません");
  row.push(cell);
  if (row.some((x) => x !== "")) rows.push(row);
  return rows;
}
export function csvRecords(text) {
  const rows = parseCSV(text);
  if (!rows.length) return [];
  const header = rows.shift().map((x) => x.trim());
  if (!header.includes("traditional") || !header.includes("meaning"))
    throw new Error("CSVには traditional と meaning のヘッダーが必要です");
  if (new Set(header).size !== header.length)
    throw new Error("CSVのヘッダーが重複しています");
  return rows.map((values, i) => {
    const entry = { examples: [] },
      errors = [],
      warnings = [];
    if (values.length !== header.length)
      errors.push(`CSV ${i + 2} 行目：列数が一致しません`);
    const examples = new Map();
    header.forEach((key, j) => {
      const v = values[j] || "",
        m = key.match(/^(example|example_pinyin|translation)(\d+)$/);
      if (m) {
        const n = Number(m[2]);
        const ex = examples.get(n) || {
          chinese: "",
          pinyin: "",
          translation: "",
        };
        ex[
          {
            example: "chinese",
            example_pinyin: "pinyin",
            translation: "translation",
          }[m[1]]
        ] = v;
        examples.set(n, ex);
      } else if ([...textFields, "entry_type"].includes(key)) entry[key] = v;
      else if (key) warnings.push(`未知の列：${key}`);
    });
    entry.examples = [...examples].sort((a, b) => a[0] - b[0]).map((x) => x[1]);
    if (
      entry.entry_type &&
      !["word", "chunk", "grammar"].includes(entry.entry_type)
    )
      warnings.push("種類が不明なため単語として登録します");
    if (!entry.simplified)
      warnings.push(
        "簡体字を繁体字と同じ値で初期化します（自動変換ではありません）",
      );
    return { entry, errors, warnings };
  });
}
const labels = {
  繁体字: "traditional",
  繁體字: "traditional",
  繁体: "traditional",
  簡体字: "simplified",
  簡體字: "simplified",
  簡体: "simplified",
  拼音: "pinyin",
  ピンイン: "pinyin",
  意味: "meaning",
  日本語: "meaning",
  日本語訳: "meaning",
  種類: "entry_type",
  品詞: "part_of_speech",
  量詞: "measure_word",
  用例: "usage",
  使い方: "usage",
  搭配: "usage",
  文法: "grammar_notes",
  文法パターン: "grammar_notes",
  文法メモ: "grammar_notes",
  ニュアンス: "nuance",
  堅さ: "register",
  言葉の堅さ: "register",
  類義語: "synonyms",
  使い分け: "synonym_differences",
  地域差: "regional_usage",
  地域の言い換え: "regional_alternatives",
  地域別の言い換え: "regional_alternatives",
  語源: "etymology",
  補足: "etymology",
  メモ: "notes",
  その他: "notes",
};
export function textRecords(text) {
  return text
    .split(/^\s*(?:---|—)\s*$/m)
    .filter((x) => x.trim())
    .map((block) => {
      const entry = { examples: [] },
        warnings = [],
        examples = new Map();
      let last = null;
      for (const line of block.split(/\r?\n/)) {
        if (!line.trim()) continue;
        const m = line.match(/^\s*([^:：]+)[:：]\s*(.*)$/);
        if (!m) {
          if (last) last.object[last.key] += "\n" + line;
          else warnings.push(`ラベルのない行：${line}`);
          continue;
        }
        const label = m[1].trim(),
          value = m[2],
          ex = label.match(/^(例文拼音|例文ピンイン|例文|訳|例文訳)(\d+)$/);
        if (ex) {
          const n = Number(ex[2]),
            obj = examples.get(n) || {
              chinese: "",
              pinyin: "",
              translation: "",
            },
            key =
              ex[1] === "例文"
                ? "chinese"
                : ex[1].includes("拼音") || ex[1].includes("ピンイン")
                  ? "pinyin"
                  : "translation";
          obj[key] = value;
          examples.set(n, obj);
          last = { object: obj, key };
        } else {
          const key =
            labels[label] ||
            ([...textFields, "entry_type"].includes(label) ? label : null);
          if (key) {
            if (entry[key]) warnings.push(`重複したラベル：${label}`);
            entry[key] = value;
            last = { object: entry, key };
          } else {
            warnings.push(`未知のラベル：${label}`);
            last = null;
          }
        }
      }
      entry.entry_type =
        { 単語: "word", チャンク: "chunk", 文法: "grammar" }[
          entry.entry_type
        ] ||
        entry.entry_type ||
        "word";
      if (!["word", "chunk", "grammar"].includes(entry.entry_type))
        warnings.push("種類が不明なため単語として登録します");
      entry.examples = [...examples]
        .sort((a, b) => a[0] - b[0])
        .map((x) => x[1]);
      if (!entry.simplified)
        warnings.push(
          "簡体字を繁体字と同じ値で初期化します（自動変換ではありません）",
        );
      return { entry, warnings };
    });
}
export function exportCSV(entries) {
  const count = Math.max(0, ...entries.map((e) => e.examples.length)),
    head = [
      "traditional",
      "simplified",
      "pinyin",
      "meaning",
      "entry_type",
      "part_of_speech",
      "measure_word",
    ];
  for (let n = 1; n <= count; n++)
    head.push(`example${n}`, `example_pinyin${n}`, `translation${n}`);
  head.push(...textFields.filter((k) => !head.includes(k)));
  const escape = (x) => '"' + String(x ?? "").replaceAll('"', '""') + '"';
  const rows = entries.map((e) =>
    head.map((k) => {
      const m = k.match(/^(example|example_pinyin|translation)(\d+)$/);
      return m
        ? e.examples[Number(m[2]) - 1]?.[
            {
              example: "chinese",
              example_pinyin: "pinyin",
              translation: "translation",
            }[m[1]]
          ] || ""
        : e[k];
    }),
  );
  return (
    "\uFEFF" + [head, ...rows].map((r) => r.map(escape).join(",")).join("\r\n")
  );
}
