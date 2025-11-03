
/* spreads_autoscanner_patch_v3_2.js — PRO
   - Auto-proxy for Vercel (/api/gecko) to avoid CORS
   - Clean 1% logic, no exchange dependency, "Авто" only
   - Immediate first scan after modal opens (safe 200ms delay to avoid race)
   - Auto-refresh every 60s, manual 🔄 button
   - Async, UI-friendly (yields), conservative CoinGecko usage
*/
(function(){
  const CG_BASE='https://api.coingecko.com';
  const API_PROXY='/api/gecko';
  const MIN_SPREAD=1;
  const TOP_LIMIT=40;
  const CONCURRENCY=3;
  const BATCH_DELAY_MS=700;
  const AUTO_REFRESH_MS=60000;

  const isLocal = location.hostname.includes('localhost') || location.hostname.startsWith('127.') || location.protocol === 'file:';
  const CG = isLocal ? CG_BASE : API_PROXY;

  const yieldUI = () => new Promise(r=>requestAnimationFrame(()=>setTimeout(r,0)));
  const sleep = (ms)=>new Promise(r=>setTimeout(r,ms));
  const nowHHMM = ()=> new Date().toLocaleTimeString();

  function fmtNum(v,d=2){ if(v==null||!isFinite(v)) return '—'; return Number(v).toLocaleString(undefined,{maximumFractionDigits:d}); }
  function colorFor(p){ if(!isFinite(p)) return '#d6d3d1'; if(p>5)return'#ff4757'; if(p>=3)return'#ff9f43'; return'#f1c40f'; }

  // Creates or replaces the spreads template content
  function ensureTemplate(){
    let tpl = document.getElementById('modalSpreadsPro');
    if(!tpl){ tpl = document.createElement('div'); tpl.id = 'modalSpreadsPro'; tpl.style.display='none'; document.body.appendChild(tpl); }
    tpl.innerHTML = `
      <div class="top-controls">
        <div class="top-seg" id="spreadsSeg">
          <button class="active" data-ex="auto">⚙️ Авто</button>
          <button id="spreadsRefresh" title="Обновить">🔄</button>
        </div>
        <span class="mini">Обновлено: <span id="spreadsUpdated">—</span></span>
      </div>
      <div class="mini" style="margin:6px 0 10px;color:#A0ACB9">
        Источник: CoinGecko (все поддерживаемые CEX и DEX). Пары: USDT / USDC. Порог: ≥ ${MIN_SPREAD}%.
      </div>
      <table class="top-table" id="spreadsTable">
        <thead>
          <tr>
            <th>ПАРА</th><th>БИРЖА (МАКС)</th><th>ЦЕНА</th><th>СПРЕД %</th><th>ФАНДИНГ</th><th>СДЕЛКИ</th><th>🗑️</th>
          </tr>
        </thead>
        <tbody id="spreadsBody">
          <tr><td colspan="7">🔄 Поиск активных спредов…</td></tr>
        </tbody>
      </table>
      <div class="mini" id="spreadsEmpty" style="display:none; padding:8px 0;">
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
    const D=['swap','dex','curve','balancer','uniswap','sushiswap','pancake','raydium','jupiter','quickswap','dydx'];
    return D.some(h=>n.includes(h)||id.includes(h))?'DEX':'CEX';
  }
  function buildKey(b,q){ return `${b}${q}`.toUpperCase(); }

  async function scanSpreads(root, signal){
    const tbody = root.querySelector('#spreadsBody');
    const empty = root.querySelector('#spreadsEmpty');
    if(tbody){ tbody.innerHTML = '<tr><td colspan="7">🔄 Поиск активных спредов…</td></tr>'; }
    if(empty) empty.style.display = 'none';
    await yieldUI();

    const top = await fetchTopIds(TOP_LIMIT);
    if(signal?.aborted) return;
    if(!top.length){ if(tbody) tbody.innerHTML = `<tr><td colspan="7">Ошибка получения списка монет</td></tr>`; return; }

    const groups = new Map();
    for(let i=0;i<top.length;i+=CONCURRENCY){
      const batch = top.slice(i, i+CONCURRENCY);
      const settled = await Promise.all(batch.map(c=>fetchTickersSafe(c.id).catch(()=>[])));
      for(const ticks of settled){
        for(const t of ticks||[]){
          const q=(t?.target||'').toUpperCase();
          if(q!=='USDT' && q!=='USDC') continue;
          const base=(t?.base||'').toUpperCase(); if(!base) continue;
          const price=Number(t?.last ?? t?.converted_last?.usd);
          if(!isFinite(price)||price<=0) continue;
          const ex=t?.market?.name||'—', type=classifyMarket(t?.market);
          const key=buildKey(base,q);
          if(!groups.has(key)) groups.set(key, { base, quote:q, items:[] });
          groups.get(key).items.push({ ex, type, price });
        }
      }
      await sleep(BATCH_DELAY_MS);
      await yieldUI();
      if(signal?.aborted) return;
    }

    const rows = [];
    groups.forEach(({base, quote, items})=>{
      if(!items || items.length<2) return;
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
        else tbody.innerHTML = `<tr><td colspan="7">Нет активных спредов ≥ ${MIN_SPREAD} % (по всем биржам и DEX)</td></tr>`;
      } else {
        for(const r of rows){
          const tr = document.createElement('tr');
          const c = colorFor(r.pct);
          tr.innerHTML = `
            <td class="mono" style="font-weight:700">${r.pair}</td>
            <td>${r.exMax}</td>
            <td class="mono">${fmtNum(r.price, r.price<1?6:4)}</td>
            <td class="mono" style="font-weight:800;color:${c}">${r.pct>0?'+':''}${r.pct.toFixed(2)}%</td>
            <td class="mono">—</td>
            <td class="mono">—</td>
            <td><button class="emoji-btn" title="Удалить">🗑️</button></td>
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
    const upd = root.querySelector('#spreadsUpdated'); if(upd) upd.textContent = nowHHMM();
  }

  function makeController(root){
    let ac=null, timer=null;
    function start(){
      stop();
      ac = new AbortController();
      setTimeout(()=>{ if(!ac.signal.aborted) scanSpreads(root, ac.signal); }, 200); // immediate first run
      timer = setInterval(()=>{
        if(ac) ac.abort();
        ac = new AbortController();
        scanSpreads(root, ac.signal);
      }, AUTO_REFRESH_MS);
    }
    function stop(){ if(timer){ clearInterval(timer); timer=null; } if(ac){ ac.abort(); ac=null; } }
    return { start, stop };
  }

  function observeIntegration(){
    const obs = new MutationObserver(()=>{
      document.querySelectorAll('#modalSpreadsPro').forEach(root=>{
        if(root.dataset._wired) return;
        root.dataset._wired = '1';
        // wipe any legacy content and inject our template
        ensureTemplate();
        // move fresh template into this root (keep existing wrapper from host app)
        const fresh = document.getElementById('modalSpreadsPro');
        if(fresh && fresh !== root){
          root.innerHTML = fresh.innerHTML;
        }
        const ctrl = makeController(root);
        const btn = root.querySelector('#spreadsRefresh');
        if(btn) btn.addEventListener('click', ()=>{ ctrl.stop(); const tmp = new AbortController(); scanSpreads(root, tmp.signal); });
        // start
        ctrl.start();
        // stop when removed
        const ro = new MutationObserver(()=>{
          if(!document.body.contains(root)){ ctrl.stop(); ro.disconnect(); }
        });
        ro.observe(document.body, { childList:true, subtree:true });
      });
    });
    obs.observe(document.documentElement||document.body, { childList:true, subtree:true });
  }

  document.addEventListener('DOMContentLoaded', ()=>{
    ensureTemplate();
    observeIntegration();
  });
})();
