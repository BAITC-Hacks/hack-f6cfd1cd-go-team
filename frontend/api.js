// GET search contract agreed with the backend team. No EKT credentials here.
export class SearchApiError extends Error {
  constructor(code, message, status = null) {
    super(message);
    this.name = 'SearchApiError';
    this.code = code;
    this.status = status;
  }
}

export async function fetchProductSearch(query, {
  baseUrl = 'http://127.0.0.1:8000',
  signal,
  timeoutMs = 10000,
  fetchImpl = globalThis.fetch
} = {}) {
  if (typeof query !== 'string' || !query.trim()) {
    throw new SearchApiError('empty_query', 'Введите название или артикул товара.');
  }
  if ([...query.trim()].length > 200) {
    throw new SearchApiError('invalid_query', 'Запрос должен содержать не больше 200 символов.');
  }
  const url = new URL('/api/products/search', baseUrl);
  url.searchParams.set('q', query.trim());
  const controller = new AbortController();
  let timedOut = false;
  const cancel = () => controller.abort();
  if (signal?.aborted) cancel();
  else signal?.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      credentials: 'omit',
      signal: controller.signal
    });
    if (!response.ok) {
      const message = response.status === 503
        ? 'Каталог пока недоступен или ещё не синхронизирован. Попробуйте позже.'
        : response.status === 422
          ? 'Проверьте запрос: от 1 до 200 символов без пробелов по краям.'
          : `Поиск недоступен (HTTP ${response.status}). Попробуйте ещё раз.`;
      throw new SearchApiError('http', message, response.status);
    }
    try { return await response.json(); }
    catch (error) {
      if (controller.signal.aborted) throw error;
      throw new SearchApiError('invalid_json', 'Backend вернул ответ, который не удалось прочитать как JSON.');
    }
  } catch (error) {
    if (signal?.aborted) throw new SearchApiError('cancelled', 'Поиск отменён.');
    if (timedOut) throw new SearchApiError('timeout', 'Backend не ответил вовремя. Попробуйте ещё раз.');
    if (error instanceof SearchApiError) throw error;
    throw new SearchApiError('network', 'Нет связи с backend. Проверьте его запуск и настройки CORS.');
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', cancel);
  }
}
