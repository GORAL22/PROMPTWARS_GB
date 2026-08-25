import http from 'node:http';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { extname, basename, dirname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, 'public');
const MAX_BODY_BYTES = 6 * 1024 * 1024;
const MAX_DOCUMENTS = 20;
const MAX_DOCUMENT_BYTES = 250 * 1024;
const RATE_LIMIT_WINDOW = 60_000;
const RATE_LIMIT_MAX = 60;
const requestLog = new Map();
const ALLOWED_EXTENSIONS = new Set(['.pdf', '.md', '.markdown', '.txt', '.csv', '.js', '.ts', '.py', '.r', '.ipynb', '.java']);
const MIME_TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml' };

const seedGraph = {
  nodes: [
    { id: 'paper-health', type: 'paper', symbol: '↗', title: 'Mobility, heat & community health', kicker: 'School of Sciences · Environmental studies', summary: 'A cross-campus study connecting walkability, urban heat and neighbourhood health indicators in Bengaluru.', tags: ['urban health', 'heat', 'Bengaluru'], lenses: ['health', 'climate'], score: '0.94', x: 28, y: 39 },
    { id: 'paper-ai', type: 'paper', symbol: '↗', title: 'Explainable triage signals', kicker: 'Computer Science · Health informatics', summary: 'Interpretable machine-learning features for prioritising time-sensitive community health records.', tags: ['XAI', 'triage', 'machine learning'], lenses: ['ai', 'health'], score: '0.89', x: 58, y: 25 },
    { id: 'paper-civic', type: 'paper', symbol: '↗', title: 'Affective maps of transit', kicker: 'Psychology · Urban studies', summary: 'Maps perceptions of safety and access across public transit journeys using participatory research.', tags: ['mobility', 'participatory research', 'safety'], lenses: ['health', 'climate'], score: '0.87', x: 77, y: 54 },
    { id: 'paper-water', type: 'paper', symbol: '↗', title: 'Forecasting rooftop water resilience', kicker: 'School of Engineering · Sustainability', summary: 'A lightweight rainfall model for locating urban rainwater-harvesting opportunities.', tags: ['rainfall', 'resilience', 'forecasting'], lenses: ['climate', 'ai'], score: '0.85', x: 40, y: 75 },
    { id: 'data-mobility', type: 'data', symbol: '◫', title: 'Bengaluru Mobility Archive', kicker: 'Open civic dataset', summary: 'An anonymised collection of transit, walkability and locality accessibility indicators.', tags: ['dataset', 'mobility', 'open data'], lenses: ['data', 'climate'], score: '0.81', x: 47, y: 47 },
    { id: 'data-climate', type: 'data', symbol: '◫', title: 'Microclimate field readings', kicker: 'Environmental data collection', summary: 'Time-stamped local temperature and surface measurements from field observations.', tags: ['dataset', 'temperature', 'sensors'], lenses: ['data', 'climate'], score: '0.79', x: 20, y: 70 },
    { id: 'method-gnn', type: 'method', symbol: '✦', title: 'Graph neural networks', kicker: 'Shared computational method', summary: 'A network method that learns from relationships between observations, authors and sources.', tags: ['method', 'GNN', 'networks'], lenses: ['ai', 'data'], score: '0.84', x: 70, y: 71 },
    { id: 'method-mixed', type: 'method', symbol: '✦', title: 'Mixed-method research', kicker: 'Shared research method', summary: 'A method that brings qualitative field accounts into dialogue with quantitative evidence.', tags: ['method', 'qualitative', 'quantitative'], lenses: ['health', 'data'], score: '0.76', x: 78, y: 29 },
    { id: 'person-anaya', type: 'person', symbol: 'AK', title: 'Anaya Kumar', kicker: 'Research contributor', summary: 'Contributor appearing across data, climate and public-health research signals.', tags: ['researcher', 'collaboration'], lenses: ['data', 'health'], score: '0.73', x: 57, y: 58 },
    { id: 'person-rahul', type: 'person', symbol: 'RS', title: 'Rahul Shah', kicker: 'Research contributor', summary: 'Contributor working at the boundary of AI methods and civic systems.', tags: ['researcher', 'AI'], lenses: ['ai', 'data'], score: '0.71', x: 87, y: 76 },
    { id: 'method-privacy', type: 'method', symbol: '✦', title: 'Privacy-preserving analysis', kicker: 'Shared research method', summary: 'A practice for extracting insight while reducing exposure of sensitive research data.', tags: ['privacy', 'ethics', 'method'], lenses: ['ai', 'data'], score: '0.78', x: 42, y: 17 },
    { id: 'data-survey', type: 'data', symbol: '◫', title: 'Community survey corpus', kicker: 'Field research dataset', summary: 'Consent-aware survey responses gathered from community-facing research projects.', tags: ['dataset', 'survey', 'consent'], lenses: ['data', 'health'], score: '0.75', x: 12, y: 35 },
  ],
  edges: [
    ['paper-health', 'data-mobility'], ['paper-health', 'data-climate'], ['paper-health', 'method-mixed'], ['paper-health', 'person-anaya'], ['paper-ai', 'method-gnn'], ['paper-ai', 'method-privacy'], ['paper-ai', 'data-survey'], ['paper-ai', 'person-rahul'], ['paper-civic', 'data-mobility'], ['paper-civic', 'method-mixed'], ['paper-civic', 'data-survey'], ['paper-water', 'data-climate'], ['paper-water', 'method-gnn'], ['paper-water', 'person-anaya'], ['data-mobility', 'method-gnn'], ['data-mobility', 'person-anaya'], ['method-gnn', 'person-rahul'], ['method-mixed', 'data-survey'], ['method-privacy', 'data-survey'],
  ].map(([source, target]) => ({ source, target, relation: 'shared signal' })),
  trails: [
    { category: 'CROSS-DISCIPLINARY', title: 'Can transit-access data strengthen heat-health interventions?', nodeId: 'paper-health' },
    { category: 'POSSIBLE DUPLICATION', title: 'Two forecasting studies may be using the same rainfall premise.', nodeId: 'paper-water' },
    { category: 'COLLABORATION GAP', title: 'Privacy methods are present—where is the shared protocol?', nodeId: 'method-privacy' },
  ],
};

