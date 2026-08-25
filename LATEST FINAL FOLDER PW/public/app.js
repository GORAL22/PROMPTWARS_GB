const IS_STATIC_HOST = window.location.protocol === 'file:' || window.location.hostname.endsWith('.github.io');
const state = {
  graph: { nodes: [], edges: [], trails: [] },
  activeId: null,
  filter: 'all',
  query: '',
  listMode: false,
  saved: new Set(),
};

const $ = (selector) => document.querySelector(selector);
const graphStage = $('#graphStage');
const emptyState = $('#emptyState');
const nodeInspector = $('#nodeInspector');
const discoveryCard = $('#discoveryCard');
const toast = $('#toast');
let toastTimer;

const browserSignals = [
  { terms: ['graph neural network', 'gnn', 'knowledge graph', 'node embedding'], target: 'method-gnn', tags: ['method', 'GNN', 'networks'], lenses: ['ai', 'data'] },
  { terms: ['machine learning', 'deep learning', 'neural network', 'classification', 'prediction model'], target: 'paper-ai', tags: ['method', 'machine learning'], lenses: ['ai', 'data'] },
  { terms: ['privacy', 'anonym', 'differential privacy', 'federated'], target: 'method-privacy', tags: ['privacy', 'ethics', 'method'], lenses: ['ai', 'data'] },
  { terms: ['mixed method', 'interview', 'qualitative', 'survey', 'participatory'], target: 'method-mixed', tags: ['method', 'qualitative', 'quantitative'], lenses: ['health', 'data'] },
  { terms: ['climate', 'heat', 'temperature', 'rainfall', 'weather', 'microclimate'], target: 'data-climate', tags: ['dataset', 'climate', 'sensors'], lenses: ['climate', 'data'] },
  { terms: ['health', 'patient', 'disease', 'clinical', 'wellbeing', 'mental health'], target: 'paper-health', tags: ['dataset', 'health', 'consent'], lenses: ['health', 'data'] },
  { terms: ['mobility', 'transport', 'transit', 'walkability', 'traffic', 'commute'], target: 'data-mobility', tags: ['dataset', 'mobility', 'civic'], lenses: ['climate', 'data'] },
  { terms: ['sustainability', 'water', 'waste', 'energy', 'resilience', 'biodiversity'], target: 'paper-water', tags: ['sustainability', 'cities'], lenses: ['climate', 'data'] },
];

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 3000);
}

async function api(path, options = {}) {
  if (IS_STATIC_HOST) throw new Error('This GitHub Pages edition keeps the research graph in your browser.');
  const response = await fetch(path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || 'The constellation did not respond.');
  return payload;
}

function nodeById(id) { return state.graph.nodes.find((node) => node.id === id); }

function localBridge() {
  const paper = state.graph.nodes.find((node) => node.id === 'paper-health') || state.graph.nodes.find((node) => node.type === 'paper');
  const data = state.graph.nodes.find((node) => node.id === 'data-mobility') || state.graph.nodes.find((node) => node.type === 'data');
  const method = state.graph.nodes.find((node) => node.id === 'method-gnn') || state.graph.nodes.find((node) => node.type === 'method');
  const nodes = [paper, data, method].filter(Boolean);
  return { title: 'A climate-health collaboration is hiding in plain sight.', text: `${paper?.title || 'A research paper'} and ${method?.title || 'a shared method'} both touch ${data?.title || 'a common data signal'}. A joint question could test whether neighbourhood access patterns improve how heat-related wellbeing risks are understood.`, path: nodes.map((node) => node.title), nodeIds: nodes.map((node) => node.id), provider: 'browser' };
}

