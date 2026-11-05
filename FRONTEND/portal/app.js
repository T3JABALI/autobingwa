/* ===== Data layer =====
   USE_MOCK=true runs on sample data. To connect the real server later: set USE_MOCK=false and API_URL.
   The server must provide (Bearer token in the Authorization header):
   GET  /portal/overview               -> { biz, cid, plan, devices, tx, plans }  (plans come from devices[].offers)
   POST /portal/devices/:id/airtime-check | /start | /stop | /portal-on | /portal-off
   POST /portal/tx/:id/retry | /reschedule {at}      DELETE /portal/tx/:id
   POST /portal/quickdial {device,offerId,phone}
   POST /portal/tokens/buy {device,packId,method:'airtime'|'mpesa',phone?}
   POST /portal/subscribe/start {plan,phone,method}  POST /portal/password {current,next}
   --- Data plans (every change must reach the phone, and phone changes must show in overview.plans) ---
   POST   /portal/plans                 {name,ussd,price,safPrice,category,autoRetry,retryCount,retryPending,retryFailed,
                                         autoReschedule,rescheduleTime,notifyOn,notifyMsg,tw,enabled,device} -> {id}
   PUT    /portal/plans/:id             any of the same fields, plus {on,enabled} for the switch  (tw = time window)
   DELETE /portal/plans/:id
   POST   /portal/plans/:id/learn       {device} -> {signature,screens}  OR  {job}
   GET    /portal/plans/:id/learn/:job  -> {status:'running'|'done'|'error', signature, screens, error}
   POST   /portal/plans/:id/signature   {device,signature,enabled}  -> saves the signature on the phone
   A plan in overview.plans looks like:
   {id,name,cat,price,safPrice,ussd,on,signed,smart,signature,locked,sig,sigLearned,sigEnabled,sigAuto,
    autoRetry,retryCount,retryPending,retryFailed,autoReschedule,rescheduleTime,notifyOn,notifyMsg,
    tw:{on,from,until,altId,notify,msg}} */
const USE_MOCK=false,API_URL='https://autobingwa-payments.onrender.com';
const DB={biz:'Jabali Bingwa Deals',cid:'AB-1042',plan:{name:'2 devices',max:2,exp:'15 Nov 2026'},
devices:[
{id:'d1',name:'Bundles Store Mtaani',online:true,running:true,air:1422,used:310,tok:112,bat:71,chg:true,com:1153.5},
{id:'d2',name:'Jabali Bingwa Deals',online:true,running:true,air:8459.24,used:540,tok:0,until:'2026-11-15',bat:48,chg:false,com:310}],
tx:[
{id:'t1',dev:'d1',name:'Audrine Anyango Otieno',phone:'0141488764',amt:20,offer:'250MBS 24HRS',st:'Completed',m:4,msg:'UJV3B131ZJ Confirmed. on 31/10/26 at 10:17 AM Ksh20.00 received from 254141488764 AUDRINE ANYANGO OTIENO. New Account balance is Ksh2,717.92.',ussd:'*180*5*2*0141488764*1*1#',resp:'You have successfully purchased 250MBS valid 24hrs for 0141488764'},
{id:'t2',dev:'d1',name:'Duncan Mukabane Amutete',phone:'0114621742',amt:22,offer:'45MINS 3HRS',st:'Failed',m:5,msg:'UJVQU045H9 Confirmed. on 31/10/26 at 7:49 PM Ksh22.00 received from 254114621742 DUNCAN MUKABANE AMUTETE.',ussd:'*544*5*8*0114621742*00*13*8*1*1#',resp:'Screen 2 (input: 5)\n1.Sh999=25GB+Free YouTube 7day\n0:BACK 00:HOME 98:MORE'},
{id:'t3',dev:'d1',name:'Mildred Nasimiyu Waswa',phone:'0718951178',amt:55,offer:'1GB MIDNIGHT',st:'Completed',m:7,msg:'UJV3B2K1PQ Confirmed. on 31/10/26 at 10:10 AM Ksh55.00 received from 254718951178 MILDRED NASIMIYU WASWA.',ussd:'*180*5*2*0718951178*6*1#',resp:'Your request is being processed. You will receive an SMS shortly.'},
{id:'t4',dev:'d1',name:'Charles Kasango Juma',phone:'0745693521',amt:20,offer:'250MBS 24HRS',st:'Pending',m:9,msg:'UJV3B7Q2LM Confirmed. Ksh20.00 received from 254745693521 CHARLES KASANGO JUMA.',ussd:'*180*5*2*0745693521*1*1#',resp:'No response recorded yet.'},
{id:'t5',dev:'d1',name:'Emmanuel Kipruto Sawe',phone:'0726048008',amt:19,offer:'1GB 1HR',st:'Completed',m:21,msg:'UJV3C0A9ZZ Confirmed. Ksh19.00 received from 254726048008 EMMANUEL KIPRUTO SAWE.',ussd:'*180*5*2*0726048008*5*1#',resp:'Your request is being processed.'},
{id:'t6',dev:'d1',name:'Mutisya Karata Kimani',phone:'0140313621',amt:5,offer:'20SMS 1 DAY',st:'Completed',m:60,msg:'UJV3C1B8YY Confirmed. Ksh5.00 received from 254140313621 MUTISYA KARATA KIMANI.',ussd:'*544*4*1#',resp:'You have successfully purchased 20SMS.'},
{id:'t7',dev:'d2',name:'Faith Simiyu',phone:'0704590730',amt:20,offer:'250MBS 24HRS',st:'Completed',m:14,msg:'UJV3D2C7XX Confirmed. Ksh20.00 received from 254704590730 FAITH SIMIYU.',ussd:'*180*5*2*0704590730*1*1#',resp:'Your request is being processed.'}],
plans:[
{id:'p1',name:'400mbs tunukiwa',cat:'TUNUKIWA',price:26,safPrice:25,ussd:'*544*6*8*AB*00*1*0*1*1#',signed:true,smart:true,on:true},
{id:'p2',name:'400MBS',cat:'DATA',price:25,safPrice:20,ussd:'*180*5*2*AB*1*1#',signed:true,on:true},
{id:'p3',name:'1.5GB 3HRS',cat:'DATA',price:50,safPrice:49,ussd:'*180*5*2*AB*7*1#',signed:false,on:true,tw:{on:true,from:'06:00',until:'22:00',altId:'p2',notify:false,msg:''}},
{id:'p4',name:'900 MB Midnight',cat:'DATA',price:57,safPrice:55,ussd:'*544*6*8*AB*00*1*0*6*1#',signed:true,on:false}]};
const PACKS=[['1,000 units',90,'u1000'],['600 units',50,'u600'],['250 units',25,'u250'],['100 units',15,'u100'],['1 day unlimited',30,'d1'],['7 days unlimited',200,'d7'],['30 days unlimited',550,'d30']];
const SUBS=[{n:'2 devices',p:100,f:['Link 1 or 2 devices','2 days of portal history','30 days of access']},{n:'5 devices',p:200,pop:1,f:['Link up to 5 devices','5 days of portal history','30 days of access']},{n:'Unlimited',p:400,f:['Link unlimited devices','1 week of portal history','30 days of access']}];
   const PICK=['DATA','MINUTES','SMS','TUNUKIWA','BINGWA'],PCATS=['ALL','DATA','BINGWA','TUNUKIWA','MINUTES','SMS'];
