const CACHE="uchilog-v1.2.1";
const ASSETS=["./","./index.html","./styles.css","./app.js","./repositories.js","./firebase-config.js","./manifest.webmanifest","./icon-192.png","./icon-512.png"];

importScripts("https://www.gstatic.com/firebasejs/12.16.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/12.16.0/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey:"AIzaSyCVvH57uWj1wl05lFu6MnWtJpULymuUjsc",
  authDomain:"uchilog-app.firebaseapp.com",
  projectId:"uchilog-app",
  storageBucket:"uchilog-app.firebasestorage.app",
  messagingSenderId:"440111185332",
  appId:"1:440111185332:web:92cc32e2c2fb8784b0c6e1"
});
const messaging=firebase.messaging();

messaging.onBackgroundMessage(payload=>{
  const data=payload.data||{};
  self.registration.showNotification(data.title||"うちログ",{
    body:data.body||"買い物リストが更新されました",
    icon:"./icon-192.png",
    badge:"./icon-192.png",
    tag:data.eventId?`uchilog-${data.eventId}`:"uchilog-shopping",
    data:{url:data.url||"./index.html"}
  });
});

self.addEventListener("notificationclick",event=>{
  event.notification.close();
  const target=new URL(event.notification.data?.url||"./index.html",self.location.origin).href;
  event.waitUntil(clients.matchAll({type:"window",includeUncontrolled:true}).then(list=>{
    const existing=list.find(client=>client.url.startsWith(self.location.origin));
    if(existing){existing.focus();existing.navigate(target);return existing}
    return clients.openWindow(target);
  }));
});
self.addEventListener("install",event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS)).then(()=>self.skipWaiting())));
self.addEventListener("activate",event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener("fetch",event=>{if(event.request.method!=="GET")return;event.respondWith(caches.match(event.request).then(cached=>cached||fetch(event.request)))});
