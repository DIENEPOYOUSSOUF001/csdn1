
const DBKEY='csdn_v3_exports_relances_2026_2027';
const LEGACY_KEYS=['csdn_v3_tranches_2026_2027','csdn_v3_exact_2026_2027','csdn_v3_data'];
const classes=['PS','MS','GS','1A','2A','3A','4A','5A','6A'];
const tuitionTypes=new Set(['Mensualité','Trimestre','Annuel']);
let DEFAULT_TEMPLATE='';
const $=id=>document.getElementById(id);
const E=v=>escapeHtml(v);
let templateDirty=false;
const fmt=n=>new Intl.NumberFormat('fr-FR').format(Math.round(Number(n)||0))+' F';
const num=n=>new Intl.NumberFormat('fr-FR').format(Math.round(Number(n)||0));
const clone=v=>JSON.parse(JSON.stringify(v));
let initial=null;
function activeOp(o){return (o.status||'Validée')!=='Annulée'}
function mergeSeed(saved){
 const d=clone(initial); if(!saved)return d;
 d.settings=Object.assign({},d.settings,saved.settings||{});
 d.payments=saved.payments||[]; d.expenses=saved.expenses||[];
 const byId=new Map((saved.students||[]).map(s=>[s.id,s]));
 d.students=d.students.map(s=>Object.assign({},s,byId.get(s.id)||{}));
 const seedIds=new Set(d.students.map(s=>s.id));
 d.students.push(...(saved.students||[]).filter(s=>!seedIds.has(s.id)));
 d.students.forEach(normalizeRegistration);
 d.settings.logoDataUrl=(saved.settings&&saved.settings.logoDataUrl)||d.settings.logoDataUrl;
 d.settings.reminderTemplate=(saved.settings&&saved.settings.reminderTemplate)||d.settings.reminderTemplate;
 return d;
}
function load(){try{const raw=localStorage.getItem(DBKEY);if(raw){try{return mergeSeed(JSON.parse(raw))}catch(e){try{localStorage.setItem(DBKEY+'_illisible_'+Date.now(),raw)}catch(_){}window.__loadWarning='Les données enregistrées dans ce navigateur sont illisibles. Une copie brute a été conservée. Restaurez votre dernière sauvegarde JSON (bouton Restaurer).'}}}catch(e){}for(const k of (localStorage.getItem('csdn_migrated')?[]:LEGACY_KEYS)){try{const v=JSON.parse(localStorage.getItem(k)||'null');if(v)return mergeSeed(v)}catch(e){}}return clone(initial)}
function normalizeRegistration(s){
 // One-time migration preserves legacy balances. Origin is never consulted afterwards.
 if(!['due','free','exempt'].includes(s.registrationStatus)){
  s.registrationStatus=s.social==='Cas social'?'exempt':s.origin==='Ancien'?'free':'due';
  s.registrationAmount=s.registrationStatus==='due'?Number(['PS','MS','GS'].includes(s.className)?initial.settings.materIns:initial.settings.primIns):0;
  s.registrationNote=s.registrationNote||'';
 }
 return s;
}
let data=null;
// Les données de base (élèves, archives) ne sont plus publiques : elles sont chargées depuis le serveur après connexion.
function initSeed(seed){initial=seed;DEFAULT_TEMPLATE=seed.settings.reminderTemplate;data=load();data.students.forEach(normalizeRegistration)}
function save(){try{if(window.CSDN_CENTRAL)CSDN_CENTRAL.beforeSave();localStorage.setItem(DBKEY,JSON.stringify(data))}catch(e){alert('Enregistrement local impossible. Exportez immédiatement une sauvegarde JSON.');}renderAll();if(window.CSDN_CENTRAL)CSDN_CENTRAL.afterSave()}
function uid(p){return p+'-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,7)}
function receiptPrefix(){const y=String(data.settings.schoolYear||'2026-2027').split('-')[0]||'2026';return `REC-${y}-`}
function nextReceiptNumber(){
 const prefix=receiptPrefix(),rx=new RegExp('^'+prefix.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'(\\d+)$','i');let max=0;
 data.payments.forEach(p=>{const m=String(p.receipt||'').trim().match(rx);if(m)max=Math.max(max,+m[1]||0)});
 let n=max+1,code;do{code=prefix+String(n++).padStart(4,'0')}while(data.payments.some(p=>String(p.receipt||'').trim().toUpperCase()===code.toUpperCase()));return code
}
function suggestedCurrentPaymentType(s){if(!s)return'Mensualité';if(s.paymentPlan==='Annuel')return'Annuel';if(s.paymentPlan==='Trimestriel')return'Trimestre';return'Mensualité'}
function estimatedBalanceAfter(s,type,amount){
 amount=+amount||0;if(!s)return 0;
 if(type==='Impayé antérieur')return Math.max(0,oldRemaining(s)-amount);
 if(tuitionTypes.has(type))return Math.max(0,overdueTuition(s)-amount);
 if(type==='Inscription')return Math.max(0,feeForStudent(s).ins-registrationPaid(s.id)-amount);
 return 0
}

function dateOnly(s){return new Date(s+'T23:59:59')}
function today(){return new Date()}
function feeForStudent(s){
 normalizeRegistration(s);
 const mater=['PS','MS','GS'].includes(s.className),monthly=s.social==='Cas social'?0:(mater?+data.settings.materMonthly:+data.settings.primMonthly);
 const ins=s.registrationStatus==='due'?Number(s.registrationAmount):0;
 return{ins,monthly,annual:monthly*9};
}
function validPayments(){return data.payments.filter(activeOp)}
function validExpenses(){return data.expenses.filter(activeOp)}
function tuitionPaid(id){return validPayments().filter(p=>p.studentId===id&&tuitionTypes.has(p.type)).reduce((a,p)=>a+(+p.amount||0),0)}
function registrationPaid(id){return validPayments().filter(p=>p.studentId===id&&p.type==='Inscription').reduce((a,p)=>a+(+p.amount||0),0)}
function oldPaid(id){return validPayments().filter(p=>p.studentId===id&&p.type==='Impayé antérieur').reduce((a,p)=>a+(+p.amount||0),0)}
function oldInitial(s){return (+s.oldArrears.T1||0)+(+s.oldArrears.T2||0)+(+s.oldArrears.T3||0)}
function oldRemaining(s){return Math.max(0,oldInitial(s)-oldPaid(s.id))}
function oldRemainingByTranche(s){
 let p=oldPaid(s.id),r={T1:+s.oldArrears.T1||0,T2:+s.oldArrears.T2||0,T3:+s.oldArrears.T3||0};
 for(const k of ['T1','T2','T3']){const used=Math.min(r[k],p);r[k]-=used;p-=used}return r
}
function monthEnd(y,m){return new Date(y,m+1,0,23,59,59)}
function overdueBase(s){
 if(s.status!=='Actif'||s.social==='Cas social'||s.paymentPlan==='À définir')return 0;
 const f=feeForStudent(s),now=today();
 if(s.paymentPlan==='Trimestriel'){if(now>dateOnly(data.settings.deadlineT3))return 9*f.monthly;if(now>dateOnly(data.settings.deadlineT2))return 6*f.monthly;if(now>dateOnly(data.settings.deadlineT1))return 3*f.monthly;return 0}
 if(s.paymentPlan==='Annuel')return now>dateOnly(data.settings.annualDeadline)?9*f.monthly:0;
 if(s.paymentPlan==='Mensuel'){const start=new Date((data.settings.schoolStartDate||'2026-10-01')+'T00:00:00');let due=0;for(let i=0;i<9;i++){const y=start.getFullYear()+Math.floor((start.getMonth()+i)/12),m=(start.getMonth()+i)%12;if(now>monthEnd(y,m))due+=f.monthly}return due}
 return 0
}
function overdueTuition(s){return Math.max(0,overdueBase(s)-tuitionPaid(s.id))}
function activeStudents(){return data.students.filter(s=>s.status==='Actif')}
function totalReceipts(){return validPayments().reduce((a,p)=>a+(+p.amount||0),0)}
function totalExpenses(){return validExpenses().reduce((a,e)=>a+(+e.amount||0),0)}
function availableBalance(){return (+data.settings.openingBalance||0)+totalReceipts()-totalExpenses()}
function totalOldRemainingGross(){return data.students.reduce((a,s)=>a+oldRemaining(s),0)}
function officialInitial(){return data.archive2025_2026.officialReport.total}
function officialRemaining(){return Math.max(0,officialInitial()-data.students.reduce((a,s)=>a+oldPaid(s.id),0))}
function totalCurrentOverdue(){return activeStudents().reduce((a,s)=>a+overdueTuition(s),0)}
function totalOverdueBase(){return activeStudents().reduce((a,s)=>a+overdueBase(s),0)}
function monthKey(){return new Date().toISOString().slice(0,7)}
function monthReceipts(){const k=monthKey();return validPayments().filter(p=>(p.date||'').slice(0,7)===k).reduce((a,p)=>a+(+p.amount||0),0)}
function monthExpenses(){const k=monthKey();return validExpenses().filter(e=>(e.date||'').slice(0,7)===k).reduce((a,e)=>a+(+e.amount||0),0)}
function planStatus(s){if(s.social==='Cas social')return'EXONÉRÉ';if(s.status!=='Actif')return'INACTIF';if(s.paymentPlan==='À définir')return'MODE À DÉFINIR';return overdueTuition(s)>0?'IMPAYÉ':'À JOUR'}

function renderNav(){document.querySelectorAll('.nav').forEach(b=>b.onclick=()=>{document.querySelectorAll('.nav,.view').forEach(x=>x.classList.remove('active'));b.classList.add('active');$(b.dataset.view).classList.add('active')})}
function fillClass(id,all){const el=$(id),cur=el.value;el.innerHTML=all?`<option value="">${all}</option>`:'';classes.forEach(c=>el.add(new Option(c,c)));el.value=cur}
function renderBrand(){$('schoolYearLabel').textContent='Année scolaire '+data.settings.schoolYear;$('brandLogo').src=data.settings.logoDataUrl||'logo-csdn.svg'}
function refreshPaymentStudents(){
 const q=($('pStudentSearch').value||'').toLowerCase(),type=$('pType').value,cur=$('pStudent').value;
 let list;
 if(type==='Impayé antérieur')list=data.students.filter(s=>oldRemaining(s)>0);
 else if(type==='Inscription')list=data.students.filter(s=>s.status==='Actif'&&feeForStudent(s).ins>0);
 else list=data.students.filter(s=>s.status==='Actif');
 list=list.filter(s=>!q||`${s.lastName} ${s.firstName} ${s.id}`.toLowerCase().includes(q));
 $('pStudent').innerHTML='';list.sort((a,b)=>(a.lastName+a.firstName).localeCompare(b.lastName+b.firstName)).forEach(s=>$('pStudent').add(new Option(`${s.lastName} ${s.firstName} — ${s.className}`,s.id)));
 if([...$('pStudent').options].some(o=>o.value===cur))$('pStudent').value=cur;updatePaymentHint()
}
function updatePaymentHint(){
 const s=data.students.find(x=>x.id===$('pStudent').value);if(!s){$('paymentHint').textContent='Aucun élève correspondant.';return}
 if($('pType').value==='Impayé antérieur')$('paymentHint').textContent=`Solde débiteur individuel restant 2025-2026 : ${fmt(oldRemaining(s))}`;
 else if($('pType').value==='Inscription')$('paymentHint').textContent=`Inscription : ${fmt(feeForStudent(s).ins)} • Payé : ${fmt(registrationPaid(s.id))} • Reste : ${fmt(Math.max(0,feeForStudent(s).ins-registrationPaid(s.id)))}. Décision modifiable dans la fiche élève.`;
 else $('paymentHint').textContent=`Mode : ${s.paymentPlan} • Impayé échu : ${fmt(overdueTuition(s))}`
}
function fillSelects(){
 fillClass('sClass');fillClass('studentClassFilter','Toutes les classes');fillClass('arrearsClassFilter','Toutes les classes');fillClass('promotionClassFilter','Toutes les anciennes classes');fillClass('reminderClassFilter','Toutes les classes');
 const ec=$('eCategory'),ef=$('expenseCategoryFilter'),c=ec.value,f=ef.value;ec.innerHTML='';ef.innerHTML='<option value="">Toutes les catégories</option>';data.categories.forEach(x=>{ec.add(new Option(x,x));ef.add(new Option(x,x))});ec.value=c;ef.value=f;refreshPaymentStudents()
}

function promotionRows(){
 const q=($('promotionSearch').value||'').toLowerCase(),cf=$('promotionClassFilter').value,vf=$('promotionValidationFilter').value;
 return data.students.filter(s=>s.origin==='Ancien'&&s.previousClass&&(!q||`${s.lastName} ${s.firstName}`.toLowerCase().includes(q))&&(!cf||s.previousClass===cf)&&(!vf||(vf==='oui')===!!s.promotionValidated))
}
function nextClass(c){const i=classes.indexOf(c);return i>=0&&i<classes.length-1?classes[i+1]:''}
function renderPromotion(){
 const rows=promotionRows();
 $('promotionTable').innerHTML='<thead><tr><th>Élève</th><th>Classe 2025-2026</th><th>Décision</th><th>Classe proposée</th><th>Classe actuelle</th><th>Validation</th><th>Action</th></tr></thead><tbody>'+rows.map(s=>{
   const decisions=['Admis','Redouble','Sortant'];if(!decisions.includes(s.promotionDecision))decisions.unshift('À valider');
   const opts=decisions.map(x=>`<option ${s.promotionDecision===x?'selected':''}>${x}</option>`).join('');
   const classopts=['',...classes].map(x=>`<option value="${x}" ${s.proposedClass===x?'selected':''}>${x||'—'}</option>`).join('');
   const inactive=s.status!=='Actif'?' <span class="badge bad">Inactif</span>':'';
   return `<tr><td>${E(s.lastName)} ${E(s.firstName)}</td><td>${E(s.previousClass)}</td><td><select class="promotion-select" onchange="setPromotionDecision('${s.id}',this.value)">${opts}</select></td><td><select class="promotion-select" onchange="setProposedClass('${s.id}',this.value)">${classopts}</select></td><td>${E(s.className)}${inactive}</td><td><span class="badge ${s.promotionValidated?'ok':'warn'}">${s.promotionValidated?'Validé':'À valider'}</span></td><td><button onclick="applyPromotion('${s.id}')">Valider</button></td></tr>`
 }).join('')+'</tbody>'
}
window.setPromotionDecision=(id,v)=>{const s=data.students.find(x=>x.id===id);if(!s)return;s.promotionDecision=v;if(v==='Redouble')s.proposedClass=s.previousClass;else if(v==='Sortant')s.proposedClass='';else if(v==='Admis'&&(!s.proposedClass||s.proposedClass===s.previousClass))s.proposedClass=nextClass(s.previousClass);save()};
window.setProposedClass=(id,v)=>{const s=data.students.find(x=>x.id===id);if(!s)return;s.proposedClass=v;save()};
function applyPromotionTo(s){if(s.promotionDecision==='Sortant'){s.status='Inactif'}else if(s.promotionDecision==='Redouble'){s.className=s.previousClass;s.status='Actif'}else{s.className=s.proposedClass||s.className;s.status='Actif'}s.promotionValidated=true}
window.applyPromotion=id=>{
 const s=data.students.find(x=>x.id===id);if(!s)return;
 if(!['Admis','Redouble','Sortant'].includes(s.promotionDecision)){alert('Choisissez d’abord une décision : Admis, Redouble ou Sortant.');return}
 if(s.promotionDecision==='Admis'&&!s.proposedClass){alert('Choisissez la classe proposée avant de valider ce passage.');return}
 const reactivate=s.status!=='Actif'&&s.promotionDecision!=='Sortant';
 if(!confirm(`Valider le passage de ${s.lastName} ${s.firstName} ?`+(reactivate?'\n\nAttention : cet élève est actuellement inactif, il sera réactivé.':'')))return;
 applyPromotionTo(s);save()
};
function validateAllPromotions(){
 const shown=promotionRows().filter(s=>!s.promotionValidated&&s.status==='Actif');
 const ready=shown.filter(s=>['Redouble','Sortant'].includes(s.promotionDecision)||(s.promotionDecision==='Admis'&&s.proposedClass));
 const skipped=shown.length-ready.length;
 if(!ready.length){alert(skipped?`${skipped} élève(s) affiché(s) n’ont pas de décision ou de classe proposée complète.`:'Aucune décision à valider parmi les élèves affichés.');return}
 if(!confirm(`Valider les décisions de passage pour ${ready.length} élève(s) affiché(s) ?`+(skipped?`\n${skipped} élève(s) sans décision complète seront ignorés.`:'')+'\nVérifiez les redoublants avant de continuer.'))return;
 ready.forEach(applyPromotionTo);save()
}

function renderStudents(){
 const q=($('studentSearch').value||'').toLowerCase(),cf=$('studentClassFilter').value,pf=$('studentPlanFilter').value,sf=$('studentStatusFilter').value;
 const rows=data.students.filter(s=>(!q||`${s.lastName} ${s.firstName}`.toLowerCase().includes(q))&&(!cf||s.className===cf)&&(!pf||s.paymentPlan===pf)&&(!sf||s.status===sf));
 $('studentsTable').innerHTML='<thead><tr><th>Élève</th><th>Classe</th><th>Origine</th><th>Inscription</th><th>Mode</th><th>Social</th><th>Statut</th><th>Impayé échu</th><th>Report individuel</th><th>Actions</th></tr></thead><tbody>'+rows.map(s=>`<tr><td><button class="secondary-link" onclick="openStudentProfile('${s.id}')">${E(s.lastName)} ${E(s.firstName)}</button></td><td>${E(s.className)}</td><td>${E(s.origin)}</td><td>${registrationLabel(s)}</td><td>${E(s.paymentPlan)}</td><td>${E(s.social)}</td><td>${planStatus(s)}</td><td>${fmt(overdueTuition(s))}</td><td>${fmt(oldRemaining(s))}</td><td><div class="quick-actions"><button onclick="openStudentProfile('${s.id}')">Fiche</button><button onclick="openPaymentForStudent('${s.id}','current')">Encaisser</button><button onclick="editStudent('${s.id}')">Modifier</button></div></td></tr>`).join('')+'</tbody>'
}
function renderPayments(){
 const q=($('paymentSearch').value||'').toLowerCase(),tf=$('paymentTypeFilter').value,sf=$('paymentStatusFilter').value;
 const rows=[...data.payments].filter(p=>{const s=data.students.find(x=>x.id===p.studentId),name=s?`${s.lastName} ${s.firstName}`:'';return(!q||`${name} ${p.receipt||''} ${p.period||''}`.toLowerCase().includes(q))&&(!tf||p.type===tf)&&(!sf||(p.status||'Validée')===sf)}).sort((a,b)=>(b.date||'').localeCompare(a.date||''));
 $('paymentsTable').innerHTML='<thead><tr><th>Date</th><th>Élève</th><th>Nature</th><th>Période</th><th>Montant</th><th>Reçu</th><th>Statut</th><th>Action</th></tr></thead><tbody>'+rows.map(p=>{const s=data.students.find(x=>x.id===p.studentId),st=p.status||'Validée',voided=st==='Annulée';return `<tr class="${voided?'voided-row':''}"><td>${E(p.date)}</td><td>${s?`${E(s.lastName)} ${E(s.firstName)}`:E(p.studentId)}</td><td>${E(p.type)}</td><td>${E(p.period||'')}</td><td>${fmt(p.amount)}</td><td>${E(p.receipt||'')}</td><td><span class="badge ${voided?'bad':'ok'}">${st}</span></td><td>${voided?`<small>${E(p.voidReason||'')}</small>`:`<button class="danger" onclick="voidPayment('${p.id}')">Annuler</button>`}</td></tr>`}).join('')+'</tbody>'
}
function renderArrears(){
 const q=($('arrearsSearch').value||'').toLowerCase(),cf=$('arrearsClassFilter').value,filt=s=>(!q||`${s.lastName} ${s.firstName}`.toLowerCase().includes(q))&&(!cf||s.className===cf);
 const old=data.students.filter(s=>filt(s)&&oldRemaining(s)>0),cur=data.students.filter(s=>filt(s)&&overdueTuition(s)>0),r=data.archive2025_2026.officialReport;
 $('arrearsSummary').innerHTML=[['T1 officiel',fmt(r.T1)],['T2 officiel',fmt(r.T2)],['T3 officiel',fmt(r.T3)],['Total officiel',fmt(r.total)]].map(([l,v])=>`<div class="summary-box"><small>${l}</small><strong>${E(v)}</strong></div>`).join('');
 $('arrearsOldTable').innerHTML='<thead><tr><th>Élève</th><th>Classe</th><th>T1 débiteur</th><th>T2 débiteur</th><th>T3 débiteur</th><th>Règlements</th><th>Solde individuel</th><th>Action</th></tr></thead><tbody>'+old.map(s=>{const x=oldRemainingByTranche(s);return `<tr><td><button class="secondary-link" onclick="openStudentProfile('${s.id}')">${E(s.lastName)} ${E(s.firstName)}</button></td><td>${E(s.className)}</td><td>${fmt(x.T1)}</td><td>${fmt(x.T2)}</td><td>${fmt(x.T3)}</td><td>${fmt(oldPaid(s.id))}</td><td>${fmt(oldRemaining(s))}</td><td><button class="primary" onclick="openPaymentForStudent('${s.id}','old')">Encaisser</button></td></tr>`}).join('')+'</tbody>';
 $('arrearsCurrentTable').innerHTML='<thead><tr><th>Élève</th><th>Classe</th><th>Mode</th><th>Base échue</th><th>Payé scolarité</th><th>Impayé</th><th>Action</th></tr></thead><tbody>'+cur.map(s=>`<tr><td><button class="secondary-link" onclick="openStudentProfile('${s.id}')">${E(s.lastName)} ${E(s.firstName)}</button></td><td>${E(s.className)}</td><td>${s.paymentPlan}</td><td>${fmt(overdueBase(s))}</td><td>${fmt(tuitionPaid(s.id))}</td><td>${fmt(overdueTuition(s))}</td><td><button class="primary" onclick="openPaymentForStudent('${s.id}','current')">Encaisser</button></td></tr>`).join('')+'</tbody>'
}

function filteredReminderDebtors(){
 const q=($('reminderSearch').value||'').toLowerCase(),cf=$('reminderClassFilter').value;
 return data.students.filter(s=>oldRemaining(s)>0&&(!q||`${s.lastName} ${s.firstName} ${s.guardian||''}`.toLowerCase().includes(q))&&(!cf||s.className===cf)).sort((a,b)=>(a.lastName+a.firstName).localeCompare(b.lastName+b.firstName))
}
function reminderText(s){
 const r=oldRemainingByTranche(s),map={
  '{NOM}':s.lastName||'', '{PRENOM}':s.firstName||'', '{CLASSE}':s.className||'',
  '{TUTEUR}':s.guardian||'Parent / Tuteur', '{CONTACT}':s.phone||'',
  '{T1}':num(r.T1), '{T2}':num(r.T2), '{T3}':num(r.T3), '{MONTANT}':num(oldRemaining(s))
 };
 let t=data.settings.reminderTemplate||DEFAULT_TEMPLATE;Object.entries(map).forEach(([k,v])=>{t=t.split(k).join(v)});return t
}
function renderReminderTemplate(){if(!templateDirty)$('reminderTemplate').value=data.settings.reminderTemplate||DEFAULT_TEMPLATE}
function renderReminders(){
 const rows=filteredReminderDebtors();
 $('remindersTable').innerHTML='<thead><tr><th><input type="checkbox" id="reminderSelectAll"></th><th>Élève</th><th>Classe</th><th>Tuteur</th><th>Contact</th><th>T1</th><th>T2</th><th>T3</th><th>Total</th><th>Action</th></tr></thead><tbody>'+rows.map(s=>{const r=oldRemainingByTranche(s);return `<tr><td><input class="reminderCheck" type="checkbox" value="${s.id}"></td><td>${E(s.lastName)} ${E(s.firstName)}</td><td>${E(s.className)}</td><td>${E(s.guardian||'')}</td><td>${E(s.phone||'')}</td><td>${fmt(r.T1)}</td><td>${fmt(r.T2)}</td><td>${fmt(r.T3)}</td><td>${fmt(oldRemaining(s))}</td><td><button onclick="previewReminder('${s.id}')">Aperçu</button> <button onclick="printReminder('${s.id}')">Imprimer</button></td></tr>`}).join('')+'</tbody>';
 const all=$('reminderSelectAll');if(all)all.onchange=()=>document.querySelectorAll('.reminderCheck').forEach(c=>c.checked=all.checked)
}
window.previewReminder=id=>{const s=data.students.find(x=>x.id===id);if(s)$('reminderPreview').textContent=reminderText(s)};
function reminderPrintHtml(list){
 const logo=$('brandLogo').src;
 return `<!doctype html><html><head><meta charset="utf-8"><title>Relances CSDN</title><style>body{font-family:Arial,sans-serif;color:#111;margin:0}.msg{padding:24mm 20mm;min-height:260mm;page-break-after:always}.head{display:flex;align-items:center;gap:16px;border-bottom:2px solid #111;padding-bottom:10px;margin-bottom:24px}.head img{width:70px;height:70px;object-fit:contain}.head h2{margin:0}.text{white-space:pre-wrap;line-height:1.55;font-size:14px}@media print{.msg:last-child{page-break-after:auto}}</style></head><body>${list.map(s=>`<section class="msg"><div class="head"><img src="${logo}"><div><h2>Complexe Scolaire C.S.D.N.</h2><div>Relance — Année scolaire 2025-2026</div></div></div><div class="text">${escapeHtml(reminderText(s))}</div></section>`).join('')}<script>window.onload=()=>window.print()</script></body></html>`
}
window.printReminder=id=>{const s=data.students.find(x=>x.id===id);if(s)openPrintWindow(reminderPrintHtml([s]))};
function printSelectedReminders(){const ids=[...document.querySelectorAll('.reminderCheck:checked')].map(c=>c.value),list=ids.map(id=>data.students.find(s=>s.id===id)).filter(Boolean);if(!list.length){alert('Sélectionnez au moins un élève.');return}openPrintWindow(reminderPrintHtml(list))}
function printAllFilteredReminders(){const list=filteredReminderDebtors();if(!list.length){alert('Aucun impayé dans le filtre actuel.');return}openPrintWindow(reminderPrintHtml(list))}
function exportReminders(){
 const rows=filteredReminderDebtors();const headers=['Élève','Classe','Tuteur','Contact','T1','T2','T3','Total'];
 const body=rows.map(s=>{const r=oldRemainingByTranche(s);return[`${s.lastName} ${s.firstName}`,s.className,s.guardian||'',s.phone||'',r.T1,r.T2,r.T3,oldRemaining(s)]});
 exportMatrixExcel(headers,body,'relances_impayes_2025_2026.xls','Relances impayés 2025-2026')
}

function renderExpenses(){
 const q=($('expenseSearch').value||'').toLowerCase(),cf=$('expenseCategoryFilter').value,sf=$('expenseStatusFilter').value;
 const rows=[...data.expenses].filter(e=>(!q||`${e.label||''} ${e.category||''}`.toLowerCase().includes(q))&&(!cf||e.category===cf)&&(!sf||(e.status||'Validée')===sf)).sort((a,b)=>(b.date||'').localeCompare(a.date||''));
 $('expensesTable').innerHTML='<thead><tr><th>Date</th><th>Catégorie</th><th>Libellé</th><th>Montant</th><th>Statut</th><th>Action</th></tr></thead><tbody>'+rows.map(e=>{const st=e.status||'Validée',v=st==='Annulée';return `<tr class="${v?'voided-row':''}"><td>${E(e.date)}</td><td>${E(e.category)}</td><td>${E(e.label)}</td><td>${fmt(e.amount)}</td><td><span class="badge ${v?'bad':'ok'}">${st}</span></td><td>${v?`<small>${E(e.voidReason||'')}</small>`:`<button class="danger" onclick="voidExpense('${e.id}')">Annuler</button>`}</td></tr>`}).join('')+'</tbody>'
}
function renderDashboard(){
 const active=activeStudents(),cash=totalReceipts(),exp=totalExpenses(),bal=availableBalance(),cur=totalCurrentOverdue(),base=totalOverdueBase(),r=data.archive2025_2026.officialReport;
 $('heroBalance').textContent=fmt(bal);$('heroTime').textContent='Actualisé '+new Date().toLocaleString('fr-FR');
 const cards=[['Solde disponible',fmt(bal),'Opérations validées uniquement'],['Encaissements',fmt(cash),'Paiements validés'],['Dépenses',fmt(exp),'Dépenses validées'],['T3 officiel 2025-2026',fmt(r.T3),'Montant retenu'],['Report officiel initial',fmt(r.total),'T1 + T2 + T3 officiels'],['Impayés 2026-2027',fmt(cur),'Uniquement après échéance'],['Base échue',fmt(base),'Selon modes de règlement'],['Encaissements du mois',fmt(monthReceipts()),'Mois en cours'],['Effectif actif',active.length,`${active.filter(s=>s.social==='Cas social').length} cas sociaux`],['Modes à définir',active.filter(s=>s.paymentPlan==='À définir'&&s.social!=='Cas social').length,'À paramétrer']];
 $('dashboardCards').innerHTML=cards.map(([l,v,s])=>`<div class="card"><div class="label">${l}</div><div class="value">${v}</div><div class="sub">${s}</div></div>`).join('');
 $('financialRealtime').innerHTML=[['Solde initial',fmt(+data.settings.openingBalance||0)],['Résultat de trésorerie',fmt(cash-exp)],['Report officiel restant',fmt(officialRemaining())],['Soldes débiteurs individuels restants',fmt(totalOldRemainingGross())],['Écart du mois',fmt(monthReceipts()-monthExpenses())]].map(([k,v])=>`<div class="metric-item"><span>${k}</span><strong>${E(v)}</strong></div>`).join('');
 $('deadlineSummary').innerHTML=[['T1 trimestriel',data.settings.deadlineT1],['T2 trimestriel',data.settings.deadlineT2],['T3 trimestriel',data.settings.deadlineT3],['Annuel',data.settings.annualDeadline],['Mensuel','Fin de chaque mois']].map(([k,v])=>`<div class="metric-item"><span>${k}</span><strong>${E(v)}</strong></div>`).join('');
 const alerts=[];const undef=active.filter(s=>s.paymentPlan==='À définir'&&s.social!=='Cas social').length,unvalidated=active.filter(s=>s.origin==='Ancien'&&s.previousClass&&!s.promotionValidated).length;if(unvalidated)alerts.push(`${unvalidated} anciens élèves ont un passage de classe non encore validé.`);if(undef)alerts.push(`${undef} élèves ont encore un mode de règlement « À définir » : aucun impayé courant n'est calculé pour eux.`);if((+data.settings.openingBalance||0)===0)alerts.push('Renseignez le solde initial de caisse si nécessaire.');if(bal<0)alerts.push('Le solde disponible est négatif.');$('alerts').innerHTML=alerts.length?alerts.map(a=>`<div class="alert">${a}</div>`).join(''):'<span class="badge ok">Aucune alerte</span>';
 $('classSummary').innerHTML='<thead><tr><th>Classe</th><th>Actifs</th><th>Cas sociaux</th><th>Modes définis</th><th>Solde débiteur ancien</th><th>Impayé courant</th></tr></thead><tbody>'+classes.map(c=>{const ss=active.filter(s=>s.className===c);return `<tr><td>${c}</td><td>${ss.length}</td><td>${ss.filter(s=>s.social==='Cas social').length}</td><td>${ss.filter(s=>s.paymentPlan!=='À définir'||s.social==='Cas social').length}</td><td>${fmt(data.students.filter(s=>s.className===c).reduce((a,s)=>a+oldRemaining(s),0))}</td><td>${fmt(ss.reduce((a,s)=>a+overdueTuition(s),0))}</td></tr>`}).join('')+'</tbody>';
 const top=data.students.map(s=>({s,total:oldRemaining(s)+overdueTuition(s)})).filter(x=>x.total>0).sort((a,b)=>b.total-a.total).slice(0,12);$('topArrearsTable').innerHTML='<thead><tr><th>Élève</th><th>Classe</th><th>Ancien</th><th>Courant</th><th>Total</th></tr></thead><tbody>'+top.map(x=>`<tr><td>${E(x.s.lastName)} ${E(x.s.firstName)}</td><td>${E(x.s.className)}</td><td>${fmt(oldRemaining(x.s))}</td><td>${fmt(overdueTuition(x.s))}</td><td>${fmt(x.total)}</td></tr>`).join('')+'</tbody>'
}
function renderTreasury(){
 $('treasuryCards').innerHTML=[['Solde initial',fmt(+data.settings.openingBalance||0)],['Encaissements validés',fmt(totalReceipts())],['Dépenses validées',fmt(totalExpenses())],['Solde disponible',fmt(availableBalance())]].map(([l,v])=>`<div class="card"><div class="label">${l}</div><div class="value">${v}</div></div>`).join('');
 const moves=[...data.payments.map(p=>({date:p.date,type:'Encaissement',label:p.type,amount:+p.amount||0,status:p.status||'Validée'})),...data.expenses.map(e=>({date:e.date,type:'Dépense',label:e.category+' — '+e.label,amount:-(+e.amount||0),status:e.status||'Validée'}))].sort((a,b)=>(b.date||'').localeCompare(a.date||''));$('treasuryTable').innerHTML='<thead><tr><th>Date</th><th>Nature</th><th>Libellé</th><th>Montant</th><th>Statut</th></tr></thead><tbody>'+moves.map(m=>`<tr class="${m.status==='Annulée'?'voided-row':''}"><td>${E(m.date)}</td><td>${E(m.type)}</td><td>${E(m.label)}</td><td>${fmt(m.amount)}</td><td>${m.status}</td></tr>`).join('')+'</tbody>'
}
function renderControls(){
 const r=data.archive2025_2026.officialReport,active=activeStudents(),receipts=data.payments.map(p=>p.receipt).filter(Boolean);
 const checks=[['T1 officiel',r.T1===17250,fmt(r.T1)],['T2 officiel',r.T2===152500,fmt(r.T2)],['T3 officiel',r.T3===583750,fmt(r.T3)],['Total officiel',r.total===753500,fmt(r.total)],['Aucune fiche élève perdue',data.students.length>=initial.students.length,`${data.students.length} fiches (référence initiale : ${initial.students.length})`],['Effectif actif',active.length>0,`${active.length} élèves actifs`],['PS avant validation des passages',active.filter(s=>s.className==='PS').length>=0,String(active.filter(s=>s.className==='PS').length)],['Cas sociaux actifs',true,`${active.filter(s=>s.social==='Cas social').length} (référence initiale : 7)`],['Décisions inscription valides',data.students.every(s=>['due','free','exempt'].includes(s.registrationStatus)&&Number.isFinite(+s.registrationAmount)&&+s.registrationAmount>=0&&(s.registrationStatus!=='due'||+s.registrationAmount>0)),'Décision individuelle'],['Reçus uniques',new Set(receipts).size===receipts.length,'Aucun doublon attendu'],['Opérations annulées exclues',true,'Contrôle applicatif']];
 $('controlsTable').innerHTML='<thead><tr><th>Contrôle</th><th>Résultat</th><th>Détail</th></tr></thead><tbody>'+checks.map(([n,o,d])=>`<tr><td>${n}</td><td><span class="badge ${o?'ok':'bad'}">${o?'OK':'À VÉRIFIER'}</span></td><td>${d}</td></tr>`).join('')+'</tbody>'
}
function renderArchive(){const o=data.archive2025_2026.officialReport,g=data.archive2025_2026.debtorGross,h=data.archive2025_2026.hiddenOverpayments;$('archivePreview').textContent=`ÉTAT OFFICIEL RETENU 2025-2026\nT1 : ${fmt(o.T1)}\nT2 : ${fmt(o.T2)}\nT3 : ${fmt(o.T3)}\nTOTAL : ${fmt(o.total)}\n\nGESTION DES RELANCES\nLes relances sont produites uniquement pour les soldes débiteurs individuels positifs. Les trop-perçus sont mis en sourdine et ne génèrent aucune relance.\n\nMontants débiteurs individuels avant règlements :\nT1 : ${fmt(g.T1)}\nT2 : ${fmt(g.T2)}\nT3 : ${fmt(g.T3)}\n\nTrop-perçus conservés techniquement pour traitement ultérieur : ${fmt(h.total)}\n\nSources :\n- ${data.archive2025_2026.sourceFiles.join('\n- ')}`}
function renderSettings(){$('schoolYear').value=data.settings.schoolYear;$('openingBalance').value=data.settings.openingBalance||0;$('feeMaterIns').value=data.settings.materIns;$('feeMaterMonthly').value=data.settings.materMonthly;$('feePrimIns').value=data.settings.primIns;$('feePrimMonthly').value=data.settings.primMonthly;$('deadlineT1').value=data.settings.deadlineT1;$('deadlineT2').value=data.settings.deadlineT2;$('deadlineT3').value=data.settings.deadlineT3;$('annualDeadline').value=data.settings.annualDeadline;$('expenseCategoryList').innerHTML=data.categories.map(c=>`<span class="chip">${E(c)}</span>`).join('')}
function renderAll(){renderNav();fillSelects();renderBrand();renderPromotion();renderStudents();renderPayments();renderArrears();renderReminderTemplate();renderReminders();renderExpenses();renderDashboard();renderTreasury();renderControls();renderArchive();renderSettings()}


function studentOperations(s){
 const ps=data.payments.filter(p=>p.studentId===s.id).map(p=>({date:p.date||'',nature:'Paiement',detail:`${p.type}${p.period?' — '+p.period:''}`,amount:+p.amount||0,status:p.status||'Validée',receipt:p.receipt||''}));
 return ps.sort((a,b)=>(b.date||'').localeCompare(a.date||''))
}
window.openStudentProfile=id=>{
 const s=data.students.find(x=>x.id===id);if(!s)return;
 $('profileName').textContent=`${s.lastName} ${s.firstName}`;$('profileMeta').textContent=`${s.id} • ${s.className} • ${s.status}`;
 $('profileIdentity').innerHTML=[['Classe',s.className],['Origine',s.origin],['Tuteur',s.guardian||'—'],['Contact',s.phone||'—'],['Mode de règlement',s.paymentPlan||'À définir'],['Statut social',s.social],['Inscription',registrationLabel(s)],['Statut financier',planStatus(s)]].map(([k,v])=>`<div class="profile-item"><small>${k}</small><strong>${E(v)}</strong></div>`).join('');
 const r=oldRemainingByTranche(s);$('profileOldSituation').innerHTML=[['T1 restant',fmt(r.T1)],['T2 restant',fmt(r.T2)],['T3 restant',fmt(r.T3)],['Règlements anciens',fmt(oldPaid(s.id))],['Solde individuel',fmt(oldRemaining(s))]].map(([k,v])=>`<div class="metric-item"><span>${k}</span><strong>${E(v)}</strong></div>`).join('');
 $('profileCurrentSituation').innerHTML=[['Base échue',fmt(overdueBase(s))],['Scolarité payée',fmt(tuitionPaid(s.id))],['Impayé échu',fmt(overdueTuition(s))],['Inscription due',fmt(feeForStudent(s).ins)],['Inscription payée',fmt(registrationPaid(s.id))],['Inscription restante',fmt(Math.max(0,feeForStudent(s).ins-registrationPaid(s.id)))],['Crédit inscription',fmt(Math.max(0,registrationPaid(s.id)-feeForStudent(s).ins))],['Mode',s.paymentPlan||'À définir']].map(([k,v])=>`<div class="metric-item"><span>${k}</span><strong>${E(v)}</strong></div>`).join('');
 const ops=studentOperations(s);$('profileHistoryTable').innerHTML='<thead><tr><th>Date</th><th>Nature</th><th>Détail</th><th>Montant</th><th>Reçu</th><th>Statut</th></tr></thead><tbody>'+ (ops.length?ops.map(o=>`<tr class="${o.status==='Annulée'?'voided-row':''}"><td>${E(o.date)}</td><td>${E(o.nature)}</td><td>${E(o.detail)}</td><td>${fmt(o.amount)}</td><td>${E(o.receipt)}</td><td>${o.status}</td></tr>`).join(''):'<tr><td colspan="6">Aucune opération enregistrée.</td></tr>') +'</tbody>';
 $('profilePayCurrentBtn').onclick=()=>{ $('studentProfileDialog').close();openPaymentForStudent(s.id,'current') };
 $('profilePayOldBtn').style.display=oldRemaining(s)>0?'inline-block':'none';$('profilePayOldBtn').onclick=()=>{ $('studentProfileDialog').close();openPaymentForStudent(s.id,'old') };
 $('profileEditBtn').onclick=()=>{ $('studentProfileDialog').close();editStudent(s.id) };
 $('studentProfileDialog').showModal()
};
function preparePaymentDialog(){
 $('paymentForm').reset();$('pDate').value=new Date().toISOString().slice(0,10);$('pStudentSearch').value='';$('pReceipt').value=nextReceiptNumber();$('pReceipt').classList.add('receipt-auto')
}
window.openPaymentForStudent=(id,kind='current')=>{
 const s=data.students.find(x=>x.id===id);if(!s)return;if(kind!=='old'&&s.status!=='Actif'){alert('Cet élève est inactif : réactivez-le dans sa fiche (Modifier) avant d’encaisser de la scolarité.');return}preparePaymentDialog();$('pType').value=kind==='old'?'Impayé antérieur':suggestedCurrentPaymentType(s);refreshPaymentStudents();$('pStudent').value=id;updatePaymentHint();
 if(kind==='old'){$('pPeriod').value='2025-2026';$('pAmount').value=oldRemaining(s)||''}else{$('pPeriod').value=s.paymentPlan==='Trimestriel'?'Tranche en cours':s.paymentPlan==='Annuel'?'Année 2026-2027':'';$('pAmount').value=overdueTuition(s)||''}
 $('paymentDialog').showModal()
};
function paymentDraft(){const s=data.students.find(x=>x.id===$('pStudent').value);return{s,type:$('pType').value,amount:+$('pAmount').value||0,receipt:$('pReceipt').value.trim(),period:$('pPeriod').value.trim(),date:$('pDate').value,mode:$('pMode').value}}
function validatePaymentDraft(d){
 if(!d.s||d.amount<=0)return'Sélectionnez un élève et saisissez un montant positif.';
 if(!Number.isFinite(d.amount)||!Number.isInteger(d.amount))return'Montant invalide : saisissez un nombre entier de francs.';
 if((d.type==='Inscription'||tuitionTypes.has(d.type))&&d.s.status!=='Actif')return'Cet élève est inactif : réactivez-le dans sa fiche (Modifier) avant d’encaisser.';
 if(d.type==='Inscription'&&feeForStudent(d.s).ins<=0)return'Inscription gratuite ou exonérée. Modifiez la décision dans la fiche élève pour rendre les frais exigibles.';
 if(d.type==='Inscription'&&d.amount>Math.max(0,feeForStudent(d.s).ins-registrationPaid(d.s.id)))return'Le montant dépasse le solde des frais d’inscription.';
 if(!d.receipt)return'Le numéro de reçu est obligatoire.';
 if(data.payments.some(p=>String(p.receipt||'').trim().toUpperCase()===d.receipt.toUpperCase()))return'Ce numéro de reçu existe déjà, y compris dans les opérations annulées.';
 if(d.type==='Impayé antérieur'&&d.amount>oldRemaining(d.s))return`Le règlement dépasse le solde débiteur individuel restant (${fmt(oldRemaining(d.s))}).`;
 if(tuitionTypes.has(d.type)&&d.s.social==='Cas social')return'Cet élève est exonéré des frais de scolarité.';
 return''
}
function showPaymentConfirmation(){
 if(!$('paymentForm').reportValidity())return;const d=paymentDraft(),err=validatePaymentDraft(d);if(err){alert(err);return}
 const before=d.type==='Impayé antérieur'?oldRemaining(d.s):tuitionTypes.has(d.type)?overdueTuition(d.s):d.type==='Inscription'?Math.max(0,feeForStudent(d.s).ins-registrationPaid(d.s.id)):0;
 const after=estimatedBalanceAfter(d.s,d.type,d.amount);
 $('paymentConfirmSummary').innerHTML=[['Élève',`${d.s.lastName} ${d.s.firstName}`],['Classe',d.s.className],['Nature',d.type],['Période',d.period||'—'],['Montant',fmt(d.amount)],['Mode',d.mode],['N° reçu',d.receipt],['Solde avant',fmt(before)],['Reste estimé après paiement',fmt(after)]].map(([k,v])=>`<div class="metric-item"><span>${k}</span><strong class="${k.includes('après')?'balance-after':''}">${E(v)}</strong></div>`).join('');
 $('paymentConfirmDialog').showModal()
}
function commitPayment(){
 const d=paymentDraft(),err=validatePaymentDraft(d);if(err){$('paymentConfirmDialog').close();alert(err);return}
 data.payments.push({id:uid('PAY'),studentId:d.s.id,date:d.date,type:d.type,period:d.period,amount:d.amount,mode:d.mode,receipt:d.receipt,status:'Validée',createdAt:new Date().toISOString()});$('paymentConfirmDialog').close();$('paymentDialog').close();save()
}
function editStudent(id){const s=data.students.find(x=>x.id===id);if(!s)return;$('studentId').value=s.id;$('sLastName').value=s.lastName;$('sFirstName').value=s.firstName;$('sClass').value=s.className;$('sPaymentPlan').value=s.paymentPlan||'À définir';$('sPhone').value=s.phone||'';$('sSocial').value=s.social;$('sStatus').value=s.status;$('sOrigin').value=s.origin;normalizeRegistration(s);$('sRegistrationStatus').value=s.registrationStatus;$('sRegistrationAmount').value=s.registrationAmount;$('sRegistrationNote').value=s.registrationNote||'';syncRegistrationForm();$('studentDialog').showModal()}
window.editStudent=editStudent;
window.voidPayment=id=>{const p=data.payments.find(x=>x.id===id);if(!p||!activeOp(p))return;const reason=prompt("Motif de l'annulation :");if(!reason||!reason.trim())return;if(!confirm("Confirmer l'annulation ? L'opération restera visible mais sera exclue des calculs."))return;p.status='Annulée';p.voidReason=reason.trim();p.voidedAt=new Date().toISOString();save()};
window.voidExpense=id=>{const e=data.expenses.find(x=>x.id===id);if(!e||!activeOp(e))return;const reason=prompt("Motif de l'annulation :");if(!reason||!reason.trim())return;if(!confirm("Confirmer l'annulation ? L'opération restera visible mais sera exclue des calculs."))return;e.status='Annulée';e.voidReason=reason.trim();e.voidedAt=new Date().toISOString();save()};

function escapeHtml(s){return String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]))}
function openPrintWindow(html){const w=window.open('','_blank');if(!w){alert('Autorisez les fenêtres contextuelles pour imprimer.');return}w.document.open();w.document.write(html);w.document.close()}
window.printTable=(tableId,title)=>{const table=$(tableId);if(!table)return;const logo=$('brandLogo').src;openPrintWindow(`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>body{font-family:Arial;margin:24px;color:#111}.head{display:flex;align-items:center;gap:12px;margin-bottom:18px}.head img{width:55px;height:55px;object-fit:contain}table{border-collapse:collapse;width:100%;font-size:11px}th,td{border:1px solid #bbb;padding:6px;text-align:left}th{background:#eee}@media print{button{display:none}}</style></head><body><div class="head"><img src="${logo}"><div><h2>${escapeHtml(title)}</h2><div>Complexe Scolaire C.S.D.N.</div></div></div>${table.outerHTML}<script>window.onload=()=>window.print()</script></body></html>`)}
window.printSection=(sectionId,title)=>{const section=$(sectionId);if(!section)return;const clone=section.cloneNode(true);clone.querySelectorAll('button,.toolbar').forEach(x=>x.remove());openPrintWindow(`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><link rel="stylesheet" href="styles.css"><style>body{padding:18px}.view{display:block!important}.sidebar,.topbar{display:none!important}</style></head><body>${clone.outerHTML}<script>window.onload=()=>window.print()</script></body></html>`)}
window.exportTableExcel=(tableId,filename,title)=>{const table=$(tableId);if(!table)return;const clone=table.cloneNode(true);
 const heads=[...clone.querySelectorAll('thead th')],ai=heads.findIndex(th=>/^actions?$/i.test(th.textContent.trim()));
 if(ai>=0){const body=[...clone.querySelectorAll('tbody tr')];let hasNote=false;
  body.forEach(tr=>{const c=tr.cells[ai];if(!c)return;const sm=c.querySelector('small');if(sm)hasNote=true;c.textContent=sm?sm.textContent:''});
  if(hasNote)heads[ai].textContent='Motif d’annulation';else clone.querySelectorAll('tr').forEach(tr=>{if(tr.cells[ai])tr.deleteCell(ai)})}
 clone.querySelectorAll('button,input,select').forEach(el=>{const td=el.closest('td,th');if(td)td.textContent=(el.tagName==='SELECT'&&el.selectedIndex>=0?el.options[el.selectedIndex].text:el.value)||el.textContent||''});
 const html=`<html><head><meta charset="utf-8"></head><body><h2>${escapeHtml(title)}</h2>${clone.outerHTML}</body></html>`;downloadBlob('\ufeff'+html,'application/vnd.ms-excel',filename)}
