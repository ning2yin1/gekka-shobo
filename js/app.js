import { loadState, saveState } from "./db.js";
import {
  uid,
  makeEntry,
  addMembership,
  orderedEntries,
  studyEntries,
  getSession,
  advance,
  moveStudy,
  seekStudy,
  captureMasterUndo,
  undoMaster,
  classifyImport,
  applyImport,
  validateBackup,
  textFields,
} from "./model.js";
import { textRecords, csvRecords, exportCSV } from "./parsers.js";
import { bindCardGestures } from "./gestures.js";
import { AudioManager } from "./audio.js";
const app = document.querySelector("#app"),
  audio = new AudioManager();
let state,
  busy = false,
  masterUndo = null,
  swipeHintShown = false,
  preview = null,
  backupPreview = null,
  editing = null,
  manualDraft = null,
  addMode = "manual",
  listScope = "all",
  search = "",
  filter = "all",
  page = 0,
  detailTab = "examples",
  returnHash = "#list",
  pendingUpdate = null,
  lastScreen = null;
const titles = {
  traditional: "繁体字",
  simplified: "簡体字",
  pinyin: "拼音（声調記号付き）",
  meaning: "日本語の意味",
  part_of_speech: "品詞",
  measure_word: "量詞と用例",
  usage: "用例・搭配・チャンク",
  grammar_notes: "文法パターン",
  nuance: "ニュアンス",
  register: "言葉の堅さ",
  synonyms: "類義語",
  synonym_differences: "類義語の使い分け",
  regional_usage: "台湾／中国大陸の使用差",
  regional_alternatives: "地域別の言い換え",
  etymology: "語源・補足",
  notes: "その他のメモ",
};
const h = (tag, attrs = {}, ...children) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith("on")) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === "class") el.className = v;
    else if (k === "checked") el.checked = v;
    else if (k === "value") el.value = v;
    else if (k === "disabled") el.disabled = v;
    else el.setAttribute(k, v);
  }
  for (const c of children.flat(Infinity))
    if (c !== null && c !== undefined)
      el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
};
const button = (text, fn, cls = "", attrs = {}) =>
  h("button", { type: "button", class: cls, onClick: fn, ...attrs }, text);
const link = (text, hash, cls = "button") =>
  h("a", { href: hash, class: cls }, text);
const p = (text, cls = "") => h("p", { class: cls }, text);
function toast(text) {
  const el = document.querySelector("#toast");
  el.textContent = text;
  el.classList.add("visible");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove("visible"), 4000);
}
function confirmAction(message, title = "操作の確認") {
  const d = document.querySelector("#confirm-dialog");
  document.querySelector("#confirm-title").textContent = title;
  document.querySelector("#confirm-message").textContent = message;
  return new Promise((resolve) => {
    d.addEventListener("close", () => resolve(d.returnValue === "ok"), {
      once: true,
    });
    d.showModal();
  });
}
async function change(fn, { renderAfter = true } = {}) {
  if (busy) return false;
  busy = true;
  app.setAttribute("aria-busy", "true");
  const controls = [
    ...app.querySelectorAll("button,input,select,textarea"),
  ].map((el) => [el, el.disabled]);
  for (const [el] of controls) el.disabled = true;
  const next = structuredClone(state);
  const previousQueues = new Map(
    state.sessions.map((x) => [
      x.scope,
      studyEntries(state, x.scope).map((e) => e.id),
    ]),
  );
  try {
    fn(next);
    for (const x of next.sessions) {
      const remaining = studyEntries(next, x.scope);
      if (x.currentId && !remaining.some((e) => e.id === x.currentId)) {
        const old = previousQueues.get(x.scope) || [],
          index = old.indexOf(x.currentId);
        x.currentId =
          old
            .slice(index + 1)
            .find((id) => remaining.some((e) => e.id === id)) ||
          remaining[0]?.id ||
          null;
        x.back = false;
      }
    }
    await saveState(next, state);
    state = next;
    audio.applyPreferences(state.settings);
    if (renderAfter) render();
    return true;
  } catch (e) {
    toast(
      "保存できませんでした。変更は反映されていません。バックアップと空き容量を確認してください。",
    );
    console.error(e);
    return false;
  } finally {
    busy = false;
    app.removeAttribute("aria-busy");
    for (const [el, disabled] of controls)
      if (el.isConnected) el.disabled = disabled;
  }
}
function scopeName(scope) {
  return scope === "all"
    ? "すべてのことば"
    : scope === "star"
      ? "星の栞 · ★学習"
      : state.books.find((b) => b.id === scope)?.name || "単語帳";
}
const progress = (done, total) =>
  h(
    "div",
    {
      class: "progress",
      role: "progressbar",
      "aria-label": "習得率",
      "aria-valuemin": 0,
      "aria-valuemax": 100,
      "aria-valuenow": total ? Math.round((done / total) * 100) : 0,
    },
    h("span", { style: `width:${total ? (done / total) * 100 : 0}%` }),
  );
