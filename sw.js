/* RADAR · service worker: tiene una copia dell'app sul telefono, così si apre anche senza rete (in macchina, in viaggio).
   I segni non passano da qui: li gestisce la pagina. Quando cambia l'app, alzare VERSION (e APP_V in index.html). */
const VERSION="radar-v6";
const CORE=["./","index.html","store.js","uscite.json","bussola.json","manifest.webmanifest","icons/apple-touch-icon.png","icons/icon-192.png","icons/icon-512.png","icons/icon-maskable-512.png"];

self.addEventListener("install",e=>{e.waitUntil(caches.open(VERSION).then(c=>c.addAll(CORE)).then(()=>self.skipWaiting()));});
self.addEventListener("activate",e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==VERSION).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});

function withTimeout(p,ms){return Promise.race([p,new Promise((_,rej)=>setTimeout(()=>rej(new Error("timeout")),ms))]);}

self.addEventListener("fetch",e=>{
  const req=e.request,url=new URL(req.url);
  if(req.method!=="GET"||url.hostname.endsWith("supabase.co"))return;
  /* l'app e le uscite: prima la rete (per avere sempre l'ultimo giro), la copia se la rete manca o è lenta.
     Correzione v4: la risposta della rete aggiorna la copia ANCHE se arriva dopo i 4 secondi (prima veniva buttata,
     e con una rete lenta l'app restava ferma sulla copia vecchia). La copia si salva senza "?t=…" nell'indirizzo. */
  if(url.origin===location.origin){
    const key=url.origin+url.pathname;
    let saving=Promise.resolve();
    /* la copia si prende appena arrivano le intestazioni, prima che la pagina legga la risposta; il salvataggio va avanti in parallelo */
    const net=fetch(req,{cache:"no-cache"}).then(res=>{if(res.ok){const copy=res.clone();saving=caches.open(VERSION).then(c=>c.put(key,copy)).catch(()=>{});}return res;});
    e.waitUntil(net.then(()=>saving,()=>{}));
    e.respondWith(withTimeout(net,4000).catch(()=>caches.match(key).then(r=>r||caches.match(req,{ignoreSearch:true})).then(r=>r||caches.match("index.html"))));
    return;
  }
  /* librerie, font e copertine di Apple Music: cambiano di rado, quindi basta la copia (e le copertine viste restano anche offline) */
  e.respondWith(caches.match(req).then(hit=>hit||fetch(req).then(res=>{if(res.ok||res.type==="opaque"){const copy=res.clone();caches.open(VERSION).then(c=>c.put(req,copy));}return res;})));
});
