/* ===== Data layer =====
   USE_MOCK=true runs on sample data. To connect the real server later: set USE_MOCK=false and API_URL.
   The business is read from the link: yoursite.com/?b=AB-1042  (later we can make it yoursite.com/AB-1042)
   Server routes (no login, customers are public):
   GET  /site/:cid            -> { biz, offers:[{id,name,cat,price}] }   (only plans the owner switched ON)
   POST /site/:cid/purchase   {offerId, receive, pay}  -> starts the M-Pesa prompt on the "pay" number */
const USE_MOCK=false,API_URL='https://smoukalewmuorpowfiqr.supabase.co/functions/v1';
const DEFAULT_SITE='jabali'; // the business shown at the root address
const seg=location.pathname.split('/').filter(Boolean)[0]||'';
const CID=((/\./.test(seg)?'':seg)||new URLSearchParams(location.search).get('b')||DEFAULT_SITE).toLowerCase();
const MOCK={biz:'Jabali Bingwa Deals',offers:[
{id:'1',name:'750MBs+50SMS, 24Hrs',cat:'Data',price:50},
{id:'2',name:'400MBs, 7Days',cat:'Data',price:49},
{id:'3',name:'1GB 1Hr, Bingwa',cat:'Data',price:19},
{id:'4',name:'250MBs, 24Hrs',cat:'Data',price:20},
{id:'5',name:'45 Mins, 3Hrs',cat:'Minutes',price:22},
{id:'6',name:'20 SMS, 1 Day',cat:'SMS',price:5},
{id:'7',name:'400MBs Tunukiwa',cat:'Tunukiwa',price:26},
{id:'8',name:'900MB Midnight',cat:'Pata More',price:57}]};
const CATS=['Data','Minutes','SMS','Tunukiwa','Pata More'];
const $=s=>document.querySelector(s),sleep=ms=>new Promise(r=>setTimeout(r,ms));
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function api(m,p,b){if(USE_MOCK){await sleep(500);return m==='GET'?MOCK:{ok:true}}
const r=await fetch(API_URL+p,{method:m,headers:{'Content-Type':'application/json'},body:b?JSON.stringify(b):undefined});
if(!r.ok)throw new Error(r.status===404?'This link is not active.':'Something went wrong. Please try again.');return r.json()}
/* ===== Logo (uses logo.png, falls back to a drawn icon) ===== */
const FALLBACK=s=>`<svg class="lg" width="${s}" height="${s}" viewBox="0 0 48 48" aria-hidden="true"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#00208C"/><stop offset="1" stop-color="#067A3D"/></linearGradient></defs><path d="M30 4C20 10 10 20 10 31a14 14 0 0 0 28 0c0-6-3-10-8-10" fill="none" stroke="url(#g)" stroke-width="7" stroke-linecap="round"/></svg>`;
const logo=s=>`<img class="lg" src="/logo.png" width="${s}" height="${s}" alt="" onerror="this.outerHTML=FALLBACK(${s})">`;
/* ===== State ===== */
let D=null,sel=null,mode='me';
const phoneOk=v=>{const p=String(v).replace(/[\s+-]/g,'').replace(/^254/,'0');return /^0[17]\d{8}$/.test(p)?p:''};
/* ===== Pages ===== */
function page(){
const cats=CATS.filter(c=>D.offers.some(o=>o.cat===c));
$('#top').innerHTML=`<h1 class="biz">${esc(D.biz)}</h1><nav class="chips" aria-label="Categories">${cats.map(c=>`<button class="chip" data-a="jump" data-c="${c}">${c}</button>`).join('')}</nav>`;
$('#app').innerHTML=`<h2 class="title">Bundles</h2><p class="mu c">Choose an offer and pay with M-Pesa.</p>`+
(cats.map(c=>`<section id="c-${c.replace(/\s/g,'')}"><h3 class="cat">${c}</h3>${D.offers.filter(o=>o.cat===c).map(o=>`<div class="offer"><div class="on">${logo(26)}<span>${esc(o.name)}</span></div><div class="price">Kes <b>${o.price}</b></div><button class="btn" data-a="buy" data-id="${o.id}">Purchase</button></div>`).join('')}</section>`).join('')||'<p class="mu c">No offers available right now.</p>')}
function form(){const o=sel;
$('#modal').innerHTML=`<div class="mb" data-a="bg"><div class="ms" role="dialog" aria-modal="true" aria-label="Purchase">${logo(56)}
<p class="sum"><b>${esc(o.name)}</b><br>Kes ${o.price}</p>
<label class="rad"><input type="radio" name="m" value="me" ${mode==='me'?'checked':''} data-a="mode" data-m="me">Buy for my number</label>
<label class="rad"><input type="radio" name="m" value="other" ${mode==='other'?'checked':''} data-a="mode" data-m="other">Buy for other number</label>
<label class="f" for="n1">${mode==='me'?'Number to receive offer':'Number to receive offer'}<input id="n1" class="in" type="tel" inputmode="tel" placeholder="Enter Number" autocomplete="tel"></label>
${mode==='other'?`<label class="f" for="n2">Number to make payment<input id="n2" class="in" type="tel" inputmode="tel" placeholder="Enter Number"></label>`:''}
<p id="er" class="err" role="alert"></p>
<div class="row"><button class="btn ghost" data-a="close">Cancel</button><button id="go" class="btn" data-a="pay">Purchase</button></div></div></div>`}
function done(pay){$('#modal').innerHTML=`<div class="mb"><div class="ms c" role="dialog" aria-modal="true"><div class="tick">✓</div><h3 style="margin:0 0 8px">Check your phone</h3><p class="mu">An M-Pesa prompt was sent to <b>${esc(pay)}</b>. Enter your PIN to pay Kes ${sel.price}. Your offer arrives right after payment.</p><button class="btn" data-a="close">Done</button></div></div>`}
/* ===== Actions ===== */
const A={
jump(d){const el=document.getElementById('c-'+d.c.replace(/\s/g,''));el&&el.scrollIntoView();document.querySelectorAll('.chip').forEach(b=>b.classList.toggle('on',b.dataset.c===d.c))},
buy(d){sel=D.offers.find(o=>o.id===d.id);mode='me';form();$('#n1').focus()},
mode(d){const a=$('#n1').value;mode=d.m;form();$('#n1').value=a},
close(){$('#modal').innerHTML=''},
bg(d,e){if(e.target.classList.contains('mb'))A.close()},
async pay(){const r=phoneOk($('#n1').value),p=mode==='me'?r:phoneOk($('#n2').value),er=$('#er');
if(!r)return er.textContent=mode==='me'?'Enter a valid number, for example 0712345678':'Enter a valid number to receive the offer';
if(!p)return er.textContent='Enter a valid number to make the payment';
const b=$('#go');b.disabled=true;b.textContent='Sending...';
try{await api('POST','/site/'+encodeURIComponent(CID)+'/purchase',{offerId:sel.id,receive:r,pay:p});done(p)}
catch(e){er.textContent=e.message;b.disabled=false;b.textContent='Purchase'}}};
document.addEventListener('click',e=>{const t=e.target.closest('[data-a]');if(!t||!A[t.dataset.a])return;if(t.dataset.a==='bg'&&e.target!==t)return;A[t.dataset.a](t.dataset,e)});
document.addEventListener('keydown',e=>{if(e.key==='Escape')A.close()});



/* ===== Start ===== */
(async()=>{if(!CID){$('#app').innerHTML='<p class="mu c" style="margin-top:40px">Open a business link, for example /jabali</p>';return}
$('#app').innerHTML='<p class="mu c" style="margin-top:40px">Loading offers...</p>';
try{D=await api('GET','/site/'+encodeURIComponent(CID));document.title=D.biz;page()}
catch(e){$('#app').innerHTML=`<p class="err c" style="margin-top:40px">${esc(e.message)}</p>`}})();