function stats(entries) {
  const done = entries.filter((e) => e.mastered).length;
  return h(
    "div",
    {},
    h(
      "div",
      { class: "stats" },
      `${entries.length} 語　／　習得 ${done}　／　未習得 ${entries.length - done}　·　${entries.length ? Math.round((done / entries.length) * 100) : 0}%`,
    ),
    progress(done, entries.length),
  );
}
function inputField(
  label,
  name,
  value = "",
  multiline = false,
  required = false,
) {
  const id = "f-" + name,
    attrs = { id, name, value };
  if (required) attrs.required = "";
  return h(
    "div",
    {},
    h("label", { for: id }, label, required ? " *" : ""),
    h(multiline ? "textarea" : "input", attrs),
  );
}
function bookSelect(name = "bookId", selected = "", allowNone = true) {
  const el = h(
    "select",
    { name, "aria-label": "単語帳" },
    allowNone ? h("option", { value: "" }, "単語帳に所属させない") : null,
    ...state.books.map((b) => h("option", { value: b.id }, b.name)),
  );
  el.value = selected;
  return el;
}
function Chinese(e) {
  return [
    h("div", { class: "traditional", lang: "zh-Hant" }, e.traditional),
    h("div", { class: "simplified", lang: "zh-Hans" }, e.simplified),
    h(
      "div",
      { class: "pinyin", lang: "zh-Latn" },
      e.pinyin || "（拼音未入力）",
    ),
  ];
}
function goDetail(id) {
  returnHash = location.hash || "#home";
  detailTab = "examples";
  location.hash = "#detail/" + id;
}
function home() {
  const total = state.entries.length;
  app.append(
    h(
      "section",
      { class: "intro" },
      p("THE MOONLIT LIBRARY", "eyebrow"),
      h("h1", {}, "ことばに、月の栞を。"),
      p(
        "出会った台湾華語を、一語ずつ。\n今夜も、あなたの書房をひらきましょう。",
      ),
      h(
        "div",
        { class: "hero-art", "aria-hidden": "true" },
        h("span", {}, "月明かりに綴る、", h("br"), "わたしのことば。"),
      ),
      stats(state.entries),
      h(
        "div",
        { class: "actions" },
        link("すべてのことばを学ぶ", "#study/all", "button primary"),
        link(
          `★ 星の栞 ${state.entries.filter((e) => e.starred).length}`,
          "#study/star",
        ),
      ),
    ),
  );
  app.append(
    h(
      "div",
      { class: "section-top" },
      h("h2", {}, "わたしの書架"),
      button("＋ 単語帳", () => bookEditor()),
    ),
  );
  if (!state.books.length)
    app.append(
      h(
        "div",
        { class: "panel" },
        p("まだ、書架は空っぽです。", "empty"),
        p("単語帳を作って、最初のことばを迎えましょう。", "form-note"),
        button("最初の単語帳を作る", () => bookEditor(), "primary"),
      ),
    );
  for (const b of state.books) {
    const entries = orderedEntries(state, b.id);
    app.append(
      h(
        "article",
        { class: "book" },
        h(
          "div",
          { class: "book-content" },
          h(
            "div",
            { class: "section-top" },
            h("h3", {}, b.name),
            button("編集", () => bookEditor(b), "subtle compact"),
          ),
          stats(entries),
          h(
            "div",
            { class: "actions" },
            link("学習する", "#study/" + b.id, "button primary"),
            button("一覧を見る", () => {
              listScope = b.id;
              search = "";
              page = 0;
              location.hash = "#list";
              render();
            }),
            button(
              "追加",
              () => {
                editing = null;
                addMode = "manual";
                location.hash = "#add/" + b.id;
              },
              "compact",
            ),
          ),
        ),
      ),
    );
  }
  if (!total)
    app.append(
      h(
        "div",
        { class: "notice" },
        "サンプルデータは自動登録しません。自分のことばを手動・テキスト・CSVで追加できます。",
      ),
    );
  app.append(
    h("footer", {}, "☾ 月華書房 — あなたの端末に、あなたのことばを。"),
  );
}
async function bookEditor(book) {
  const d = h(
    "dialog",
    {},
    h("h2", {}, book ? "単語帳の編集" : "新しい単語帳"),
  );
  const input = h("input", {
    value: book?.name || "",
    maxlength: 100,
    "aria-label": "単語帳名",
  });
  d.append(
    h("label", {}, "単語帳の名前"),
    input,
    h(
      "div",
      { class: "actions" },
      button("キャンセル", () => d.close()),
      button(
        "保存",
        async () => {
          const name = input.value.trim();
          if (!name) {
            input.focus();
            return;
          }
          if (
            await change((s) => {
              if (book) s.books.find((b) => b.id === book.id).name = name;
              else
                s.books.push({
                  id: uid(),
                  name,
                  created_at: new Date().toISOString(),
                });
            })
          )
            d.close();
        },
        "primary",
      ),
    ),
  );
  if (book)
    d.append(
      button(
        "単語帳を削除",
        async () => {
          d.close();
          if (
            await confirmAction(
              "この単語帳と所属関係を削除します。ことば本体・習得状態・★は残り、全単語一覧で見られます。",
            )
          )
            await change((s) => {
              s.books = s.books.filter((b) => b.id !== book.id);
              s.memberships = s.memberships.filter((m) => m.bookId !== book.id);
              s.sessions = s.sessions.filter((x) => x.scope !== book.id);
              if (listScope === book.id) listScope = "all";
            });
        },
        "danger",
      ),
    );
  document.body.append(d);
  d.addEventListener("close", () => d.remove(), { once: true });
  d.showModal();
  input.focus();
}
function study(scope) {
  if (
    !["all", "star"].includes(scope) &&
    !state.books.some((b) => b.id === scope)
  ) {
    app.append(p("この単語帳はありません。"), link("書房へ", "#home"));
    return;
  }
  app.className = "study";
  // Rendering must not add an unsaved session to the persistence baseline.
  const session = getSession(
      { ...state, sessions: state.sessions.map((x) => ({ ...x })) },
      scope,
    ),
    entries = studyEntries(state, scope),
    all = orderedEntries(state, scope),
    e = entries.find((e) => e.id === session.currentId);
  app.append(
    h(
      "div",
      { class: "study-heading" },
      h("h1", {}, scopeName(scope)),
      h(
        "div",
        { class: "study-back-actions" },
        musicResumeButton(),
        link("戻る", "#home", "button subtle compact"),
      ),
    ),
  );
  const undoButton = button(
    "元に戻す",
    async () => {
      const snapshot = masterUndo;
      if (!snapshot || snapshot.scope !== scope) return;
      if (
        await change((s) => undoMaster(s, snapshot), { renderAfter: false })
      ) {
        masterUndo = null;
        render();
      }
    },
    "subtle compact undo-master",
    {
      disabled: !masterUndo || masterUndo.scope !== scope,
      "aria-label": "覚えた操作を元に戻す",
    },
  );
  if (!e) {
    const finished = all.length > 0;
    app.append(
      h(
        "div",
        { class: "clear" },
        h(
          "div",
          { class: "clear-sparks", "aria-hidden": "true" },
          ...Array.from({ length: 5 }, (_, i) =>
            h("i", { style: `--i:${i}` }, "✧"),
          ),
        ),
        h(
          "div",
          { class: "moon", "aria-hidden": "true" },
          finished ? "☾" : "✧",
        ),
        h(
          "h1",
          {},
          finished
            ? "すべてのことばに、月の栞。"
            : "まだ、ことばがありません。",
        ),
        p(
          finished
            ? "全語習得しました。おつかれさまでした。"
            : "ことばを追加して、学習を始めましょう。",
        ),
        undoButton,
        link("書房に戻る", "#home", "button primary"),
        finished
          ? button("一覧で未習得に戻す", () => {
              listScope = scope;
              filter = "mastered";
              location.hash = "#list";
            })
          : link("ことばを追加", "#add"),
      ),
    );
    return;
  }
  const position = entries.findIndex((x) => x.id === e.id);
  const positionText = h(
    "output",
    { id: "study-position" },
    `${position + 1} / ${entries.length}`,
  );
  const slider = h("input", {
    type: "range",
    min: 1,
    max: entries.length,
    step: 1,
    value: position + 1,
    "aria-label": "カードの位置",
    "aria-describedby": "study-position",
    disabled: entries.length === 1,
    onInput: (ev) => {
      positionText.textContent = `${ev.target.value} / ${entries.length}`;
    },
    onChange: async (ev) => {
      if (
        !(await change((s) => seekStudy(s, scope, Number(ev.target.value) - 1)))
      )
        render();
    },
  });
  app.append(
    h(
      "section",
      { class: "study-progress", "aria-label": "学習進捗" },
      h(
        "div",
        { class: "stats" },
        positionText,
        h(
          "span",
          {},
          ` · ${session.round} 周目 ${scope === "star" ? " · 習得済みも出題" : ""}`,
        ),
      ),
      h(
        "div",
        { class: "position-controls" },
        button(
          "«",
          () => change((s) => seekStudy(s, scope, 0)),
          "subtle compact",
          { "aria-label": "最初へ", title: "最初へ" },
        ),
        slider,
        button(
          "»",
          () => change((s) => seekStudy(s, scope, entries.length - 1)),
          "subtle compact",
          { "aria-label": "最後へ", title: "最後へ" },
        ),
      ),
      progress(all.filter((x) => x.mastered).length, all.length),
    ),
  );
  const direction = h(
    "select",
    { class: "direction", "aria-label": "出題方向" },
    h("option", { value: "zh-ja" }, "中国語 → 日本語"),
    h("option", { value: "ja-zh" }, "日本語 → 中国語"),
  );
  direction.value = state.settings.direction;
  direction.onchange = () =>
    change((s) => {
      s.settings.direction = direction.value;
      getSession(s, scope).back = false;
    });
  app.append(h("div", { class: "study-options" }, direction, undoButton));
  app.append(
    h(
      "div",
      { class: "card-tools" },
      p("☆ 苦手　✓ 覚えた", "icon-guide"),
      button(
        e.starred ? "★" : "☆",
        async () => {
          audio.play("star", state.settings);
          await change((s) => {
            const item = s.entries.find((x) => x.id === e.id);
            item.starred = !item.starred;
            item.updated_at = new Date().toISOString();
          });
        },
        "star icon-button" + (e.starred ? " active" : ""),
        {
          "aria-label": "★ 苦手",
          "aria-pressed": String(e.starred),
          title: "苦手の登録・解除",
        },
      ),
      button("✓", () => next(true), "icon-button master-button", {
        "aria-label": "覚えた！",
        title: "覚えた！ 次のカードへ",
      }),
    ),
  );

  const chinese =
    state.settings.direction === "zh-ja" ? !session.back : session.back;
  const card = h(
    "div",
    {
      class: "flashcard",
      role: "button",
      tabindex: 0,
      "aria-label": "カードを裏返す",
      "aria-description":
        "タップで裏返す。左スワイプか左矢印キーで次、右スワイプか右矢印キーで前。長押しで文字を選択。",
      "aria-pressed": String(session.back),
    },
    h(
      "div",
      { class: "card-text" },
      h(
        "div",
        { class: "face-label" },
        session.back ? "ANSWER · 答え" : "QUESTION · ことば",
      ),
      chinese ? Chinese(e) : h("div", { class: "meaning" }, e.meaning),
    ),
  );
  const flip = async () => {
    if (window.getSelection()?.toString()) return;
    audio.play("flip", state.settings);
    if (
      await change((s) => {
        getSession(s, scope).back = !session.back;
      })
    ) {
      document.querySelector(".flashcard")?.classList.add("flipping");
    }
  };
  const move = async (direction) => {
    if (busy) return;
    if (await change((s) => moveStudy(s, scope, direction))) {
      audio.play("next", state.settings);
      if (entries.length > 1)
        document
          .querySelector(".flashcard")
          ?.classList.add(direction === 1 ? "swipe-next" : "swipe-previous");
    }
  };
  bindCardGestures(card, { flip, move, blocked: () => busy });
  if (!swipeHintShown) {
    swipeHintShown = true;
    try {
      if (!localStorage.getItem("gekka-shobo-swipe-hint-v1")) {
        toast("左右にスワイプしてカードを移動できます");
        localStorage.setItem("gekka-shobo-swipe-hint-v1", "1");
      }
    } catch {
      toast("左右にスワイプしてカードを移動できます");
    }
  }
  app.append(
    card,
    p(
      "← 次のカード · 前のカード →　タップで裏返す · 長押しで文字を選択",
      "flip-hint",
    ),
    h(
      "div",
      { class: "actions study-actions" },
      button("詳細を見る", () => goDetail(e.id)),
    ),
  );
  async function next(master) {
    audio.play(master ? "master" : "next", state.settings);
    const snapshot = master ? captureMasterUndo(state, scope) : null;
    if (
      await change((s) => advance(s, scope, master), { renderAfter: false })
    ) {
      if (master) masterUndo = snapshot;
      render();
      if (!studyEntries(state, scope).length && master)
        setTimeout(() => audio.play("clear", state.settings), 280);
      else if (master) {
        const el = document.querySelector(".flashcard");
        if (el) {
          const sparks = h(
            "div",
            { class: "sparks", "aria-hidden": "true" },
            ...Array.from({ length: 5 }, (_, i) =>
              h("i", { style: `--i:${i}` }, "✧"),
            ),
          );
          el.append(sparks);
          setTimeout(() => sparks.remove(), 600);
        }
      }
    }
  }
}
function detail(id) {
  const e = state.entries.find((x) => x.id === id);
  if (!e) {
    app.append(p("このことばはありません。"), link("一覧へ", "#list"));
    return;
  }
  app.append(
    link("← 元の画面へ", returnHash, "back"),
    h(
      "section",
      { class: "detail-header" },
      ...Chinese(e),
      h("div", { class: "meaning" }, e.meaning),
      e.part_of_speech ? p(e.part_of_speech, "badge") : null,
    ),
  );
  app.append(
    h(
      "div",
      { class: "tabs" },
      ...Object.entries({
        examples: "例文",
        usage: "使い方",
        other: "その他",
      }).map(([key, text]) =>
        button(
          text,
          () => {
            detailTab = key;
            render();
          },
          detailTab === key ? "active" : "",
          { "aria-pressed": String(detailTab === key) },
        ),
      ),
    ),
  );
  const body = h("section", { class: "detail-body" });
  app.append(body);
  if (detailTab === "examples") {
    if (!e.examples.length)
      body.append(p("例文はまだ登録されていません。", "muted"));
    e.examples.forEach((x, i) =>
      body.append(
        h(
          "article",
          { class: "example" },
          p(`例文 ${i + 1}`, "eyebrow"),
          x.chinese
            ? h("p", { class: "chinese", lang: "zh-Hant" }, x.chinese)
            : null,
          x.pinyin ? h("p", { class: "pinyin" }, x.pinyin) : null,
          x.translation ? p(x.translation) : null,
        ),
      ),
    );
  } else {
    const keys =
      detailTab === "usage"
        ? ["usage", "grammar_notes", "measure_word"]
        : [
            "part_of_speech",
            "nuance",
            "register",
            "synonyms",
            "synonym_differences",
            "regional_usage",
            "regional_alternatives",
            "etymology",
            "notes",
          ];
    let count = 0;
    for (const key of keys)
      if (e[key]) {
        body.append(h("h3", {}, titles[key]), p(e[key]));
        count++;
      }
    if (!count)
      body.append(
        p(
          "情報はまだ登録されていません。地域差は未入力の場合、情報なしとして扱います。",
          "muted",
        ),
      );
  }
  app.append(
    button("このことばを編集", () => {
      editing = e.id;
      addMode = "manual";
      location.hash = "#add";
    }),
  );
}
function list() {
  app.append(h("h1", {}, "ことばの目録"));
  const scope = bookSelect("listScope", listScope);
  scope.firstElementChild.textContent = "全単語帳を横断";
  scope.firstElementChild.value = "all";
  scope.value = listScope;
  scope.onchange = () => {
    listScope = scope.value;
    page = 0;
    render();
  };
  const query = h("input", {
    type: "search",
    placeholder: "繁体字・簡体字・日本語で検索",
    value: search,
    "aria-label": "単語検索",
  });
  let timer;
  query.oninput = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      search = query.value;
      page = 0;
      renderListResults();
    }, 150);
  };
  const f = h(
    "select",
    { "aria-label": "状態フィルタ" },
    ...Object.entries({
      all: "すべて",
      unmastered: "未習得",
      mastered: "習得済み",
      star: "★ 苦手",
    }).map(([k, v]) => h("option", { value: k }, v)),
  );
  f.value = filter;
  f.onchange = () => {
    filter = f.value;
    page = 0;
    renderListResults();
  };
  app.append(
    scope,
    h("label", {}, "検索"),
    query,
    h("label", {}, "表示することば"),
    f,
    h("section", { id: "list-results" }),
  );
  renderListResults();
}
function renderListResults() {
  const area = document.querySelector("#list-results");
  if (!area) return;
  area.replaceChildren();
  const q = search.normalize("NFKC").toLocaleLowerCase();
  const rows = orderedEntries(state, listScope).filter(
    (e) =>
      (filter === "all" ||
        (filter === "unmastered" && !e.mastered) ||
        (filter === "mastered" && e.mastered) ||
        (filter === "star" && e.starred)) &&
      (!q ||
        [e.traditional, e.simplified, e.meaning].some((x) =>
          x.normalize("NFKC").toLocaleLowerCase().includes(q),
        )),
  );
  const size = 30;
  page = Math.min(page, Math.max(0, Math.ceil(rows.length / size) - 1));
  area.append(p(`${rows.length} 語`, "stats"));
  if (!rows.length) area.append(p("該当することばはありません。", "empty"));
  for (const e of rows.slice(page * size, (page + 1) * size)) {
    const books = state.memberships
      .filter((m) => m.entryId === e.id)
      .map((m) => state.books.find((b) => b.id === m.bookId)?.name)
      .filter(Boolean);
    area.append(
      h(
        "article",
        { class: "entry" },
        h("h3", { lang: "zh-Hant" }, e.traditional),
        h("div", { class: "simplified", lang: "zh-Hans" }, e.simplified),
        p(e.pinyin || "拼音未入力", "pinyin"),
        p(e.meaning),
        p(
          `${e.mastered ? "習得済み" : "未習得"} · ${books.join(" / ") || "単語帳なし"}`,
          "entry-meta",
        ),
        h(
          "div",
          { class: "actions" },
          button("詳細", () => goDetail(e.id)),
          button(
            e.starred ? "★" : "☆",
            () =>
              change((s) => {
                s.entries.find((x) => x.id === e.id).starred = !e.starred;
              }),
            "star" + (e.starred ? " active" : ""),
            { "aria-label": "苦手フラグ", "aria-pressed": String(e.starred) },
          ),
          button(e.mastered ? "未習得に戻す" : "習得済みにする", () =>
            change((s) => {
              s.entries.find((x) => x.id === e.id).mastered = !e.mastered;
              s.entries.find((x) => x.id === e.id).updated_at =
                new Date().toISOString();
            }),
          ),
        ),
        h(
          "div",
          { class: "actions" },
          button("編集", () => {
            editing = e.id;
            addMode = "manual";
            location.hash = "#add";
          }),
          button("所属・移動", () => membershipEditor(e)),
          button("完全削除", () => deleteEntry(e), "danger"),
        ),
      ),
    );
  }
  if (rows.length > size)
    area.append(
      h(
        "div",
        { class: "actions pagination" },
        button(
          "前のページ",
          () => {
            page--;
            renderListResults();
          },
          "",
          { disabled: page === 0 },
        ),
        p(`${page + 1} / ${Math.ceil(rows.length / size)}`, "stats"),
        button(
          "次のページ",
          () => {
            page++;
            renderListResults();
          },
          "",
          { disabled: (page + 1) * size >= rows.length },
        ),
      ),
    );
}
async function deleteEntry(e) {
  if (
    await confirmAction(
      `「${e.traditional}」をすべての単語帳から完全削除します。元に戻せません。所属だけを外す場合は「所属・移動」を使ってください。`,
    )
  )
    await change((s) => {
      s.entries = s.entries.filter((x) => x.id !== e.id);
      s.memberships = s.memberships.filter((m) => m.entryId !== e.id);
      for (const x of s.sessions)
        if (x.currentId === e.id) {
          x.currentId = null;
          x.back = false;
        }
    });
}
function membershipEditor(e) {
  const d = h(
    "dialog",
    {},
    h("h2", {}, "所属する単語帳"),
    p(
      "複数を選ぶと同じことばを共有します。移動は元のチェックを外して移動先を選択。すべて外してもことば本体は残ります。",
      "form-note",
    ),
  );
  const boxes = state.books.map((b) => {
    const checkbox = h("input", {
      type: "checkbox",
      value: b.id,
      checked: state.memberships.some(
        (m) => m.entryId === e.id && m.bookId === b.id,
      ),
    });
    d.append(h("label", { class: "check" }, checkbox, b.name));
    return checkbox;
  });
  if (!boxes.length) d.append(p("まず書房で単語帳を作成してください。"));
  d.append(
    h(
      "div",
      { class: "actions" },
      button("キャンセル", () => d.close()),
      button(
        "保存",
        async () => {
          const ids = boxes.filter((x) => x.checked).map((x) => x.value);
          if (
            await change((s) => {
              s.memberships = s.memberships.filter(
                (m) => m.entryId !== e.id || ids.includes(m.bookId),
              );
              ids.forEach((id) => addMembership(s, e.id, id));
            })
          )
            d.close();
        },
        "primary",
      ),
    ),
  );
  document.body.append(d);
  d.addEventListener("close", () => d.remove(), { once: true });
  d.showModal();
}
function add(scope = "") {
  const original = state.entries.find((e) => e.id === editing);
  app.append(
    h("h1", {}, original ? "ことばを編集" : "ことばを迎える"),
    p("一語でも、ひとつの表現でも。あなたの書房に。", "form-note"),
  );
  if (!original)
    app.append(
      h(
        "div",
        { class: "tabs" },
        ...Object.entries({ manual: "手動", text: "テキスト", csv: "CSV" }).map(
          ([k, v]) =>
            button(
              v,
              () => {
                addMode = k;
                preview = null;
                render();
              },
              k === addMode ? "active" : "",
            ),
        ),
      ),
    );
  if (original || addMode === "manual") manualForm(original, scope);
  else importForm(scope);
}
function invalidatePreview() {
  preview = null;
  document.querySelector("#import-preview")?.remove();
}
function manualForm(original, scope) {
  const form = h("form", {}),
    e = original || manualDraft || makeEntry({}),
    exampleArea = h("div", { id: "example-fields" });
  form.append(
    inputField(titles.traditional, "traditional", e.traditional, false, true),
    inputField(
      titles.simplified + "（同じでも保存）",
      "simplified",
      e.simplified,
    ),
    inputField(titles.pinyin, "pinyin", e.pinyin),
    inputField(titles.meaning, "meaning", e.meaning, true, true),
  );
  const trad = form.querySelector("[name=traditional]"),
    simp = form.querySelector("[name=simplified]");
  let auto = !original && e.simplified === e.traditional;
  let previous = trad.value;
  simp.oninput = () => {
    auto = false;
  };
  trad.oninput = () => {
    if (auto || simp.value === previous) {
      simp.value = trad.value;
      auto = true;
    }
    previous = trad.value;
  };
  const type = h(
    "select",
    { name: "entry_type" },
    h("option", { value: "word" }, "単語"),
    h("option", { value: "chunk" }, "チャンク"),
    h("option", { value: "grammar" }, "文法"),
  );
  type.value = e.entry_type;
  form.append(
    h("label", {}, "種類"),
    type,
    inputField(titles.part_of_speech, "part_of_speech", e.part_of_speech),
  );
  if (!original)
    form.append(
      h("label", {}, "追加先の単語帳"),
      bookSelect("bookId", scope || state.books[0]?.id || ""),
    );
  form.append(
    h("h2", {}, "例文"),
    exampleArea,
    button("＋ 例文を追加", () => {
      invalidatePreview();
      addExampleFields(exampleArea);
    }),
  );
  e.examples.forEach((x) => addExampleFields(exampleArea, x));
  const more = h(
    "details",
    {},
    h("summary", {}, "使い方・ニュアンス・その他の項目"),
  );
  for (const key of textFields.filter(
    (k) =>
      ![
        "traditional",
        "simplified",
        "pinyin",
        "meaning",
        "part_of_speech",
      ].includes(k),
  ))
    more.append(inputField(titles[key], key, e[key], true));
  form.append(
    more,
    p(
      "簡体字が空欄の場合は繁体字と同じ文字列を保存します。自動変換・拼音生成は行いません。",
      "form-note",
    ),
    h(
      "div",
      { class: "actions" },
      button("キャンセル", () => {
        editing = null;
        location.hash = "#list";
      }),
      h(
        "button",
        { type: "submit", class: "primary" },
        original ? "変更を保存" : "登録前に確認",
      ),
    ),
  );
  form.onsubmit = async (ev) => {
    ev.preventDefault();
    const input = Object.fromEntries(new FormData(form));
    input.examples = [...exampleArea.children].map((el) =>
      Object.fromEntries(
        [...el.querySelectorAll("textarea,input")].map((x) => [
          x.dataset.field,
          x.value,
        ]),
      ),
    );
    const fresh = makeEntry(input);
    if (original) {
      if (
        await change((s) => {
          const item = s.entries.find((x) => x.id === original.id);
          Object.assign(item, fresh, {
            id: item.id,
            created_at: item.created_at,
            mastered: item.mastered,
            starred: item.starred,
          });
        })
      ) {
        editing = null;
        toast("変更を保存しました");
        location.hash = "#list";
      }
    } else {
      manualDraft = fresh;
      preview = {
        rows: classifyImport([{ entry: fresh }], state),
        bookId: input.bookId || "",
        source: "manual",
      };
      render();
    }
  };
  form.addEventListener("input", invalidatePreview);
  app.append(form);
  if (preview && !original) showImportPreview();
}
function addExampleFields(
  area,
  example = { chinese: "", pinyin: "", translation: "" },
) {
  const block = h("section", { class: "example" }, h("h3", {}, "例文"));
  for (const [key, label] of Object.entries({
    chinese: "中国語（繁体字）",
    pinyin: "例文の拼音（任意）",
    translation: "日本語訳",
  })) {
    const el = h(key === "pinyin" ? "input" : "textarea", {
      "data-field": key,
      value: example[key] || "",
      "aria-label": label,
    });
    block.append(h("label", {}, label), el);
  }
  block.append(
    button(
      "この例文を削除",
      () => {
        invalidatePreview();
        block.remove();
      },
      "subtle",
    ),
  );
  area.append(block);
}
function importForm(scope) {
  const form = h("form", {});
  form.append(
    h("label", {}, "追加先の単語帳"),
    bookSelect("bookId", scope || state.books[0]?.id || ""),
  );
  const text = h("textarea", {
    name: "text",
    rows: 10,
    value: preview?.rawText || "",
    "aria-label": "読み込むテキスト",
    placeholder:
      addMode === "csv"
        ? "traditional,meaning\n口感,食感"
        : "繁体字: 口感\n簡体字: 口感\n拼音: kǒu gǎn\n意味: 食感",
  });
  if (addMode === "csv") {
    const file = h("input", {
      type: "file",
      accept: ".csv,text/csv",
      "aria-label": "CSVファイル選択",
    });
    file.onchange = async () => {
      try {
        if (file.files[0]) {
          invalidatePreview();
          text.value = await file.files[0].text();
        }
      } catch {
        toast("ファイルを読み込めませんでした");
      }
    };
    form.append(
      h("label", {}, "UTF-8 CSVファイル（または下に貼り付け）"),
      file,
    );
  }
  form.append(
    h("label", {}, addMode === "csv" ? "CSVテキスト" : "ラベル付きテキスト"),
    text,
    p(
      addMode === "csv"
        ? "traditional と meaning の列が必須です。例文は任意の番号まで読み込めます。"
        : "複数のことばは --- または — だけの行で区切ります。例文1・例文拼音1・訳1 を使えます。",
      "form-note",
    ),
    h("button", { type: "submit", class: "primary" }, "読み込んでプレビュー"),
  );
  form.onsubmit = (ev) => {
    ev.preventDefault();
    try {
      const records =
        addMode === "csv" ? csvRecords(text.value) : textRecords(text.value);
      if (!records.length) throw new Error("登録することばがありません");
      preview = {
        rows: classifyImport(records, state),
        bookId: form.elements.bookId.value,
        source: addMode,
        rawText: text.value,
      };
      render();
    } catch (e) {
      invalidatePreview();
      toast(e.message);
    }
  };
  form.addEventListener("input", invalidatePreview);
  app.append(form);
  if (preview) showImportPreview();
}
function showImportPreview() {
  const { rows, bookId } = preview,
    counts = { new: 0, duplicate: 0, error: 0, review: 0 };
  rows.forEach((x) => counts[x.status]++);
  const panel = h(
    "section",
    { class: "panel", id: "import-preview" },
    h("h2", {}, "登録前プレビュー"),
    p(
      `新規 ${counts.new} ／ 重複 ${counts.duplicate} ／ エラー ${counts.error} ／ 要確認 ${counts.review}`,
    ),
    p("追加先：" + (bookId ? scopeName(bookId) : "単語帳なし"), "stats"),
    p(
      "エラー行は登録しません。重複の「スキップ」は内容を上書きせず、追加先への所属だけを追加します。",
      "form-note",
    ),
  );
  const policy = h(
    "select",
    { "aria-label": "重複処理" },
    h("option", { value: "skip" }, "重複をスキップ（所属は追加）"),
    h("option", { value: "update" }, "重複の既存データを更新"),
    h("option", { value: "cancel" }, "すべてキャンセル"),
  );
  const distinct = h("input", { type: "checkbox" });
  panel.append(
    h("label", {}, "重複時の処理"),
    policy,
    counts.review
      ? h(
          "label",
          { class: "check" },
          distinct,
          "要確認の語を別エントリとして登録する",
        )
      : null,
  );
  const list = h("div", { class: "preview-list" });
  for (const row of rows)
    list.append(
      h(
        "div",
        { class: "preview-row" },
        h(
          "strong",
          {},
          `${row.index}. ${row.entry.traditional || "（繁体字なし）"} · ${row.entry.meaning || "（意味なし）"}`,
        ),
        p(
          `${row.entry.simplified} / ${row.entry.pinyin || "拼音未入力"} / 例文 ${row.entry.examples.length}`,
          "stats",
        ),
        p(
          {
            new: "新規登録",
            duplicate: "既存語と重複",
            error: "登録できません",
            review: "要確認：別の意味・拼音",
          }[row.status],
          "badge",
        ),
        ...row.errors.map((x) => p(x, "error")),
        ...row.warnings.map((x) => p(x, "warning")),
      ),
    );
  panel.append(
    list,
    h(
      "div",
      { class: "actions" },
      button("プレビューを閉じる", () => {
        preview = null;
        render();
      }),
      button(
        "確認して登録",
        async () => {
          if (policy.value === "cancel") {
            preview = null;
            render();
            toast("登録をキャンセルしました");
            return;
          }
          const valid = rows.filter(
            (x) =>
              x.status !== "error" &&
              (x.status !== "review" || distinct.checked),
          );
          if (!valid.length) {
            toast(
              "登録可能な行がありません。要確認のチェックや入力を確認してください",
            );
            return;
          }
          if (
            !(await confirmAction(
              `${valid.length} 件を処理します。${policy.value === "update" ? "一致する既存語の内容を更新します（ID・習得・★・所属は維持）。" : "既存語の内容は上書きしません。"} エラー行と未確認の行は除外します。`,
            ))
          )
            return;
          let result;
          if (
            await change(
              (s) => {
                result = applyImport(
                  s,
                  rows,
                  bookId,
                  policy.value,
                  distinct.checked,
                );
              },
              { renderAfter: false },
            )
          ) {
            preview = null;
            editing = null;
            manualDraft = null;
            toast(
              `新規 ${result.added} ／ 更新 ${result.updated} ／ 所属追加 ${result.linked}`,
            );
            listScope = bookId || "all";
            search = "";
            filter = "all";
            page = 0;
            location.hash = "#list";
            render();
          }
        },
        "primary",
      ),
    ),
  );
  app.append(panel);
}
function download(text, name, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = h("a", { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
function musicResumeButton() {
  return button(
    "♫",
    () => audio.startMusic(state.settings),
    "music-resume subtle compact",
    {
      "data-music-resume": "",
      "aria-label": "BGMを再開",
      title: "BGMを再開",
    },
  );
}
function updateMusicStatus() {
  const status = audio.musicStatus;
  const retry =
    state?.settings.bgm &&
    audio.musicAvailable &&
    ["paused", "blocked", "error"].includes(status);
  for (const el of document.querySelectorAll("[data-music-resume]"))
    el.hidden = !retry;
  const statusEl = document.querySelector("#music-status");
  if (statusEl)
    statusEl.textContent = {
      playing: "BGMを再生中です。",
      paused: "再生ボタンで、続きから再開できます。",
      blocked: "再生が許可されていません。再生ボタンを押してください。",
      loading: "音楽を読み込んでいます…",
      error: "BGMを読み込めませんでした。オンラインで再試行してください。",
      off: "BGMはOFFです。",
      unavailable: "BGM音源は準備中です。",
    }[status];
  const retryEl = document.querySelector("#music-retry");
  if (retryEl) retryEl.hidden = !retry;
}
audio.onMusicStatus = updateMusicStatus;
function musicSettings() {
  app.append(h("h2", {}, "静かな書房の旋律"));
  const toggle = h("input", {
    type: "checkbox",
    checked: state.settings.bgm,
    disabled: !audio.musicAvailable,
  });
  toggle.onchange = async () => {
    const enabled = toggle.checked;
    // Safari needs play/resume in the original user gesture, before DB save.
    const started = audio.startMusic({ ...state.settings, bgm: enabled });
    if (
      !(await change((s) => {
        s.settings.bgm = enabled;
      }))
    )
      audio.applyPreferences(state.settings);
    await started;
    updateMusicStatus();
  };
  app.append(h("label", { class: "check" }, toggle, "BGMを有効にする"));
  const output = h(
    "output",
    {},
    `${Math.round(state.settings.bgmVolume * 100)}%`,
  );
  const volume = h("input", {
    type: "range",
    min: 0,
    max: 100,
    step: 1,
    value: Math.round(state.settings.bgmVolume * 100),
    "aria-label": "BGMの音量",
  });
  volume.oninput = () => {
    output.textContent = `${volume.value}%`;
    audio.setMusicVolume(Number(volume.value) / 100);
  };
  volume.onchange = async () => {
    if (
      !(await change((s) => {
        s.settings.bgmVolume = Number(volume.value) / 100;
      }))
    )
      audio.setMusicVolume(state.settings.bgmVolume);
  };
  const retry = button(
    "BGMを再生",
    () => audio.startMusic(state.settings),
    "primary",
    { id: "music-retry" },
  );
  app.append(
    h("label", {}, "BGM音量 ", output),
    volume,
    h(
      "div",
      { class: "music-notice" },
      h("p", { id: "music-status", role: "status" }),
      retry,
    ),
    p(
      "初期設定はOFF・音量15%。画面を切り替えても続きから流れます。背景に移ると一時停止し、♫ボタンで再開できます。",
      "form-note",
    ),
  );
}
function settings() {
  app.className = "settings";
  app.append(h("h1", {}, "書房の設定"));
  musicSettings();
  app.append(h("h2", {}, "小さな音のしるし"));
  const sound = h("input", { type: "checkbox", checked: state.settings.sound });
  sound.onchange = async () => {
    if (sound.checked) audio.unlock();
    if (
      await change((s) => {
        s.settings.sound = sound.checked;
      })
    )
      audio.play("star", state.settings);
  };
  app.append(h("label", { class: "check" }, sound, "効果音を有効にする"));
  const volume = h("input", {
    type: "range",
    min: 0,
    max: 100,
    step: 1,
    value: Math.round(state.settings.volume * 100),
    "aria-label": "効果音の音量",
  });
  const output = h("output", {}, `${volume.value}%`);
  volume.oninput = () => {
    output.textContent = `${volume.value}%`;
  };
  volume.onchange = async () => {
    audio.unlock();
    if (
      await change((s) => {
        s.settings.volume = Number(volume.value) / 100;
      })
    )
      audio.play("star", state.settings);
  };
  app.append(
    h("label", {}, "音量 ", output),
    volume,
    button("音を試す", () => audio.play("master", state.settings)),
    h("h2", {}, "ことばを守る"),
    h(
      "div",
      { class: "notice" },
      "データはこの端末のブラウザに保存されます。端末変更・Safariのデータ削除などで消えることがあります。Safariとホーム画面アプリで保存場所が異なる場合もあります。完全JSONバックアップを定期的に保存してください。",
    ),
    h(
      "div",
      { class: "actions" },
      button(
        "完全JSONバックアップ",
        () =>
          download(
            JSON.stringify(
              { ...state, exported_at: new Date().toISOString() },
              null,
              2,
            ),
            "gekka-shobo-backup-" +
              new Date().toISOString().slice(0, 10) +
              ".json",
            "application/json",
          ),
        "primary",
      ),
      button("全語CSVを書き出す", () =>
        download(
          exportCSV(state.entries),
          "gekka-shobo-words.csv",
          "text/csv;charset=utf-8",
        ),
      ),
    ),
    p(
      "CSVは学習内容のみ。単語帳・習得・★・設定の復元にはJSONを使います。",
      "form-note",
    ),
  );
  const file = h("input", {
    type: "file",
    accept: ".json,application/json",
    "aria-label": "JSONバックアップを選択",
  });
  file.onchange = async () => {
    try {
      if (!file.files[0]) return;
      backupPreview = validateBackup(JSON.parse(await file.files[0].text()));
      render();
    } catch (e) {
      backupPreview = null;
      render();
      toast("復元できません：" + e.message);
    }
  };
  app.append(
    h("h2", {}, "JSONから復元"),
    p(
      "復元方式：全置換。現在のデータをすべて置き換えます。先に現在のJSONを保存してください。",
      "warning",
    ),
    file,
  );
  if (backupPreview) {
    app.append(
      h(
        "div",
        { class: "panel" },
        h("h3", {}, "復元前プレビュー"),
        p(
          `現在：${state.entries.length} 語・${state.books.length} 単語帳 → 復元後：${backupPreview.entries.length} 語・${backupPreview.books.length} 単語帳`,
        ),
        p(
          `所属 ${backupPreview.memberships.length} ／ 習得 ${backupPreview.entries.filter((e) => e.mastered).length} ／ ★ ${backupPreview.entries.filter((e) => e.starred).length} ／ 学習位置 ${backupPreview.sessions.length}`,
          "stats",
        ),
        p("習得状態・★・学習位置・設定もすべて置き換えます。", "warning"),
        h(
          "div",
          { class: "actions" },
          button("キャンセル", () => {
            backupPreview = null;
            render();
          }),
          button(
            "全置換で復元",
            async () => {
              if (
                await confirmAction(
                  "現在の全データをこのバックアップで置き換えます。元に戻せません。現在のバックアップを保存しましたか？",
                  "復元の最終確認",
                )
              ) {
                const safe = backupPreview;
                if (
                  await change(
                    (s) => {
                      for (const key of Object.keys(safe)) s[key] = safe[key];
                    },
                    { renderAfter: false },
                  )
                ) {
                  backupPreview = null;
                  listScope = "all";
                  masterUndo = null;
                  toast("バックアップを復元しました");
                  render();
                }
              }
            },
            "danger",
          ),
        ),
      ),
    );
  }
  app.append(
    h("h2", {}, "オフラインと更新"),
    p(
      "一度オンラインで開いてキャッシュが保存されると、オフラインで使用できます。更新で単語データは削除しません。",
      "form-note",
    ),
    button("更新を確認", async () => {
      const r = await navigator.serviceWorker?.getRegistration();
      if (r) {
        await r.update();
        toast(
          r.waiting
            ? "新しい版があります。下の更新ボタンを使ってください。"
            : "更新を確認しました",
        );
      } else
        toast(
          "Service Workerは未登録です。HTTPSまたは開発サーバーで開いてください。",
        );
    }),
    pendingUpdate
      ? button(
          "新しい版に更新",
          async () => {
            if (
              await confirmAction(
                "新しい版へ切り替え、画面を再読み込みします。保存中でないことを確認してください。",
              )
            )
              pendingUpdate.postMessage({ type: "SKIP_WAITING" });
          },
          "primary",
        )
      : null,
    h("h2", {}, "iPhoneで使う"),
    p(
      "Safariの共有メニュー →「ホーム画面に追加」。最初にオンラインで起動し、機内モードでも開けることを確認してください。",
      "form-note",
    ),
    h("h2", {}, "保存領域"),
    button("データの保持をリクエスト", async () => {
      const ok = await navigator.storage?.persist?.();
      toast(
        ok
          ? "ブラウザがデータの保持を許可しました。バックアップも続けてください。"
          : "保持は保証されません。JSONバックアップをご利用ください。",
      );
    }),
  );
}
function render() {
  if (!state) return;
  app.replaceChildren();
  app.className = "";
  const [route, arg] = location.hash.replace(/^#/, "").split("/");
  document.body.classList.toggle("is-study", route === "study");
  document.querySelectorAll(".bottom-nav a").forEach((a) => {
    if (a.hash === "#" + (route || "home"))
      a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
  if (route === "study") study(arg || "all");
  else if (route === "detail") detail(arg);
  else if (route === "list") list();
  else if (route === "add") add(arg);
  else if (route === "settings") settings();
  else home();
  const screen = `${route || "home"}/${arg || ""}`;
  if (screen !== lastScreen) app.classList.add("screen-enter");
  lastScreen = screen;
  updateMusicStatus();
}
window.addEventListener("hashchange", () => {
  render();
  window.scrollTo(0, 0);
  app.focus({ preventScroll: true });
});
async function registerSW() {
  if (!("serviceWorker" in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.register("./sw.js");
    const waiting = () => {
      if (reg.waiting) {
        pendingUpdate = reg.waiting;
        toast("新しい版があります。設定から更新できます。");
        if (location.hash === "#settings") render();
      }
    };
    waiting();
    reg.addEventListener("updatefound", () => {
      reg.installing?.addEventListener("statechange", waiting);
    });
    let refreshing = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (!refreshing) {
        refreshing = true;
        location.reload();
      }
    });
  } catch (e) {
    toast(
      "オフライン機能を準備できませんでした。オンラインで再度開いてください。",
    );
    console.error(e);
  }
}
// Serialize browser tabs so a stale tab cannot overwrite changes from another tab.
let lockRelease;
async function boot() {
  try {
    if (navigator.locks) {
      await new Promise((resolve, reject) => {
        navigator.locks
          .request(
            "gekka-shobo-editor",
            { ifAvailable: true },
            async (lock) => {
              if (!lock) {
                reject(
                  new Error(
                    "月華書房は別のタブで開いています。別のタブを閉じて再読み込みしてください。",
                  ),
                );
                return;
              }
              resolve();
              await new Promise((r) => (lockRelease = r));
            },
          )
          .catch(reject);
      });
    }
    state = await loadState();
    audio.applyPreferences(state.settings);
    document.querySelector(".masthead").append(musicResumeButton());
    render();
    await registerSW();
  } catch (e) {
    app.replaceChildren(
      h("h1", {}, "書房を開けませんでした"),
      p(e.message),
      p(
        "保存データは削除していません。別のタブ、ブラウザの保存設定・空き容量を確認して再読み込みしてください。",
      ),
      button("再読み込み", () => location.reload()),
    );
  }
}
boot();
