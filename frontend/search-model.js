import { SearchApiError } from './api.js';

// External EKT detail URLs are deliberately not used by the browser.
export function safeEktUrl(value) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && ['ekt.kz', 'www.ekt.kz'].includes(url.hostname) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

export function parseSearchResponse(data) {
  const invalid = () => { throw new SearchApiError('invalid_response', 'Ответ поиска не соответствует согласованному формату.'); };
  if (!data || !Array.isArray(data.items) || !Number.isSafeInteger(data.count) || data.count < 0 || data.count !== data.items.length || typeof data.query !== 'string' || typeof data.match_type !== 'string' || data.source !== 'sqlite' || typeof data.catalog_complete !== 'boolean') invalid();
  const ids = new Set();
  const items = data.items.map(item => {
    if (!item || !Number.isSafeInteger(item.id) || typeof item.name !== 'string' || typeof item.article !== 'string' || ids.has(item.id)) invalid();
    ids.add(item.id);
    return {
      id: item.id, name: item.name, article: item.article,
      price: (typeof item.price === 'number' && Number.isFinite(item.price)) || typeof item.price === 'string' ? item.price : null,
      image: safeEktUrl(item.image), url: safeEktUrl(item.url)
    };
  });
  return { items, count: data.count, query: data.query, matchType: data.match_type, complete: data.catalog_complete, syncedAt: typeof data.synced_at === 'string' && Number.isFinite(Date.parse(data.synced_at)) ? data.synced_at : null };
}

export function priceLabel(price) {
  if (typeof price === 'number' && Number.isFinite(price)) return new Intl.NumberFormat('ru-RU').format(price);
  return typeof price === 'string' && price.trim() ? price.trim() : 'Цена уточняется';
}
export function sortedSearchItems(items, sort) {
  const numeric = p => typeof p.price === 'number' ? (Number.isFinite(p.price) ? p.price : null) : typeof p.price === 'string' && /^\d+(\.\d+)?$/.test(p.price.trim()) ? Number(p.price) : null;
  return [...items].sort((a, b) => {
    if (sort === 'name') return a.name.localeCompare(b.name, 'ru');
    if (sort !== 'price-asc' && sort !== 'price-desc') return 0;
    const pa = numeric(a), pb = numeric(b);
    if (pa === null) return pb === null ? 0 : 1;
    if (pb === null) return -1;
    return sort === 'price-asc' ? pa - pb : pb - pa;
  });
}

// Generation checks prevent older requests (even uncooperative transports)
// from replacing newer results or reappearing after switching to demo mode.
export function createSearchController({ request, publish, delay = 350 }) {
  let generation = 0, timer, controller;
  function cancel() { generation++; clearTimeout(timer); controller?.abort(); }
  function search(query, immediate = false) {
    cancel();
    const current = generation;
    query = query.trim();
    if (!query) { publish({ phase: 'idle' }); return; }
    if ([...query].length > 200) { publish({ phase: 'error', message: 'Запрос должен содержать не больше 200 символов.', retry: false }); return; }
    publish({ phase: 'loading' });
    const run = async () => {
      controller = new AbortController();
      try {
        const data = parseSearchResponse(await request(query, { signal: controller.signal }));
        if (generation === current) publish({ phase: 'success', data });
      } catch (error) {
        if (generation === current && error.code !== 'cancelled') publish({ phase: 'error', message: error.message || 'Не удалось выполнить поиск.', retry: error.status !== 422 });
      }
    };
    if (immediate) return run();
    timer = setTimeout(run, delay);
  }
  return { search, cancel };
}