const DEF_MSG='Hi {name}, your {offer} has been sent. Thank you for buying!';
const $=s=>document.querySelector(s),sleep=ms=>new Promise(r=>setTimeout(r,ms));
const ls={get(k,d){try{return localStorage.getItem(k)||d}catch(e){return d}},set(k,v){try{localStorage.setItem(k,v)}catch(e){}}};
async function call(m,p,b){if(USE_MOCK){await sleep(200);return{ok:true}}
const r=await fetch(API_URL+p,{method:m,headers:{'Content-Type':'application/json',Authorization:'Bearer '+(await window.getAuthToken())},body:b?JSON.stringify(b):undefined});
if(r.status===401){window.portalSignOut();throw new Error('Session expired. Please log in again.')}
const j=await r.json().catch(()=>({}));
if(!r.ok)throw new Error(j.error||'The server answered '+r.status);return j}
/* ===== Helpers ===== */
const P={home:'M3 11l9-8 9 8M5 10v10h14V10',phone:'M7 2h10v20H7zM11 18h2',list:'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',db:'M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zM4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3',more:'M5 12h.01M12 12h.01M19 12h.01',chev:'M9 6l6 6-6 6',back:'M19 12H5M12 19l-7-7 7-7',plus:'M12 5v14M5 12h14',refresh:'M3 12a9 9 0 0 1 15-6.7L21 8M21 3v5h-5M21 12a9 9 0 0 1-15 6.7L3 16M3 21v-5h5',eye:'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',eyeoff:'M3 3l18 18M10.6 6.1A9.6 9.6 0 0 1 12 6c6 0 10 6 10 6a17 17 0 0 1-3.2 3.8M6.5 7.5A17 17 0 0 0 2 12s4 6 10 6c1.4 0 2.7-.3 3.8-.8',bolt:'M13 2L4 14h7l-1 8 9-12h-7z',edit:'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z',trash:'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',out:'M9 21H5V3h4M16 17l5-5-5-5M21 12H9',dial:'M6.6 10.8a15 15 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25c1.1.37 2.3.57 3.6.57a1 1 0 0 1 1 1V20a1 1 0 0 1-1 1C10.6 21 3 13.4 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.57a1 1 0 0 1-.25 1z',card:'M3 6h18v12H3zM3 10h18',coin:'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v10M9.5 9.5h4a1.5 1.5 0 0 1 0 3h-3a1.5 1.5 0 0 0 0 3h4',gear:'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM3 12h2M19 12h2M12 3v2M12 19v2M5.6 5.6L7 7M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4',copy:'M9 9h11v11H9zM5 15V5h10',clock:'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 2',finger:'M12 10a2 2 0 0 0-2 2c0 1.02-.1 2.51-.26 4M14 13.12c0 2.38 0 6.38-1 8.88M17.29 21.02c.12-.6.43-2.3.5-3.02M2 12a10 10 0 0 1 18-6M21.8 16c.2-2 .131-5.354 0-6M5 19.5C5.5 18 6 15 6 12a6 6 0 0 1 .34-2M8.65 22c.21-.66.45-1.32.57-2M9 6.8a6 6 0 0 1 9 5.2v2'};
const ic=(n,s=22)=>`<svg viewBox="0 0 24 24" width="${s}" height="${s}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${P[n]}"/></svg>`;
const vb=(s=16)=>`<svg class="vb" viewBox="0 0 24 24" width="${s}" height="${s}" role="img" aria-label="Verified"><path d="M12 2l2.6 2 3.2-.2 1 3 2.7 1.8-1 3.1 1 3.1-2.7 1.8-1 3-3.2-.2L12 22l-2.6-2-3.2.2-1-3L2.5 15.4l1-3.1-1-3.1L5.2 7.4l1-3 3.2.2z" fill="currentColor"/><path d="M8.5 12.2l2.4 2.4 4.6-4.9" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=n=>Number(n).toLocaleString('en-KE',{minimumFractionDigits:2,maximumFractionDigits:2});
const ago=m=>m<1?'Just now':m<60?m+'m ago':m<1440?Math.floor(m/60)+'h ago':Math.floor(m/1440)+'d ago';
const ini=n=>String(n).trim().split(/\s+/).slice(0,2).map(w=>w[0]||'').join('').toUpperCase();
const TONE={Completed:'ok',Failed:'bad',Pending:'wn',Scheduled:'wn',Processing:'wn',Paused:'wn',Skipped:'wn',Unmatched:'bad'};
const S={page:'home',more:null,dev:'d1',f:'All',hide:false,tx:null,td:null,tp:null,pc:'ALL',pm:null,pf:null,wf:null,sg:null,theme:ls.get('theme','system')};
const dev=()=>DB.devices.find(d=>d.id===S.dev)||DB.devices[0]||{id:'',name:'No phone connected',online:false,portalOn:false,running:false,air:0,used:0,tok:0,bat:0,chg:false,com:0,ok:0,failed:0};
const cur=()=>DB.tx.find(x=>x.id===S.tx);
const mk=t=>S.hide?'••••••':t;
let R=null,tt=null,HOLD=0;
const held=()=>{HOLD=Date.now()+10000};
function toast(m){const t=$('#toast');t.textContent=m;clearTimeout(tt);tt=setTimeout(()=>{t.textContent=''},3500)}
function modal(h){$('#modal').innerHTML=`<div class="mb" data-a="close"><div class="ms" role="dialog" aria-modal="true">${h}</div></div>`}
function ask(t,m,ok,danger){return new Promise(res=>{R=res;modal(`<h3>${t}</h3><p class="mu">${m}</p><div class="flex"><button class="btn gh grow" data-a="no">Cancel</button><button class="btn${danger?' bad':''} grow" data-a="yes">${ok}</button></div>`)})}
function applyTheme(t){S.theme=t;ls.set('theme',t);const r=document.documentElement;t==='system'?r.removeAttribute('data-theme'):r.setAttribute('data-theme',t)}
const bk=t=>`<div class="flex"><button class="ib" data-a="go" data-p="more" data-m="" aria-label="Back">${ic('back')}</button><h1 class="h2" style="margin:0">${t}</h1></div>`;
const phoneOk=v=>{const p=String(v).replace(/[\s+-]/g,'').replace(/^254/,'0');return /^0[17]\d{8}$/.test(p)?p:''};
/* ===== Data plan helpers (same rules as the phone app) ===== */
const cap=s=>s?s[0]+s.slice(1).toLowerCase():'';
const catOf=p=>{const c=String(p.cat||p.category||'').toUpperCase();if(PICK.includes(c))return c;const s=((p.name||'')+' '+(p.cat||'')).toLowerCase();if(/sms/.test(s))return'SMS';if(/minutes|mins?(\s|$)/.test(s))return'MINUTES';if(/tunukiwa/.test(s))return'TUNUKIWA';return'DATA'};
const isVerified=p=>!!(p.smart||p.signature||p.signed||(p.sigLearned&&p.sigEnabled));
const isLocked=p=>!!(p.smart||p.signature||p.locked);
const t12=v=>{if(!v)return'';const[h,m]=v.split(':').map(Number);return(h%12||12)+':'+String(m).padStart(2,'0')+' '+(h>=12?'PM':'AM')};
const defTw=()=>({on:false,from:'06:00',until:'22:00',altId:'',notify:false,msg:''});
const blankPlan=()=>({id:'',isNew:true,name:'',cat:'DATA',ussd:'',price:'',safPrice:'',autoRetry:false,retryCount:1,retryPending:false,retryFailed:true,autoReschedule:false,rescheduleTime:'06:00',notifyOn:false,notifyMsg:'',on:true,tw:defTw()});
const normU=u=>String(u||'').replace(/\s+/g,'').replace(/ab/gi,'AB');
const chkU=u=>{if(!u)return'Enter the USSD code';if(!/AB/.test(u))return'The USSD code must contain AB where the phone number goes';if(!/^\*[0-9*]+#$/.test(u.replace(/AB/g,'0')))return'The USSD code must start with * and end with #, with only numbers and * between';return''};
const toPatch=(s,lock)=>{const p={name:String(s.name||'').trim(),ussd:normU(s.ussd),price:Number(s.price),safPrice:Number(s.safPrice)||0,autoRetry:!!s.autoRetry,retryCount:Math.min(10,Math.max(1,Number(s.retryCount)||1)),retryPending:!!s.retryPending,retryFailed:s.retryFailed!==false,autoReschedule:!!s.autoReschedule,rescheduleTime:s.rescheduleTime||'06:00',notifyOn:!!s.notifyOn,notifyMsg:String(s.notifyMsg||'').trim()};if(!lock)p.category=catOf(s);return p};
const parseMenu=s=>String(s||'').split('\n').map(l=>l.match(/^\s*(\d+)\s*[.:)\-]\s*(.+)$/)).filter(Boolean).map(m=>({n:m[1],text:m[2].trim()}));
const sigRows=(sig,l)=>sig.steps.map((s,i)=>{if(s.kind==='input')return{ok:1,t:"Types the customer's phone number"};if(s.kind==='literal')return s.unmatched?{ok:0,t:`Option ${s.value} was not found on the screen`}:{ok:1,t:`Types ${s.value}`};const raw=l&&l.screens&&l.screens[i]?(parseMenu(l.screens[i]).find(o=>String(o.n)===String(s.hint))||{}).text:'';return{ok:1,t:`Picks "${raw||s.label||s.text||'option'}" (option ${s.hint} today)`}});
const mockSig=()=>({complete:true,steps:[{kind:'literal',value:'5'},{kind:'literal',value:'2'},{kind:'input'},{kind:'menu',hint:'1',label:'Data'},{kind:'literal',value:'1'}]});
const sw=(k,on,l,a='pft')=>`<button type="button" class="sw${on?' on':''}" role="switch" aria-checked="${on}" aria-label="${esc(l)}" data-a="${a}" data-k="${k}"><i></i></button>`;
const srow=(t,s,k,on)=>`<div class="srow"><span class="grow"><b>${t}</b><small>${s}</small></span>${sw(k,on,t)}</div>`;
const gv=id=>{const e=document.getElementById(id);return e?e.value:undefined},gc=id=>{const e=document.getElementById(id);return e?e.checked:undefined};
function readPf(){const f=S.pf;if(!f)return;const m={name:'pn',cat:'pc',ussd:'pu',price:'pp',safPrice:'ps',retryCount:'prc',rescheduleTime:'prt',notifyMsg:'pnm'};for(const k in m){const v=gv(m[k]);if(v!==undefined)f[k]=v}
const a=gc('prp'),b=gc('prf');if(a!==undefined)f.retryPending=a;if(b!==undefined)f.retryFailed=b}
function readWf(){const w=S.wf;if(!w)return;const m={from:'wf',until:'wu',altId:'wa',msg:'wm'};for(const k in m){const v=gv(m[k]);if(v!==undefined)w[k]=v}}
/* ===== Pages ===== */
const devRow=d=>`<button class="card drow${d.id===S.dev?' act':''}" data-a="dev" data-id="${d.id}"><i class="dot${d.online?' on':''}"></i><span class="grow"><b>${esc(d.name)}</b><small>${d.online?'Online':'Offline'}, ${d.running?'running':'stopped'}</small></span>${ic('chev')}</button>`;
const txRow=t=>`<button class="card tx" data-a="otx" data-id="${t.id}"><span class="av">${esc(ini(t.name))}</span><span class="grow"><b>${esc(t.name)}</b><small>${t.phone}, ${esc(t.offer)}, KES ${t.amt}</small></span><span class="rt"><b class="${TONE[t.st]||''}">${t.st}</b><small>${ago(t.m)}</small></span></button>`;
function homeMain(){const d=dev(),t=DB.tx.filter(x=>x.dev===d.id);
return `<h1 class="h1">AUTOBINGWA PORTAL</h1><p class="sub">Here's what's happening on <b>${esc(DB.biz)}</b> (${esc(DB.cid)}) right now</p>
${DB.devices.map(devRow).join('')}
<div class="stats"><div class="st" style="--c:var(--ok)"><b>${d.ok??t.filter(x=>x.st==='Completed').length}</b><span>Successful</span></div><div class="st" style="--c:var(--bad)"><b>${d.failed??t.filter(x=>x.st==='Failed').length}</b><span>Failed</span></div><button class="st" style="--c:var(--ac)" data-a="go" data-p="more" data-m="tokens"><b>${d.tok}</b><span>Tokens</span></button></div>
<div class="card"><div class="flex"><small class="grow">${esc(d.name)}</small><button class="ib" data-a="eye" aria-pressed="${S.hide}" aria-label="${S.hide?'Show':'Hide'} amounts">${ic(S.hide?'eyeoff':'eye')}</button><button class="ib" data-a="air" aria-label="Check airtime">${ic('refresh')}</button></div>
<div class="two"><div><small>Airtime used today</small><div class="big sm">${mk('KES '+money(d.used))}</div></div><div><small>Airtime balance</small><div class="big sm">${mk('KES '+money(d.air))}</div></div></div></div>
<div class="two"><div class="card"><small>Battery</small><div class="big">${d.bat}%</div><span class="pill" style="--c:var(--${d.chg?'ok':'wn'})">${ic('bolt',14)} ${d.chg?'Charging':'Not charging'}</span></div><div class="card"><small>Commission this week</small><div class="big sm">${mk('KES '+money(d.com))}</div></div></div>
<div class="sec"><h2>Recent transactions</h2><button class="lnk" data-a="go" data-p="tx">View all</button></div>${t.slice(0,5).map(txRow).join('')||'<p class="mu c">No transactions yet.</p>'}`}
const connectForm=()=>`<label>Connect ID<input id="cid" class="in" autocapitalize="characters" autocomplete="off" placeholder="AUB-XXXXX"></label><label>Phone name<input id="cnm" class="in" maxlength="40" placeholder="For example: Bundles Store Mtaani"></label><p id="cerr" class="err" role="alert"></p><button class="btn full" data-a="cdo">${ic('phone',18)} Connect phone</button>`;
const connectCard=first=>`<h1 class="h1">AUTOBINGWA PORTAL</h1><p class="sub">${first?'Connect your first phone to start seeing its live activity.':'Connect another phone.'}</p><div class="card"><b>Connect a phone</b><p class="mu">In the AutoBingwa app, switch on <b>AutoBingwa Portal</b>, then copy the Connect ID shown there.</p>${connectForm()}</div>`;
function home(){if(!DB.devices.length)return connectCard(true);const d=dev();
const w=d.portalOn===false?'AutoBingwa Portal is switched off on this phone. Switch it on from Devices, or in the app Settings.':!d.online?'Showing the last values this phone sent. Open AutoBingwa on the phone to see live activity.':'';
return (w?`<div class="card warn"><b>${esc(d.name)} is ${d.portalOn===false?'disconnected':'offline'}</b><p class="mu">${w}</p></div>`:'')+homeMain()}
function devices(){const n=DB.devices.length,m=DB.plan.max,full=n>=m;
return `<div class="flex"><h1 class="h2 grow" style="margin:0">Devices</h1>${full?'':`<button class="ib" data-a="adddev" aria-label="Add device">${ic('plus')}</button>`}</div>
<div class="card"><div class="flex"><b class="grow">${n}/${m>=1000?'unlimited':m} devices paired</b><span class="pill" style="--c:var(--${full?'bad':'ok'})">${full?'Limit reached':'Space available'}</span></div><div class="bar"><i style="width:${Math.min(100,n/m*100)}%"></i></div></div>
${full?`<div class="card warn"><b>You've reached your device limit</b><p class="mu">${esc(DB.plan.name)} allows ${m} devices. Upgrade to pair more.</p><button class="btn" data-a="go" data-p="more" data-m="sub">${ic('card',18)} Upgrade plan</button></div>`:''}
${DB.devices.map(d=>`<div class="card"><button class="drow plain" data-a="dev" data-id="${d.id}"><i class="dot${d.online?' on':''}"></i><span class="grow"><b>${esc(d.name)}</b><small>Paired phone, ${d.online?'online':'offline'}, ${d.running?'running':'stopped'}</small></span>${ic('chev')}</button><div class="two"><div><small>Airtime</small><b>KES ${money(d.air)}</b></div><div><small>Tokens</small><b>${d.tok}</b></div></div><button class="btn gh full" style="margin-top:12px" data-a="pon" data-id="${d.id}">${d.portalOn?'Switch AutoBingwa Portal off':'Switch AutoBingwa Portal on'}</button><button class="btn${d.running?' bad':''} full" style="margin-top:8px" data-a="run" data-id="${d.id}">${d.running?'Stop automation':'Start automation'}</button></div>`).join('')}
<p class="mu">Only devices linked to your account appear here.</p>`}
function txPage(){if(S.tx&&cur())return txDetail();const t=DB.tx.filter(x=>x.dev===dev().id&&(S.f==='All'||x.st===S.f));
return `<h1 class="h2" style="margin-bottom:2px">Transactions</h1><p class="mu">${esc(dev().name)}</p><div class="chips">${['All','Completed','Pending','Scheduled','Failed'].map(f=>`<button class="chip${S.f===f?' on':''}" data-a="f" data-f="${f}">${f}</button>`).join('')}</div>${t.map(txRow).join('')||'<p class="mu c">No transactions here.</p>'}`}
function txDetail(){const t=cur(),box=(l,k)=>`<div class="card"><div class="flex" style="margin:0"><small class="grow">${l}</small><button class="ib" style="width:34px;height:34px" data-a="copy" data-k="${k}" aria-label="Copy ${l}">${ic('copy',16)}</button></div><div class="pre">${esc(t[k])}</div></div>`;
return `<div class="flex"><button class="ib" data-a="tback" aria-label="Back">${ic('back')}</button><h1 class="h2" style="margin:0">Transaction</h1></div>
<div class="flex"><span class="pill" style="--c:var(--${TONE[t.st]||'tx'})">${t.st}</span><small class="grow r">${ago(t.m)}</small></div>
<div class="amt">KES ${t.amt}<span class="pill">${esc(t.offer)}</span></div>
${box('M-Pesa message','msg')}${box('Phone number','phone')}${box('USSD','ussd')}${box('USSD response','resp')}
<div class="flex"><button class="btn gh grow" data-a="retry">${ic('refresh',18)} Retry</button><button class="btn gh grow" data-a="resched">${ic('list',18)} Reschedule</button><button class="btn bad grow" data-a="del">${ic('trash',18)} Delete</button></div>`}
/* ----- Data plans dashboard ----- */
const planCard=p=>{const v=isVerified(p),tw=p.tw&&p.tw.on;
return `<div class="card pc${p.on?'':' off'}${v?' vf':''}"><div class="flex" style="margin:0"><span class="grow"><b class="pn">${esc(p.name)}${v?vb(17):''}</b><small>${esc(cap(catOf(p)))} · KES ${esc(p.price)}</small></span>${sw(p.id,p.on,(p.on?'Turn off ':'Turn on ')+p.name,'ptog').replace(`data-k="${p.id}"`,`data-id="${p.id}"`)}</div>
<code>${esc(p.ussd)}</code>
<div class="pt"><span class="pill" style="--c:var(--${v?'ok':'wn'})">${ic('finger',14)} ${v?'Signed':'Not signed'}</span><span class="pill" style="--c:var(--${p.on?'ok':'bad'})">${p.on?'Enabled':'Disabled'}</span>${tw?`<span class="pill">${ic('clock',14)} ${t12(p.tw.from)} to ${t12(p.tw.until)}</span>`:''}</div>
<div class="flex" style="margin:0"><button class="btn gh grow" data-a="pmenu" data-id="${p.id}">${ic('edit',18)} Edit</button><button class="ib bad" data-a="pdel" data-id="${p.id}" aria-label="Delete ${esc(p.name)}">${ic('trash')}</button></div></div>`};
function plans(){const all=DB.plans,list=S.pc==='ALL'?all:all.filter(p=>catOf(p)===S.pc),n=all.filter(p=>p.on).length;
return `<div class="flex"><h1 class="h2 grow" style="margin:0">Data plans</h1><span class="pill">${n}/${all.length} on</span><button class="ib" data-a="padd" aria-label="Add plan">${ic('plus')}</button></div>
<p class="mu">${esc(dev().name)} · same plans as the app</p>
<div class="chips">${PCATS.map(c=>`<button class="chip${S.pc===c?' on':''}" data-a="pcat" data-c="${c}">${cap(c)}</button>`).join('')}</div>
${list.map(planCard).join('')||'<p class="mu c">No plans here. Tap + to add one.</p>'}`}
const pmenuHtml=p=>`<h3>${esc(p.name)} ${isVerified(p)?vb(17):''}</h3><p class="mu">${esc(p.ussd)}</p>
<button class="opt" data-a="psig" data-id="${p.id}">${ic('finger')}<span class="grow"><b>Signature</b><small>Learn on the phone, see the USSD path, save it</small></span>${ic('chev')}</button>
<button class="opt" data-a="pform" data-id="${p.id}">${ic('edit')}<span class="grow"><b>Edit offer</b><small>Name, price, USSD, retry and SMS settings</small></span>${ic('chev')}</button>
<button class="opt" data-a="pwin" data-id="${p.id}">${ic('clock')}<span class="grow"><b>Time window</b><small>${p.tw&&p.tw.on?t12(p.tw.from)+' to '+t12(p.tw.until):'Not restricted'}</small></span>${ic('chev')}</button>
<button class="btn gh full" style="margin-top:12px" data-a="close">Close</button>`;
function pformHtml(){const f=S.pf,lock=isLocked(f),dis=lock?' disabled':'';
return `<h3>${f.isNew?'Add offer':'Edit offer'}</h3>
${lock?'<p class="hint">This is a verified Smart plan. Only the amount and the settings below can be changed.</p>':''}
${!lock&&!f.isNew&&isVerified(f)?`<p class="hint">Saving a change switches this offer's signature off. You will need to learn it again.</p>`:''}
<label>Offer name<input id="pn" class="in" value="${esc(f.name)}"${dis} placeholder="1GB 1HR"></label>
<label>Category<select id="pc" class="in"${dis}>${PICK.map(c=>`<option value="${c}"${catOf(f)===c?' selected':''}>${cap(c)}</option>`).join('')}</select></label>
<label>USSD code<input id="pu" class="in" value="${esc(f.ussd)}"${dis} placeholder="*180*5*2*AB*1*1#"><small>Use AB where the customer phone number goes.</small></label>
<div class="two"><label>Amount (KES)<input id="pp" class="in" type="number" inputmode="decimal" value="${esc(f.price)}"></label><label>Safaricom price (KES)<input id="ps" class="in" type="number" inputmode="decimal" value="${esc(f.safPrice)}"${dis}></label></div>
${srow('Auto retry','Try again if the purchase fails or is pending','autoRetry',!!f.autoRetry)}
${f.autoRetry?`<div class="two"><label>Retry count<input id="prc" class="in" type="number" min="1" max="10" value="${esc(f.retryCount)}"></label><div class="checks"><label><input id="prp" type="checkbox"${f.retryPending?' checked':''}> Retry pending</label><label><input id="prf" type="checkbox"${f.retryFailed!==false?' checked':''}> Retry failed</label></div></div>${f.retryPending?'<p class="hint">Pending means the last step was sent but nothing confirmed it. Retrying it can buy the offer twice if the first try had already sold.</p>':''}`:''}
${srow('Auto reschedule to the next day','If a purchase fails, save it for tomorrow and try again then','autoReschedule',!!f.autoReschedule)}
${f.autoReschedule?`<label>Time the next day<input id="prt" class="in" type="time" value="${esc(f.rescheduleTime||'06:00')}"></label>`:''}
${srow('Notify the customer','Send an SMS after this offer is bought','notifyOn',!!f.notifyOn)}
${f.notifyOn?`<label>SMS message<textarea id="pnm" class="in" rows="3">${esc(f.notifyMsg)}</textarea><small>You can use {name}, {offer}, {amount} and {phone}.</small></label>`:''}
<p id="pe" class="err" role="alert"></p>
<div class="flex"><button class="btn gh grow" data-a="close">Cancel</button><button class="btn grow" data-a="psave">Save</button></div>`}
function wformHtml(){const w=S.wf,p=pl(w.pid),alts=DB.plans.filter(x=>String(x.id)!==String(w.pid)&&x.on);
return `<h3>Time window</h3><p class="hint"><b>${esc(p.name)}</b> · KES ${esc(p.price)}</p>
${srow('Restrict to a time window','Only sell this offer between the hours below','on',!!w.on)}
${w.on?`<div class="two"><label>Available from<input id="wf" class="in" type="time" value="${esc(w.from)}"></label><label>Available until<input id="wu" class="in" type="time" value="${esc(w.until)}"></label></div>
<label>Alternative offer outside this window (required)<select id="wa" class="in"><option value="">Choose an offer</option>${alts.map(x=>`<option value="${esc(x.id)}"${String(w.altId)===String(x.id)?' selected':''}>${esc(x.name)} · KES ${esc(x.price)}</option>`).join('')}</select>${alts.length?'':'<small>Add or enable another offer first.</small>'}</label>
${srow('Notify the customer','Send an SMS when the alternative offer is used','notify',!!w.notify)}
${w.notify?`<label>SMS message<textarea id="wm" class="in" rows="3" placeholder="This offer is not available now, so we sent you an alternative.">${esc(w.msg)}</textarea></label>`:''}`:''}
<p id="we" class="err" role="alert"></p>
<div class="flex"><button class="btn gh grow" data-a="close">Cancel</button><button class="btn grow" data-a="wsave">Save</button></div>`}
function sigSheet(){const g=S.sg,p=pl(g.id),smart=!!p.smart,saved=p.sig&&p.sig.steps?p.sig:null,locked=smart&&!!saved&&!p.sigAuto,sig=g.learned?g.learned.signature:saved,
canSave=!locked&&!g.busy&&((g.learned&&g.learned.signature.complete)||(!g.learned&&saved&&saved.complete&&g.enable!==!!p.sigEnabled)),
rows=sig?sigRows(sig,g.learned):[],path=esc(String(p.ussd).replace(/AB/g,'0700000000'));
return `<h3>Signature</h3>
<p class="hint">The signature remembers what each step of this offer should contain, so it still buys the right plan if Safaricom reorders the menu.</p>
<p class="hint"><b>${esc(p.name)}</b> ${isVerified(p)?vb(15):''}<br>USSD <code>${esc(p.ussd)}</code></p>
<p class="hint">USSD path used to learn<br><code>${path}</code></p>
${locked?`<p class="hint">${vb(15)} This is a verified Smart plan. Its signature is built in and locked.</p>`:`
${smart&&!saved?'<p class="hint">This plan has no saved signature yet. Learn it once here.</p>':''}
<div class="srow"><span class="grow"><b>Enable signature</b><small>${sig&&sig.complete?'Turn on to use the saved steps':'Learn the steps first, then enable'}</small></span><button type="button" class="sw${g.enable?' on':''}" role="switch" aria-checked="${g.enable}" aria-label="Enable signature" data-a="sgen"${g.busy||!sig||!sig.complete?' disabled':''}><i></i></button></div>
<button class="btn gh full" data-a="slearn"${g.busy?' disabled':''}>${ic('finger',18)} ${g.busy?'Learning on the phone…':sig?'Learn again':'Learn signature'}</button>
<p class="hint">${g.busy?'Running the steps on the phone with the test number 0700000000. This can take up to 90 seconds. Keep the phone unlocked.':'Learning dials every step with the test number 0700000000 and stops before the last step, so nothing is bought. Stop automation first so a customer payment does not wait behind it.'}</p>`}
${sig?`<b>${g.learned?'Steps found':'Saved steps'}</b><ol class="steps">${rows.map(r=>`<li>${r.ok?'':'⚠ '}${esc(r.t)}</li>`).join('')}</ol>
${g.learned&&sig.complete?'<p class="hint">The last step is the purchase. It was not sent.</p>':''}
${g.learned&&!sig.complete?'<p class="hint">Some steps could not be matched, so this signature cannot be saved. Check the USSD code, then learn again.</p>':''}`:''}
${g.learned&&g.learned.screens?`<details><summary>What the phone showed at each step</summary>${g.learned.screens.map((s,i)=>`<pre class="scr">${esc('Step '+(i+1)+'\n'+s)}</pre>`).join('')}</details>`:''}
${g.msg?`<p class="hint">${esc(g.msg)}</p>`:''}${g.err?`<p class="err">${esc(g.err)}</p>`:''}
<div class="flex" style="margin-top:12px">${locked?'<button class="btn grow" data-a="close">Close</button>':`<button class="btn gh grow" data-a="close"${g.busy?' disabled':''}>Cancel</button><button class="btn grow" data-a="ssave"${canSave?'':' disabled'}>Save signature</button>`}</div>`}
function more(){const m=S.more;if(m)return{quick,sub,tokens,settings}[m]();
return `<h1 class="h2">More</h1>${[['quick','dial','Quick Dial'],['sub','card','Portal Subscription'],['tokens','coin','Tokens'],['settings','gear','Settings']].map(([k,i,l])=>`<button class="card mrow" data-a="go" data-p="more" data-m="${k}">${ic(i)}<b class="grow">${l}</b>${ic('chev')}</button>`).join('')}<button class="card mrow" data-a="out">${ic('out')}<b class="grow">Sign out</b></button>`}
function quick(){return `${bk('Quick Dial')}<div class="card"><label>Phone number<input id="qp" class="in" type="tel" inputmode="tel" placeholder="0712345678"></label><label>Plan<select id="qo" class="in">${DB.plans.filter(p=>p.on).map(p=>`<option value="${p.id}">${esc(p.name)}, KES ${p.price}</option>`).join('')}</select></label><p id="qe" class="err" role="alert"></p><button class="btn full" data-a="qdial">${ic('dial',18)} Dial on ${esc(dev().name)}</button></div>`}
function sub(){const n=DB.devices.length,m=DB.plan.max,act=DB.plan.active!==false;return `${bk('Portal Subscription')}${act?'':'<div class="card warn"><b>Subscribe to use the portal</b><p class="mu">Choose a plan below to connect your phones and see their live activity.</p></div>'}<div class="card"><div class="flex"><b class="grow">${act?n+(m>=1000?'':' of '+m)+' devices paired':'No active subscription'}</b><small>${DB.plan.exp?'Expires '+DB.plan.exp:''}</small></div>${act?`<div class="bar"><i style="width:${Math.min(100,n/m*100)}%"></i></div>`:''}</div>
${SUBS.map(s=>{const c=act&&s.n===DB.plan.name;return `<div class="card sp${s.pop?' pop':''}">${s.pop?'<span class="tag">Most popular</span>':''}<h3>${s.n}</h3><div class="price">KES ${s.p}<small> / 30 days</small></div><ul>${s.f.map(f=>`<li>${f}</li>`).join('')}</ul><button class="btn${c?' gh':''} full" data-a="subbuy" data-n="${s.n}">${c?'Extend 30 days':'Choose '+s.n}</button></div>`}).join('')}`}
function tokens(){return `${bk('Tokens')}<p class="mu">Balances come from the phone. Buying sends an airtime purchase to that device.</p>${DB.devices.map(d=>`<div class="card"><div class="flex"><i class="dot${d.online?' on':''}"></i><b class="grow">${esc(d.name)}</b></div><div class="flex" style="margin:0"><span class="big grow">${d.tok}<small> tokens</small></span><button class="btn" data-a="tbuy" data-id="${d.id}">${ic('coin',18)} Buy</button></div>${d.until?`<span class="pill" style="margin-top:10px">Unlimited until ${d.until}</span>`:''}</div>`).join('')}`}
function settings(){return `${bk('Settings')}<div class="card"><b>Appearance</b><div class="seg">${['light','dark','system'].map(t=>`<button class="${S.theme===t?'on':''}" data-a="theme" data-t="${t}" aria-pressed="${S.theme===t}">${t[0].toUpperCase()+t.slice(1)}</button>`).join('')}</div></div>
<div class="card"><b>Change password</b><label>Current password<input id="pw0" class="in" type="password" autocomplete="current-password"></label><label>New password<input id="pw1" class="in" type="password" autocomplete="new-password"></label><label>Confirm new password<input id="pw2" class="in" type="password" autocomplete="new-password"></label><p id="pwe" class="err" role="alert"></p><button class="btn full" data-a="pw">Update password</button></div>`}
function render(){if(DB.locked){S.page='more';S.more='sub'}const pg=({home,devices,tx:txPage,plans,more})[S.page];if(pg)$('#app').innerHTML=pg();document.querySelectorAll('#nav button').forEach(b=>b.classList.toggle('on',b.dataset.p===S.page))}
/* ===== Actions ===== */
const pl=id=>DB.plans.find(p=>String(p.id)===String(id)),dv=id=>DB.devices.find(d=>String(d.id)===String(id));
const A={
close(){if(S.sg&&S.sg.busy)return;S.sg=null;$('#modal').innerHTML='';if(R){R(false);R=null}},
no(){A.close()},yes(){$('#modal').innerHTML='';if(R){R(true);R=null}},
go(d){S.page=d.p;S.more=d.m||null;S.tx=null;render();scrollTo(0,0)},
dev(d){S.dev=d.id;HOLD=0;DB.plans=plansOf();S.page='home';S.more=null;S.tx=null;render();scrollTo(0,0)},
eye(){S.hide=!S.hide;render()},
async air(){const d=dev();if(!d.online)return toast(d.name+' is offline');toast('Checking airtime on the phone...');await call('POST','/portal/devices/'+d.id+'/airtime-check');toast('Airtime check sent. The balance updates when the phone replies.')},
async pon(d){const x=dv(d.id);if(!x.reachable)return toast(x.name+' cannot be reached. Open AutoBingwa on the phone.');const on=!x.portalOn;await call('POST','/portal/devices/'+x.id+(on?'/portal-on':'/portal-off'));toast(on?'Switching on... the phone follows in a few seconds':'Switching off... the phone follows in a few seconds')},
async run(d){const x=dv(d.id);if(!x.online)return toast(x.name+' is offline');await call('POST','/portal/devices/'+x.id+(x.running?'/stop':'/start'));x.running=!x.running;render();toast(x.running?'Automation started':'Automation stopped')},
adddev(){modal('<h3>Connect a phone</h3><p class="mu">In the AutoBingwa app, switch on AutoBingwa Portal and copy the Connect ID.</p>'+connectForm()+'<button class="btn gh full" style="margin-top:10px" data-a="close">Cancel</button>')},
async cdo(){const id=$('#cid').value.trim().toUpperCase(),nm=$('#cnm').value.trim(),e=$('#cerr');
if(!id)return e.textContent='Enter the Connect ID from the app';if(!nm)return e.textContent='Give this phone a name';
e.textContent='';try{const r=await call('POST','/portal/devices/connect',{connectId:id,name:nm});await refresh();S.dev=r.id;S.page='home';A.close();render();toast('Connected: '+nm)}catch(x){e.textContent=x.message}},
f(d){S.f=d.f;render()},
otx(d){S.tx=d.id;S.page='tx';render();scrollTo(0,0)},
tback(){S.tx=null;render()},
async copy(d){try{await navigator.clipboard.writeText(cur()[d.k]);toast('Copied')}catch(e){toast('Could not copy. Select the text and copy it by hand.')}},
async retry(){const t=cur();await call('POST','/portal/tx/'+t.id+'/retry');t.st='Pending';render();toast('Retry sent to the phone')},
resched(){modal(`<h3>Reschedule</h3><label>New date and time<input id="rs" class="in" type="datetime-local"></label><p id="re" class="err" role="alert"></p><div class="flex"><button class="btn gh grow" data-a="close">Cancel</button><button class="btn grow" data-a="rsok">Schedule</button></div>`)},
async rsok(){const v=$('#rs').value;if(!v||new Date(v)<=new Date())return $('#re').textContent='Choose a time in the future';const t=cur();await call('POST','/portal/tx/'+t.id+'/reschedule',{at:v});t.st='Scheduled';A.close();render();toast('Transaction rescheduled')},
async del(){if(!await ask('Delete transaction?','This transaction will be removed for good.','Delete',1))return;await call('DELETE','/portal/tx/'+S.tx);DB.tx=DB.tx.filter(x=>x.id!==S.tx);S.tx=null;render();toast('Transaction deleted')},
/* ----- Data plans ----- */
pcat(d){S.pc=d.c;render()},
async ptog(d){const p=pl(d.id),v=!p.on;p.on=v;held();render();try{await call('PUT','/portal/plans/'+p.id,{on:v,enabled:v})}catch(e){p.on=!v;render();throw e}},
pmenu(d){S.pm=d.id;modal(pmenuHtml(pl(d.id)))},
padd(){S.pf=blankPlan();modal(pformHtml())},
pform(d){S.pf=JSON.parse(JSON.stringify(pl(d.id)));modal(pformHtml())},
pft(d){readPf();const f=S.pf,k=d.k;f[k]=!f[k];if(k==='notifyOn'&&f[k]&&!f.notifyMsg)f.notifyMsg=DEF_MSG;modal(pformHtml())},
async psave(){readPf();const f=S.pf,lock=isLocked(f),patch=toPatch(f,lock),e=$('#pe');
if(!patch.name)return e.textContent='Enter the offer name';
const bad=chkU(patch.ussd);if(bad)return e.textContent=bad;
if(!(patch.price>0))return e.textContent='Enter the amount';
if(patch.notifyOn&&!patch.notifyMsg)return e.textContent='Write the SMS message for the customer';
const p=f.isNew?null:pl(f.id);
if(p&&JSON.stringify(patch)===JSON.stringify(toPatch(p,lock)))return A.close();
const{category,...rest}=patch;
if(p){await call('PUT','/portal/plans/'+p.id,{...patch,device:dev().id});Object.assign(p,rest);if(category)p.cat=category;if(!lock){p.signed=false;p.sigEnabled=false}}
else{const r=await call('POST','/portal/plans',{...patch,enabled:true,tw:defTw(),device:dev().id});const n=blankPlan();delete n.isNew;DB.plans.push({...n,...rest,cat:category||'DATA',id:(r&&r.id)||'p'+Date.now(),signed:false,on:true})}
held();A.close();render();toast('Plan saved')},
pwin(d){S.wf={...defTw(),...(pl(d.id).tw||{}),pid:d.id};modal(wformHtml())},
wft(d){readWf();S.wf[d.k]=!S.wf[d.k];modal(wformHtml())},
async wsave(){readWf();const{pid,...w}=S.wf,e=$('#we');
if(w.on){if(!w.from||!w.until)return e.textContent='Choose the start and end time';if(w.from===w.until)return e.textContent='The start and end time cannot be the same';if(!w.altId)return e.textContent='Choose an alternative offer for outside the window'}
const p=pl(pid),alt=w.altId?pl(w.altId):null,tw={...w,altId:alt?alt.id:''};
await call('PUT','/portal/plans/'+p.id,{tw});p.tw=tw;held();S.wf=null;A.close();render();toast('Time window saved')},
psig(d){const p=pl(d.id);S.sg={id:d.id,learned:null,enable:p.smart?true:!!(p.sigEnabled??p.signed),busy:false,err:'',msg:''};modal(sigSheet())},
sgen(){const g=S.sg;g.enable=!g.enable;modal(sigSheet())},
async slearn(){const g=S.sg,p=pl(g.id),x=dev();
if(!x.online){g.err=x.name+' is offline. Learning needs the phone online.';return modal(sigSheet())}
g.busy=true;g.err='';g.msg='';modal(sigSheet());
try{let r;
if(USE_MOCK){await sleep(1500);r={signature:mockSig(),screens:['Screen 1\n1.Data\n2.Minutes','Screen 2\n1.Bundles']}}
else{r=await call('POST','/portal/plans/'+p.id+'/learn',{device:x.id});
if(!r.signature){const job=r.job;for(let i=0;i<50&&!r.signature;i++){await sleep(2000);const s=await call('GET','/portal/plans/'+p.id+'/learn/'+job);if(s.status==='error')throw new Error(s.error||'Learning failed');if(s.status==='done')r=s}
if(!r.signature)throw new Error('The phone took too long. Check it is online and unlocked, then try again.')}}
g.learned={signature:r.signature,screens:r.screens||[]};g.enable=!!r.signature.complete}
catch(e){g.err=e.message||'Learning failed'}
g.busy=false;if(S.sg===g)modal(sigSheet())},
async ssave(){const g=S.sg,p=pl(g.id),x=dev(),sig=g.learned?g.learned.signature:p.sig,en=p.smart?true:g.enable;
g.busy=true;g.err='';modal(sigSheet());
try{await call('POST','/portal/plans/'+p.id+'/signature',{device:x.id,signature:sig,enabled:en});
Object.assign(p,{sig,sigLearned:true,sigEnabled:en,signed:en});held();g.busy=false;A.close();render();toast('Signature saved on the phone')}
catch(e){g.busy=false;g.err=e.message||'Could not save the signature';modal(sigSheet())}},
async pdel(d){const p=pl(d.id);if(!await ask('Delete plan?',esc(p.name)+' will be removed for good.','Delete',1))return;await call('DELETE','/portal/plans/'+p.id);DB.plans=DB.plans.filter(x=>x!==p);DB.plans.forEach(x=>{if(x.tw&&String(x.tw.altId)===String(p.id))x.tw={...x.tw,on:false,altId:''}});held();render();toast('Plan deleted')},
async qdial(){const ph=phoneOk($('#qp').value),id=$('#qo').value;if(!ph)return $('#qe').textContent='Enter a valid phone number, for example 0712345678';if(!id)return $('#qe').textContent='Switch on a plan first';
const p=pl(id),x=dev();await call('POST','/portal/quickdial',{device:x.id,offerId:id,phone:ph});DB.tx.unshift({id:'q'+Date.now(),dev:x.id,name:ph,phone:ph,amt:p.price,offer:p.name,st:'Pending',m:0,msg:'Started from Quick Dial',ussd:p.ussd.replace(/AB/gi,ph),resp:'No response recorded yet.'});toast('Quick Dial sent to '+x.name+'. See the result in Transactions.');A.go({p:'tx'})},
subbuy(d){modal(`<h3>${d.n}</h3><p class="mu">Enter the M-Pesa number to pay with. You will get a payment prompt.</p><label>M-Pesa number<input id="sp" class="in" type="tel" inputmode="tel"></label><p id="se" class="err" role="alert"></p><div class="flex"><button class="btn gh grow" data-a="close">Cancel</button><button class="btn grow" data-a="subpay" data-n="${d.n}">Pay</button></div>`)},
async subpay(d){const ph=phoneOk($('#sp').value);if(!ph)return $('#se').textContent='Enter a valid phone number';await call('POST','/portal/subscribe/start',{plan:d.n,phone:ph,method:'mpesa'});A.close();toast('M-Pesa prompt sent to '+ph+'. Your plan updates once it is paid.')},
tbuy(d){S.td=d.id;modal(`<h3>Buy tokens for ${esc(dv(d.id).name)}</h3>${PACKS.map((p,i)=>`<button class="pk" data-a="tpick" data-i="${i}"><b>${p[0]}</b><span>KES ${p[1]}</span></button>`).join('')}<button class="btn gh full" style="margin-top:14px" data-a="close">Close</button>`)},
tpick(d){S.tp=d.i;const p=PACKS[d.i],x=dv(S.td);modal(`<h3>${p[0]} · KES ${p[1]}</h3><p class="mu">Choose how to pay for ${esc(x.name)}.</p><button class="btn full" data-a="tpay" data-m="airtime">${ic('coin',18)} Pay with airtime on the phone</button><label style="margin-top:14px">M-Pesa number (only for M-Pesa)<input id="tph" class="in" type="tel" inputmode="tel" placeholder="0712345678"></label><p id="tpe" class="err" role="alert"></p><button class="btn gh full" data-a="tpay" data-m="mpesa">${ic('card',18)} Pay with M-Pesa</button><button class="btn gh full" style="margin-top:8px" data-a="close">Cancel</button>`)},
async tpay(d){const p=PACKS[S.tp],x=dv(S.td),m=d.m;let ph='';
if(m==='mpesa'){ph=phoneOk($('#tph').value);if(!ph)return $('#tpe').textContent='Enter a valid M-Pesa number'}
A.close();await call('POST','/portal/tokens/buy',{device:x.id,packId:p[2],method:m,phone:ph||undefined});
toast(m==='mpesa'?'M-Pesa prompt sent to '+ph+'. The tokens are added once it is paid.':p[0]+' (KES '+p[1]+') request sent to '+x.name+'. It is paid with airtime on the phone.')},
theme(d){applyTheme(d.t);render()},
async pw(){const a=$('#pw0').value,b=$('#pw1').value,c=$('#pw2').value,e=$('#pwe');if(!a)return e.textContent='Enter your current password';if(b.length<8)return e.textContent='The new password must be at least 8 characters';if(b!==c)return e.textContent='The new passwords do not match';
await window.portalChangePin(a,b);render();toast('Password updated')},
out(){window.portalSignOut()}};
document.addEventListener('click',e=>{const t=e.target.closest('[data-a]');if(!t)return;if(t.classList.contains('mb')&&e.target!==t)return;const f=A[t.dataset.a];if(f)Promise.resolve(f(t.dataset)).catch(err=>toast(err.message||'Something went wrong'))});
/* ===== Live data ===== */
const plansOf=()=>{const d=DB.devices.find(x=>x.id===S.dev)||DB.devices[0];return d&&Array.isArray(d.offers)?d.offers:[]};
async function refresh(){const o=await call('GET','/portal/overview');DB.locked=false;const keep=Date.now()<HOLD?DB.plans:null;Object.assign(DB,o);if(!DB.devices.find(d=>d.id===S.dev))S.dev=(DB.devices[0]||{}).id||'';DB.plans=keep||plansOf()}
async function poll(){if(document.hidden)return;const b=JSON.stringify([DB.devices,DB.tx,DB.plans]);
try{await refresh()}catch(e){return}
if(JSON.stringify([DB.devices,DB.tx,DB.plans])===b)return;
const f=document.activeElement,typing=f&&/^(INPUT|SELECT|TEXTAREA)$/.test(f.tagName);
if($('#modal').innerHTML||typing||(S.page==='more'&&(S.more==='quick'||S.more==='settings')))return;render()}
/* ===== Start ===== */
$('#nav').innerHTML=[['home','home','Home'],['devices','phone','Devices'],['tx','list','Transactions'],['plans','db','Data plans'],['more','more','More']].map(([p,i,l])=>`<button data-a="go" data-p="${p}">${ic(i)}<span>${l}</span></button>`).join('');
applyTheme(S.theme);
(async()=>{$('#app').innerHTML='<p class="mu c">Loading your portal...</p>';
if(!USE_MOCK){try{await refresh()}catch(e){DB.devices=[];DB.tx=[];DB.plans=[];toast('Could not load: '+e.message)}}
render();if(!USE_MOCK)setInterval(poll,5000)})();