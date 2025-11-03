Spreads Auto-Scanner v3.1 (Vercel-ready)
Files:
- index.html
- spreads_autoscanner_patch_v3_1.js
- api/gecko.js  (Vercel proxy for CoinGecko)

Deploy:
1. Deploy to Vercel (Other → Static Site).
2. Keep /api/gecko.js in project root. It auto-enables proxy for production.
3. On localhost it uses direct CoinGecko, on Vercel it uses proxy to avoid CORS.
4. Threshold 1%, auto refresh every 60s.