let graph = structuredClone(seedGraph);

const ontology = [
  { key: 'graph-neural-networks', title: 'Graph neural networks', type: 'method', symbol: '✦', terms: ['graph neural network', 'gnn', 'knowledge graph', 'node embedding'], tags: ['method', 'GNN', 'networks'], lenses: ['ai', 'data'] },
  { key: 'machine-learning', title: 'Machine learning', type: 'method', symbol: '✦', terms: ['machine learning', 'deep learning', 'neural network', 'classification', 'prediction model'], tags: ['method', 'machine learning'], lenses: ['ai', 'data'] },
  { key: 'privacy-preserving-analysis', title: 'Privacy-preserving analysis', type: 'method', symbol: '✦', terms: ['privacy', 'anonym', 'differential privacy', 'federated'], tags: ['privacy', 'ethics', 'method'], lenses: ['ai', 'data'] },
  { key: 'mixed-method-research', title: 'Mixed-method research', type: 'method', symbol: '✦', terms: ['mixed method', 'interview', 'qualitative', 'survey', 'participatory'], tags: ['method', 'qualitative', 'quantitative'], lenses: ['health', 'data'] },
  { key: 'urban-climate-data', title: 'Urban climate data', type: 'data', symbol: '◫', terms: ['climate', 'heat', 'temperature', 'rainfall', 'weather', 'microclimate'], tags: ['dataset', 'climate', 'sensors'], lenses: ['climate', 'data'] },
  { key: 'health-records', title: 'Community health records', type: 'data', symbol: '◫', terms: ['health', 'patient', 'disease', 'clinical', 'wellbeing', 'mental health'], tags: ['dataset', 'health', 'consent'], lenses: ['health', 'data'] },
  { key: 'mobility-data', title: 'Mobility and access data', type: 'data', symbol: '◫', terms: ['mobility', 'transport', 'transit', 'walkability', 'traffic', 'commute'], tags: ['dataset', 'mobility', 'civic'], lenses: ['climate', 'data'] },
  { key: 'sustainability', title: 'Urban sustainability', type: 'method', symbol: '✦', terms: ['sustainability', 'water', 'waste', 'energy', 'resilience', 'biodiversity'], tags: ['sustainability', 'cities'], lenses: ['climate', 'data'] },
];

