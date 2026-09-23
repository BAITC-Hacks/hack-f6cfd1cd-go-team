import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSearchResponse, safeEktUrl, priceLabel, sortedSearchItems, createSearchController } from '../search-model.js';
const response = (query = '200300285_') => ({ query, match_type: 'exact_article', count: 1, items: [{ id: 515291, name: '027228 АВ DRX250 MT 3ф 160А 18ka Legrand (1)', article: '200300285_', price: 64920, image: 'https://ekt.kz/upload/test.jpg', url: 'https://ekt.kz/catalog/test/', url_api_detail: 'https://ekt.kz/api/products/detail?id=515291' }], source: 'sqlite', synced_at: '2026-09-23T10:16:14.709488+00:00', pages_scanned: 0, catalog_complete: true });
test('Agreed successful envelope preserves IDs and does not synthesize stock or detail data', () => {
  const data = parseSearchResponse(response());
  assert.equal(data.count, 1); assert.equal(data.items[0].price, 64920);
  assert.equal(data.matchType, 'exact_article'); assert.equal(data.complete, true);
  for (const key of ['quantity', 'stocks', 'specs', 'url_api_detail']) assert.equal(key in data.items[0], false);
});
test('Empty and partial catalog results are distinguished from errors', () => {
  const data = parseSearchResponse({ ...response(), count: 0, items: [], catalog_complete: false });
  assert.deepEqual(data.items, []); assert.equal(data.complete, false);
  assert.throws(() => parseSearchResponse({ detail: 'unavailable' }), { code: 'invalid_response' });
});
test('Null price and image remain unknown; zero and string prices are preserved', () => {
  const data = response(); data.items[0].price = null; data.items[0].image = null; data.items[0].url = null;
  const item = parseSearchResponse(data).items[0];
  assert.equal(item.price, null); assert.equal(item.image, null); assert.equal(item.url, null);
  assert.equal(priceLabel(null), 'Цена уточняется'); assert.equal(priceLabel(0), '0');
  data.items[0].price = '64920.00'; assert.equal(parseSearchResponse(data).items[0].price, '64920.00');
});
test('Only safe EKT links survive; text values are preserved for textContent rendering', () => {
  for (const url of ['javascript:alert(1)', 'data:text/html,test', 'https://evil.example/x', 'https://ekt.kz.evil.example/x', 'https://user:secret@ekt.kz/x', null]) assert.equal(safeEktUrl(url), null);
  const data = response(); data.items[0].name = '<img src=x onerror=alert(1)>';
  assert.equal(parseSearchResponse(data).items[0].name, data.items[0].name);
});
test('Unknown prices sort last in both directions without mutating relevance order', () => {
  const items = [{price: null}, {price:'20.00'}, {price:0}, {price:100}];
  assert.deepEqual(sortedSearchItems(items, 'price-desc').map(p=>p.price), [100,'20.00',0,null]);
  assert.deepEqual(sortedSearchItems(items, 'price-asc').map(p=>p.price), [0,'20.00',100,null]);
  assert.deepEqual(sortedSearchItems(items, 'recommended'), items);
});
test('Late response cannot replace a newer query', async () => {
  const waits = [], updates = [];
  const controller = createSearchController({request: q => new Promise(resolve=>waits.push({q,resolve})), publish: s=>updates.push(s)});
  const first = controller.search('old', true), second = controller.search('new', true);
  waits[1].resolve(response('new')); await second; waits[0].resolve(response('old')); await first;
  assert.deepEqual(updates.filter(s=>s.phase==='success').map(s=>s.data.query), ['new']);
});
test('Clearing or leaving live search cancels pending results; excessive input makes no request', async () => {
  let resolve, calls = 0; const updates = [];
  const controller = createSearchController({request: () => { calls++; return new Promise(r=>resolve=r); }, publish: s=>updates.push(s)});
  const pending = controller.search('old', true); controller.search(''); resolve(response()); await pending;
  assert.equal(updates.at(-1).phase, 'idle');
  controller.search('x'.repeat(201), true); assert.equal(updates.at(-1).phase, 'error'); assert.equal(calls, 1);
});
