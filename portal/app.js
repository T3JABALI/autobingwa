/* ===== Data layer =====
   USE_MOCK=true runs on sample data. To connect the real server later: set USE_MOCK=false and API_URL.
   The server must provide (Bearer token in the Authorization header):
   GET  /portal/overview               -> { biz, cid, plan, devices, tx, plans, locked }
   GET  /portal/transactions?device=&range=&q= -> { tx, history }
   GET  /portal/plans                  -> { plans, current, phone }
   POST /portal/subscribe/start {planId,phone} -> { paymentId }
   GET  /portal/subscribe/status/:id   -> { status, message }
   POST /portal/devices/:id/airtime-check | /start | /stop
   POST /portal/tx/:id/retry | /reschedule {at}      DELETE /portal/tx/:id
   POST /portal/plans   PUT|DELETE /portal/plans/:id   POST /portal/plans/:id/learn
   POST /portal/quickdial {device,offerId,phone}     POST /portal/tokens/buy {device,packId,method,phone}
   GET  /portal/tokens/mpesa/status/:id              GET /portal/commands/:id
   POST /portal/password {current,next} */
const USE_MOCK=false,API_URL='https://autobingwa-payments.onrender.com';
const DB={biz:'Jabali Bingwa Deals',cid:'AB-1042',plan:{id:'d2',name:'2 Devices',max:2,exp:'15 Nov 2026',active:true},
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
{id:'p1',name:'400mbs tunukiwa',cat:'Tunukiwa',price:26,ussd:'*544*6*8*AB*00*1*0*1*1#',signed:true,on:true},
{id:'p2',name:'400MBS',cat:'Data',price:25,ussd:'*180*5*2*AB*1*1#',signed:true,on:true},
{id:'p3',name:'1.5GB 3HRS',cat:'Data',price:50,ussd:'*180*5*2*AB*7*1#',signed:false,on:true},
{id:'p4',name:'900 MB Midnight',cat:'Pata More',price:57,ussd:'*544*6*8*AB*00*1*0*6*1#',signed:true,on:false}]};
const PACKS=[['1,000 units',90,'u1000'],['600 units',50,'u600'],['250 units',25,'u250'],['100 units',15,'u100'],['1 day unlimited',30,'d1'],['7 days unlimited',200,'d7'],['30 days unlimited',550,'d30']];
/* Portal subscription plans. The ids must match SUB_PLANS on the server. */
const SUBS=[
{id:'d2',n:'2 Devices',p:100,f:['Link up to 2 devices','3 days of portal history','Valid for 31 days']},
{id:'d4',n:'4 Devices',p:200,pop:1,f:['Link up to 4 devices','5 days of portal history','Valid for 31 days']},
{id:'unl',n:'Unlimited Plan',p:400,f:['Link unlimited devices','7 days of portal history','31 days of access']}];
const CATS=['Data','Minutes','SMS','Tunukiwa','Pata More'];
const $=s=>document.querySelector(s),sleep=ms=>new Promise(r=>setTimeout(r,ms));
const ls={get(k,d){try{return localStorage.getItem(k)||d}catch(e){return d}},set(k,v){try{localStorage.setItem(k,v)}catch(e){}}};
async function call(m,p,b){if(USE_MOCK){await sleep(200);return{ok:true}}
const r=await fetch(API_URL+p,{method:m,headers:{'Content-Type':'application/json',Authorization:'Bearer '+(await window.getAuthToken())},body:b?JSON.stringify(b):undefined});
if(r.status===401){window.portalSignOut();throw new Error('Session expired. Please log in again.')}
const j=await r.json().catch(()=>({}));
if(!r.ok)throw new Error(j.error||'The server answered '+r.status);return j}
/* ===== Helpers ===== */
const P={search:'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-4.3-4.3',x:'M6 6l12 12M18 6L6 18',home:'M3 11l9-8 9 8M5 10v10h14V10',phone:'M7 2h10v20H7zM11 18h2',list:'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',db:'M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zM4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3',more:'M5 12h.01M12 12h.01M19 12h.01',chev:'M9 6l6 6-6 6',back:'M19 12H5M12 19l-7-7 7-7',plus:'M12 5v14M5 12h14',refresh:'M3 12a9 9 0 0 1 15-6.7L21 8M21 3v5h-5M21 12a9 9 0 0 1-15 6.7L3 16M3 21v-5h5',eye:'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',eyeoff:'M3 3l18 18M10.6 6.1A9.6 9.6 0 0 1 12 6c6 0 10 6 10 6a17 17 0 0 1-3.2 3.8M6.5 7.5A17 17 0 0 0 2 12s4 6 10 6c1.4 0 2.7-.3 3.8-.8',bolt:'M13 2L4 14h7l-1 8 9-12h-7z',edit:'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z',trash:'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',out:'M9 21H5V3h4M16 17l5-5-5-5M21 12H9',dial:'M6.6 10.8a15 15 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25c1.1.37 2.3.57 3.6.57a1 1 0 0 1 1 1V20a1 1 0 0 1-1 1C10.6 21 3 13.4 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.57a1 1 0 0 1-.25 1z',card:'M3 6h18v12H3zM3 10h18',coin:'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v10M9.5 9.5h4a1.5 1.5 0 0 1 0 3h-3a1.5 1.5 0 0 0 0 3h4',gear:'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM3 12h2M19 12h2M12 3v2M12 19v2M5.6 5.6L7 7M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4',copy:'M9 9h11v11H9zM5 15V5h10',finger:'M12 10a2 2 0 0 0-2 2c0 1.02-.1 2.51-.26 4M14 13.12c0 2.38 0 6.38-1 8.88M17.29 21.02c.12-.6.43-2.3.5-3.02M2 12a10 10 0 0 1 18-6M21.8 16c.2-2 .131-5.354 0-6M5 19.5C5.5 18 6 15 6 12a6 6 0 0 1 .34-2M8.65 22c.21-.66.45-1.32.57-2M9 6.8a6 6 0 0 1 9 5.2v2'};
const ic=(n,s=22)=>`<svg viewBox="0 0 24 24" width="${s}" height="${s}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${P[n]}"/></svg>`;
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=n=>Number(n).toLocaleString('en-KE',{minimumFractionDigits:2,maximumFractionDigits:2});
const ago=m=>m<1?'Just now':m<60?m+'m ago':m<1440?Math.floor(m/60)+'h ago':Math.floor(m/1440)+'d ago';
const ini=n=>String(n).trim().split(/\s+/).slice(0,2).map(w=>w[0]||'').join('').toUpperCase();
const TONE={Completed:'ok',Failed:'bad',Pending:'wn',Scheduled:'wn',Processing:'wn',Paused:'wn',Skipped:'wn',Unmatched:'bad'};
const S={page:'home',more:null,dev:'d1',f:'All',hide:false,tx:null,td:null,theme:ls.get('theme','system'),range:'today',q:'',sopen:false,txl:[],tdev:'all',loading:false,qc:'All'};
const dev=()=>DB.devices.find(d=>d.id===S.dev)||DB.devices[0]||{id:'',name:'No phone connected',online:false,portalOn:false,running:false,air:0,used:0,tok:0,bat:0,chg:false,com:0,ok:0,failed:0};
const cur=()=>DB.tx.find(x=>x.id===S.tx)||(S.txl||[]).find(x=>x.id===S.tx);
const mk=t=>S.hide?'••••••':t;
let R=null,tt=null,payRun=0;
function toast(m){const t=$('#toast');t.textContent=m;clearTimeout(tt);tt=setTimeout(()=>{t.textContent=''},3500)}
function modal(h){$('#modal').innerHTML=`<div class="mb" data-a="close"><div class="ms" role="dialog" aria-modal="true">${h}</div></div>`}
function ask(t,m,ok,danger){return new Promise(res=>{R=res;modal(`<h3>${t}</h3><p class="mu">${m}</p><div class="flex"><button class="btn gh grow" data-a="no">Cancel</button><button class="btn${danger?' bad':''} grow" data-a="yes">${ok}</button></div>`)})}
function applyTheme(t){S.theme=t;ls.set('theme',t);const r=document.documentElement;t==='system'?r.removeAttribute('data-theme'):r.setAttribute('data-theme',t)}
const bk=t=>`<div class="flex"><button class="ib" data-a="go" data-p="more" data-m="" aria-label="Back">${ic('back')}</button><h1 class="h2" style="margin:0">${t}</h1></div>`;
const phoneOk=v=>{const p=String(v).replace(/[\s+-]/g,'').replace(/^254/,'0');return /^0[17]\d{8}$/.test(p)?p:''};
/* ===== Pages ===== */
const devRow=d=>`<button class="card drow${d.id===S.dev?' act':''}" data-a="dev" data-id="${d.id}"><i class="dot${d.online?' on':''}"></i><span class="grow"><b>${esc(d.name)}</b><small>${d.online?'Online':'Offline'}, ${d.running?'running':'stopped'}</small></span>${ic('chev')}</button>`;
const txRow=t=>`<button class="card tx" data-a="otx" data-id="${t.id}"><span class="av">${esc(ini(t.name))}</span><span class="grow"><b>${esc(t.name)}</b><small>${t.phone}, ${esc(t.offer)}, KES ${t.amt}</small></span><span class="rt"><b class="${TONE[t.st]||''}">${t.st}</b><small>${ago(t.m)}</small></span></button>`;
const hhmm=ts=>new Date(ts).toLocaleTimeString('en-KE',{hour:'2-digit',minute:'2-digit'});
const dayLabel=ts=>{const d=new Date(ts),t=new Date(),y=new Date(Date.now()-864e5),k=x=>x.toDateString();return k(d)===k(t)?'Today':k(d)===k(y)?'Yesterday':d.toLocaleDateString('en-KE',{weekday:'short',day:'numeric',month:'short'})};
const txRowC=t=>`<button class="card tr" data-a="otx" data-id="${t.id}"><span class="grow"><b>${esc(t.name||t.phone)}</b><small>${esc(t.phone)} · ${esc(t.offer)}</small></span><span class="rt"><b>KES ${t.amt}</b><small><i class="${TONE[t.st]||''}" style="font-style:normal">${t.st}</i> · ${hhmm(t.ts)}</small></span></button>`;
function txList(){const l=S.txl||[];if(S.loading&&!l.length)return '<p class="mu c">Loading...</p>';
if(!l.length)return `<p class="mu c">${S.q?'No match in your plan history.':'No transactions here.'}</p>`;
let k='',o='';for(const t of l){const g=dayLabel(t.ts);if(S.range==='all'&&g!==k){k=g;o+=`<small class="dh">${g}</small>`}o+=txRowC(t)}
return `<p class="mu" style="margin:2px 0">${l.length} transaction${l.length===1?'':'s'}</p>`+o}
async function loadTx(){if(!DB.devices.length){S.txl=[];return}
const r=await call('GET','/portal/transactions?device='+encodeURIComponent(S.tdev)+'&range='+S.range+'&q='+encodeURIComponent(S.q));
S.txl=r.tx.map(t=>({...t,m:Math.max(0,Math.floor((Date.now()-Date.parse(t.ts))/60000))}))}
const reload=()=>{S.loading=true;render();return loadTx().catch(e=>toast(e.message)).then(()=>{S.loading=false;render()})};
function homeMain(){const d=dev(),t=DB.tx.filter(x=>x.dev===d.id);
return `<div class="flex" style="margin:0"><img class="logo" src="/logo.png" alt="" onerror="this.remove()"><h1 class="h1" style="margin:0">AUTOBINGWA PORTAL</h1></div><p class="sub">Here's what's happening on <b>${esc(DB.biz)}</b> (${esc(DB.cid)}) right now</p>
${DB.devices.map(devRow).join('')}
<div class="stats"><div class="st" style="--c:var(--ok)"><b>${d.ok??t.filter(x=>x.st==='Completed').length}</b><span>Successful</span></div><div class="st" style="--c:var(--bad)"><b>${d.failed??t.filter(x=>x.st==='Failed').length}</b><span>Failed</span></div><button class="st" style="--c:var(--ac)" data-a="go" data-p="more" data-m="tokens"><b>${d.tok}</b><span>Tokens</span></button></div>
<div class="card"><div class="flex"><small class="grow">${esc(d.name)}</small><button class="ib" data-a="eye" aria-pressed="${S.hide}" aria-label="${S.hide?'Show':'Hide'} amounts">${ic(S.hide?'eyeoff':'eye')}</button><button class="ib" data-a="air" aria-label="Check airtime">${ic('refresh')}</button></div>
<div class="two"><div><small>Airtime used today</small><div class="big sm">${mk('KES '+money(d.used))}</div></div><div><small>Airtime balance</small><div class="big sm">${mk('KES '+money(d.air))}</div></div></div></div>
<div class="two"><div class="card"><small>Battery</small><div class="big">${d.bat}%</div><span class="pill" style="--c:var(--${d.chg?'ok':'wn'})">${ic('bolt',14)} ${d.chg?'Charging':'Not charging'}</span></div><div class="card"><small>Commission this week</small><div class="big sm">${mk('KES '+money(d.com))}</div></div></div>
<div class="sec"><h2>Recent transactions</h2><button class="lnk" data-a="go" data-p="tx">View all</button></div>${t.slice(0,4).map(txRow).join('')||'<p class="mu c">No transactions yet.</p>'}`}
const connectForm=()=>`<label>Connect ID<input id="cid" class="in" autocapitalize="characters" autocomplete="off" placeholder="AUB-XXXXX"></label><label>Phone name<input id="cnm" class="in" maxlength="40" placeholder="For example: Bundles Store Mtaani"></label><p id="cerr" class="err" role="alert"></p><button class="btn full" data-a="cdo">${ic('phone',18)} Connect phone</button>`;
const connectCard=first=>`<div class="flex" style="margin:0"><img class="logo" src="/logo.png" alt="" onerror="this.remove()"><h1 class="h1" style="margin:0">AUTOBINGWA PORTAL</h1></div><p class="sub">${first?'Connect your first phone to start seeing its live activity.':'Connect another phone.'}</p><div class="card"><b>Connect a phone</b><p class="mu">In the AutoBingwa app, switch on <b>AutoBingwa Portal</b>, then copy the Connect ID shown there.</p>${connectForm()}</div>`;
function home(){if(!DB.devices.length)return connectCard(true);const d=dev();
const w=d.portalOn===false?'AutoBingwa Portal is switched off on this phone. Switch it on in the app to see live activity.':!d.online?'Showing the last values this phone sent. Open AutoBingwa on the phone to see live activity.':'';
return (w?`<div class="card warn"><b>${esc(d.name)} is ${d.portalOn===false?'disconnected':'offline'}</b><p class="mu">${w}</p></div>`:'')+homeMain()}
function devices(){const n=DB.devices.length,m=DB.plan.max,full=n>=m,unl=m>=1000;
return `<h1 class="h2" style="margin-bottom:2px">Devices</h1><p class="mu">${n?'Your linked phones.':'Link your first phone to start seeing its live activity.'}</p>
<div class="card"><div class="flex"><b class="grow">${n}/${unl?'unlimited':m} devices linked</b><span class="pill" style="--c:var(--${full?'bad':'ok'})">${full?'Limit reached':'Space available'}</span></div>${unl?'':`<div class="bar"><i style="width:${Math.min(100,m?n/m*100:0)}%"></i></div>`}<small>${esc(DB.plan.name)} plan</small></div>
${full?`<div class="card warn"><b>You've reached your device limit</b><p class="mu">${esc(DB.plan.name)} allows ${m} devices. Upgrade to link more.</p><button class="btn" data-a="go" data-p="more" data-m="sub">${ic('card',18)} Upgrade plan</button></div>`:`<div class="card"><b>Link a phone</b><p class="mu">In the AutoBingwa app, switch on <b>AutoBingwa Portal</b> and wait until it shows <b>Connected</b>. Then enter the Connect ID shown there and give the phone a name.</p>${connectForm()}</div>`}
${DB.devices.map(d=>`<div class="card"><button class="drow plain" data-a="dev" data-id="${d.id}"><i class="dot${d.online?' on':''}"></i><span class="grow"><b>${esc(d.name)}</b><small>Linked phone, ${d.online?'online':'offline'}, ${d.running?'running':'stopped'}</small></span>${ic('chev')}</button><div class="two"><div><small>Airtime</small><b>KES ${money(d.air)}</b></div><div><small>Tokens</small><b>${d.tok}</b></div></div><button class="btn${d.running?' bad':''} full" style="margin-top:12px" data-a="run" data-id="${d.id}">${d.running?'Stop automation':'Start automation'}</button></div>`).join('')}
<p class="mu">Only devices linked to your account appear here.</p>`}
function txPage(){if(S.tx&&cur())return txDetail();const h=(DB.plan&&DB.plan.history)||3;
return `<div class="flex" style="margin:0"><h1 class="h2 grow" style="margin:0">Transactions</h1><button class="ib" data-a="tsearch" aria-label="Search">${ic(S.sopen?'x':'search')}</button></div>
${S.sopen?`<input id="tq" class="in" type="search" autocomplete="off" placeholder="Search phone, M-Pesa code or name" value="${esc(S.q)}" style="margin-bottom:6px">`:''}
<div class="chips">${[['today','Today'],['yest','Yesterday'],['all','Last '+h+' days']].map(([k,l])=>`<button class="chip${S.range===k?' on':''}" data-a="trange" data-r="${k}">${l}</button>`).join('')}${DB.devices.length>1?`<select class="in sel" data-c="tdev"><option value="all">All phones</option>${DB.devices.map(d=>`<option value="${d.id}"${S.tdev===d.id?' selected':''}>${esc(d.name)}</option>`).join('')}</select>`:''}</div>
<div id="txl">${txList()}</div>`}
function txDetail(){const t=cur(),box=(l,k)=>`<div class="card"><div class="flex" style="margin:0"><small class="grow">${l}</small><button class="ib" style="width:34px;height:34px" data-a="copy" data-k="${k}" aria-label="Copy ${l}">${ic('copy',16)}</button></div><div class="pre">${esc(t[k])}</div></div>`;
return `<div class="flex"><button class="ib" data-a="tback" aria-label="Back">${ic('back')}</button><h1 class="h2" style="margin:0">Transaction</h1></div>
<div class="flex"><span class="pill" style="--c:var(--${TONE[t.st]||'tx'})">${t.st}</span><small class="grow r">${ago(t.m)}</small></div>
<div class="amt">KES ${t.amt}<span class="pill">${esc(t.offer)}</span></div>
${box('M-Pesa message','msg')}${box('Phone number','phone')}${box('USSD','ussd')}${box('USSD response','resp')}
<div class="flex"><button class="btn gh grow" data-a="retry">${ic('refresh',18)} Retry</button><button class="btn gh grow" data-a="resched">${ic('list',18)} Reschedule</button><button class="btn bad grow" data-a="del">${ic('trash',18)} Delete</button></div>`}
function plans(){return `<div class="flex"><button class="btn sm" data-a="padd">${ic('plus',18)} Add plan</button></div><h1 class="h2">Data plans</h1>
${DB.plans.map(p=>`<div class="card"><div class="flex" style="margin:0"><span class="grow"><b>${esc(p.name)}</b><small>${esc(p.cat)}, KES ${p.price}</small></span><button class="tg${p.on?' on':''}" data-a="ptog" data-id="${p.id}" aria-pressed="${p.on}">${p.on?'ON':'OFF'}</button></div><code>${esc(p.ussd)}</code><div style="margin-bottom:10px"><span class="pill" style="--c:var(--${p.signed?'ok':'wn'})">${ic('finger',14)} ${p.signed?'Signed':'Not signed'}</span></div><div class="flex" style="margin:0"><button class="btn gh grow" data-a="pedit" data-id="${p.id}">${ic('edit',18)} Edit</button><button class="ib" data-a="plearn" data-id="${p.id}" aria-label="Learn signature">${ic('finger')}</button><button class="ib bad" data-a="pdel" data-id="${p.id}" aria-label="Delete plan">${ic('trash')}</button></div></div>`).join('')}`}
function more(){const m=S.more;if(m)return{quick,sub,tokens,settings}[m]();
return `<h1 class="h2">More</h1>${[['quick','dial','Quick Dial'],['sub','card','Portal Subscription'],['tokens','coin','Tokens'],['settings','gear','Settings']].map(([k,i,l])=>`<button class="card mrow" data-a="go" data-p="more" data-m="${k}">${ic(i)}<b class="grow">${l}</b>${ic('chev')}</button>`).join('')}<button class="card mrow" data-a="out">${ic('out')}<b class="grow">Sign out</b></button>`}
function quick(){const d=dev(),of=(d.offers||[]).filter(o=>o.on),cats=[...new Set(of.map(o=>o.cat||'Other'))],c=cats.includes(S.qc)?S.qc:'All',list=of.filter(o=>c==='All'||(o.cat||'Other')===c),qd=DB.tx.filter(t=>t.dev===d.id&&t.qd).slice(0,4);
return `${bk('Quick Dial')}<small class="mu">${esc(d.name)}${d.online?'':' (offline)'}</small>
<div class="chips">${['All',...cats].map(k=>`<button class="chip${c===k?' on':''}" data-a="qc" data-cat="${esc(k)}">${esc(k)}</button>`).join('')}</div>
<div class="og">${list.map(o=>`<button class="card of" data-a="qpick" data-id="${esc(o.id)}"><b>${esc(o.name)}</b><small>KES ${o.price}</small></button>`).join('')||'<p class="mu c" style="grid-column:1/-1">No offers yet. Open AutoBingwa on the phone with AutoBingwa Portal on, so it can send its offers.</p>'}</div>
<div class="sec"><h2>Recent quick dials</h2></div>${qd.map(t=>`<button class="card tr" data-a="otx" data-id="${t.id}"><span class="grow"><b>${esc(t.offer)}</b><small>${esc(t.phone)}</small></span><span class="rt"><b class="${TONE[t.st]||''}">${t.st}</b><small>${ago(t.m)}</small></span></button>`).join('')||'<p class="mu c">None yet.</p>'}`}
function sub(){const n=DB.devices.length,m=DB.plan.max,act=DB.plan.active!==false&&!DB.locked,lock=!!DB.locked;
const head=lock?'<h1 class="h2">Portal Subscription</h1>':bk('Portal Subscription');
return `${head}${act?'':'<div class="card warn"><b>Subscribe to use the portal</b><p class="mu">Choose a plan below and pay with M-Pesa. Once the payment goes through, you can connect your phones and see their live activity.</p></div>'}<div class="card"><div class="flex"><b class="grow">${act?n+(m>=1000?'':' of '+m)+' devices paired':'No active subscription'}</b><small>${act&&DB.plan.exp?'Expires '+esc(DB.plan.exp):''}</small></div>${act?`<div class="bar"><i style="width:${Math.min(100,m?n/m*100:0)}%"></i></div>`:''}</div>
${SUBS.map(s=>{const c=act&&s.id===DB.plan.id;return `<div class="card sp${s.pop?' pop':''}">${s.pop?'<span class="tag">Most popular</span>':''}<h3>${s.n}</h3><div class="price">KES ${s.p}<small> / 31 days</small></div><ul>${s.f.map(f=>`<li>${f}</li>`).join('')}</ul><button class="btn${c?' gh':''} full" data-a="subbuy" data-id="${s.id}">${c?'Extend 31 days':'Choose '+s.n}</button></div>`}).join('')}${lock?`<button class="btn gh full" style="margin-top:6px" data-a="out">${ic('out',18)} Sign out</button>`:''}`}
function tokens(){return `${bk('Tokens')}<p class="mu">Balances come from the phone. Buying sends an airtime purchase to that device.</p>${DB.devices.map(d=>`<div class="card"><div class="flex"><i class="dot${d.online?' on':''}"></i><b class="grow">${esc(d.name)}</b></div><div class="flex" style="margin:0"><span class="big grow">${d.tok}<small> tokens</small></span><button class="btn" data-a="tbuy" data-id="${d.id}">${ic('coin',18)} Buy</button></div>${d.until?`<span class="pill" style="margin-top:10px">Unlimited until ${d.until}</span>`:''}</div>`).join('')}`}
function settings(){return `${bk('Settings')}<div class="card"><b>Appearance</b><div class="seg">${['light','dark','system'].map(t=>`<button class="${S.theme===t?'on':''}" data-a="theme" data-t="${t}" aria-pressed="${S.theme===t}">${t[0].toUpperCase()+t.slice(1)}</button>`).join('')}</div></div>
<div class="card"><b>Change password</b><label>Current password<input id="pw0" class="in" type="password" autocomplete="current-password"></label><label>New password<input id="pw1" class="in" type="password" autocomplete="new-password"></label><label>Confirm new password<input id="pw2" class="in" type="password" autocomplete="new-password"></label><p id="pwe" class="err" role="alert"></p><button class="btn full" data-a="pw">Update password</button></div>`}
function render(){
/* No active subscription: the subscription page is the only page, and the menu is hidden */
if(DB.locked){S.page='more';S.more='sub'}
else if(S.page==='home'&&!DB.devices.length){S.page='devices';S.more=null}
$('#nav').style.display=DB.locked?'none':'';
const pg=({home,devices,tx:txPage,plans,more})[S.page];if(pg)$('#app').innerHTML=pg();document.querySelectorAll('#nav button').forEach(b=>b.classList.toggle('on',b.dataset.p===S.page))}
const pform=p=>modal(`<h3>${p?'Edit plan':'Add plan'}</h3><label>Plan name<input id="pn" class="in" value="${esc(p&&p.name)}"></label><label>Category<select id="pc" class="in">${CATS.map(c=>`<option${p&&p.cat===c?' selected':''}>${c}</option>`).join('')}</select></label><label>USSD code (use AB for the customer's number)<input id="pu" class="in" value="${esc(p?p.ussd:'*180*5*2*AB*1*1#')}"></label><label>Selling price (KES)<input id="pp" class="in" type="number" inputmode="decimal" value="${p?p.price:''}"></label><p id="pe" class="err" role="alert"></p><div class="flex"><button class="btn gh grow" data-a="close">Cancel</button><button class="btn grow" data-a="psave" data-id="${p?p.id:''}">Save plan</button></div>`);
/* ===== Actions ===== */
const pl=id=>DB.plans.find(p=>p.id===id),dv=id=>DB.devices.find(d=>d.id===id);
const A={
close(){payRun++;$('#modal').innerHTML='';if(R){R(false);R=null}},
no(){A.close()},yes(){$('#modal').innerHTML='';if(R){R(true);R=null}},
go(d){S.page=d.p;S.more=d.m||null;S.tx=null;scrollTo(0,0);if(d.p==='tx')reload();else render()},
dev(d){S.dev=d.id;S.page='home';S.more=null;S.tx=null;render();scrollTo(0,0)},
eye(){S.hide=!S.hide;render()},
async air(){const d=dev();if(!d.online)return toast(d.name+' is offline');toast('Checking airtime on the phone...');await call('POST','/portal/devices/'+d.id+'/airtime-check');toast('Airtime check sent. The balance updates when the phone replies.')},
async run(d){const x=dv(d.id);if(!x.online)return toast(x.name+' is offline');await call('POST','/portal/devices/'+x.id+(x.running?'/stop':'/start'));x.running=!x.running;render();toast(x.running?'Automation started':'Automation stopped')},
adddev(){modal('<h3>Connect a phone</h3><p class="mu">In the AutoBingwa app, switch on AutoBingwa Portal and copy the Connect ID.</p>'+connectForm()+'<button class="btn gh full" style="margin-top:10px" data-a="close">Cancel</button>')},
async cdo(){const id=$('#cid').value.trim().toUpperCase(),nm=$('#cnm').value.trim(),e=$('#cerr');
if(!id)return e.textContent='Enter the Connect ID from the app';if(!nm)return e.textContent='Give this phone a name';
e.textContent='';try{const r=await call('POST','/portal/devices/connect',{connectId:id,name:nm});await refresh();S.dev=r.id;S.page='home';A.close();render();toast('Connected: '+nm)}catch(x){e.textContent=x.message}},
f(d){S.f=d.f;render()},
otx(d){S.tx=d.id;S.page='tx';render();scrollTo(0,0)},
tback(){S.tx=null;reload()},
async copy(d){try{await navigator.clipboard.writeText(cur()[d.k]);toast('Copied')}catch(e){toast('Could not copy. Select the text and copy it by hand.')}},
async retry(){const t=cur();await call('POST','/portal/tx/'+t.id+'/retry');t.st='Pending';render();toast('Retry sent to the phone')},
resched(){modal(`<h3>Reschedule</h3><label>New date and time<input id="rs" class="in" type="datetime-local"></label><p id="re" class="err" role="alert"></p><div class="flex"><button class="btn gh grow" data-a="close">Cancel</button><button class="btn grow" data-a="rsok">Schedule</button></div>`)},
async rsok(){const v=$('#rs').value;if(!v||new Date(v)<=new Date())return $('#re').textContent='Choose a time in the future';const t=cur();await call('POST','/portal/tx/'+t.id+'/reschedule',{at:new Date(v).toISOString()});t.st='Scheduled';A.close();render();toast('Transaction rescheduled')},
async del(){if(!await ask('Delete transaction?','This transaction will be removed for good.','Delete',1))return;await call('DELETE','/portal/tx/'+S.tx);DB.tx=DB.tx.filter(x=>x.id!==S.tx);S.tx=null;render();toast('Transaction deleted')},
padd(){pform(null)},pedit(d){pform(pl(d.id))},
async psave(d){const n=$('#pn').value.trim(),u=$('#pu').value.trim(),pr=Number($('#pp').value),e=$('#pe');
if(!n)return e.textContent='Enter the plan name';if(!/AB/i.test(u))return e.textContent='The USSD code must contain AB where the phone number goes';if(!(pr>0))return e.textContent='Enter the selling price';
const p=d.id?pl(d.id):null;await call(p?'PUT':'POST','/portal/plans'+(p?'/'+p.id:''),{n,u,pr});
if(p){if(p.ussd!==u)p.signed=false;Object.assign(p,{name:n,cat:$('#pc').value,ussd:u,price:pr})}else DB.plans.push({id:'p'+Date.now(),name:n,cat:$('#pc').value,ussd:u,price:pr,signed:false,on:true});
A.close();render();toast('Plan saved')},
ptog(d){const p=pl(d.id);p.on=!p.on;render()},
async pdel(d){const p=pl(d.id);if(!await ask('Delete plan?',esc(p.name)+' will be removed for good.','Delete',1))return;await call('DELETE','/portal/plans/'+p.id);DB.plans=DB.plans.filter(x=>x.id!==p.id);render();toast('Plan deleted')},
async plearn(d){const p=pl(d.id),x=dev();if(!x.online)return toast(x.name+' is offline. Learning needs the phone online.');toast('Learning "'+p.name+'" on '+x.name+'. Keep the phone unlocked.');await call('POST','/portal/plans/'+p.id+'/learn');if(USE_MOCK)await sleep(1500);p.signed=true;render();toast('Signature saved for '+p.name)},
/* ---- Transactions page ---- */
trange(d){S.range=d.r;return reload()},
async tsearch(){S.sopen=!S.sopen;if(!S.sopen&&S.q){S.q='';await loadTx()}render();if(S.sopen)$('#tq').focus()},
/* ---- Quick Dial ---- */
qc(d){S.qc=d.cat;render()},
qpick(d){const o=(dev().offers||[]).find(x=>x.id===d.id);if(!o)return;S.qo=o.id;
modal(`<h3>${esc(o.name)}, KES ${o.price}</h3><label>Customer phone number<input id="qp" class="in" type="tel" inputmode="tel" placeholder="0712345678"></label><p id="qe" class="err" role="alert"></p><div class="flex"><button class="btn gh grow" data-a="close">Cancel</button><button class="btn grow" data-a="qgo">${ic('dial',18)} Dial</button></div>`);$('#qp').focus()},
async qgo(){const ph=phoneOk($('#qp').value),x=dev(),o=(x.offers||[]).find(z=>z.id===S.qo);if(!ph)return $('#qe').textContent='Enter a valid phone number, for example 0712345678';
const r=await call('POST','/portal/quickdial',{device:x.id,offerId:o.id,phone:ph}).catch(e=>{$('#qe').textContent=e.message});if(!r)return;
DB.tx.unshift({id:r.txId,dev:x.id,name:'Quick Dial',phone:ph,amt:o.price,offer:o.name,st:'Pending',m:0,ts:new Date().toISOString(),msg:'Started from the portal Quick Dial',ussd:r.ussd,resp:'',qd:true});
A.close();render();toast('Sent to '+x.name+'. The status updates below.')},
/* ---- Portal subscription: pay with M-Pesa ---- */
subbuy(d){const s=SUBS.find(x=>x.id===d.id);if(!s)return;
modal(`<h3>${s.n}, KES ${s.p}</h3><p class="mu">Enter the M-Pesa number to pay with. You will get a payment prompt on your phone.</p><label>M-Pesa number<input id="sp" class="in" type="tel" inputmode="tel" placeholder="0712345678" value="${esc(phoneOk(DB.cid))}"></label><p id="se" class="err" role="alert"></p><div class="flex"><button class="btn gh grow" data-a="close">Cancel</button><button class="btn grow" data-a="subpay" data-id="${s.id}">Pay KES ${s.p}</button></div>`)},
async subpay(d){const s=SUBS.find(x=>x.id===d.id),ph=phoneOk($('#sp').value),e=$('#se');
if(!ph)return e.textContent='Enter a valid phone number, for example 0712345678';
e.textContent='';const me=++payRun;
modal(`<h3>${s.n}, KES ${s.p}</h3><p class="mu" id="pst">Sending the M-Pesa prompt to ${esc(ph)}...</p><button class="btn gh full" data-a="close">Close</button>`);
const say=t=>{const el=$('#pst');if(el&&me===payRun)el.textContent=t};
try{
const r=await call('POST','/portal/subscribe/start',{planId:s.id,phone:ph});
say('Check your phone and enter your M-Pesa PIN to pay KES '+s.p+'.');
for(let i=0;i<45;i++){await sleep(3000);if(me!==payRun)return;
const x=await call('GET','/portal/subscribe/status/'+r.paymentId);
if(me!==payRun)return;
if(x.status==='paid'){say('Payment received. Opening your portal...');await refresh();await sleep(900);if(me!==payRun)return;
A.close();S.page='home';S.more=null;S.tx=null;render();scrollTo(0,0);toast('Subscription active. Now connect your phone.');return}
if(x.status==='failed'||x.status==='cancelled')throw new Error(x.status==='cancelled'?'The payment was cancelled.':(x.message||'The payment failed.'))}
throw new Error('Still waiting for the payment. If money left your M-Pesa, reopen the portal in a minute.')
}catch(err){if(me!==payRun)return;
modal(`<h3>${s.n}, KES ${s.p}</h3><p class="err">${esc(err.message)}</p><div class="flex"><button class="btn gh grow" data-a="close">Close</button><button class="btn grow" data-a="subbuy" data-id="${s.id}">Try again</button></div>`)}},
/* ---- Tokens: choose M-Pesa or airtime ---- */
tbuy(d){S.td=d.id;modal(`<h3>Buy tokens for ${esc(dv(d.id).name)}</h3>${PACKS.map((p,i)=>`<button class="pk" data-a="tpick" data-i="${i}"><b>${p[0]}</b><span>KES ${p[1]}</span></button>`).join('')}<button class="btn gh full" style="margin-top:14px" data-a="close">Close</button>`)},
tpick(d){const p=PACKS[d.i];S.tp=p;modal(`<h3>${p[0]}, KES ${p[1]}</h3><p class="mu">How do you want to pay?</p><button class="btn full" data-a="tmp">${ic('card',18)} Pay with M-Pesa</button><button class="btn gh full" style="margin-top:8px" data-a="tair">${ic('phone',18)} Pay with airtime from the phone</button><button class="btn gh full" style="margin-top:8px" data-a="close">Cancel</button>`)},
tmp(){const p=S.tp;modal(`<h3>${p[0]}, KES ${p[1]}</h3><p class="mu">Enter the M-Pesa number. You will get a payment prompt.</p><label>M-Pesa number<input id="tph" class="in" type="tel" inputmode="tel" placeholder="0712345678" value="${esc(phoneOk(DB.cid))}"></label><p id="te" class="err" role="alert"></p><div class="flex"><button class="btn gh grow" data-a="close">Cancel</button><button class="btn grow" data-a="tmgo">Pay KES ${p[1]}</button></div>`)},
async tmgo(){const p=S.tp,x=dv(S.td),ph=phoneOk($('#tph').value);if(!ph)return $('#te').textContent='Enter a valid phone number, for example 0712345678';
const me=++payRun,say=t=>{const el=$('#pst');if(el&&me===payRun)el.textContent=t},head=`<h3>${p[0]}, KES ${p[1]}</h3>`;
modal(`${head}<p class="mu" id="pst">Sending the M-Pesa prompt to ${esc(ph)}...</p><button class="btn gh full" data-a="close">Close</button>`);
try{const r=await call('POST','/portal/tokens/buy',{device:x.id,packId:p[2],method:'mpesa',phone:ph});say('Check your phone and enter your M-Pesa PIN to pay KES '+p[1]+'.');
let cid=null;for(let i=0;i<45&&!cid;i++){await sleep(3000);if(me!==payRun)return;const s=await call('GET','/portal/tokens/mpesa/status/'+r.paymentId);if(me!==payRun)return;
if(s.status==='paid'&&s.commandId)cid=s.commandId;else if(s.status==='failed'||s.status==='cancelled')throw new Error(s.status==='cancelled'?'The payment was cancelled.':(s.message||'The payment failed.'))}
if(!cid)throw new Error('Still waiting for the payment. If money left your M-Pesa, the tokens are added once the phone is online.');
say('Payment received. Adding the tokens on the phone...');if(!await waitCmd(cid,me,say,'Payment received. The tokens will be added as soon as the phone is online.'))return;
await refresh();modal(`${head}<p>Done. The tokens were added on ${esc(x.name)}.</p><button class="btn full" data-a="close">Close</button>`);render()
}catch(err){if(me!==payRun)return;modal(`${head}<p class="err">${esc(err.message)}</p><button class="btn gh full" data-a="close">Close</button>`)}},
async tair(){const p=S.tp,x=dv(S.td),me=++payRun,say=t=>{const el=$('#pst');if(el&&me===payRun)el.textContent=t},head=`<h3>${p[0]}, KES ${p[1]}</h3>`;
modal(`${head}<p class="mu" id="pst">Sending the request to ${esc(x.name)}...</p><button class="btn gh full" data-a="close">Close</button>`);
try{const r=await call('POST','/portal/tokens/buy',{device:x.id,packId:p[2],method:'airtime'});say('The phone is transferring KES '+p[1]+' airtime...');
if(!await waitCmd(r.commandId,me,say,'The phone has not answered yet. Check the app and try again.'))return;
await refresh();modal(`${head}<p>Done. Airtime was sent and the tokens were added on ${esc(x.name)}.</p><button class="btn full" data-a="close">Close</button>`);render()
}catch(err){if(me!==payRun)return;modal(`${head}<p class="err">${esc(err.message)}</p><button class="btn gh full" data-a="close">Close</button>`)}},
theme(d){applyTheme(d.t);render()},
async pw(){const a=$('#pw0').value,b=$('#pw1').value,c=$('#pw2').value,e=$('#pwe');if(!a)return e.textContent='Enter your current password';if(b.length<8)return e.textContent='The new password must be at least 8 characters';if(b!==c)return e.textContent='The new passwords do not match';
await window.portalChangePin(a,b);render();toast('Password updated')},
out(){window.portalSignOut()}};
/* Wait for the phone to finish a command (quick dial, token purchase) */
async function waitCmd(id,me,say,timeout){for(let i=0;i<60;i++){await sleep(2000);if(me!==payRun)return null;const x=await call('GET','/portal/commands/'+id);if(me!==payRun)return null;
if(x.status==='completed')return x;if(x.status==='failed')throw new Error(x.message||'The phone could not complete it.');if(x.status==='running')say('The phone is working on it...')}
throw new Error(timeout)}
let qt;document.addEventListener('input',e=>{if(e.target.id!=='tq')return;clearTimeout(qt);qt=setTimeout(async()=>{S.q=e.target.value.trim();try{await loadTx()}catch(x){toast(x.message)}const el=$('#txl');if(el)el.innerHTML=txList()},300)});
document.addEventListener('change',e=>{if(e.target.dataset.c==='tdev'){S.tdev=e.target.value;reload()}});
document.addEventListener('click',e=>{const t=e.target.closest('[data-a]');if(!t)return;if(t.classList.contains('mb')&&e.target!==t)return;const f=A[t.dataset.a];if(f)Promise.resolve(f(t.dataset)).catch(err=>toast(err.message||'Something went wrong'))});
/* ===== Live data ===== */
async function refresh(){const o=await call('GET','/portal/overview');
/* When locked, the server sends the subscription plans in "plans"; never let them replace the data plans */
if(o.locked)delete o.plans;
DB.locked=false;Object.assign(DB,o);if(!DB.devices.find(d=>d.id===S.dev))S.dev=(DB.devices[0]||{}).id||''}
async function poll(){if(document.hidden)return;const b=JSON.stringify([DB.devices,DB.tx,DB.plan,DB.locked]);
try{await refresh()}catch(e){return}
const f=document.activeElement,typing=f&&/^(INPUT|SELECT|TEXTAREA)$/.test(f.tagName);
if($('#modal').innerHTML||typing||(S.page==='more'&&S.more==='settings')||($('#cid')&&($('#cid').value||$('#cnm').value)))return;
if(S.page==='tx'&&!S.tx){const k=(S.txl||[]).map(x=>x.id+x.st).join();try{await loadTx()}catch(e){return}if((S.txl||[]).map(x=>x.id+x.st).join()!==k)render();return}
if(JSON.stringify([DB.devices,DB.tx,DB.plan,DB.locked])===b)return;render()}
/* ===== Start ===== */
$('#nav').innerHTML=[['home','home','Home'],['devices','phone','Devices'],['tx','list','Transactions'],['plans','db','Data plans'],['more','more','More']].map(([p,i,l])=>`<button data-a="go" data-p="${p}">${ic(i)}<span>${l}</span></button>`).join('');
applyTheme(S.theme);
(async()=>{$('#app').innerHTML='<p class="mu c">Loading your portal...</p>';
if(!USE_MOCK){try{await refresh()}catch(e){DB.devices=[];DB.tx=[];DB.plans=[];toast('Could not load: '+e.message)}}
render();if(!USE_MOCK)setInterval(poll,5000)})();