function browserTitle(filename, text) {
  const heading = text.match(/^\s*#\s+(.{5,100})$/m)?.[1];
  const raw = heading || filename.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ');
  return raw.trim().replace(/\b\w/g, (character) => character.toUpperCase()).slice(0, 100);
}

function scoreFrom(value) {
  let hash = 0;
  for (const character of value) hash = ((hash << 5) - hash) + character.charCodeAt(0);
  return Math.abs(hash);
}

function similarity(left, right) {
  const a = new Set(left); const b = new Set(right); let shared = 0;
  for (const item of a) if (b.has(item)) shared += 1;
  return shared / Math.max(1, new Set([...a, ...b]).size);
}

async function readableBrowserFile(file) {
  if (file.size === 0 || file.size > 250 * 1024) throw new Error(`${file.name} must be between 1 byte and 250 KB.`);
  const extension = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
  const allowed = ['.pdf', '.md', '.markdown', '.txt', '.csv', '.js', '.ts', '.py', '.r', '.ipynb', '.java'];
  if (!allowed.includes(extension)) throw new Error(`${file.name} is not a supported research file.`);
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (extension === '.pdf') {
    if (new TextDecoder('ascii').decode(bytes.slice(0, 5)) !== '%PDF-') throw new Error(`${file.name} is not a valid PDF.`);
    const source = new TextDecoder('latin1').decode(bytes);
    const extracted = [...source.matchAll(/\(([^()]{4,500})\)/g)].map((match) => match[1].replace(/\\[()]/g, ' ').replace(/\\n/g, ' ')).join(' ');
    if (extracted.trim().length < 12) throw new Error(`${file.name} is image-only. For the free website version, upload its Markdown or text export.`);
    return extracted.replace(/\s+/g, ' ').trim();
  }
  return new TextDecoder().decode(bytes).replace(/\s+/g, ' ').trim();
}

async function ingestInBrowser(files) {
  if (files.length > 20) throw new Error('Choose at most 20 files at a time.');
  const added = [];
  for (const [index, file] of files.entries()) {
    const text = await readableBrowserFile(file);
    if (text.length < 12) throw new Error(`${file.name} has no readable research text.`);
    const matches = browserSignals.filter((signal) => signal.terms.some((term) => text.toLowerCase().includes(term)));
    const tags = [...new Set(matches.flatMap((signal) => signal.tags))].slice(0, 4);
    const lenses = [...new Set(matches.flatMap((signal) => signal.lenses))];
    const id = `browser-${Date.now()}-${index}-${scoreFrom(file.name).toString(36)}`;
    const checksum = scoreFrom(`${file.name}${text.slice(0, 120)}`);
    const doi = text.match(/\b10\.\d{4,9}\/[\w.()/:;-]+\b/i)?.[0]?.replace(/[.,;]+$/, '').toLowerCase() || null;
    const node = { id, type: 'paper', symbol: '↗', title: browserTitle(file.name, text), kicker: 'Browser-only research material', summary: `${file.name} was woven privately in this browser from ${matches.length || 'no'} recognised cross-disciplinary signal${matches.length === 1 ? '' : 's'}.`, tags: tags.length ? tags : ['new material', file.name.split('.').pop().toLowerCase()], lenses: lenses.length ? lenses : ['data'], score: (0.7 + (checksum % 23) / 100).toFixed(2), x: 18 + (checksum % 64), y: 18 + (scoreFrom(id) % 64), doi, verification: doi ? 'DOI candidate found — open to verify' : 'No DOI candidate in this file' };
    state.graph.nodes.push(node);
    matches.forEach((signal) => state.graph.edges.push({ source: id, target: signal.target, relation: 'browser-extracted relationship' }));
    const similar = state.graph.nodes.filter((candidate) => candidate.type === 'paper' && candidate.id !== id).map((candidate) => ({ candidate, overlap: similarity(node.tags, candidate.tags || []) })).filter(({ overlap }) => overlap >= .2).sort((a, b) => b.overlap - a.overlap)[0];
    if (similar) state.graph.edges.push({ source: id, target: similar.candidate.id, relation: 'possible thematic overlap' });
    state.graph.trails.unshift({ category: similar?.overlap >= .5 ? 'POSSIBLE DUPLICATION' : 'NEW SIGNAL', title: similar?.overlap >= .5 ? `${node.title} overlaps with ${similar.candidate.title}.` : `${node.title} introduced a new research signal.`, nodeId: id });
    added.push(node);
  }
  state.graph.trails = state.graph.trails.slice(0, 8);
  return { ingested: added.length, graph: state.graph };
}
function nodesForFilter() {
  const query = state.query.trim().toLowerCase();
  return new Set(state.graph.nodes.filter((node) => {
    const filterOk = state.filter === 'all' || node.lenses?.includes(state.filter);
    const searchable = `${node.title} ${node.summary} ${(node.tags || []).join(' ')}`.toLowerCase();
    return filterOk && (!query || searchable.includes(query));
  }).map((node) => node.id));
}

function renderGraph() {
  const visible = nodesForFilter();
  const stageRect = graphStage.getBoundingClientRect();
  const width = Math.max(stageRect.width, 320);
  const height = Math.max(stageRect.height, 380);
  graphStage.replaceChildren();

  if (state.listMode) {
    const list = document.createElement('div');
    list.className = 'graph-list';
    list.style.cssText = 'height:100%;overflow:auto;padding:18px;display:grid;gap:7px';
    state.graph.nodes.filter((node) => visible.has(node.id)).forEach((node) => {
      const button = document.createElement('button');
      button.className = 'list-node';
      button.style.cssText = 'border:1px solid rgba(255,255,255,.18);background:rgba(255,255,255,.04);color:white;text-align:left;padding:12px;display:flex;justify-content:space-between;gap:8px;font-size:.7rem';
      button.innerHTML = `<span><small style="display:block;color:#b5c9c4;font: .52rem var(--mono);margin-bottom:4px">${escapeHtml(node.type.toUpperCase())}</small>${escapeHtml(node.title)}</span><b style="color:#d7f33c">↗</b>`;
      button.addEventListener('click', () => selectNode(node.id));
      list.append(button);
    });
    graphStage.append(list);
    return;
  }

  const namespace = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(namespace, 'svg');
  svg.setAttribute('aria-hidden', 'true');
  const positions = new Map(state.graph.nodes.map((node) => [node.id, {
    x: (node.x / 100) * width,
    y: (node.y / 100) * height,
  }]));
  const connectedIds = new Set();
  if (state.activeId) {
    state.graph.edges.forEach((edge) => {
      if (edge.source === state.activeId) connectedIds.add(edge.target);
      if (edge.target === state.activeId) connectedIds.add(edge.source);
    });
  }
  state.graph.edges.forEach((edge) => {
    const origin = positions.get(edge.source);
    const target = positions.get(edge.target);
    if (!origin || !target) return;
    const line = document.createElementNS(namespace, 'line');
    line.setAttribute('x1', origin.x); line.setAttribute('y1', origin.y);
    line.setAttribute('x2', target.x); line.setAttribute('y2', target.y);
    line.classList.add('edge');
    const highlighted = state.activeId && (edge.source === state.activeId || edge.target === state.activeId);
    if (highlighted) line.classList.add('highlight');
    else if (state.activeId || !visible.has(edge.source) || !visible.has(edge.target)) line.classList.add('dim');
    svg.append(line);
  });
  graphStage.append(svg);

  state.graph.nodes.forEach((node) => {
    const position = positions.get(node.id);
    const star = document.createElement('button');
    star.type = 'button';
    star.className = `star ${node.type}`;
    star.dataset.nodeId = node.id;
    star.style.left = `${position.x}px`;
    star.style.top = `${position.y}px`;
    star.setAttribute('aria-label', `${node.title}, ${node.type}`);
    star.setAttribute('aria-pressed', String(state.activeId === node.id));
    if (!visible.has(node.id)) star.classList.add('dim');
    if (state.activeId === node.id) star.classList.add('selected');
    if (state.activeId && connectedIds.has(node.id)) star.classList.add('connected');
    star.innerHTML = `<span class="star-core"><span class="symbol">${node.symbol || '·'}</span></span><span class="star-label">${escapeHtml(shorten(node.title, 20))}</span>`;
    star.addEventListener('click', () => selectNode(node.id));
    graphStage.append(star);
  });
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]));
}
function shorten(value, max) { return value.length > max ? `${value.slice(0, max - 1)}…` : value; }

