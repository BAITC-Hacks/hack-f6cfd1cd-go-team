import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchProductSearch } from '../api.js';

test('Search uses the confirmed route, encodes q and does not assume an envelope', async () => {
  // Arbitrary test value is NOT a proposed backend schema.
  const payload = { arbitraryTestEnvelope: [1, 2] };
  const result = await fetchProductSearch(' Legrand & реле ', { fetchImpl: async (url, options) => {
    assert.equal(url.origin, 'http://127.0.0.1:8000');
    assert.equal(url.pathname, '/api/products/search');
    assert.equal(url.searchParams.get('q'), 'Legrand & реле');
    assert.equal(options.method, 'GET');
    assert.equal(options.credentials, 'omit');
    assert.equal(options.headers.Authorization, undefined);
    return { ok: true, json: async () => payload };
  } });
  assert.equal(result, payload);
});
test('Empty query does not issue a request', async () => {
  await assert.rejects(fetchProductSearch('  ', { fetchImpl: () => assert.fail('Unexpected request') }), { code: 'empty_query' });
});
test('Queries over 200 characters do not issue a request', async () => {
  await assert.rejects(fetchProductSearch('x'.repeat(201), { fetchImpl: () => assert.fail('Unexpected request') }), { code: 'invalid_query' });
});
test('422 receives a validation message and 503 a catalog availability message', async () => {
  for (const status of [422, 503]) await assert.rejects(fetchProductSearch('test', { fetchImpl: async () => ({ ok: false, status }) }), error => error.status === status && error.message.includes(status === 422 ? '200 символов' : 'синхронизирован'));
});
test('HTTP failure is not interpreted as an empty result', async () => {
  await assert.rejects(fetchProductSearch('test', { fetchImpl: async () => ({ ok: false, status: 503 }) }), { code: 'http', status: 503 });
});
test('Invalid JSON and network errors are distinguishable', async () => {
  await assert.rejects(fetchProductSearch('test', { fetchImpl: async () => ({ ok: true, json: async () => { throw new SyntaxError(); } }) }), { code: 'invalid_json' });
  await assert.rejects(fetchProductSearch('test', { fetchImpl: async () => { throw new TypeError('Failed to fetch'); } }), { code: 'network' });
});
const abortableFetch = async (_url, { signal }) => new Promise((resolve, reject) => {
  if (signal.aborted) reject(new Error('Aborted'));
  else signal.addEventListener('abort', () => reject(new Error('Aborted')), { once: true });
});
test('Timeout and caller cancellation are distinguishable', async () => {
  await assert.rejects(fetchProductSearch('test', { timeoutMs: 5, fetchImpl: abortableFetch }), { code: 'timeout' });
  const controller = new AbortController();
  const promise = fetchProductSearch('test', { signal: controller.signal, fetchImpl: abortableFetch });
  controller.abort();
  await assert.rejects(promise, { code: 'cancelled' });
});
