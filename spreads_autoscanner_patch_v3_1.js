
/* spreads_autoscanner_patch_v3_1.js
   Auto proxy for Vercel, cleaned 2% logic, async 1% scanner.
*/
(function(){
  const CG_BASE='https://api.coingecko.com';
  const API_PROXY='/api/gecko';
  const MIN_SPREAD=1;
  const TOP_LIMIT=40;
  const CONCURRENCY=3;
  const BATCH_DELAY_MS=700;
  const AUTO_REFRESH_MS=60000;
  const isLocal=location.hostname.includes('localhost')||location.hostname.startsWith('127.')||location.protocol==='file:';
  const CG=isLocal?CG_BASE:API_PROXY;

  const yieldUI=()=>new Promise(r=>requestAnimationFrame(()=>setTimeout(r,0)));
  function fmtNum(v,d=2){if(v==null||!isFinite(v))return'—';return Number(v).toLocaleString(undefined,{maximumFractionDigits:d});}
  function colorFor(p){if(!isFinite(p))return'#d6d3d1';if(p>5)return'#ff4757';if(p>=3)return'#ff9f43';return'#f1c40f';}

  // Template is now in HTML, no need to create it dynamically

  async function fetchTopIds(limit=TOP_LIMIT){
    try{const url=`${CG}/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=${limit}&page=1&sparkline=false`;const r=await fetch(url,{cache:'no-store'});if(!r.ok)throw new Error('markets '+r.status);const j=await r.json();return j.map(x=>({id:x.id,symbol:(x.symbol||'').toUpperCase()}));}catch(e){console.warn('fetchTopIds',e);return[];}
  }
  async function fetchTickersSafe(coinId){
    try{const url=`${CG}/api/v3/coins/${encodeURIComponent(coinId)}/tickers?include_exchange_logo=false`;const r=await fetch(url,{cache:'no-store'});if(!r.ok)return[];const j=await r.json();return Array.isArray(j?.tickers)?j.tickers:[];}catch(e){return[];}
  }
  function classifyMarket(m){const n=(m?.name||'').toLowerCase();const id=(m?.identifier||'').toLowerCase();const d=['swap','dex','curve','balancer','uniswap','sushiswap','pancake','raydium','jupiter','quickswap','dydx'];return d.some(h=>n.includes(h)||id.includes(h))?'DEX':'CEX';}
  function buildKey(b,q){return`${b}${q}`.toUpperCase();}

  async function scanSpreads(root,signal){
    const tb=root.querySelector('#spreadsBody');const emp=root.querySelector('#spreadsEmpty');
    if(tb)tb.innerHTML='<tr><td colspan="7">Сканирование... Пожалуйста, подождите.</td></tr>';if(emp)emp.style.display='none';await yieldUI();
    const top=await fetchTopIds(TOP_LIMIT);if(signal?.aborted)return;if(!top.length){if(tb)tb.innerHTML=`<tr><td colspan="7">Ошибка получения списка монет</td></tr>`;return;}
    const groups=new Map();
    for(let i=0;i<top.length;i+=CONCURRENCY){const batch=top.slice(i,i+CONCURRENCY);const res=await Promise.all(batch.map(c=>fetchTickersSafe(c.id).catch(()=>[])));for(const ticks of res){for(const t of ticks||[]){const q=(t?.target||'').toUpperCase();if(q!=='USDT'&&q!=='USDC')continue;const base=(t?.base||'').toUpperCase();if(!base)continue;const price=Number(t?.last??t?.converted_last?.usd);if(!isFinite(price)||price<=0)continue;const ex=t?.market?.name||'—';const type=classifyMarket(t?.market);const key=buildKey(base,q);if(!groups.has(key))groups.set(key,{base,quote:q,items:[]});groups.get(key).items.push({ex,type,price});}}await new Promise(r=>setTimeout(r,BATCH_DELAY_MS));await yieldUI();}
    const rows=[];groups.forEach(({base,quote,items})=>{if(items.length<2)return;let min={price:Infinity},max={price:-Infinity};for(const it of items){if(it.price<min.price)min=it;if(it.price>max.price)max=it;}if(!isFinite(min.price)||!isFinite(max.price)||min.price<=0)return;const pct=((max.price-min.price)/min.price)*100;if(pct<MIN_SPREAD)return;rows.push({pair:`${base}${quote}`,exMax:`${max.ex} ${max.type==='DEX'?'dex':'linear'}`,price:max.price,pct});});rows.sort((a,b)=>b.pct-a.pct);
    if(tb){tb.innerHTML='';if(rows.length===0){if(emp)emp.style.display='block';}else{for(const r of rows){const tr=document.createElement('tr');const c=colorFor(r.pct);tr.innerHTML=`<td>${r.pair}</td><td>${r.exMax}</td><td>${fmtNum(r.price,4)}</td><td style="color:${c}">${r.pct.toFixed(2)}%</td><td>—</td><td>—</td><td><button>🗑️</button></td>`;tr.querySelector('button').addEventListener('click',()=>{tr.remove();if(!tb.querySelector('tr')){if(emp)emp.style.display='block';}});tb.appendChild(tr);await yieldUI();}}}
    const upd=root.querySelector('#spreadsUpdated');if(upd)upd.textContent=new Date().toLocaleTimeString();
  }

  function makeCtrl(root){let ac=null,t=null;function start(){stop();ac=new AbortController();setTimeout(()=>{if(!ac.signal.aborted)scanSpreads(root,ac.signal);},300);t=setInterval(()=>{if(ac)ac.abort();ac=new AbortController();scanSpreads(root,ac.signal);},AUTO_REFRESH_MS);}function stop(){if(t){clearInterval(t);t=null;}if(ac){ac.abort();ac=null;}}return{start,stop};}
  function observe(){const o=new MutationObserver(()=>{document.querySelectorAll('#modalSpreadsPro').forEach(r=>{if(r.dataset.ready)return;r.dataset.ready=1;const c=makeCtrl(r);const b=r.querySelector('#spreadsRefresh');if(b)b.addEventListener('click',()=>{c.stop();const a=new AbortController();scanSpreads(r,a.signal);});setTimeout(()=>{c.start();},300);});});o.observe(document.documentElement,{childList:true,subtree:true});}
  document.addEventListener('DOMContentLoaded',()=>{observe();});
})();