function selectNode(id) {
  const node = nodeById(id);
  if (!node) return;
  state.activeId = id;
  emptyState.classList.add('hidden');
  discoveryCard.classList.add('hidden');
  nodeInspector.classList.remove('hidden');
  $('#detailType').textContent = node.type.toUpperCase();
  $('#detailKicker').textContent = node.kicker || 'CHRIST research mesh';
  $('#detailTitle').textContent = node.title;
  $('#detailSummary').textContent = node.summary;
  $('#detailScore').textContent = String(node.score || '0.80');
  const relationCount = state.graph.edges.filter((edge) => edge.source === id || edge.target === id).length;
  $('#detailConnections').textContent = `${String(relationCount).padStart(2, '0')} nodes`;
  $('#detailTags').replaceChildren(...(node.tags || []).map((tag) => {
    const item = document.createElement('span'); item.className = 'tag'; item.textContent = tag; return item;
  }));
  $('#saveButton').textContent = state.saved.has(id) ? '✓ Saved to trail' : '✦ Save to trail';
  $('#citeButton').textContent = node.doi ? 'Verify DOI' : 'Copy citation';
  renderGraph();
}

function closeInspector() {
  state.activeId = null;
  nodeInspector.classList.add('hidden');
  discoveryCard.classList.add('hidden');
  emptyState.classList.remove('hidden');
  renderGraph();
}

