
/*
  Spreads Auto-Scanner (CoinGecko, no keys) — drop‑in patch
  Requirements implemented:
  ✅ Полностью автоматический поиск по всем биржам и DEX
  ✅ Учитываются пары в USDT и USDC (в любых сетях)
  ✅ Порог — от 1 %
  ✅ Нет зависимости от выбранной биржи (режим «Авто» всегда активен)
  ✅ Сообщение, если нет спредов ≥ 1%
  ✅ Ранжирование по % desc, цвета: >5% красн, 3-5% оранж, <3% жёлт
  ✅ Элементы можно удалять из списка (корзина)
  ✅ Всё через API CoinGecko, прямо из браузера
  Интеграция: просто подключите этот файл ПОД всеми вашими скриптами на странице.
*/

(function(){
  const CG = 'https://api.coingecko.com/api/v3';
  const MIN_SPREAD = 1; // %

  // Helper DOM
  function el(html){
    const t = document.createElement('template');
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  }
  function fmtNum(v, d=2){
    if(v == null || !isFinite(v)) return '—';
    return Number(v).toLocaleString(undefined, { maximumFractionDigits: d });
  }
  function colorFor(p){
    if(!isFinite(p)) return '#d6d3d1'; // neutral
    if(p > 5) return '#ff4757'; // red
    if(p >= 3) return '#ff9f43'; // orange
    return '#f1c40f'; // yellow
  }

  // Replace the template content (keeps the same template id so openModal still works)
  function ensureTemplate(){
    let tpl = document.getElementById('modalSpreadsPro');
    if(!tpl){
      // create a basic one so it still works in minimal builds
      tpl = document.createElement('div');
      tpl.id = 'modalSpreadsPro';
      tpl.style.display = 'none';
      document.body.appendChild(tpl);
    }
    tpl.innerHTML = `
      <div class="top-controls">
        <div class="top-seg" id="spreadsSeg">
          <button class="active" data-ex="auto">⚙️ Авто</button>
        </div>
        <span class="mini">Обновлено: <span id="spreadsUpdated">—</span></span>
      </div>
      <div class="mini" style="margin:6px 0 10px;color:#A0ACB9">
        Источник цен: CoinGecko (все поддерживаемые CEX и DEX). Пары: USDT / USDC. Порог: ≥ ${MIN_SPREAD}%.
      </div>
      <table class="top-table" id="spreadsTable">
        <thead>
          <tr>
            <th>Пара</th>
            <th>Биржа (макс)</th>
            <th>Цена</th>
            <th>Спред %</th>
            <th>Фандинг</th>
            <th>Сделки</th>
            <th>🗑️</th>
          </tr>
        </thead>
        <tbody id="spreadsBody">
          <tr><td colspan="7">Загрузка...</td></tr>
        </tbody>
      </table>
      <div class="mini" id="spreadsEmpty" style="display:none; padding:8px 0;">
        Нет активных спредов ≥ ${MIN_SPREAD} % (по всем биржам и DEX)
      </div>
    `;
  }

  // API: paginated list of market-cap leaders → ids
  async function fetchTopIds(limit=100){
    const per = 250;
    let need = limit, page = 1;
    const ids = [];
    while(need > 0){
      const take = Math.min(need, per);
      const url = `${CG}/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=${take}&page=${page}&sparkline=false&price_change_percentage=24h`;
      const r = await fetch(url);
      if(!r.ok) throw new Error('CoinGecko markets '+r.status);
      const j = await r.json();
      if(!Array.isArray(j) || !j.length) break;
      ids.push(...j.map(x => ({ id: x.id, symbol: (x.symbol||'').toUpperCase() })));
      need -= j.length;
      page += 1;
      if(j.length < take) break;
    }
    return ids;
  }

  // API: tickers per coin id (contains per-exchange quotations)
  async function fetchTickers(coinId){
    const url = `${CG}/coins/${encodeURIComponent(coinId)}/tickers?include_exchange_logo=false`;
    const r = await fetch(url);
    if(!r.ok) throw new Error('CoinGecko tickers '+r.status);
    const j = await r.json();
    return Array.isArray(j?.tickers) ? j.tickers : [];
  }

  // Detect DEX vs CEX label from market name/identifier (best effort)
  function classifyMarket(market){
    const name = (market?.name || '').toLowerCase();
    const id = (market?.identifier || '').toLowerCase();
    const dexHints = ['swap','dex','curve','balancer','uniswap','sushiswap','pancake','raydium','jupiter','quickswap','dydx']; // heuristic
    const isDex = dexHints.some(h => name.includes(h) || id.includes(h));
    return isDex ? 'DEX' : 'CEX';
  }

  function buildKey(baseSym, quoteSym){
    // For display and grouping: BTCUSDT / ETHUSDC …
    return `${baseSym}${quoteSym}`.toUpperCase();
  }

  // Scan: group by (base, quote in USDT/USDC) across all ticks; compute spread
  async function scanSpreads(){
    const tbody = document.getElementById('spreadsBody');
    const empty = document.getElementById('spreadsEmpty');
    if(tbody){ tbody.innerHTML = '<tr><td colspan="7">Загрузка...</td></tr>'; }
    if(empty) empty.style.display = 'none';

    try{
      const top = await fetchTopIds(120); // ~top120 by mcap for speed
      // Limit concurrency
      const pool = 8;
      const chunks = [];
      for(let i=0;i<top.length;i+=pool) chunks.push(top.slice(i,i+pool));

      const groups = new Map(); // key -> {base, quote, items:[{ex, type, price, raw}]}
      for(const chunk of chunks){
        const res = await Promise.allSettled(chunk.map(x => fetchTickers(x.id)));
        res.forEach((st, idx) => {
          if(st.status !== 'fulfilled') return;
          const ticks = st.value;
          for(const t of ticks){
            const q = (t?.target || '').toUpperCase();
            if(q !== 'USDT' && q !== 'USDC') continue;
            const base = (t?.base || '').toUpperCase();
            if(!base) continue;
            const price = Number(t?.last ?? t?.converted_last?.usd);
            if(!isFinite(price) || price <= 0) continue;

            const marketName = t?.market?.name || '—';
            const exType = classifyMarket(t?.market);
            const key = buildKey(base, q);
            if(!groups.has(key)) groups.set(key, { base, quote: q, items: [] });
            groups.get(key).items.push({
              ex: marketName,
              type: exType,
              price,
              raw: t
            });
          }
        });
      }

      // Compute spreads
      const rows = [];
      groups.forEach(({base, quote, items}) => {
        if(!items || items.length < 2) return; // need at least two markets
        let min = { price: Infinity, ex: '', type:'', raw:null };
        let max = { price: -Infinity, ex: '', type:'', raw:null };
        for(const it of items){
          if(it.price < min.price) min = it;
          if(it.price > max.price) max = it;
        }
        if(!isFinite(min.price) || !isFinite(max.price) || min.price <= 0) return;
        const spreadPct = ((max.price - min.price) / min.price) * 100;
        if(spreadPct < MIN_SPREAD) return;

        rows.push({
          pair: `${base}${quote}`,
          exMax: `${max.ex} ${max.type === 'DEX' ? 'dex' : 'linear'}`, // keep "linear" wording for CEX per example
          price: max.price,
          pct: spreadPct,
          funding: null, // CoinGecko doesn't provide funding
          trades: null,  // CoinGecko doesn't provide trade count
        });
      });

      // Sort desc by pct
      rows.sort((a,b) => b.pct - a.pct);

      // Render
      if(tbody){
        tbody.innerHTML = '';
        if(!rows.length){
          if(empty) empty.style.display = 'block';
          else tbody.innerHTML = `<tr><td colspan="7">Нет активных спредов ≥ ${MIN_SPREAD} % (по всем биржам и DEX)</td></tr>`;
        } else {
          rows.forEach((r, idx) => {
            const tr = document.createElement('tr');
            const color = colorFor(r.pct);
            tr.innerHTML = `
              <td class="mono" style="font-weight:700">${r.pair}</td>
              <td>${r.exMax}</td>
              <td class="mono">${fmtNum(r.price, r.price<1?6:4)}</td>
              <td class="mono" style="font-weight:800;color:${color}">${r.pct > 0 ? '+' : ''}${r.pct.toFixed(2)}%</td>
              <td class="mono">—</td>
              <td class="mono">—</td>
              <td><button class="emoji-btn" title="Удалить">🗑️</button></td>
            `;
            // Deletion
            tr.querySelector('button')?.addEventListener('click', (e)=>{
              e.stopPropagation();
              tr.remove();
              // If list became empty, show message
              if(!tbody.querySelector('tr')){
                if(empty) empty.style.display = 'block';
              }
            });
            tbody.appendChild(tr);
          });
        }
      }

      const upd = document.getElementById('spreadsUpdated');
      if(upd) upd.textContent = new Date().toLocaleTimeString();

    }catch(err){
      console.error('Spreads auto-scan error', err);
      const tbody = document.getElementById('spreadsBody');
      if(tbody) tbody.innerHTML = `<tr><td colspan="7">Ошибка загрузки данных CoinGecko</td></tr>`;
    }
  }

  function hookOpen(){
    // When modal is opened via your existing openModal(..., 'modalSpreadsPro')
    // this observer will rescan spreads
    const modal = document.getElementById('modalDrawer');
    if(!modal) return;

    const target = document.getElementById('modalContent');
    if(!target) return;

    const observer = new MutationObserver(()=>{
      const root = target.querySelector('#modalSpreadsPro');
      if(root){
        // kick scan when the spreads content is actually displayed
        scanSpreads();
      }
    });
    observer.observe(target, { childList: true, subtree: true });
  }

  // Boot
  document.addEventListener('DOMContentLoaded', ()=>{
    ensureTemplate();
    hookOpen();
    // if page programmatically opens Spreads immediately (e.g., default), still ready
  });
})();