function setSecurityHeaders(response) {
  response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Frame-Options', 'DENY');
  response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  response.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
}

function json(response, status, body) {
  setSecurityHeaders(response);
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(body));
}

function isRateLimited(request) {
  const ip = request.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const previous = requestLog.get(ip) || [];
  const current = previous.filter((time) => now - time < RATE_LIMIT_WINDOW);
  current.push(now); requestLog.set(ip, current);
  return current.length > RATE_LIMIT_MAX;
}

function readJson(request) {
  return new Promise((resolveBody, reject) => {
    let size = 0; const chunks = [];
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) { reject(Object.assign(new Error('Upload exceeds the 6 MB request limit.'), { status: 413 })); request.destroy(); return; }
      chunks.push(chunk);
    });
    request.on('end', () => {
      try { resolveBody(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(Object.assign(new Error('Graphis could not read that request.'), { status: 400 })); }
    });
    request.on('error', () => reject(Object.assign(new Error('The upload stream ended unexpectedly.'), { status: 400 })));
  });
}

function cleanFilename(value) {
  if (typeof value !== 'string' || value.length < 1 || value.length > 140) throw Object.assign(new Error('Each uploaded file needs a short, valid filename.'), { status: 400 });
  if (value !== basename(value) || /[\0<>:"|?*]/.test(value)) throw Object.assign(new Error('A filename contained unsupported path characters.'), { status: 400 });
  const extension = extname(value).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(extension)) throw Object.assign(new Error(`Unsupported file type: ${extension || 'no extension'}.`), { status: 415 });
  return { filename: value.replace(/[^a-zA-Z0-9._() -]/g, '_'), extension };
}

function cleanText(value) {
  return value.replace(/\0/g, '').replace(/[\u0001-\u0008\u000B\u000C\u000E-\u001F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80_000);
}

function extractPdfText(binary) {
  const printable = binary.toString('latin1');
  const matches = [...printable.matchAll(/\(([^()]{4,500})\)/g)].map((match) => match[1].replace(/\\[()]/g, '').replace(/\\n/g, ' '));
  return cleanText(matches.join(' '));
}

async function decodeDocument(item) {
  const { filename, extension } = cleanFilename(item?.name);
  if (typeof item?.content !== 'string' || item.content.length === 0) throw Object.assign(new Error(`${filename} did not contain upload data.`), { status: 400 });
  if (!/^[A-Za-z0-9+/=\r\n]+$/.test(item.content)) throw Object.assign(new Error(`${filename} has invalid file encoding.`), { status: 400 });
  const binary = Buffer.from(item.content, 'base64');
  if (binary.length === 0 || binary.length > MAX_DOCUMENT_BYTES) throw Object.assign(new Error(`${filename} exceeds the 250 KB per-file safety limit.`), { status: 413 });
  if (extension === '.pdf' && binary.subarray(0, 5).toString('ascii') !== '%PDF-') throw Object.assign(new Error(`${filename} is not a valid PDF upload.`), { status: 415 });
  const literalText = extension === '.pdf' ? extractPdfText(binary) : cleanText(binary.toString('utf8'));
  const documentAiText = extension === '.pdf' && literalText.length < 120 ? await extractWithDocumentAi(binary) : '';
  const text = documentAiText || literalText;
  if (!text || text.length < 12) throw Object.assign(new Error(`${filename} has no readable text. Try an exported text PDF or Markdown copy.`), { status: 422 });
  return { filename, extension, text };
}

function titleFromDocument(document) {
  const heading = document.text.match(/(?:^|\s)#\s+([^#\n]{5,120})/)?.[1];
  const candidate = heading || basename(document.filename, document.extension).replace(/[-_]+/g, ' ');
  return cleanText(candidate).slice(0, 100).replace(/\b\w/g, (character) => character.toUpperCase());
}

function hashToNumber(value, offset = 0) {
  return Number.parseInt(createHash('sha256').update(`${value}:${offset}`).digest('hex').slice(0, 8), 16);
}

function findMatches(text) { return ontology.filter((entry) => entry.terms.some((term) => text.includes(term))); }
function entityId(entry) { return `entity-${entry.key}`; }
function findDoi(text) {
  const candidate = text.match(/\b10\.\d{4,9}\/[\w.()/:;-]+\b/i)?.[0];
  return candidate ? candidate.replace(/[.,;]+$/, '').toLowerCase() : null;
}

function ensureEntity(entry) {
  const id = entityId(entry);
  if (!graph.nodes.some((node) => node.id === id)) {
    const value = hashToNumber(id);
    graph.nodes.push({ id, type: entry.type, symbol: entry.symbol, title: entry.title, kicker: 'Extracted shared research signal', summary: `A shared Graphis signal inferred from recurring terms in the university research material.`, tags: entry.tags, lenses: entry.lenses, score: '0.72', x: 15 + (value % 72), y: 16 + (hashToNumber(id, 1) % 68) });
  }
  return id;
}

function addEdge(source, target, relation) {
  if (!graph.edges.some((edge) => (edge.source === source && edge.target === target) || (edge.source === target && edge.target === source))) graph.edges.push({ source, target, relation });
}

function jaccard(left, right) {
  const a = new Set(left); const b = new Set(right); let common = 0;
  for (const item of a) if (b.has(item)) common += 1;
  return common / new Set([...a, ...b]).size;
}

async function ingestDocuments(rawDocuments) {
  if (!Array.isArray(rawDocuments) || rawDocuments.length === 0) throw Object.assign(new Error('Select one or more research files.'), { status: 400 });
  if (rawDocuments.length > MAX_DOCUMENTS) throw Object.assign(new Error(`Graphis accepts up to ${MAX_DOCUMENTS} files at a time.`), { status: 413 });
  const documents = await Promise.all(rawDocuments.map(decodeDocument));
  const added = [];
  documents.forEach((document) => {
    const lowered = document.text.toLowerCase();
    const matches = findMatches(lowered);
    const title = titleFromDocument(document);
    const doi = findDoi(document.text);
    const id = `paper-${createHash('sha256').update(`${document.filename}:${document.text}`).digest('hex').slice(0, 12)}`;
    const lenses = [...new Set(matches.flatMap((entry) => entry.lenses))];
    const node = { id, type: 'paper', symbol: '↗', title, kicker: document.extension === '.pdf' ? 'Imported PDF research material' : 'Imported research material', summary: `${document.filename} was mapped from ${matches.length || 'no'} recognised cross-disciplinary signal${matches.length === 1 ? '' : 's'}.`, tags: matches.length ? matches.flatMap((entry) => entry.tags).filter((tag, index, all) => all.indexOf(tag) === index).slice(0, 4) : ['new material', document.extension.slice(1)], lenses: lenses.length ? lenses : ['data'], score: (0.7 + (hashToNumber(id) % 23) / 100).toFixed(2), x: 18 + (hashToNumber(id) % 64), y: 18 + (hashToNumber(id, 1) % 64), doi, verification: doi ? 'DOI candidate found — not yet verified' : 'No DOI candidate in this file' };
    graph.nodes.push(node);
    const linkedEntities = matches.map(ensureEntity);
    linkedEntities.forEach((target) => addEdge(id, target, 'extracted relationship'));
    const relatedPapers = graph.nodes.filter((candidate) => candidate.type === 'paper' && candidate.id !== id).map((candidate) => ({ candidate, overlap: jaccard(node.tags, candidate.tags || []) })).filter(({ overlap }) => overlap >= 0.2).sort((a, b) => b.overlap - a.overlap).slice(0, 2);
    relatedPapers.forEach(({ candidate }) => addEdge(id, candidate.id, 'possible thematic overlap'));
    if (relatedPapers[0]?.overlap >= 0.5) graph.trails.unshift({ category: 'POSSIBLE DUPLICATION', title: `${title} shares a strong topic signature with ${relatedPapers[0].candidate.title}.`, nodeId: id });
    else graph.trails.unshift({ category: 'NEW SIGNAL', title: `${title} could connect ${matches.length || 'unmapped'} shared research signals.`, nodeId: id });
    added.push(node);
  });
  graph.trails = graph.trails.slice(0, 8);
  return added;
}

function localBridge() {
  const paper = graph.nodes.find((node) => node.id === 'paper-health') || graph.nodes.find((node) => node.type === 'paper');
  const data = graph.nodes.find((node) => node.id === 'data-mobility') || graph.nodes.find((node) => node.type === 'data');
  const method = graph.nodes.find((node) => node.id === 'method-gnn') || graph.nodes.find((node) => node.type === 'method');
  const pathNodes = [paper, data, method].filter(Boolean);
  return { title: 'A climate-health collaboration is hiding in plain sight.', text: `${paper?.title || 'A research paper'} and ${method?.title || 'a shared method'} both touch ${data?.title || 'a common data signal'}. A joint question could test whether neighbourhood access patterns improve how heat-related wellbeing risks are understood.`, path: pathNodes.map((node) => node.title), nodeIds: pathNodes.map((node) => node.id), provider: 'local' };
}

async function metadataAccessToken() {
  const response = await fetch('http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token', { headers: { 'Metadata-Flavor': 'Google' }, signal: AbortSignal.timeout(2500) });
  if (!response.ok) throw new Error('Cloud identity was unavailable.');
  const payload = await response.json();
  if (!payload.access_token) throw new Error('Cloud identity returned no access token.');
  return payload.access_token;
}

async function extractWithDocumentAi(binary) {
  const project = process.env.DOCUMENT_AI_PROJECT || process.env.GOOGLE_CLOUD_PROJECT;
  const processor = process.env.DOCUMENT_AI_PROCESSOR;
  if (!project || !processor) return '';
  try {
    const location = process.env.DOCUMENT_AI_LOCATION || 'us';
    const token = await metadataAccessToken();
    const endpoint = `https://${location}-documentai.googleapis.com/v1/projects/${encodeURIComponent(project)}/locations/${encodeURIComponent(location)}/processors/${encodeURIComponent(processor)}:process`;
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ rawDocument: { content: binary.toString('base64'), mimeType: 'application/pdf' } }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return '';
    const payload = await response.json();
    return cleanText(payload?.document?.text || '');
  } catch {
    // A literal-text PDF remains usable if the optional institution-owned processor is unavailable.
    return '';
  }
}

async function vertexBridge(base) {
  const project = process.env.VERTEX_AI_PROJECT || process.env.GOOGLE_CLOUD_PROJECT;
  if (!project) return base;
  try {
    const location = process.env.VERTEX_AI_LOCATION || 'asia-south1';
    const model = process.env.VERTEX_AI_MODEL || 'gemini-2.0-flash-001';
    const token = await metadataAccessToken();
    const safeIndex = graph.nodes.slice(0, 30).map((node) => ({ title: node.title, type: node.type, tags: node.tags })).filter((node) => node.title.length < 110);
    const prompt = `You are a university research-liaison assistant. Based only on this structural index, write one concise, action-oriented bridge insight (max 55 words). Do not invent findings, citations, people, statistics or sensitive data. Index: ${JSON.stringify(safeIndex)}`;
    const endpoint = `https://${location}-aiplatform.googleapis.com/v1/projects/${encodeURIComponent(project)}/locations/${encodeURIComponent(location)}/publishers/google/models/${encodeURIComponent(model)}:generateContent`;
    const response = await fetch(endpoint, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { temperature: 0.25, maxOutputTokens: 120 } }), signal: AbortSignal.timeout(7000) });
    if (!response.ok) throw new Error('Vertex generation was unavailable.');
    const payload = await response.json();
    const text = cleanText(payload?.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join(' ') || '');
    if (text.length < 15) throw new Error('Vertex returned an empty insight.');
    return { ...base, text: text.slice(0, 480), provider: 'vertex' };
  } catch {
    return base;
  }
}

