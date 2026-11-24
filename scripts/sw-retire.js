// Emergency exit for the service worker: copy this file over public/sw.js and deploy. Browsers fetch /sw.js again on the
// next page load (it is served with no-cache), this version replaces the old one, deletes what it kept and leaves.
// It answers no request, so from that moment every page comes straight from the network.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key.startsWith("cwym-")) await caches.delete(key);
    await self.registration.unregister();
  })());
});
