export default async function handler(req, res) {
  const target = 'https://api.coingecko.com' + req.url.replace('/api/gecko', '');
  try {
    const response = await fetch(target);
    const data = await response.json();
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.status(200).json(data);
  } catch (err) {
    res.status(500).json({ error: 'proxy_error', details: err.message });
  }
}
