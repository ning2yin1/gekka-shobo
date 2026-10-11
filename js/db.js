import { emptyState, validateBackup } from "./model.js";
const NAME = "gekka-shobo",
  VERSION = 1,
  STORES = ["entries", "books", "memberships", "sessions", "settings"];
let db;
export function openDB() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(NAME, VERSION);
    r.onupgradeneeded = () => {
      const d = r.result;
      for (const name of STORES)
        if (!d.objectStoreNames.contains(name))
          d.createObjectStore(name, {
            keyPath:
              name === "sessions"
                ? "scope"
                : name === "settings"
                  ? "key"
                  : "id",
          });
    };
    r.onerror = () => reject(r.error);
    r.onblocked = () =>
      reject(new Error("別のタブを閉じてから再度開いてください"));
    r.onsuccess = () => {
      db = r.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
  });
}
export async function loadState() {
  if (!db) await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES, "readonly"),
      s = emptyState();
    for (const name of STORES) {
      const r = tx.objectStore(name).getAll();
      r.onsuccess = () => {
        if (name === "settings") {
          const saved = r.result.find((x) => x.key === "preferences");
          if (saved) s.settings = saved.value;
        } else s[name] = r.result;
      };
    }
    tx.oncomplete = () => {
      try {
        resolve(validateBackup(s));
      } catch (e) {
        reject(e);
      }
    };
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error("読み込み中断"));
  });
}
export async function saveState(state, previous = null) {
  const safe = validateBackup(state);
  if (!db) await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES, "readwrite");
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error("保存が中断されました"));
    try {
      for (const name of STORES) {
        const store = tx.objectStore(name);
        if (!previous) {
          store.clear();
          if (name === "settings")
            store.put({ key: "preferences", value: safe.settings });
          else for (const item of safe[name]) store.put(item);
          continue;
        }
        if (name === "settings") {
          if (
            JSON.stringify(previous.settings) !== JSON.stringify(safe.settings)
          )
            store.put({ key: "preferences", value: safe.settings });
          continue;
        }
        const key = name === "sessions" ? "scope" : "id",
          before = new Map(previous[name].map((x) => [x[key], x])),
          after = new Map(safe[name].map((x) => [x[key], x]));
        for (const id of before.keys()) if (!after.has(id)) store.delete(id);
        for (const [id, item] of after)
          if (JSON.stringify(before.get(id)) !== JSON.stringify(item))
            store.put(item);
      }
    } catch (error) {
      // A synchronous write failure must roll back previously queued writes too.
      tx.abort();
      reject(error);
    }
  });
}
