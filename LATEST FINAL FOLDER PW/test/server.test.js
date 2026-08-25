import test from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from '../server.js';

let server;
let baseUrl;

test.before(async () => {
  server = await startServer(0);
  const address = server.address();
  baseUrl = `http://127.0.0.1:${address.port}`;
});

test.after(() => new Promise((resolve) => server.close(resolve)));

test('health endpoint announces a ready Graphis service', async () => {
  const response = await fetch(`${baseUrl}/api/health`);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).status, 'ok');
  assert.match(response.headers.get('content-security-policy'), /default-src 'self'/);
});

test('ingestion makes a Markdown research signal queryable', async () => {
  const content = Buffer.from('# Privacy aware mobility analysis\nWe use machine learning with transit data and health surveys. DOI: 10.5555/graphis.test').toString('base64');
  const response = await fetch(`${baseUrl}/api/ingest`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ documents: [{ name: 'research-note.md', content }] }) });
  const payload = await response.json();
  assert.equal(response.status, 201);
  assert.equal(payload.ingested, 1);
  assert.ok(payload.graph.nodes.some((node) => node.title.includes('Privacy Aware Mobility Analysis')));
  assert.ok(payload.graph.edges.some((edge) => edge.relation === 'extracted relationship'));
  assert.equal(payload.graph.nodes.find((node) => node.title.includes('Privacy Aware Mobility Analysis')).doi, '10.5555/graphis.test');
});

test('unsafe file extensions are rejected', async () => {
  const content = Buffer.from('not research').toString('base64');
  const response = await fetch(`${baseUrl}/api/ingest`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ documents: [{ name: 'unsafe.exe', content }] }) });
  assert.equal(response.status, 415);
});

test('static route rejects traversal requests', async () => {
  const response = await fetch(`${baseUrl}/..%2fserver.js`);
  assert.notEqual(response.status, 200);
});