async function verifyCitation(nodeId) {
  if (typeof nodeId !== 'string' || nodeId.length > 80) throw Object.assign(new Error('A valid graph node is required for verification.'), { status: 400 });
  const node = graph.nodes.find((candidate) => candidate.id === nodeId);
  if (!node || node.type !== 'paper') throw Object.assign(new Error('That research node is unavailable for citation verification.'), { status: 404 });
  if (!node.doi) return { verified: false, message: 'No DOI candidate was found in this imported research material.' };
  try {
    const response = await fetch(`https://api.crossref.org/works/${encodeURIComponent(node.doi)}`, { headers: { 'User-Agent': 'Graphis/1.0 (university-research-prototype)' }, signal: AbortSignal.timeout(6000) });
    if (!response.ok) return { verified: false, message: 'The DOI could not be confirmed by Crossref.' };
    const work = (await response.json())?.message;
    if (!work?.DOI) return { verified: false, message: 'Crossref did not return a matching citation record.' };
    node.verification = 'Verified against Crossref';
    return { verified: true, doi: work.DOI, title: work.title?.[0] || node.title, publisher: work.publisher || 'Publisher unavailable', year: work.published?.['date-parts']?.[0]?.[0] || null, message: 'DOI confirmed against Crossref.' };
  } catch {
    return { verified: false, message: 'Citation verification is temporarily unavailable; the DOI remains unverified.' };
  }
}

