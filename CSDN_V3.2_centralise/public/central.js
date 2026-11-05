// CSDN V3.2 — accès sécurisé + données centralisées (synchronisation automatique entre postes)
(function(){
'use strict';
const COLS=['students','payments','expenses'];
const TK='csdn_session',SK='csdn_sync_state',SEEDK='csdn_seed_cache',MK='csdn_migrated';
const POLL_MS=15000,IDLE_MS=30*60*1000;
let sess=null,st={rev:-1,epoch:-1,snap:null},skew=0,pollT=null,idleT=null,saveT=null;
let busy=false,again=false,online=true,lastOk=null,pendingRender=false,started=false,bound=false,hasLocal=false;
const stamped={students:{},payments:{},expenses:{},settings:''};
const emptySnap=()=>({students:{},payments:{},expenses:{},settings:''});
const when=t=>t?new Date(t).toLocaleString('fr-FR',{timeZone:'Africa/Bamako'}):'—';

// ---------- empreintes (détection des fiches modifiées) ----------
function canon(v){
  if(Array.isArray(v))return'['+v.map(canon).join(',')+']';
  if(v&&typeof v==='object')return'{'+Object.keys(v).filter(k=>k!=='_u'&&k!=='_by'&&v[k]!==undefined).sort().map(k=>JSON.stringify(k)+':'+canon(v[k])).join(',')+'}';
  return JSON.stringify(v);
}
function h(s){let a=0xdeadbeef,b=0x41c6ce57;for(let i=0;i<s.length;i++){const c=s.charCodeAt(i);a=Math.imul(a^c,2654435761);b=Math.imul(b^c,1597334677)}a=Math.imul(a^(a>>>16),2246822507)^Math.imul(b^(b>>>13),3266489909);b=Math.imul(b^(b>>>16),2246822507)^Math.imul(a^(a>>>13),3266489909);return(4294967296*(2097151&b)+(a>>>0)).toString(36)}
const sig=r=>h(canon(r));
const nowIso=()=>new Date(Date.now()+skew).toISOString();

// ---------- API ----------
async function api(route,body,method){
  const opt={method:method||'POST',headers:{'content-type':'application/json'},cache:'no-store'};
  if(sess)opt.headers.authorization='Bearer '+sess.token;
  if(opt.method!=='GET')opt.body=JSON.stringify(body||{});
  const r=await fetch('/api/'+route,opt);let j;
  try{j=await r.json()}catch(e){const er=new Error('Le serveur centralisé ne répond pas correctement (fonctions Netlify non déployées ?).');er.status=r.status;er.noApi=true;throw er}
  if(!r.ok){const er=new Error(j.error||'Erreur serveur');er.status=r.status;throw er}
  return j;
}

// ---------- état local ----------
function loadState(){try{const s=JSON.parse(localStorage.getItem(SK)||'null');if(s&&s.snap)st=s}catch(e){}}
function saveState(){try{localStorage.setItem(SK,JSON.stringify(st))}catch(e){}}
function readSession(){try{const s=JSON.parse(sessionStorage.getItem(TK)||'null');if(s&&s.exp>Date.now())return s}catch(e){}return null}
function setSession(s){sess=s;try{sessionStorage.setItem(TK,JSON.stringify(s))}catch(e){}}

// Estampille (date + utilisateur) des fiches modifiées depuis la dernière synchronisation
function stamp(){
  if(!sess||!st.snap)return 0;const t=nowIso();let n=0;
  for(const c of COLS)for(const r of data[c]){
    const g=sig(r);if(st.snap[c][r.id]===g)continue;
    if(stamped[c][r.id]===g&&r._u)continue;
    r._u=t;r._by=sess.name;stamped[c][r.id]=g;n++;
  }
  const gs=sig(data.settings);
  if(st.snap.settings!==gs&&!(stamped.settings===gs&&data.settings._u)){data.settings._u=t;data.settings._by=sess.name;stamped.settings=gs;n++}
  return n;
}
function collect(){
  const out={students:[],payments:[],expenses:[]},sent=[];let n=0;
  if(!st.snap)return{out,sent,n};
  for(const c of COLS)for(const r of data[c]){const g=sig(r);if(st.snap[c][r.id]!==g){out[c].push(r);sent.push([c,r.id,g]);n++}}
  const gs=sig(data.settings);if(st.snap.settings!==gs){out.settings=data.settings;sent.push(['settings','',gs]);n++}
  return{out,sent,n};
}

// ---------- application des données reçues du serveur ----------
function downloadLocal(label){
  try{const b=new Blob([JSON.stringify(data,null,2)],{type:'application/json'}),a=document.createElement('a');a.href=URL.createObjectURL(b);a.download=`CSDN_local_${label}_${new Date().toISOString().slice(0,10)}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),700)}catch(e){}
}
function applyDoc(doc,mode){
  const sd=mergeSeed({students:doc.students||[],payments:doc.payments||[],expenses:doc.expenses||[],settings:doc.settings||null});
  const snap=emptySnap();
  for(const c of COLS)for(const r of sd[c])snap[c][r.id]=sig(r);
  snap.settings=sig(sd.settings);
  const res={added:{students:0,payments:0,expenses:0},skipped:0};
  if(mode!=='replace'){
    for(const c of COLS){
      const idx=new Map(sd[c].map((r,i)=>[r.id,i]));
      for(const r of data[c]){
        const i=idx.get(r.id);
        if(i===undefined){sd[c].push(r);res.added[c]++}
        else if(mode==='merge'){if((r._u||'')>(sd[c][i]._u||''))sd[c][i]=r}
        else if(sig(r)!==snap[c][r.id])res.skipped++;
      }
    }
    if(mode==='merge'&&(data.settings._u||'')>(sd.settings._u||''))sd.settings=data.settings;
  }
  data=sd;
  try{localStorage.setItem(DBKEY,JSON.stringify(data))}catch(e){}
  st.rev=doc.rev;st.epoch=doc.epoch;st.snap=snap;saveState();
  return res;
}
const dialogOpen=()=>!!document.querySelector('dialog[open]');
function rerender(){if(dialogOpen()){pendingRender=true;return}pendingRender=false;renderAll();if($('settings').classList.contains('active'))buildSecurity(false)}

function handleResult(res,c){
  if(res.serverTime)skew=res.serverTime-Date.now();
  if(res.unchanged){lastOk=Date.now();return}
  if(c.n>0&&!res.ignored&&res.epoch===st.epoch&&res.rev===st.rev+1&&!(res.renumbered||[]).length){
    // seules nos modifications ont été enregistrées : on met simplement l'empreinte à jour
    for(const[col,id,g]of c.sent){if(col==='settings')st.snap.settings=g;else st.snap[col][id]=g}
    st.rev=res.rev;saveState();lastOk=Date.now();return;
  }
  let mode='merge';
  if(st.epoch>=0&&res.epoch!==st.epoch){mode='replace';if(collect().n>0)downloadLocal('modifications_non_envoyees')}
  applyDoc(res,mode);rerender();lastOk=Date.now();
  if(mode==='replace')alert('Un administrateur a restauré une sauvegarde : les données de cet ordinateur ont été remplacées par la version centrale.');
  const ren=res.renumbered||[];
  if(ren.length)alert('Deux postes ont utilisé le même numéro de reçu. Numéro(s) corrigé(s) automatiquement :\n'+ren.map(x=>`${x.from} → ${x.to}`).join('\n'));
}

// ---------- synchronisation ----------
async function sync(){
  if(!sess||!started&&!st.snap)return;
  if(busy){again=true;return}
  busy=true;ui('sync');
  try{
    stamp();const c=collect();
    const res=await api('sync',{baseRev:st.rev,epoch:st.epoch,changes:c.out});
    online=true;handleResult(res,c);
  }catch(e){
    if(e.status===401)lock('Session expirée. Reconnectez-vous : vos modifications en attente seront envoyées.');
    else online=false;
  }finally{busy=false;ui();if(again){again=false;setTimeout(sync,50)}}
}
async function initialSync(){
  loadState();
  if(st.snap){await sync();return}
  const res=await api('sync',{baseRev:-1,epoch:-1,changes:{}});
  if(res.serverTime)skew=res.serverTime-Date.now();
  if(!res.rev){ // base centrale vide : ce poste envoie ses données
    st={rev:0,epoch:res.epoch||0,snap:emptySnap()};saveState();started=true;await sync();
  }else if(!hasLocal||localStorage.getItem(MK)){
    applyDoc(res,'replace');
  }else{ // premier rattachement d'un poste qui a déjà des données locales
    const before=JSON.stringify(data);
    const r=applyDoc(res,'serverfirst');
    const a=r.added;
    if(r.skipped>0){const keep=data;data=JSON.parse(before);downloadLocal('avant_centralisation');data=keep}
    started=true;await sync();
    alert('Cet ordinateur est maintenant relié à la base centrale.\n'
      +(a.students+a.payments+a.expenses?`• Ajoutés depuis cet ordinateur : ${a.students} élève(s), ${a.payments} paiement(s), ${a.expenses} dépense(s).\n`:'')
      +(r.skipped?`• ${r.skipped} fiche(s) locale(s) différente(s) de la version centrale n’ont pas été reprises (la version centrale est conservée). Une copie de vos données locales vient d’être téléchargée.`:'• Aucune différence avec la version centrale.'));
  }
  try{localStorage.setItem(MK,'1')}catch(e){}
}
function startPolling(){stopPolling();pollT=setInterval(()=>{if(!document.hidden)sync();if(pendingRender&&!dialogOpen())rerender()},POLL_MS)}
function stopPolling(){clearInterval(pollT);pollT=null}

// ---------- verrouillage / déconnexion ----------
function resetIdle(){clearTimeout(idleT);if(!sess)return;idleT=setTimeout(()=>lock('Session verrouillée après 30 minutes d’inactivité.'),IDLE_MS)}
function lock(msg){
  stopPolling();clearTimeout(idleT);
  const name=sess&&sess.name;sess=null;try{sessionStorage.removeItem(TK)}catch(e){}
  document.querySelectorAll('dialog[open]').forEach(d=>{try{d.close()}catch(e){}});
  document.body.classList.add('locked');showAuth('login',msg,name);
}
async function logout(){
  const n=started?(stamp(),collect().n):0;
  if(n>0&&!confirm(`${n} modification(s) n’ont pas encore été envoyées au serveur (connexion perdue ?).\nSe déconnecter les fera perdre. Continuer ?`))return;
  try{await api('logout',{})}catch(e){}
  try{sessionStorage.removeItem(TK);if(n===0){localStorage.removeItem(DBKEY);localStorage.removeItem(SK);localStorage.removeItem(SEEDK)}}catch(e){}
  location.reload();
}

// ---------- interface de connexion ----------
function injectUI(){
  if($('authOverlay'))return;
  const d=document.createElement('div');d.id='authOverlay';d.className='auth-overlay';d.hidden=true;
  d.innerHTML=`<form id="authForm" class="auth-card" autocomplete="on"><img src="logo-csdn.svg" alt=""><h2 id="authTitle"></h2><p id="authText" class="muted"></p>
  <label id="authNameRow">Nom d’utilisateur<input id="authName" autocomplete="username" maxlength="40" required></label>
  <label id="authPassRow">Mot de passe<input id="authPass" type="password" autocomplete="current-password" required></label>
  <label id="authPass2Row">Confirmer le mot de passe<input id="authPass2" type="password" autocomplete="new-password"></label>
  <label id="authCodeRow">Code d’installation<input id="authCode" autocomplete="off"></label>
  <div id="authMsg" class="auth-msg" role="alert"></div>
  <button class="primary" id="authSubmit" type="submit"></button></form>`;
  document.body.appendChild(d);
}
let authMode='login',authStatus=null;
function showAuth(mode,msg,prefill){
  authMode=mode;const T={setup:['Première ouverture','Créez le compte administrateur. Utilisez l’ordinateur qui contient vos données actuelles pour cette première connexion.','Créer le compte et entrer'],
    login:['Connexion','Identifiez-vous pour accéder à la gestion scolaire.','Se connecter'],down:['Serveur injoignable','','Réessayer']}[mode];
  $('authOverlay').hidden=false;$('authTitle').textContent=T[0];$('authText').textContent=T[1];$('authSubmit').textContent=T[2];
  const down=mode==='down',setup=mode==='setup';
  $('authNameRow').style.display=$('authPassRow').style.display=down?'none':'';
  $('authPass2Row').style.display=setup?'':'none';$('authCodeRow').style.display=setup&&authStatus&&authStatus.setupCodeRequired?'':'none';
  $('authName').required=$('authPass').required=!down;$('authPass').autocomplete=setup?'new-password':'current-password';
  $('authMsg').textContent=msg||'';$('authPass').value=$('authPass2').value='';
  if(prefill)$('authName').value=prefill;
  setTimeout(()=>($('authName').value?$('authPass'):$('authName')).focus(),50);
}
function hideAuth(){$('authOverlay').hidden=true}
async function onSubmit(e){
  e.preventDefault();const msg=t=>{$('authMsg').textContent=t},btn=$('authSubmit');
  if(authMode==='down'){location.reload();return}
  const name=$('authName').value.trim(),password=$('authPass').value;
  if(authMode==='setup'){
    if(password.length<8)return msg('Mot de passe trop court : 8 caractères minimum.');
    if(password!==$('authPass2').value)return msg('Les deux mots de passe sont différents.');
  }
  btn.disabled=true;msg('');
  try{
    const s=await api(authMode==='setup'?'setup':'login',{name,password,setupCode:$('authCode').value.trim()});
    setSession(s);await afterAuth();
  }catch(er){msg(er.status?er.message:'Connexion impossible. Vérifiez Internet puis réessayez.')}
  finally{btn.disabled=false}
}
async function afterAuth(){
  try{
    await ensureSeed();
    await initialSync();
  }catch(er){
    if(er.status===401){sess=null;showAuth('login','Session invalide. Reconnectez-vous.');return}
    if(er.noSeed){sess=null;try{sessionStorage.removeItem(TK)}catch(e){}showAuth('down',er.message);$('authText').textContent=er.message;return}
    online=false; // hors ligne : on travaille sur la copie locale
    if(!st.snap)loadState();
  }
  if(!st.snap){sess=null;try{sessionStorage.removeItem(TK)}catch(e){}showAuth('down','Impossible de joindre le serveur.');$('authText').textContent='Impossible de joindre le serveur central et aucune copie locale n’est disponible sur cet ordinateur.';return}
  startApp();
}
async function ensureSeed(){
  if(initial)return;let seed=null;
  try{seed=await api('seed',{})}catch(e){if(e.status===401)throw e;try{seed=JSON.parse(localStorage.getItem(SEEDK)||'null')}catch(_){}}
  if(!seed){const er=new Error('Les données de base sont indisponibles (hors ligne et aucune copie locale).');er.noSeed=true;throw er}
  try{localStorage.setItem(SEEDK,JSON.stringify(seed))}catch(e){}
  initSeed(seed);
}

// ---------- démarrage de l'application ----------
function startApp(){
  started=true;hideAuth();document.body.classList.remove('locked');
  data.students.forEach(normalizeRegistration);renderAll();
  if(window.__loadWarning){const w=window.__loadWarning;window.__loadWarning=null;setTimeout(()=>alert(w),300)}
  const admin=sess.role==='admin',rl=$('restoreFile').closest('label');if(rl)rl.style.display=admin?'':'none';
  buildSecurity(true);ui();startPolling();resetIdle();
  if(!bound){bound=true;
    ['mousemove','keydown','click','touchstart'].forEach(ev=>document.addEventListener(ev,()=>{if(sess)resetIdle()},{passive:true}));
    document.addEventListener('visibilitychange',()=>{if(!document.hidden&&sess)sync()});
    window.addEventListener('online',()=>{if(sess)sync()});
    window.addEventListener('offline',()=>{online=false;ui()});
    document.addEventListener('close',()=>{if(pendingRender&&!dialogOpen())rerender()},true);
    window.addEventListener('beforeunload',e=>{if(sess&&started&&st.snap&&collect().n>0){e.preventDefault();e.returnValue=''}});
    $('lockBtn').onclick=logout;$('syncBadge').onclick=()=>sync();
    document.querySelector('.nav[data-view="settings"]').addEventListener('click',()=>buildSecurity(true));
  }
}
function ui(state){
  if(!sess)return;
  $('userBadge').textContent=`${sess.name} (${sess.role==='admin'?'administrateur':'utilisateur'})`;
  const n=started&&st.snap?collect().n:0,b=$('syncBadge');
  if(state==='sync'){b.textContent='⟳ Synchronisation…';b.className='sync-badge'}
  else if(!online){b.textContent=`⚠ Hors ligne${n?` — ${n} modification(s) en attente`:''}`;b.className='sync-badge off'}
  else if(n){b.textContent=`⟳ ${n} modification(s) en attente`;b.className='sync-badge off'}
  else{b.textContent='✔ Synchronisé '+(lastOk?new Date(lastOk).toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'}):'');b.className='sync-badge ok'}
}

// ---------- panneau Accès et sécurité (Paramètres) ----------
async function buildSecurity(reload){
  const P=$('securityPanel');if(!P||!sess)return;
  const admin=sess.role==='admin';
  if(!P.dataset.built||reload){
    P.dataset.built='1';
    P.innerHTML=`<h3>Accès et sécurité</h3>
    <div class="sec-block"><h4>Mon mot de passe</h4><div class="sec-row"><input id="pwOld" type="password" placeholder="Mot de passe actuel" autocomplete="current-password"><input id="pwNew" type="password" placeholder="Nouveau (8 caractères min.)" autocomplete="new-password"><button id="pwBtn" type="button">Changer</button></div><div id="pwMsg" class="muted"></div></div>
    ${admin?`<div class="sec-block"><h4>Utilisateurs</h4><div class="table-wrap" style="max-height:240px"><table id="usersTable"></table></div>
    <div class="sec-row"><input id="nuName" placeholder="Nom du nouvel utilisateur" maxlength="40"><input id="nuPass" type="password" placeholder="Mot de passe (8 min.)" autocomplete="new-password"><select id="nuRole"><option value="user">Utilisateur</option><option value="admin">Administrateur</option></select><button class="primary" id="nuBtn" type="button">Ajouter</button></div><div id="nuMsg" class="muted"></div></div>
    <div class="sec-block"><h4>Journal des accès (heure de Bamako)</h4><div class="table-wrap" style="max-height:320px"><table id="logTable"></table></div></div>
    <div class="sec-block"><h4>Sauvegardes automatiques du serveur</h4><div id="backupList" class="chips"></div><p class="muted">Téléchargez un fichier puis utilisez « Restaurer » en haut de page pour revenir à cette date.</p></div>`:''}`;
    $('pwBtn').onclick=async()=>{const m=$('pwMsg');try{const s=await api('password',{oldPassword:$('pwOld').value,newPassword:$('pwNew').value});setSession(s);m.textContent='Mot de passe modifié.';$('pwOld').value=$('pwNew').value=''}catch(e){m.textContent=e.message}};
    if(admin)$('nuBtn').onclick=async()=>{const m=$('nuMsg');try{await api('admin/user-create',{name:$('nuName').value,password:$('nuPass').value,role:$('nuRole').value});m.textContent='Compte créé.';$('nuName').value=$('nuPass').value='';buildSecurity(false)}catch(e){m.textContent=e.message}};
  }
  if(!admin||!online)return;
  try{
    const[u,l,b]=await Promise.all([api('admin/users',{}),api('admin/log',{limit:300}),api('admin/backups',{})]);
    $('usersTable').innerHTML='<thead><tr><th>Nom</th><th>Rôle</th><th>État</th><th>Dernière connexion</th><th>Actions</th></tr></thead><tbody>'+u.users.map(x=>`<tr><td>${E(x.name)}</td><td>${x.role==='admin'?'Administrateur':'Utilisateur'}</td><td><span class="badge ${x.active?'ok':'bad'}">${x.active?'Actif':'Désactivé'}</span></td><td>${when(x.lastLogin)}</td><td><div class="quick-actions"><button data-act="pw" data-n="${E(x.name)}">Nouveau mot de passe</button><button data-act="${x.active?'off':'on'}" data-n="${E(x.name)}">${x.active?'Désactiver':'Réactiver'}</button></div></td></tr>`).join('')+'</tbody>';
    $('usersTable').onclick=async ev=>{const t=ev.target.closest('button[data-act]');if(!t)return;const name=t.dataset.n,a=t.dataset.act;let body={name};
      if(a==='pw'){const p=prompt(`Nouveau mot de passe pour ${name} (8 caractères minimum) :`);if(!p)return;body.password=p}else body.active=a==='on';
      try{await api('admin/user-update',body);buildSecurity(false)}catch(e){alert(e.message)}};
    $('logTable').innerHTML='<thead><tr><th>Date et heure</th><th>Utilisateur</th><th>Action</th><th>Détail</th><th>Appareil</th><th>Adresse IP</th></tr></thead><tbody>'+l.entries.map(x=>`<tr><td>${when(x.t)}</td><td>${E(x.u)}</td><td>${E(x.a)}</td><td>${E(x.d||'')}${x.n>1?` (+${x.n-1} autres)`:''}</td><td>${E(x.ua||'')}</td><td>${E(x.ip||'')}</td></tr>`).join('')+'</tbody>';
    $('backupList').innerHTML=b.keys.map(k=>`<button data-k="${E(k)}">${E(k.replace('backup-',''))}</button>`).join('')||'<span class="muted">Aucune pour l’instant.</span>';
    $('backupList').onclick=async ev=>{const t=ev.target.closest('button[data-k]');if(!t)return;try{const d=await api('admin/backup',{key:t.dataset.k});const bl=new Blob([JSON.stringify(d,null,2)],{type:'application/json'}),a=document.createElement('a');a.href=URL.createObjectURL(bl);a.download='CSDN_serveur_'+t.dataset.k.replace('backup-','')+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),700)}catch(e){alert(e.message)}};
  }catch(e){}
}

// ---------- restauration (administrateur) ----------
async function restore(full){
  if(!sess||sess.role!=='admin'){alert('Seul un administrateur peut restaurer une sauvegarde.');return}
  if(!online){alert('Connexion au serveur indisponible : restauration impossible pour le moment.');return}
  try{
    await api('admin/restore',{doc:{students:full.students,payments:full.payments,expenses:full.expenses,settings:full.settings}});
    const res=await api('sync',{baseRev:-1,epoch:-1,changes:{}});
    applyDoc(res,'replace');rerender();ui();alert('Sauvegarde restaurée et diffusée à tous les postes.');
  }catch(e){alert('Restauration impossible : '+e.message)}
}

// ---------- API publique pour app.js ----------
window.CSDN_CENTRAL={
  beforeSave(){stamp()},
  afterSave(){clearTimeout(saveT);ui();saveT=setTimeout(sync,300)},
  restore,syncNow:sync,
  _state:()=>({sess,st,online})
};

async function boot(){
  injectUI();document.body.classList.add('locked');
  $('authForm').addEventListener('submit',onSubmit);
  hasLocal=!!(localStorage.getItem(DBKEY)||LEGACY_KEYS.some(k=>localStorage.getItem(k)));
  const s=readSession();
  try{authStatus=await api('status',null,'GET')}catch(e){
    if(s){sess=s;await afterAuth();return}
    showAuth('down');$('authText').textContent=e.noApi?e.message:'Impossible de joindre le serveur. Vérifiez la connexion Internet.';return;
  }
  if(s){sess=s;await afterAuth();return}
  showAuth(authStatus.configured?'login':'setup');
}
boot();
})();
