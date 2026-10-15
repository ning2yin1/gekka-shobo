const CACHE = "gekka-shobo-shell-v4";
const FILES = [
  "./",
  "./index.html",
  "./styles.css",
  "./manifest.webmanifest",
  "./js/app.js",
  "./js/model.js",
  "./js/db.js",
  "./js/parsers.js",
  "./js/audio.js",
  "./js/music.js",
  "./art/reading-room.svg",
  "./art/page-corners.svg",
  "./icons/icon.svg",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable.png",
  "./icons/apple-touch-icon.png",
];
self.addEventListener("install", (event) =>
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await cache.addAll(FILES);
      // Cache the supplied track; a failed audio download must not block the shell.
      try {
        const url = new URL("./audio/bgm.mp3", self.registration.scope);
        const response = await fetch(url);
        if (response.ok && response.status === 200)
          await cache.put(url, response);
      } catch {
        /* Shell remains usable when optional audio cannot be fetched. */
      }
    })(),
  ),
);
self.addEventListener("activate", (event) =>
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys())
        if (key.startsWith("gekka-shobo-shell-") && key !== CACHE)
          await caches.delete(key);
      await self.clients.claim();
    })(),
  ),
);
self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (
    url.origin !== self.location.origin ||
    !url.pathname.startsWith(new URL(self.registration.scope).pathname)
  )
    return;
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const hit = await cache.match(event.request, { ignoreSearch: true });
      if (hit) {
        const range = event.request.headers.get("Range");
        if (range && url.pathname.endsWith("/audio/bgm.mp3")) {
          const match = range.match(/^bytes=(\d*)-(\d*)$/);
          if (!match) return new Response(null, { status: 416 });
          const blob = await hit.blob(),
            size = blob.size;
          let start = match[1]
            ? Number(match[1])
            : Math.max(0, size - Number(match[2]));
          let end = match[1] && match[2] ? Number(match[2]) : size - 1;
          end = Math.min(end, size - 1);
          if ((!match[1] && !match[2]) || start > end || start >= size)
            return new Response(null, {
              status: 416,
              headers: { "Content-Range": `bytes */${size}` },
            });
          return new Response(blob.slice(start, end + 1), {
            status: 206,
            headers: {
              "Content-Type": hit.headers.get("Content-Type") || "audio/mpeg",
              "Accept-Ranges": "bytes",
              "Content-Range": `bytes ${start}-${end}/${size}`,
              "Content-Length": String(end - start + 1),
            },
          });
        }
        return hit;
      }
      try {
        const response = await fetch(event.request);
        // BGM is optional while awaiting the supplied MP3. Cache only a real,
        // successful media response; a missing track must not break the shell.
        if (
          url.pathname ===
            new URL("./audio/bgm.mp3", self.registration.scope).pathname &&
          response.ok &&
          response.status === 200
        )
          await cache.put(event.request, response.clone());
        return response;
      } catch (error) {
        if (event.request.mode === "navigate")
          return await cache.match("./index.html");
        throw error;
      }
    })(),
  );
});
