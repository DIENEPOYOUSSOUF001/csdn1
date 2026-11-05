// Logique serveur CSDN : comptes, sessions, synchronisation centralisée, journal d'accès, sauvegardes.
// Indépendante de Netlify : le stockage est injecté (voir netlifyStore en bas) pour pouvoir être testée.
import {randomBytes,scryptSync,timingSafeEqual,createHmac} from 'node:crypto';

const COLS=['students','payments','expenses'];
const TTL=12*3600*1000, MAXLOG=1500, MAXBODY=5500000, KEEP_BACKUPS=30;
const NAME_RX=/^[\p{L}\p{N}][\p{L}\p{N} ._'-]{1,39}$/u;
const emptyDoc=()=>({rev:0,epoch:0,students:{},payments:{},expenses:{},settings:null});

function hashPw(pw,salt){salt=salt||randomBytes(16).toString('hex');return{salt,hash:scryptSync(pw,salt,64).toString('hex')}}
function checkPw(pw,u){const a=scryptSync(pw,u.salt,64),b=Buffer.from(u.hash,'hex');return a.length===b.length&&timingSafeEqual(a,b)}
const DUMMY=hashPw('mot-de-passe-factice');
function shortUA(ua){
  const b=/Edg\//.test(ua)?'Edge':/OPR\//.test(ua)?'Opera':/Firefox\//.test(ua)?'Firefox':/Chrome\//.test(ua)?'Chrome':/Safari\//.test(ua)?'Safari':'Navigateur';
  const o=/Windows/.test(ua)?'Windows':/Android/.test(ua)?'Android':/iPhone|iPad/.test(ua)?'iOS':/Mac OS/.test(ua)?'macOS':/Linux/.test(ua)?'Linux':'?';
  return b+' / '+o;
}
function nextReceipt(recv,owner){
  const m=String(recv).trim().match(/^(.*?)(\d+)$/);
  if(!m){let i=2,c;do{c=`${recv}-${i++}`}while(owner.has(c.toUpperCase()));return c}
  const prefix=m[1],w=m[2].length,P=prefix.toUpperCase();let max=0;
  for(const k of owner.keys()){if(k.startsWith(P)){const t=k.slice(P.length);if(/^\d+$/.test(t))max=Math.max(max,+t)}}
  let n=max+1,c;do{c=prefix+String(n++).padStart(w,'0')}while(owner.has(c.toUpperCase()));return c;
}

export function createApi(store,{seed,setupCode='',now=()=>Date.now()}={}){
  const iso=(t=now())=>new Date(t).toISOString();
  const json=(o,status=200)=>new Response(JSON.stringify(o),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
  const fail=(s,m)=>json({error:m},s);
  let secretCache=null;

  async function update(key,fn){
    for(let i=0;i<8;i++){
      const cur=await store.get(key);
      const next=await fn(cur?cur.data:null);
      if(next===undefined)return null;
      if(await store.put(key,next,cur?{etag:cur.etag}:{ifNew:true}))return next;
    }
    throw new Error('conflit');
  }
  async function getSecret(){
    if(secretCache)return secretCache;
    let c=await store.get('secret');
    if(!c){await store.put('secret',{v:randomBytes(32).toString('hex')},{ifNew:true});c=await store.get('secret')}
    return secretCache=c.data.v;
  }
  async function sign(p){const b=Buffer.from(JSON.stringify(p)).toString('base64url');return b+'.'+createHmac('sha256',await getSecret()).update(b).digest('base64url')}
  async function verify(t){
    const [b,s]=String(t||'').split('.');if(!b||!s)return null;
    const e=createHmac('sha256',await getSecret()).update(b).digest('base64url');
    if(e.length!==s.length||!timingSafeEqual(Buffer.from(e),Buffer.from(s)))return null;
    try{const p=JSON.parse(Buffer.from(b,'base64url').toString());return p.exp>now()?p:null}catch(e){return null}
  }
  const getUsers=async()=>((await store.get('users'))?.data)||{list:[]};
  async function session(u){const exp=now()+TTL;return{token:await sign({u:u.key,v:u.tv,exp}),name:u.name,role:u.role,exp}}
  async function auth(req){
    const h=req.headers.get('authorization')||'';const p=await verify(h.startsWith('Bearer ')?h.slice(7):'');if(!p)return null;
    const u=(await getUsers()).list.find(x=>x.key===p.u);return u&&u.active&&u.tv===p.v?u:null;
  }
  async function log(user,a,d,ip,ua){
    try{await update('log',cur=>{
      const L=cur?cur.entries:[],t=iso(),last=L[L.length-1];
      if(a==='Modification des données'&&last&&last.a===a&&last.u===user&&last.ip===ip&&Date.parse(t)-Date.parse(last.t)<300000){last.t=t;last.d=d;last.n=(last.n||1)+1}
      else L.push({t,u:user,a,d:d||'',ip,ua});
      return{entries:L.slice(-MAXLOG)};
    })}catch(e){}
  }
  async function throttleCheck(keys){
    const t=(await store.get('throttle'))?.data||{},n=now();
    for(const k of keys){const e=t[k];if(e&&e.until>n)return Math.ceil((e.until-n)/60000)}return 0;
  }
  async function throttleFail(keys){
    await update('throttle',cur=>{const t=cur||{},n=now();
      for(const k of keys){const e=t[k]&&n-t[k].first<900000?t[k]:{c:0,first:n};e.c++;if(e.c>=(k[0]==='i'?15:5))e.until=n+900000;t[k]=e}
      for(const k of Object.keys(t))if(n-t[k].first>3600000&&!(t[k].until>n))delete t[k];
      return t});
  }
  async function throttleReset(key){await update('throttle',cur=>{if(!cur||!cur[key])return undefined;delete cur[key];return cur})}

  const toArrays=d=>({rev:d.rev,epoch:d.epoch,students:Object.values(d.students),payments:Object.values(d.payments),expenses:Object.values(d.expenses),settings:d.settings});
  const clampU=(r,t,by)=>{const max=iso(now()+300000);if(!r._u||typeof r._u!=='string'||r._u>max)r._u=t;r._by=by};
  function applyChanges(d,ch,by,t,ren){
    const ids=new Set();
    for(const c of COLS){
      for(const r of (Array.isArray(ch[c])?ch[c]:[])){
        if(!r||typeof r.id!=='string'||!r.id||r.id.length>80)continue;
        clampU(r,t,by);const e=d[c][r.id];
        if(!e||r._u>(e._u||'')){d[c][r.id]=r;if(c==='payments')ids.add(r.id)}
      }
    }
    if(ch.settings&&typeof ch.settings==='object'){clampU(ch.settings,t,by);if(!d.settings||ch.settings._u>(d.settings._u||''))d.settings=ch.settings}
    // doublons de numéros de reçu (deux postes qui encaissent en même temps) : le plus récent est renuméroté
    const norm=r=>String(r||'').trim().toUpperCase(),owner=new Map(),all=Object.values(d.payments);
    for(const p of all){if(ids.has(p.id))continue;const k=norm(p.receipt);if(k&&!owner.has(k))owner.set(k,p.id)}
    for(const p of all.filter(p=>ids.has(p.id)).sort((a,b)=>String(a.createdAt||'').localeCompare(String(b.createdAt||'')))){
      const k=norm(p.receipt);if(!k)continue;
      if(!owner.has(k)){owner.set(k,p.id);continue}
      if(owner.get(k)===p.id)continue;
      const nr=nextReceipt(p.receipt,owner);ren.push({id:p.id,from:p.receipt,to:nr});p.receipt=nr;p._u=t;owner.set(nr.toUpperCase(),p.id);
    }
  }
  const countLabel=ch=>{const l=[['students','élève'],['payments','paiement'],['expenses','dépense']].map(([c,n])=>{const k=(ch[c]||[]).length;return k?`${k} ${n}${k>1?'s':''}`:''}).filter(Boolean);if(ch.settings)l.push('paramètres');return l.join(', ')};

  async function snapshotBackup(doc,meta){
    const t=now();if(meta.lastBackupAt&&t-meta.lastBackupAt<3600000)return meta;
    await store.put('backup-'+iso(t).slice(0,10),doc,{});
    meta.lastBackupAt=t;
    try{const keys=(await store.list('backup-')).filter(k=>/^backup-\d{4}-\d{2}-\d{2}$/.test(k)).sort();for(const k of keys.slice(0,Math.max(0,keys.length-KEEP_BACKUPS)))await store.del(k)}catch(e){}
    return meta;
  }

  async function doSync(body,user,ip,ua){
    const ch=body.changes&&typeof body.changes==='object'?body.changes:{};
    const n=COLS.reduce((a,c)=>a+(Array.isArray(ch[c])?ch[c].length:0),0)+(ch.settings?1:0);
    const me=await store.get('meta'),meta=me?me.data:{rev:0,epoch:0};
    if(!n&&body.baseRev===meta.rev&&body.epoch===meta.epoch)return{unchanged:true,rev:meta.rev,epoch:meta.epoch,serverTime:now()};
    const epochOk=body.epoch===-1||body.epoch===meta.epoch;
    let doc,ren=[],ignored=false;
    if(n&&epochOk){
      const t=iso();
      doc=await update('doc',cur=>{ren=[];const d=cur||emptyDoc();applyChanges(d,ch,user.name,t,ren);d.rev=(d.rev||0)+1;d.updatedAt=t;d.updatedBy=user.name;return d});
      let m={rev:doc.rev,epoch:doc.epoch||0,updatedAt:t,updatedBy:user.name,lastBackupAt:meta.lastBackupAt};
      m=await snapshotBackup(doc,m);
      await store.put('meta',m,me?{etag:me.etag}:{ifNew:true}).then(ok=>ok||update('meta',()=>m));
      await log(user.name,'Modification des données',countLabel(ch),ip,ua);
    }else{
      ignored=n>0;const c=await store.get('doc');doc=c?c.data:emptyDoc();
    }
    return{...toArrays(doc),renumbered:ren,ignored,serverTime:now()};
  }

  const validName=n=>typeof n==='string'&&NAME_RX.test(n.trim());
  const validPw=p=>typeof p==='string'&&p.length>=8&&p.length<=200;
  const pubUser=u=>({name:u.name,role:u.role,active:u.active,createdAt:u.createdAt,lastLogin:u.lastLogin||null});
  const adminCount=l=>l.filter(u=>u.role==='admin'&&u.active).length;

  return async function handle(req,ctx={}){
    try{
      const url=new URL(req.url),route=url.pathname.replace(/^\/api\/?/,'').replace(/\/+$/,'');
      const ip=ctx.ip||req.headers.get('x-nf-client-connection-ip')||(req.headers.get('x-forwarded-for')||'').split(',')[0].trim()||'?';
      const ua=shortUA(req.headers.get('user-agent')||'');
      if(route==='status'&&req.method==='GET'){const u=await getUsers();return json({configured:u.list.length>0,setupCodeRequired:!!setupCode,serverTime:now()})}
      if(req.method!=='POST')return fail(405,'Méthode non autorisée.');
      const txt=await req.text();if(txt.length>MAXBODY)return fail(413,'Données trop volumineuses.');
      let body={};try{body=txt?JSON.parse(txt):{}}catch(e){return fail(400,'Requête invalide.')}

      if(route==='setup'){
        if((await getUsers()).list.length)return fail(409,'L’application est déjà configurée.');
        if(setupCode&&body.setupCode!==setupCode)return fail(403,'Code d’installation incorrect.');
        if(!validName(body.name))return fail(400,'Nom invalide (2 à 40 caractères : lettres, chiffres, espace . _ - \').');
        if(!validPw(body.password))return fail(400,'Mot de passe trop court (8 caractères minimum).');
        const name=body.name.trim(),u={name,key:name.toLowerCase(),role:'admin',active:true,tv:1,createdAt:iso(),...hashPw(body.password)};
        u.lastLogin=iso();
        if(!(await store.put('users',{list:[u]},{ifNew:true})))return fail(409,'L’application est déjà configurée.');
        await getSecret();await log(name,'Compte administrateur créé',"Première ouverture",ip,ua);
        return json(await session(u));
      }
      if(route==='login'){
        const key=String(body.name||'').trim().toLowerCase(),keys=['n:'+key,'i:'+ip];
        const wait=await throttleCheck(keys);if(wait)return fail(429,`Trop de tentatives. Réessayez dans ${wait} minute(s).`);
        const u=(await getUsers()).list.find(x=>x.key===key);
        const ok=u?checkPw(String(body.password||''),u):(checkPw('x',{...DUMMY}),false);
        if(!u||!ok||!u.active){await throttleFail(keys);await log(u?u.name:String(body.name||'?').slice(0,40),'Échec de connexion',u&&!u.active?'Compte désactivé':'Mot de passe ou nom incorrect',ip,ua);return fail(401,'Nom ou mot de passe incorrect.')}
        await throttleReset('n:'+key);
        await update('users',cur=>{const x=cur.list.find(v=>v.key===key);x.lastLogin=iso();return cur});
        await log(u.name,'Connexion','',ip,ua);return json(await session(u));
      }

      const user=await auth(req);if(!user)return fail(401,'Session expirée ou invalide. Reconnectez-vous.');
      switch(route){
        case 'seed':return json(seed);
        case 'logout':await log(user.name,'Déconnexion','',ip,ua);return json({ok:true});
        case 'sync':return json(await doSync(body,user,ip,ua));
        case 'password':{
          if(!checkPw(String(body.oldPassword||''),user))return fail(403,'Ancien mot de passe incorrect.');
          if(!validPw(body.newPassword))return fail(400,'Nouveau mot de passe trop court (8 caractères minimum).');
          const h=hashPw(body.newPassword);
          const nu=await update('users',cur=>{const x=cur.list.find(v=>v.key===user.key);Object.assign(x,h);x.tv++;return cur});
          await log(user.name,'Mot de passe modifié','',ip,ua);return json(await session(nu.list.find(v=>v.key===user.key)));
        }
      }
      if(!route.startsWith('admin/'))return fail(404,'Route inconnue.');
      if(user.role!=='admin')return fail(403,'Réservé à l’administrateur.');
      switch(route){
        case 'admin/users':return json({users:(await getUsers()).list.map(pubUser)});
        case 'admin/user-create':{
          if(!validName(body.name))return fail(400,'Nom invalide.');if(!validPw(body.password))return fail(400,'Mot de passe trop court (8 caractères minimum).');
          const name=body.name.trim(),key=name.toLowerCase(),role=body.role==='admin'?'admin':'user';let dup=false;
          await update('users',cur=>{if(cur.list.some(x=>x.key===key)){dup=true;return undefined}cur.list.push({name,key,role,active:true,tv:1,createdAt:iso(),createdBy:user.name,...hashPw(body.password)});return cur});
          if(dup)return fail(409,'Ce nom existe déjà.');
          await log(user.name,'Compte créé',`${name} (${role==='admin'?'administrateur':'utilisateur'})`,ip,ua);return json({ok:true});
        }
        case 'admin/user-update':{
          const key=String(body.name||'').toLowerCase();let err=null,what=[];
          await update('users',cur=>{
            const x=cur.list.find(v=>v.key===key);if(!x){err=[404,'Compte introuvable.'];return undefined}
            const nx={...x};
            if(typeof body.password==='string'&&body.password){if(!validPw(body.password)){err=[400,'Mot de passe trop court (8 caractères minimum).'];return undefined}Object.assign(nx,hashPw(body.password));nx.tv++;what.push('mot de passe réinitialisé')}
            if(typeof body.active==='boolean'&&body.active!==x.active){nx.active=body.active;nx.tv++;what.push(body.active?'réactivé':'désactivé')}
            if((body.role==='admin'||body.role==='user')&&body.role!==x.role){nx.role=body.role;what.push('rôle '+body.role)}
            const after=cur.list.map(v=>v.key===key?nx:v);
            if(adminCount(after)<1){err=[400,'Il doit rester au moins un administrateur actif.'];return undefined}
            if(key===user.key&&(!nx.active||nx.role!=='admin')){err=[400,'Vous ne pouvez pas retirer vos propres droits.'];return undefined}
            cur.list=after;return cur});
          if(err)return fail(err[0],err[1]);
          await log(user.name,'Compte modifié',`${body.name} : ${what.join(', ')||'aucun changement'}`,ip,ua);return json({ok:true});
        }
        case 'admin/log':{const l=(await store.get('log'))?.data?.entries||[];return json({entries:l.slice(-Math.min(+body.limit||300,MAXLOG)).reverse()})}
        case 'admin/backups':return json({keys:(await store.list('backup-')).sort().reverse()});
        case 'admin/backup':{
          if(!/^backup-[\w-]+$/.test(String(body.key||'')))return fail(400,'Clé invalide.');
          const c=await store.get(body.key);if(!c)return fail(404,'Sauvegarde introuvable.');
          const a=toArrays(c.data);return json({students:a.students,payments:a.payments,expenses:a.expenses,settings:a.settings});
        }
        case 'admin/restore':{
          const D=body.doc;if(!D||!Array.isArray(D.students)||!Array.isArray(D.payments)||!Array.isArray(D.expenses))return fail(400,'Sauvegarde invalide.');
          const t=iso(),cur=await store.get('doc');
          if(cur)await store.put('backup-avant-restauration-'+t.replace(/[:.]/g,'-'),cur.data,{});
          const nd=emptyDoc(),by=user.name;
          for(const c of COLS)for(const r of D[c]){if(r&&typeof r.id==='string'){nd[c][r.id]={...r,_u:t,_by:by}}}
          nd.settings=D.settings&&typeof D.settings==='object'?{...D.settings,_u:t,_by:by}:null;
          nd.rev=(cur?cur.data.rev:0)+1;nd.epoch=(cur?cur.data.epoch||0:0)+1;nd.updatedAt=t;nd.updatedBy=by;
          await update('doc',()=>nd);
          const m={rev:nd.rev,epoch:nd.epoch,updatedAt:t,updatedBy:by,lastBackupAt:now()};await update('meta',()=>m);
          await store.put('backup-'+t.slice(0,10),nd,{});
          await log(by,'Restauration d’une sauvegarde',`${D.students.length} élèves, ${D.payments.length} paiements, ${D.expenses.length} dépenses`,ip,ua);
          return json({ok:true,rev:nd.rev,epoch:nd.epoch});
        }
      }
      return fail(404,'Route inconnue.');
    }catch(e){return fail(500,'Erreur serveur. Réessayez.')}
  };
}

// Adaptateur Netlify Blobs (une instance par requête : le contexte Blobs n'existe que pendant l'appel)
export function netlifyStore(factory){
  return{
    async get(k){const r=await factory().getWithMetadata(k,{type:'json',consistency:'strong'});return r?{data:r.data,etag:r.etag}:null},
    async put(k,v,o={}){const x={};if(o.etag)x.onlyIfMatch=o.etag;else if(o.ifNew)x.onlyIfNew=true;const r=await factory().setJSON(k,v,x);return !(r&&r.modified===false)},
    async list(p){const r=await factory().list({prefix:p});return r.blobs.map(b=>b.key)},
    async del(k){await factory().delete(k)},
  };
}
