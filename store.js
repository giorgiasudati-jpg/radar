/* RADAR · il ponte tra l'app e Supabase (stesso schema di Enlist e Practice).
   Ogni modifica si applica subito alla copia locale e parte verso Supabase appena c'è rete:
   l'app si apre e salva anche offline, e invia tutto quando torna la connessione.
   Con ?demo nell'indirizzo non tocca Supabase: dati di prova solo in questo browser. */
const Store=(()=>{
  const SB_URL="https://jwbzadaxregnukdevcrm.supabase.co";
  const SB_KEY="sb_publishable_UGraDoUu9WgRlj4arJhjWg_dalxkVvU";
  const COLS=["radar_segni"];
  const DEMO=new URLSearchParams(location.search).has("demo");
  const P=DEMO?"radar-demo-":"radar-";
  const K_CACHE=P+"cache-v1", K_OUT=P+"outbox-v1", K_PULLED=P+"pulled";
  const sb=DEMO?null:supabase.createClient(SB_URL,SB_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}});

  const load=k=>{try{return JSON.parse(localStorage.getItem(k)||"null");}catch(e){return null;}};
  const save=(k,v)=>{try{localStorage.setItem(k,JSON.stringify(v));}catch(e){}};
  const empty=()=>Object.fromEntries(COLS.map(c=>[c,{}]));
  let cache=Object.assign(empty(),load(K_CACHE)||{});
  let outbox=load(K_OUT)||[];
  let lastError=null;
  /* al primo accesso su un dispositivo la copia locale è vuota: si mostra solo dopo il primo scaricamento */
  let pulled=!!load(K_PULLED);
  const subs=Object.fromEntries(COLS.map(c=>[c,[]])), statusSubs=[], pulledSubs=[];

  function snap(col){return {docs:Object.entries(cache[col]).map(([id,data])=>({id,data:()=>data}))};}
  function emit(col){const s=snap(col);subs[col].forEach(cb=>cb(s));}
  function status(){const st={pending:outbox.length,online:navigator.onLine,error:lastError,demo:DEMO};statusSubs.forEach(cb=>cb(st));}
  function persist(){save(K_CACHE,cache);save(K_OUT,outbox);status();}

  /* un'operazione per documento: l'ultima vince, perché porta sempre il documento intero */
  function queue(op){
    if(DEMO){persist();return;}
    outbox=outbox.filter(o=>!(o.col===op.col&&o.id===op.id));outbox.push(op);persist();flush();
  }

  let flushing=null;
  function flush(){
    if(DEMO)return Promise.resolve();
    if(flushing)return flushing;
    flushing=(async()=>{
      if(!outbox.length||!navigator.onLine)return;
      const {data:{session}}=await sb.auth.getSession();if(!session)return;
      try{
        while(outbox.length){
          const o=outbox[0];
          if(o.op==="set"){
            /* i salvataggi consecutivi partono a gruppi (fino a 100 per volta): l'importazione dei vecchi segni ne porta centinaia */
            let n=0;while(n<outbox.length&&n<100&&outbox[n].op==="set"&&outbox[n].col===o.col)n++;
            const now=new Date().toISOString();
            const r=await sb.from(o.col).upsert(outbox.slice(0,n).map(x=>({id:x.id,data:x.data,updated_at:now})));
            if(r.error)throw r.error;
            outbox.splice(0,n);
          }else{
            const r=await sb.from(o.col).delete().eq("id",o.id);
            if(r.error)throw r.error;
            outbox.shift();
          }
          lastError=null;persist();
        }
      }catch(e){lastError=e.message||String(e);console.warn("RADAR: invio rimandato",e);status();}
    })().finally(()=>{flushing=null;});
    return flushing;
  }

  async function pull(){
    if(DEMO){
      if(!pulled&&window.DEMO_SEED){cache=Object.assign(empty(),JSON.parse(JSON.stringify(window.DEMO_SEED)));}
      pulled=true;save(K_PULLED,true);persist();COLS.forEach(emit);pulledSubs.forEach(cb=>cb());return;
    }
    if(!navigator.onLine)return;
    await flush();
    const fresh={};
    for(const col of COLS){
      const r=await sb.from(col).select("id,data").limit(10000);
      if(r.error){lastError=r.error.message;status();return;}
      fresh[col]=Object.fromEntries(r.data.map(x=>[x.id,x.data]));
    }
    /* quello che non è ancora partito resta valido sopra i dati del server */
    for(const o of outbox){if(o.op==="set")fresh[o.col][o.id]=o.data;else delete fresh[o.col][o.id];}
    cache=fresh;lastError=null;pulled=true;save(K_PULLED,true);persist();COLS.forEach(emit);pulledSubs.forEach(cb=>cb());
  }

  function collection(col){
    return {
      onSnapshot(cb){subs[col].push(cb);if(pulled)cb(snap(col));return()=>{subs[col]=subs[col].filter(x=>x!==cb);};},
      async add(data,id){id=id||crypto.randomUUID();cache[col][id]=data;emit(col);queue({op:"set",col,id,data});return {id};}
    };
  }
  function doc(path){
    const [col,id]=path.split("/");
    return {
      async update(patch){const cur=cache[col][id];if(!cur)throw new Error("not_found");const data={...cur,...patch};cache[col][id]=data;emit(col);queue({op:"set",col,id,data});},
      async set(data){cache[col][id]=data;emit(col);queue({op:"set",col,id,data});},
      /* crea solo se non esiste già: va usato subito dopo uno scaricamento fresco, così non copre mai una versione più nuova */
      async create(data){if(cache[col][id])return false;cache[col][id]=data;emit(col);queue({op:"set",col,id,data});return true;},
      async delete(){delete cache[col][id];emit(col);queue({op:"del",col,id});}
    };
  }

  /* accesso con email e password: lo stesso utente di Enlist, Train e Practice */
  async function session(){if(DEMO)return {demo:true};const {data:{session}}=await sb.auth.getSession();return session;}
  async function signIn(email,password){const {error}=await sb.auth.signInWithPassword({email,password});if(error)throw error;}
  async function signOut(){if(!DEMO)await sb.auth.signOut();cache=empty();outbox=[];pulled=false;save(K_PULLED,false);persist();}

  let started=false;
  function start(){
    if(started)return;started=true;
    pull();
    if(DEMO)return;
    window.addEventListener("online",()=>{status();pull();});
    window.addEventListener("offline",status);
    document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible")pull();});
    setInterval(()=>{if(document.visibilityState==="visible")pull();},5*60*1000);
  }

  return {collection,doc,session,signIn,signOut,start,pull,DEMO,onStatus:cb=>{statusSubs.push(cb);status();},onPulled:cb=>{pulledSubs.push(cb);}};
})();