function renderTrails() {
  const container = $('#trailList');
  container.replaceChildren(...state.graph.trails.map((trail, index) => {
    const button = document.createElement('button');
    button.className = 'trail-item';
    button.innerHTML = `<span><small>TRAIL ${String(index + 1).padStart(2, '0')} · ${escapeHtml(trail.category)}</small><strong>${escapeHtml(trail.title)}</strong></span><b>↗</b>`;
    button.addEventListener('click', () => {
      const target = state.graph.nodes.find((node) => node.id === trail.nodeId) || state.graph.nodes[0];
      if (target) selectNode(target.id);
      $('#constellation').scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    return button;
  }));
}

function setFilter(filter, trigger) {
  state.filter = filter;
  document.querySelectorAll('.filter').forEach((button) => button.classList.toggle('active', button === trigger));
  renderGraph();
}

async function revealBridge() {
  try {
    const result = IS_STATIC_HOST ? localBridge() : await api('/api/ai/synthesize', { method: 'POST', body: JSON.stringify({ mode: 'bridge' }) });
    emptyState.classList.add('hidden'); nodeInspector.classList.add('hidden'); discoveryCard.classList.remove('hidden');
    $('#bridgeTitle').textContent = result.title;
    $('#bridgeText').textContent = result.text;
    const path = $('#bridgePath'); path.replaceChildren();
    result.path.forEach((piece, index) => {
      const tag = document.createElement('span'); tag.textContent = piece; path.append(tag);
      if (index < result.path.length - 1) { const arrow = document.createElement('i'); arrow.textContent = '→'; path.append(arrow); }
    });
    state.graph.nodes.forEach((node) => {
      const isPath = result.nodeIds.includes(node.id);
      document.querySelector(`[data-node-id="${node.id}"]`)?.classList.toggle('match', isPath);
    });
    showToast(result.provider === 'vertex' ? 'Vertex AI found a fresh research bridge.' : 'Bridge found in your private browser map.');
  } catch (error) { showToast(error.message); }
}

async function filesToPayload(files) {
  return Promise.all(files.map(async (file) => {
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = '';
    const chunk = 0x8000;
    for (let index = 0; index < bytes.length; index += chunk) binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
    return { name: file.name, type: file.type, content: btoa(binary) };
  }));
}

async function ingestSelectedFiles(event) {
  event.preventDefault();
  const files = [...$('#fileInput').files];
  if (!files.length) { showToast('Choose at least one research file first.'); return; }
  const submit = $('#ingestSubmit'); submit.disabled = true; submit.querySelector('span').textContent = 'Reading research material…';
  try {
    const result = IS_STATIC_HOST
      ? await ingestInBrowser(files)
      : await api('/api/ingest', { method: 'POST', body: JSON.stringify({ documents: await filesToPayload(files) }) });
    state.graph = result.graph;
    $('#nodeCount').textContent = `${state.graph.nodes.length} nodes`;
    $('#graphState').textContent = 'WEAVED';
    renderGraph(); renderTrails();
    $('#ingestDialog').close();
    $('#fileInput').value = ''; $('#fileStatus').textContent = 'Nothing selected yet.';
    showToast(`${result.ingested} signal${result.ingested === 1 ? '' : 's'} joined the constellation${IS_STATIC_HOST ? ' privately' : ''}.`);
  } catch (error) { showToast(error.message); }
  finally { submit.disabled = false; submit.querySelector('span').textContent = 'Weave into Graphis'; }
}

async function copyOrVerifyCitation() {
  const node = nodeById(state.activeId);
  if (!node) return;
  if (node.doi) {
    if (IS_STATIC_HOST) {
      window.open(`https://doi.org/${encodeURIComponent(node.doi)}`, '_blank', 'noopener');
      showToast('Opening the DOI record in a new tab.');
      return;
    }
    try {
      const result = await api('/api/verify-citation', { method: 'POST', body: JSON.stringify({ nodeId: node.id }) });
      showToast(result.message);
      if (result.verified) { node.verification = 'Verified against Crossref'; $('#detailKicker').textContent = `✓ ${node.verification}`; }
    } catch (error) { showToast(error.message); }
    return;
  }
  const citation = `${node.kicker || 'Graphis Research Mesh'}. (${new Date().getFullYear()}). ${node.title}.`;
  navigator.clipboard?.writeText(citation).then(() => showToast('Citation copied to your clipboard.')).catch(() => showToast('Copy is not available in this browser.'));
}

function bindEvents() {
  $('#discoverButton').addEventListener('click', revealBridge);
  $('#bridgeButton').addEventListener('click', revealBridge);
  $('#exploreBridge').addEventListener('click', () => { const node = nodeById('paper-health'); if (node) selectNode(node.id); });
  $('#uploadButton').addEventListener('click', () => $('#ingestDialog').showModal());
  $('#helpButton').addEventListener('click', () => $('#helpDialog').showModal());
  $('#ingestForm').addEventListener('submit', ingestSelectedFiles);
  $('#fileInput').addEventListener('change', (event) => {
    const files = [...event.target.files];
    const total = files.reduce((sum, file) => sum + file.size, 0);
    $('#fileStatus').textContent = files.length ? `${files.length} file${files.length === 1 ? '' : 's'} selected · ${(total / 1024).toFixed(1)} KB` : 'Nothing selected yet.';
  });
  $('#searchInput').addEventListener('input', (event) => { state.query = event.target.value; renderGraph(); });
  document.querySelectorAll('.filter').forEach((button) => button.addEventListener('click', () => setFilter(button.dataset.filter, button)));
  document.querySelectorAll('.view-button').forEach((button) => button.addEventListener('click', () => {
    state.listMode = button.textContent === 'List';
    document.querySelectorAll('.view-button').forEach((item) => { const active = item === button; item.classList.toggle('active', active); item.setAttribute('aria-pressed', String(active)); });
    renderGraph();
  }));
  $('#closeInspector').addEventListener('click', closeInspector);
  $('#saveButton').addEventListener('click', () => { if (state.activeId) state.saved.add(state.activeId); $('#saveButton').textContent = '✓ Saved to trail'; showToast('Added to your open research trail.'); });
  $('#citeButton').addEventListener('click', copyOrVerifyCitation);
  window.addEventListener('resize', () => { if (!state.listMode) renderGraph(); });
}

async function init() {
  bindEvents();
  try {
    state.graph = IS_STATIC_HOST ? structuredClone(globalThis.GRAPHIS_DEMO_GRAPH) : await api('/api/graph');
    $('#nodeCount').textContent = `${state.graph.nodes.length} nodes`;
    renderGraph(); renderTrails();
  } catch (error) {
    if (globalThis.GRAPHIS_DEMO_GRAPH) {
      state.graph = structuredClone(globalThis.GRAPHIS_DEMO_GRAPH);
      $('#nodeCount').textContent = `${state.graph.nodes.length} nodes`;
      renderGraph(); renderTrails();
      showToast('Loaded the browser-only Graphis edition.');
    } else {
      graphStage.textContent = 'Graphis could not load its research mesh.';
      showToast(error.message);
    }
  }
}

init();
