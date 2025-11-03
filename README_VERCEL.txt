# Listings Aggregator for Vercel

This repo contains:
- `api/listings.js` — Edge function that aggregates real listing announcements from Binance, Bybit, KuCoin, OKX, MEXC.
- `index_final_entry_price_blue_LISTINGS_VERCEL.html` — your agent HTML with auto-fetch from the Vercel endpoint.
- `vercel.json` — cron that warms the endpoint every 30 minutes.

## Deploy

1. Create a new GitHub repo and add these files:
   - `api/listings.js`
   - `vercel.json`
   - (optional) put your app files too, including the HTML agent.

2. Import the repo into Vercel (New Project → Import GitHub Repo).
3. After deploy, your endpoint will be:
   `https://<your-project>.vercel.app/api/listings`

4. In the HTML agent, set (or leave default):
   ```js
   window.LISTINGS_FEED_URL = 'https://<your-project>.vercel.app/api/listings';
   ```

## Notes

- Binance source uses an **unofficial CMS endpoint** that powers their announcement pages. It may change at any time.
- Bybit + KuCoin are official public endpoints.
- OKX + MEXC are parsed from their announcement pages (HTML). Structure can change over time.
- We filter only **upcoming** and **past <= 14 days**.
- No links are shown in the UI — only date/exchange/token/pair/type/note.

