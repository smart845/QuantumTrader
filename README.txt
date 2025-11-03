Spreads Auto-Scanner (Vercel-ready)
Files:
- index.html  (patched original page)
- spreads_autoscanner_patch_v2.js  (optimized scanner v2)
Deploy:
- Push this folder to GitHub and link to Vercel (or deploy static site).
Notes:
- v2 uses conservative settings: TOP_LIMIT=40, concurrency=3, batch delay 700ms, auto-refresh 60s.
- CoinGecko enforces rate limits; serverless IPs (Vercel) may still be limited if many users trigger scans simultaneously.
