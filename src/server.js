/**
 * Nifty50 Impact Simulator — Node.js Server
 *
 * Usage:
 *   node server.js
 *
 * Config:
 *   Edit CSV_DIR below to point to the folder containing your 8 CSV files.
 *   Files expected (any name works as long as filenames contain these keywords):
 *     cost_input, credit (or credts), demand, industry,
 *     investment, regulator, sector, supply_chain
 *
 * Then open:  http://localhost:3000
 */

// import { API_KEY } from './api';

const http = require('http');
const fs   = require('fs');
const path = require('path');

// ─── CONFIG ──────────────────────────────────────────────────────────────────
const PORT    = 3000;
const CSV_DIR = 'D:/Project/Algorithmic_Trading/Analyzer2/edges';          // <-- change this to your CSV folder path
                                   // e.g. 'C:/Users/you/nifty/csvs'
                                   // or   '/home/you/project/data'
// ─────────────────────────────────────────────────────────────────────────────

// Maps filename keywords → canonical category key
const CATEGORY_MAP = {
  cost_input   : 'cost_input',
  cost         : 'cost_input',
  credit       : 'credit',
  credts       : 'credit',       // your file is spelled "credts"
  demand       : 'demand',
  industry     : 'industry',
  investment   : 'investment',
  regulator    : 'regulator',
  regulatory   : 'regulator',
  sector       : 'sector',
  supply_chain : 'supply_chain',
  supply       : 'supply_chain',
};

function detectCategory(filename) {
  const lower = filename.toLowerCase().replace('.csv', '');
  for (const [keyword, cat] of Object.entries(CATEGORY_MAP)) {
    if (lower.includes(keyword)) return cat;
  }
  return lower; // fallback: use filename as category
}

function parseCSV(content, category) {
  const lines = content.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];

  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
  const idx = key => headers.findIndex(h => h.toLowerCase() === key.toLowerCase());

  const iFrom = idx('From');
  const iTo   = idx('To');
  const iMech = idx('Mechanism');
  const iStr  = idx('Strength');
  const iDir  = idx('Direction');
  const iWt   = idx('Weight');

  const edges = [];
  for (let i = 1; i < lines.length; i++) {
    // Handle quoted fields with commas inside
    const cols = splitCSVLine(lines[i]);
    const from = (cols[iFrom] || '').trim();
    const to   = (cols[iTo]   || '').trim();
    if (!from || !to) continue;

    const edge = {
      from,
      to,
      mechanism : (cols[iMech] || '').trim().replace(/^"|"$/g, ''),
      category,
      strength  : (cols[iStr]  || 'medium').trim().toLowerCase(),
      direction : (cols[iDir]  || 'mixed').trim().toLowerCase(),
    };
    if (iWt >= 0 && cols[iWt]) {
      const w = parseFloat(cols[iWt]);
      if (!isNaN(w)) edge.weight = w;
    }
    edges.push(edge);
  }
  return edges;
}

function splitCSVLine(line) {
  const result = [];
  let cur = '', inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { inQuote = !inQuote; }
    else if (c === ',' && !inQuote) { result.push(cur); cur = ''; }
    else { cur += c; }
  }
  result.push(cur);
  return result;
}

function loadAllEdges() {
  if (!fs.existsSync(CSV_DIR)) {
    console.error(`\n❌  CSV_DIR not found: "${path.resolve(CSV_DIR)}"`);
    console.error(`    Edit the CSV_DIR variable at the top of server.js\n`);
    process.exit(1);
  }

  const files = fs.readdirSync(CSV_DIR).filter(f => f.toLowerCase().endsWith('.csv'));
  if (files.length === 0) {
    console.warn(`⚠️  No CSV files found in "${path.resolve(CSV_DIR)}"`);
    return [];
  }

  let all = [];
  const summary = [];

  for (const file of files) {
    const filePath = path.join(CSV_DIR, file);
    const content  = fs.readFileSync(filePath, 'utf-8');
    const category = detectCategory(file);
    const edges    = parseCSV(content, category);
    all = all.concat(edges);
    summary.push(`  ${file.padEnd(25)} → category: ${category.padEnd(15)} (${edges.length} edges)`);
  }

  console.log(`\n📂  Loaded ${files.length} CSV files from: ${path.resolve(CSV_DIR)}`);
  console.log(summary.join('\n'));
  console.log(`\n✅  Total edges: ${all.length}\n`);
  return all;
}

// ─── BUILD EDGE STATS ────────────────────────────────────────────────────────
function buildStats(edges) {
  const byCat = {};
  const tickers = new Set();
  for (const e of edges) {
    byCat[e.category] = (byCat[e.category] || 0) + 1;
    tickers.add(e.from);
    tickers.add(e.to);
  }
  return { total: edges.length, by_category: byCat, ticker_count: tickers.size };
}

// ─── HTTP SERVER ─────────────────────────────────────────────────────────────
let EDGES = loadAllEdges();

const MIME = {
  '.html' : 'text/html',
  '.js'   : 'application/javascript',
  '.css'  : 'text/css',
  '.json' : 'application/json',
};

const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];

  // CORS headers (needed for fetch from same origin)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  // ── API: /api/edges ─────────────────────────────────────────────────────
  if (url === '/api/edges') {
    const body = JSON.stringify({ edges: EDGES, stats: buildStats(EDGES) });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(body);
    return;
  }

  // ── API: /api/reload ────────────────────────────────────────────────────
  // Hit this endpoint to hot-reload CSVs without restarting the server
  if (url === '/api/reload') {
    EDGES = loadAllEdges();
    const body = JSON.stringify({ message: 'reloaded', stats: buildStats(EDGES) });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(body);
    return;
  }

  // ── Serve index.html for / ───────────────────────────────────────────────
  let filePath = url === '/' ? path.join(__dirname, 'index.html') : path.join(__dirname, url);
  const ext    = path.extname(filePath);
  const mime   = MIME[ext] || 'text/plain';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': mime });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`🚀  Server running at http://localhost:${PORT}`);
  console.log(`    Open that URL in your browser.\n`);
  console.log(`    To reload CSVs without restarting: GET http://localhost:${PORT}/api/reload\n`);
});