function exportMatrixExcel(headers,rows,filename,title){const th=headers.map(x=>`<th>${escapeHtml(x)}</th>`).join(''),tr=rows.map(r=>'<tr>'+r.map(x=>`<td>${escapeHtml(x)}</td>`).join('')+'</tr>').join('');downloadBlob('\ufeff'+`<html><head><meta charset="utf-8"></head><body><h2>${escapeHtml(title)}</h2><table border="1"><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table></body></html>`,'application/vnd.ms-excel',filename)}
function downloadBlob(content,type,filename){const b=new Blob([content],{type}),a=document.createElement('a');a.href=URL.createObjectURL(b);a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),700)}

$('validateAllPromotionsBtn').onclick=validateAllPromotions;
$('newStudentBtn').onclick=()=>{$('studentForm').reset();$('studentId').value='';$('sPaymentPlan').value='À définir';$('sSocial').value='Normal';$('sStatus').value='Actif';$('sOrigin').value='Nouveau';$('sRegistrationStatus').value='due';$('sRegistrationAmount').value='';$('sRegistrationNote').value='';syncRegistrationForm();$('studentDialog').showModal()};
$('saveStudentBtn').onclick=e=>{e.preventDefault();if(!$('studentForm').reportValidity())return;const status=$('sRegistrationStatus').value,amount=Number($('sRegistrationAmount').value);if(status==='due'&&(!Number.isFinite(amount)||!Number.isInteger(amount)||amount<=0)){alert('Saisissez des frais d’inscription positifs en francs entiers.');return}const id=$('studentId').value||uid('EL'),old=data.students.find(s=>s.id===id)||{};const item=Object.assign({},old,{id,lastName:$('sLastName').value.trim(),firstName:$('sFirstName').value.trim(),className:$('sClass').value,paymentPlan:$('sPaymentPlan').value,phone:$('sPhone').value.trim(),social:$('sSocial').value,status:$('sStatus').value,origin:$('sOrigin').value,registrationStatus:status,registrationAmount:status==='due'?amount:0,registrationNote:$('sRegistrationNote').value.trim()});if(!item.oldArrears)item.oldArrears={T1:0,T2:0,T3:0};if(!item.previousClass)item.previousClass='';if(item.origin==='Nouveau'){item.promotionValidated=true;item.promotionDecision='Nouveau'}else if(!item.previousClass){item.promotionValidated=true}const i=data.students.findIndex(s=>s.id===id);if(i>=0)data.students[i]=item;else data.students.push(item);$('studentDialog').close();save()};
$('newPaymentBtn').onclick=()=>{preparePaymentDialog();$('pType').value='Mensualité';refreshPaymentStudents();$('paymentDialog').showModal()};
$('pStudentSearch').addEventListener('input',refreshPaymentStudents);$('pType').addEventListener('change',refreshPaymentStudents);$('pStudent').addEventListener('change',updatePaymentHint);
$('savePaymentBtn').onclick=e=>{e.preventDefault();showPaymentConfirmation()};
$('confirmPaymentBtn').onclick=e=>{e.preventDefault();commitPayment()};
$('backToPaymentBtn').onclick=e=>{e.preventDefault();$('paymentConfirmDialog').close()};
$('newExpenseBtn').onclick=()=>{$('expenseForm').reset();$('eDate').value=new Date().toISOString().slice(0,10);$('expenseDialog').showModal()};
$('saveExpenseBtn').onclick=e=>{e.preventDefault();if(!$('expenseForm').reportValidity())return;const amount=+$('eAmount').value||0;if(!Number.isFinite(amount)||!Number.isInteger(amount)||amount<=0){alert('Montant invalide.');return}data.expenses.push({id:uid('DEP'),date:$('eDate').value,category:$('eCategory').value,label:$('eLabel').value.trim(),amount,mode:$('eMode').value,status:'Validée',createdAt:new Date().toISOString()});$('expenseDialog').close();save()};
$('reminderTemplate').addEventListener('input',()=>{templateDirty=true});
$('saveReminderTemplateBtn').onclick=()=>{data.settings.reminderTemplate=$('reminderTemplate').value;templateDirty=false;save();alert('Modèle de relance enregistré.')};
$('resetReminderTemplateBtn').onclick=()=>{if(!confirm('Réinitialiser le modèle de relance ?'))return;data.settings.reminderTemplate=DEFAULT_TEMPLATE;templateDirty=false;save()};
$('exportRemindersBtn').onclick=exportReminders;$('printSelectedRemindersBtn').onclick=printSelectedReminders;$('printAllRemindersBtn').onclick=printAllFilteredReminders;
$('saveSettingsBtn').onclick=()=>{if(['deadlineT1','deadlineT2','deadlineT3','annualDeadline'].some(id=>!$(id).value)){alert('Renseignez toutes les échéances.');return}if(['feeMaterIns','feeMaterMonthly','feePrimIns','feePrimMonthly'].some(id=>$(id).value===''||!(+$(id).value>=0))){alert('Les tarifs doivent être des nombres positifs ou nuls.');return}if(!$('schoolYear').value.trim()){alert('Renseignez l’année scolaire.');return}data.settings=Object.assign({},data.settings,{schoolYear:$('schoolYear').value,openingBalance:+$('openingBalance').value||0,materIns:+$('feeMaterIns').value||0,materMonthly:+$('feeMaterMonthly').value||0,primIns:+$('feePrimIns').value||0,primMonthly:+$('feePrimMonthly').value||0,deadlineT1:$('deadlineT1').value,deadlineT2:$('deadlineT2').value,deadlineT3:$('deadlineT3').value,annualDeadline:$('annualDeadline').value});save()};
$('logoUpload').addEventListener('change',ev=>{const f=ev.target.files[0];if(!f)return;if(!/^image\//.test(f.type)||f.size>300*1024){alert('Logo refusé : choisissez une image de moins de 300 Ko pour ne pas saturer le stockage du navigateur.');ev.target.value='';return}const r=new FileReader();r.onload=()=>{data.settings.logoDataUrl=r.result;save()};r.readAsDataURL(f)});
$('btnBackup').onclick=()=>{const b=new Blob([JSON.stringify(data,null,2)],{type:'application/json'}),a=document.createElement('a');a.href=URL.createObjectURL(b);a.download='CSDN_sauvegarde_'+new Date().toISOString().slice(0,10)+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),500)};
$('restoreFile').onchange=ev=>{const input=ev.target,f=input.files[0];if(!f)return;const r=new FileReader();
 r.onload=()=>{try{
  const saved=JSON.parse(r.result);
  if(!saved||typeof saved!=='object'||!Array.isArray(saved.students)||!Array.isArray(saved.payments)||!Array.isArray(saved.expenses))throw new Error('format');
  if(!confirm(`Restaurer cette sauvegarde ?\n\n${saved.students.length} élèves, ${saved.payments.length} paiements, ${saved.expenses.length} dépenses.\n\nLes données actuellement affichées seront remplacées. Téléchargez d’abord une sauvegarde si nécessaire.`))return;
  if(window.CSDN_CENTRAL)CSDN_CENTRAL.restore(mergeSeed(saved));else{data=mergeSeed(saved);save()}
 }catch(e){alert('Sauvegarde invalide : ce fichier n’a pas le format d’une sauvegarde CSDN. Vos données actuelles n’ont pas été modifiées.')}finally{input.value=''}};
 r.readAsText(f)};
['promotionSearch','promotionClassFilter','promotionValidationFilter'].forEach(id=>$(id).addEventListener('input',renderPromotion));
['studentSearch','studentClassFilter','studentPlanFilter','studentStatusFilter'].forEach(id=>$(id).addEventListener('input',renderStudents));
['paymentSearch','paymentTypeFilter','paymentStatusFilter'].forEach(id=>$(id).addEventListener('input',renderPayments));
['arrearsSearch','arrearsClassFilter'].forEach(id=>$(id).addEventListener('input',renderArrears));
['reminderSearch','reminderClassFilter'].forEach(id=>$(id).addEventListener('input',renderReminders));
['expenseSearch','expenseCategoryFilter','expenseStatusFilter'].forEach(id=>$(id).addEventListener('input',renderExpenses));
if('serviceWorker'in navigator)navigator.serviceWorker.register('sw.js').catch(()=>{});

function registrationLabel(s){return s.registrationStatus==='exempt'?'Exonéré / dispensé':s.registrationStatus==='free'?'Gratuite':fmt(feeForStudent(s).ins)}
function syncRegistrationForm(){const due=$('sRegistrationStatus').value==='due';$('sRegistrationAmount').disabled=!due;$('sRegistrationAmount').required=due;}
$('sRegistrationStatus').onchange=syncRegistrationForm;
$('refreshAppBtn').onclick=async()=>{if('serviceWorker'in navigator){const r=await navigator.serviceWorker.getRegistration();if(r)await r.update()}location.reload()};
