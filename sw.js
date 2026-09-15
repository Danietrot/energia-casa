const CACHE='energia-casa-screen-v1';
const ASSETS=['./','./index.html','./manifest.webmanifest','./icon.svg','./tariffe.json'];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS))));
self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));
self.addEventListener('fetch',e=>{
  const u=new URL(e.request.url);
  if(u.hostname==='api.thingspeak.com') return;
  e.respondWith(fetch(e.request).catch(()=>caches.match(e.request)));
});
