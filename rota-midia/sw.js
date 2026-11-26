// Guarda as páginas no celular para o app abrir mesmo sem internet.
<<<<<<< HEAD
const VERSAO = "rota-midia-cliente-v3";
const ARQUIVOS = ["./", "index.html", "rotas.json",
=======
const VERSAO = "rota-midia-v2";
const ARQUIVOS = ["./", "index.html", "equipe.html", "registrar.html", "simulador.html",
>>>>>>> origin/main
  "manifest.webmanifest", "icone-192.png", "icone-512.png", "apple-touch-icon.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSAO).then(c => c.addAll(ARQUIVOS)));
  self.skipWaiting();
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSAO).map(k => caches.delete(k)))));
  self.clients.claim();
});
// Tenta a internet primeiro (dados sempre novos); sem sinal, usa o que está guardado.
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  e.respondWith(
    fetch(e.request).then(r => {
      if (r.ok && new URL(e.request.url).origin === location.origin) {
        const copia = r.clone(); caches.open(VERSAO).then(c => c.put(e.request, copia));
      }
      return r;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