async function serveStatic(request, response, pathname) {
  const requested = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const target = resolve(PUBLIC_DIR, normalize(requested));
  if (!target.startsWith(resolve(PUBLIC_DIR))) return json(response, 403, { error: 'That path is outside Graphis.' });
  try {
    const content = await readFile(target);
    setSecurityHeaders(response);
    response.writeHead(200, { 'Content-Type': MIME_TYPES[extname(target)] || 'application/octet-stream', 'Cache-Control': extname(target) === '.html' ? 'no-cache' : 'public, max-age=3600' });
    response.end(content);
  } catch { json(response, 404, { error: 'That part of Graphis was not found.' }); }
}

export function createApp() {
  return http.createServer(async (request, response) => {
    const requestUrl = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
    if (isRateLimited(request)) return json(response, 429, { error: 'Please pause for a moment before making more graph requests.' });
    try {
      if (request.method === 'GET' && requestUrl.pathname === '/api/health') return json(response, 200, { status: 'ok', service: 'graphis', vertexConfigured: Boolean(process.env.VERTEX_AI_PROJECT || process.env.GOOGLE_CLOUD_PROJECT), timestamp: new Date().toISOString() });
      if (request.method === 'GET' && requestUrl.pathname === '/api/graph') return json(response, 200, graph);
      if (request.method === 'POST' && requestUrl.pathname === '/api/ingest') {
        const payload = await readJson(request);
        const ingested = await ingestDocuments(payload.documents);
        return json(response, 201, { ingested: ingested.length, graph });
      }
      if (request.method === 'POST' && requestUrl.pathname === '/api/ai/synthesize') {
        const payload = await readJson(request);
        if (payload.mode !== 'bridge') return json(response, 400, { error: 'Graphis only supports a bridge synthesis right now.' });
        return json(response, 200, await vertexBridge(localBridge()));
      }
      if (request.method === 'POST' && requestUrl.pathname === '/api/verify-citation') {
        const payload = await readJson(request);
        return json(response, 200, await verifyCitation(payload.nodeId));
      }
      if (requestUrl.pathname.startsWith('/api/')) return json(response, 404, { error: 'Graphis could not find that API route.' });
      if (request.method !== 'GET' && request.method !== 'HEAD') return json(response, 405, { error: 'That action is not supported.' });
      return serveStatic(request, response, requestUrl.pathname);
    } catch (error) {
      return json(response, error.status || 500, { error: error.status ? error.message : 'Graphis encountered an unexpected error.' });
    }
  });
}

export function startServer(port = Number(process.env.PORT) || 8080) {
  const server = createApp();
  return new Promise((resolveServer) => server.listen(port, '0.0.0.0', () => resolveServer(server)));
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  startServer().then((server) => {
    const address = server.address();
    console.log(`Graphis is listening on port ${address.port}`);
  });
}
