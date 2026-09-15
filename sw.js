const CACHE='energia-casa-v1';
const A=['./','./index.html','./manifest.webmanifest','./icon.svg','./tariffe.json'];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(A))));
self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));
self.addEventListener('fetch',e=>{const u=new URL(e.request.url);if(u.hostname==='api.thingspeak.com')return;e.respondWith(fetch(e.request).then(r=>{const x=r.clone();caches.open(CACHE).then(c=>c.put(e.request,x)).catch(()=>{});return r}).catch(()=>caches.match(e.request)))});
