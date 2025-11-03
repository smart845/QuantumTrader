
/* QuantumTrader — Spreads AutoScanner v3.3 (Final PRO)
   - Auto starts scan immediately after the "Спреды" panel appears
   - 1% threshold, USDT/USDC, all CEX+DEX via CoinGecko
   - Production (Vercel): uses /api/gecko proxy to avoid CORS; Localhost: direct CoinGecko
   - Async, UI-friendly; auto-refresh every 60s; manual Refresh (🔄); delete rows (🗑️)
   - No exchange selection; "Авто" only; no "2%" remnants anywhere
*/
(function(){
  const BRAND = 'QuantumTrader';
  const CG_BASE='https://api.coingecko.com';
  const API_PROXY='/api/gecko';
  const MIN_SPREAD=1;
  const TOP_LIMIT=40;
  const CONCURRENCY=3;
  const BATCH_DELAY_MS=700;
  const AUTO_REFRESH_MS=60000;

  const isLocal = location.hostname.includes('localhost') || location.hostname.startsWith('127.') || location.protocol === 'file:';
  const CG = isLocal ? CG_BASE : API_PROXY;

  // Utility
  const yieldUI = () => new Promise(r=>requestAnimationFrame(()=>setTimeout(r,0)));
  const sleep = (ms)=>new Promise(r=>setTimeout(r,ms));
  const nowTime = ()=> new Date().toLocaleTimeString();
  function fmtNum(v,d=2){ if(v==null||!isFinite(v)) return '—'; return Number(v).toLocaleString(undefined,{maximumFractionDigits:d}); }
  function colorFor(p){ if(!isFinite(p)) return '#d6d3d1'; if(p>5)return'#ff4757'; if(p>=3)return'#ff9f43'; return'#f1c40f'; }

  // Build the spreads content inside a given root container (panel body)
  function mountTemplate(root){
    root.innerHTML = `
      <div class="top-controls" style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:6px 5px 10px;">
        <div class="top-seg" style="display:inline-flex;gap:6px;padding:4px;border-radius:12px;background:#141a22;border:1px solid #2c3646">
          <button class="active" data-ex="auto" style="background:#1c2430;border:1px solid #2c3646;color:#E9F0F6;border-radius:10px;padding:6px 10px;font-weight:800;">⚙️ Авто</button>
          <button id="spreadsRefresh" title="Обновить" style="background:#1c2430;border:1px solid #2c3646;color:#E9F0F6;border-radius:10px;padding:6px 10px;font-weight:800;">🔄</button>
        </div>
        <span class="mini" style="color:#9aa7b5;font-size:12px;">Обновлено: <span id="spreadsUpdated">—</span></span>
      </div>
      <div class="mini" style="margin:6px 0 10px;color:#9aa7b5;font-size:12px">
        Источник: CoinGecko (CEX + DEX). Пары: USDT / USDC. Порог: ≥ ${MIN_SPREAD}%.
      </div>
      <table class="top-table" style="width:100%;border-collapse:collapse;font-size:14px;">
        <thead>
          <tr style="border-bottom:1px solid rgba(255,255,255,.08)">
            <th style="padding:10px 8px;text-align:left;white-space:nowrap;">ПАРА</th>
            <th style="padding:10px 8px;text-align:left;white-space:nowrap;">БИРЖА (МАКС)</th>
            <th style="padding:10px 8px;text-align:left;white-space:nowrap;">ЦЕНА</th>
            <th style="padding:10px 8px;text-align:left;white-space:nowrap;">СПРЕД %</th>
            <th style="padding:10px 8px;text-align:left;white-space:nowrap;">ФАНДИНГ</th>
            <th style="padding:10px 8px;text-align:left;white-space:nowrap;">СДЕЛКИ</th>
            <th style="padding:10px 8px;text-align:left;white-space:nowrap;">🗑️</th>
          </tr>
        </thead>
        <tbody id="spreadsBody">
          <tr><td colspan="7" style="padding:10px 8px;">🔄 Поиск активных спредов…</td></tr>
        </tbody>
      </table>
      <div class="mini" id="spreadsEmpty" style="display:none; padding:10px 8px; color:#9aa7b5; font-size:12px;">
        Нет активных спредов ≥ ${MIN_SPREAD} % (по всем биржам и DEX)
      </div>
    `;
  }

  async function fetchTopIds(limit=TOP_LIMIT){
    try{
      const url = `${CG}/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=${limit}&page=1&sparkline=false`;
      const r = await fetch(url, { cache:'no-store' });
      if(!r.ok) throw new Error('markets '+r.status);
      const j = await r.json();
      return j.map(x => ({ id:x.id, symbol:(x.symbol||'').toUpperCase() }));
    }catch(e){
      console.warn('fetchTopIds err', e);
      return [];
    }
  }
  async function fetchTickersSafe(coinId){
    try{
      const url = `${CG}/api/v3/coins/${encodeURIComponent(coinId)}/tickers?include_exchange_logo=false`;
      const r = await fetch(url, { cache:'no-store' });
      if(!r.ok) return [];
      const j = await r.json();
      return Array.isArray(j?.tickers) ? j.tickers : [];
    }catch(e){ return []; }
  }
  function classifyMarket(m){
    const n=(m?.name||'').toLowerCase(), id=(m?.identifier||'').toLowerCase();
    const dexHints=['swap','dex','curve','balancer','uniswap','sushiswap','pancake','raydium','jupiter','quickswap','dydx'];
    return dexHints.some(h=>n.includes(h)||id.includes(h)) ? 'DEX' : 'CEX';
  }
  function buildKey(b,q){ return `${b}${q}`.toUpperCase(); }

  async function scanSpreads(root, signal){
    const tbody = root.querySelector('#spreadsBody');
    const empty = root.querySelector('#spreadsEmpty');
    if(tbody) tbody.innerHTML = '<tr><td colspan="7" style="padding:10px 8px;">🔄 Поиск активных спредов…</td></tr>';
    if(empty) empty.style.display = 'none';
    await yieldUI();

    const top = await fetchTopIds(TOP_LIMIT);
    if(signal?.aborted) return;
    if(!top.length){ if(tbody) tbody.innerHTML = `<tr><td colspan="7" style="padding:10px 8px;">Ошибка получения списка монет</td></tr>`; return; }

    const groups = new Map();
    for(let i=0;i<top.length;i+=CONCURRENCY){
      const batch = top.slice(i, i+CONCURRENCY);
      const settled = await Promise.all(batch.map(c=>fetchTickersSafe(c.id).catch(()=>[])));
      for(const ticks of settled){
        for(const t of ticks||[]){
          const q=(t?.target||'').toUpperCase(); if(q!=='USDT'&&q!=='USDC') continue;
          const base=(t?.base||'').toUpperCase(); if(!base) continue;
          const price=Number(t?.last ?? t?.converted_last?.usd); if(!isFinite(price)||price<=0) continue;
          const market=t?.market?.name||'—'; const type=classifyMarket(t?.market);
          const key=buildKey(base,q);
          if(!groups.has(key)) groups.set(key,{ base, quote:q, items:[] });
          groups.get(key).items.push({ ex:market, type, price });
        }
      }
      await sleep(BATCH_DELAY_MS);
      await yieldUI();
      if(signal?.aborted) return;
    }

    const rows=[];
    groups.forEach(({base, quote, items})=>{
      if(!items||items.length<2) return;
      let min={price:Infinity}, max={price:-Infinity};
      for(const it of items){ if(it.price<min.price) min=it; if(it.price>max.price) max=it; }
      if(!isFinite(min.price)||!isFinite(max.price)||min.price<=0) return;
      const pct=((max.price-min.price)/min.price)*100;
      if(pct<MIN_SPREAD) return;
      rows.push({ pair:`${base}${quote}`, exMax:`${max.ex} ${max.type==='DEX'?'dex':'linear'}`, price:max.price, pct });
    });
    rows.sort((a,b)=>b.pct-a.pct);

    if(tbody){
      tbody.innerHTML='';
      if(!rows.length){
        if(empty) empty.style.display='block';
      } else {
        for(const r of rows){
          const tr=document.createElement('tr');
          const c=colorFor(r.pct);
          tr.innerHTML = `
            <td style="padding:10px 8px;font-weight:700">${r.pair}</td>
            <td style="padding:10px 8px">${r.exMax}</td>
            <td style="padding:10px 8px" class="mono">${fmtNum(r.price, r.price<1?6:4)}</td>
            <td style="padding:10px 8px;color:${c};font-weight:800" class="mono">${r.pct>0?'+':''}${r.pct.toFixed(2)}%</td>
            <td style="padding:10px 8px" class="mono">—</td>
            <td style="padding:10px 8px" class="mono">—</td>
            <td style="padding:10px 8px"><button class="emoji-btn" style="background:none;border:none;cursor:pointer;font-size:16px;">🗑️</button></td>
          `;
          tr.querySelector('button')?.addEventListener('click', ()=>{
            tr.remove();
            if(!tbody.querySelector('tr')){ if(empty) empty.style.display='block'; }
          });
          tbody.appendChild(tr);
          await yieldUI();
        }
      }
    }
    const upd = root.querySelector('#spreadsUpdated'); if(upd) upd.textContent = nowTime();
  }

  function makeController(root){
    let ac=null, timer=null;
    function start(){
      stop();
      ac = new AbortController();
      // start immediately (small delay to avoid race with render)
      setTimeout(()=>{ if(!ac.signal.aborted) scanSpreads(root, ac.signal); }, 200);
      timer = setInterval(()=>{
        if(ac) ac.abort();
        ac = new AbortController();
        scanSpreads(root, ac.signal);
      }, AUTO_REFRESH_MS);
    }
    function stop(){ if(timer){ clearInterval(timer); timer=null; } if(ac){ ac.abort(); ac=null; } }
    return { start, stop };
  }

  // Try to find the container where "Спреды" content should appear.
  function findSpreadsContainer(){
    // 1) explicit id if exists
    const byId = document.getElementById('modalSpreadsPro') || document.getElementById('spreadsModal') || document.getElementById('modalSpreads');
    if(byId) return byId;
    // 2) a visible panel that contains a header with word "Спреды"
    const nodes = Array.from(document.querySelectorAll('div,section,article'));
    for(const n of nodes){
      const txt = (n.textContent||'').toLowerCase();
      if(txt.includes('спреды') && n.querySelector('table')) return n;
    }
    // 3) fallback: create hidden placeholder the host code can clone
    const p = document.createElement('div');
    p.id = 'modalSpreadsPro';
    p.style.display = 'none';
    document.body.appendChild(p);
    return p;
  }

  function integrate(){
    const target = findSpreadsContainer();
    // If target is empty shell, mount our template; otherwise replace its inner with our template
    mountTemplate(target);

    const ctrl = makeController(target);
    // wire refresh
    target.querySelector('#spreadsRefresh')?.addEventListener('click', ()=>{
      ctrl.stop();
      const tmp = new AbortController();
      scanSpreads(target, tmp.signal);
    });

    // start automatically
    ctrl.start();

    // Observe for removal (panel close) and stop
    const ro = new MutationObserver(()=>{
      if(!document.body.contains(target)){ ctrl.stop(); ro.disconnect(); }
    });
    ro.observe(document.body, { childList:true, subtree:true });
  }

  // If host app clones the node dynamically when button pressed, we hook into DOM changes
  function observeForOpen(){
    const mo = new MutationObserver(()=>{
      const container = document.getElementById('modalSpreadsPro');
      if(container && !container.dataset.qtwired){
        container.dataset.qtwired = '1';
        integrate();
      }
    });
    mo.observe(document.documentElement || document.body, { childList:true, subtree:true });
  }

  document.addEventListener('DOMContentLoaded', ()=>{
    // Try immediate integration for pages where panel is already present
    observeForOpen();
    const existing = document.getElementById('modalSpreadsPro');
    if(existing){ integrate(); }
  });
})();
