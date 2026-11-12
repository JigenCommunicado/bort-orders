/* Offline shell only: no orders, JSON exports or runtime responses enter this cache. */
const ASSETS = {
  "index.html": "b1b89230f81c4707affe48430771e1f939738a4065caa610d577e62b9d5b1347",
  "manifest.webmanifest": "b74f53dc4506af872018c2ed50d863644a4486aac7c4b18765644e9586412260",
  "icons/icon-192.png": "413698b69ac3604810893b67a9c62f748a571d732daeb98404d05eadb65afec2",
  "icons/icon-512.png": "8fffbf02aad0ee095c1dc8572aa216a56430f6604e16905e23a083713d61d2c9",
  "icons/maskable-512.png": "0e1532ec37ad583cc69841afeca9a29cb8a48db47ddd5898b830dafbd1b0996d",
  "icons/apple-touch-icon.png": "70f20f00626021512107bf2920580cf3fa7a3ddb46d291c370d463190f8305d5"
};
const VERSION = "8b2d850adb10cef2";
const CACHE = "bort-shell-" + VERSION;
const base = self.registration.scope;
const urlFor = path => new URL(path, base).href;

async function prepare() {
  // Validate the entire release before writing anything. A partial/mixed deployment
  // must never replace a previously working worker.
  const files = await Promise.all(Object.entries(ASSETS).map(async ([path, hash]) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch(urlFor(path), {cache:"no-store", credentials:"same-origin", redirect:"error", signal:controller.signal});
      if (!response.ok || response.type === "opaque") throw new Error("Unavailable asset: " + path);
      const bytes = await response.clone().arrayBuffer();
      const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), b => b.toString(16).padStart(2,"0")).join("");
      if (digest !== hash) throw new Error("Mixed release: " + path);
      return [urlFor(path), response];
    } finally { clearTimeout(timer); }
  }));
  const cache = await caches.open(CACHE);
  await Promise.all(files.map(([url,response]) => cache.put(url,response)));
}
async function ready() {
  const cache = await caches.open(CACHE);
  return (await Promise.all(Object.keys(ASSETS).map(path => cache.match(urlFor(path))))).every(Boolean);
}
self.addEventListener("install", event => event.waitUntil(prepare()));
// No automatic skipWaiting: existing flights continue in their current app.
// Keep older release caches: an interrupted update must not destroy a working copy.
self.addEventListener("activate", event => event.waitUntil(self.clients.claim()));
self.addEventListener("message", event => {
  const port = event.ports[0];
  event.waitUntil((async () => {
    try {
      if (event.data?.type === "REPAIR") await prepare();
      if (event.data?.type === "ACTIVATE") {
        if (!await ready()) throw new Error("Incomplete offline cache");
        await self.skipWaiting();
      }
      port?.postMessage({ready:await ready(), version:VERSION});
    } catch (error) { port?.postMessage({ready:false, error:String(error)}); }
  })());
});
self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  const root = new URL(base);
  if (url.origin !== root.origin) return;
  let path = url.pathname.slice(root.pathname.length);
  if (!url.pathname.startsWith(root.pathname)) return;
  if (path === "") path = "index.html";
  if (!Object.hasOwn(ASSETS,path)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(urlFor(path));
    // Never wait on the network for the installed shell, even with a slow connection.
    if (cached) return cached;
    return new Response("Офлайн-копия неполна. Подключитесь к сети и выполните подготовку в приложении.", {
      status:503, headers:{"Content-Type":"text/plain; charset=utf-8"}
    });
  })());
});
