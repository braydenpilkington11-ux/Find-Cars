// Car finder backend. Node 18+, no dependencies.
// Run:  TRADEME_KEY=your_consumer_key TRADEME_SECRET=your_consumer_secret node server.js
// Then open http://localhost:3000
const http = require('http');
const fs = require('fs');
const path = require('path');

const KEY = process.env.TRADEME_KEY;
const SECRET = process.env.TRADEME_SECRET;
const PARAMS = ['make', 'model', 'year_min', 'year_max', 'price_min', 'price_max',
  'odometer_min', 'odometer_max', 'body_style', 'fuel_type', 'transmission', 'rows', 'page'];

// Source 1: Trade Me Motors via the official API.
// Check parameter names against https://developer.trademe.co.nz (API Reference).
async function tradeMe(q) {
  if (!KEY || !SECRET) throw new Error('Set TRADEME_KEY and TRADEME_SECRET');
  const u = new URL('https://api.trademe.co.nz/v1/Search/Motors/Used.json');
  if (!q.get('rows')) u.searchParams.set('rows', '100'); // fetch more so excluded listings don't empty the page
  for (const p of PARAMS) if (q.get(p)) u.searchParams.set(p, q.get(p));
  const r = await fetch(u, {
    headers: { Authorization: `OAuth oauth_consumer_key="${KEY}", oauth_signature_method="PLAINTEXT", oauth_signature="${SECRET}%26"` },
  });
  if (!r.ok) throw new Error(`Trade Me returned ${r.status}`);
  const d = await r.json();
  return (d.List || []).map(x => ({
    source: 'Trade Me',
    title: x.Title,
    price: x.PriceDisplay,
    region: x.Region,
    img: x.PictureHref,
    url: `https://www.trademe.co.nz/a/motors/cars/listing/${x.ListingId}`,
  }));
}

// Source 2+: dealers. There is no shared dealer API in NZ, so add one adapter per
// dealer that has a feed or API. Each takes the query and returns the same shape as above.
const dealers = [
  // { name: 'Example Motors', run: async (q) => [ { source: 'Example Motors', title, price, region, img, url } ] },
];

async function search(q) {
  const jobs = [{ name: 'Trade Me', run: tradeMe }, ...dealers];
  const settled = await Promise.allSettled(jobs.map(j => j.run(q)));
  const results = [], errors = [];
  settled.forEach((s, i) => s.status === 'fulfilled'
    ? results.push(...s.value)
    : errors.push(`${jobs[i].name}: ${s.reason.message}`));
  // Trade Me has no include/exclude filters, so match on the listing title here.
  // Include: listing must contain at least one of these words. Exclude: drop if it contains any.
  const words = k => (q.get(k) || '').toLowerCase().split(',').map(w => w.trim()).filter(Boolean);
  const inc = words('include'), ex = words('exclude');
  const kept = results.filter(r => {
    const t = (r.title || '').toLowerCase();
    return (!inc.length || inc.some(w => t.includes(w))) && !ex.some(w => t.includes(w));
  });
  return { results: kept, errors, hidden: results.length - kept.length };
}

const PASSWORD = process.env.APP_PASSWORD; // optional: set it to put the site behind a password

http.createServer(async (req, res) => {
  if (PASSWORD) {
    const given = Buffer.from((req.headers.authorization || '').split(' ')[1] || '', 'base64').toString().split(':').slice(1).join(':');
    if (given !== PASSWORD) {
      res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="Car finder"' });
      return res.end('Password required');
    }
  }
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/api/search') {
    const out = await search(url.searchParams);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(out));
  }
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(fs.readFileSync(path.join(__dirname, 'index.html')));
}).listen(process.env.PORT || 3000, () => console.log('Running'));
