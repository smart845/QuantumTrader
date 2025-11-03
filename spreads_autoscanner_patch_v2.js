
/* spreads_autoscanner_patch_v2.js
   Optimized for Vercel: limited concurrency, batching, yields, auto-refresh every 60s.
   Keeps same UI style as v1.
*/
(function(){
  const CG = 'https://api.coingecko.com/api/v3';
  const MIN_SPREAD = 1;
  const TOP_LIMIT = 40;
  const CONCURRENCY = 3;
  const BATCH_DELAY_MS = 700;
  const AUTO_REFRESH_MS = 60000;

  function fmtNum(v,d=2){ if(v==null||!isFinite(v)) return '—'; return Number(v).toLocaleString(undefined,{maximumFractionDigits:d}); }
  function colorFor(p){ if(!isFinite(p)) return '#d6d3d1'; if(p>5) return '#ff4757'; if(p>=3) return '#ff9f43'; return '#f1c40f'; }

  function ensureTemplate(){
    let tpl = document.getElementById('modalSpreadsPro');
    if(!tpl){ tpl = document.createElement('div'); tpl.id='modalSpreadsPro'; tpl.style.display='none'; document.body.appendChild(tpl); }
    tpl.innerHTML = `
      <div class="top-controls">
        <div class="top-seg" id="spreadsSeg">
          <button class="active" data-ex="auto">⚙️ Авто</button>
          <button id="spreadsRefresh" title="Обновить">🔄</button>
        </div>
        <span class="mini">Обновлено: <span id="spreadsUpdated">—</span></span>
      </div>
      <div class="mini" style="margin:6px 0 10px;color:#A0ACB9">
        Источник: CoinGecko (CEX + DEX). Пары: USDT / USDC. Порог: ≥ ${MIN_SPREAD}%.
      </div>
      <table class="top-table" id="spreadsTable">
        <thead><tr><th>Пара</th><th>Биржа (макс)</th><th>Цена</th><th>Спред %</th><th>Фандинг</th><th>Сделки</th><th>🗑️</th></tr></thead>
        <tbody id="spreadsBody"><tr><td colspan="7">Готов к сканированию...</td></tr></tbody>
      </table>
      <div class="mini" id="spreadsEmpty" style="display:none; padding:8px 0;">Нет активных спредов ≥ ${MIN_SPREAD} % (по всем биржам и DEX)</div>
    `;
  }

  async function fetchTopIds(limit=TOP_LIMIT){
    try{
      const url = `${CG}/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=${limit}&page=1&sparkline=false`;
      const r = await fetch(url);
      if(!r.ok) throw new Error('markets '+r.status);
      const j = await r.json();
      return j.map(x=>({id:x.id,symbol:(x.symbol||'').toUpperCase()}));
    }catch(e){
      console.warn('fetchTopIds err', e);
      return [];
    }
  }

  async function fetchTickersSafe(coinId){
    try{
      const url = `${CG}/coins/${encodeURIComponent(coinId)}/tickers?include_exchange_logo=false`;
      const r = await fetch(url);
      if(!r.ok) return [];
      const j = await r.json();
      return Array.isArray(j?.tickers)?j.tickers:[];
    }catch(e){
      return [];
    }
  }

  function classifyMarket(market){
    const name = (market?.name||'').toLowerCase(); const id = (market?.identifier||'').toLowerCase();
    const dexHints = ['swap','dex','curve','balancer','uniswap','sushiswap','pancake','raydium','jupiter','quickswap','dydx'];
    return dexHints.some(h=>name.includes(h)||id.includes(h)) ? 'DEX' : 'CEX';
  }

  function buildKey(base,quote){ return `${base}${quote}`.toUpperCase(); }
  function tinyPause(){ return new Promise(res=>setTimeout(res,0)); }

  async function scanSpreads(signal){
    const tbody = document.getElementById('spreadsBody');
    const empty = document.getElementById('spreadsEmpty');
    if(tbody) tbody.innerHTML = '<tr><td colspan="7">Сканирование... Пожалуйста, подождите.</td></tr>';
    if(empty) empty.style.display='none';

    const top = await fetchTopIds(TOP_LIMIT);
    if(!top.length){ if(tbody) tbody.innerHTML = `<tr><td colspan="7">Ошибка получения списка монет</td></tr>`; return; }

    const groups = new Map();
    for(let i=0;i<top.length;i+=CONCURRENCY){
      const batch = top.slice(i, i+CONCURRENCY);
      const promises = batch.map(c=>fetchTickersSafe(c.id));
      const settled = await Promise.all(promises.map(p=>p.catch(e=>[])));
      for(const ticks of settled){
        for(const t of ticks || []){
          const q = (t?.target||'').toUpperCase();
          if(q!=='USDT' && q!=='USDC') continue;
          const base = (t?.base||'').toUpperCase();
          if(!base) continue;
          const price = Number(t?.last ?? t?.converted_last?.usd);
          if(!isFinite(price) || price<=0) continue;
          const marketName = t?.market?.name || '—';
          const exType = classifyMarket(t?.market);
          const key = buildKey(base,q);
          if(!groups.has(key)) groups.set(key,{base,quote:q,items:[]});
          groups.get(key).items.push({ex:marketName,type:exType,price,raw:t});
        }
      }
      await new Promise(r=>setTimeout(r,BATCH_DELAY_MS));
      await tinyPause();
      if(signal?.aborted) return;
    }

    const rows = [];
    groups.forEach(({base,quote,items})=>{
      if(!items||items.length<2) return;
      let min={price:Infinity}, max={price:-Infinity};
      for(const it of items){ if(it.price<min.price) min=it; if(it.price>max.price) max=it; }
      if(!isFinite(min.price)||!isFinite(max.price)||min.price<=0) return;
      const spreadPct = ((max.price - min.price)/min.price)*100;
      if(spreadPct < MIN_SPREAD) return;
      rows.push({pair:`${base}${quote}`, exMax:`${max.ex} ${max.type==='DEX'?'dex':'linear'}`, price:max.price, pct:spreadPct});
    });

    rows.sort((a,b)=>b.pct-a.pct);

    if(tbody){
      tbody.innerHTML = '';
      if(rows.length===0){
        if(empty) empty.style.display='block';
        else tbody.innerHTML = `<tr><td colspan="7">Нет активных спредов ≥ ${MIN_SPREAD} %</td></tr>`;
      } else {
        for(const r of rows){
          const tr = document.createElement('tr');
          const color = colorFor(r.pct);
          tr.innerHTML = `
            <td class="mono" style="font-weight:700">${r.pair}</td>
            <td>${r.exMax}</td>
            <td class="mono">${fmtNum(r.price, r.price<1?6:4)}</td>
            <td class="mono" style="font-weight:800;color:${color}">${r.pct>0?'+':''}${r.pct.toFixed(2)}%</td>
            <td class="mono">—</td>
            <td class="mono">—</td>
            <td><button class="emoji-btn" title="Удалить">🗑️</button></td>
          `;
          tr.querySelector('button')?.addEventListener('click',(e)=>{ e.stopPropagation(); tr.remove(); if(!tbody.querySelector('tr')){ if(empty) empty.style.display='block'; } });
          tbody.appendChild(tr);
          await tinyPause();
        }
      }
    }

    const upd = document.getElementById('spreadsUpdated');
    if(upd) upd.textContent = new Date().toLocaleTimeString();
  }

  function controllerFactory(){
    let abortController = null;
    let timer = null;
    function startAuto(){
      stopAuto();
      abortController = new AbortController();
      scanSpreads(abortController.signal).catch(e=>console.warn('scan error', e));
      timer = setInterval(()=>{
        if(abortController) abortController.abort();
        abortController = new AbortController();
        scanSpreads(abortController.signal).catch(e=>console.warn('scan error', e));
      }, AUTO_REFRESH_MS);
    }
    function stopAuto(){ if(timer){ clearInterval(timer); timer=null; } if(abortController){ abortController.abort(); abortController=null; } }
    return { startAuto, stopAuto };
  }

  function hookOpenAndButtons(){
    const target = document.getElementById('modalContent');
    if(!target) return;
    const ctrl = controllerFactory();
    const observer = new MutationObserver(()=>{
      const root = target.querySelector('#modalSpreadsPro');
      if(root){
        const btn = root.querySelector('#spreadsRefresh');
        if(btn && !btn.dataset._wired){ btn.addEventListener('click', ()=>{ ctrl.stopAuto(); const ac=new AbortController(); scanSpreads(ac.signal); }); btn.dataset._wired='1'; }
        ctrl.startAuto();
      } else {
        ctrl.stopAuto();
      }
    });
    observer.observe(target, { childList:true, subtree:true });
  }

  document.addEventListener('DOMContentLoaded', ()=>{ ensureTemplate(); hookOpenAndButtons(); });
})();
