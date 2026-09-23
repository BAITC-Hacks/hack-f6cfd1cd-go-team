import { safeEktUrl } from './search-model.js';

export class ChatApiError extends Error {
  constructor(code, message, status = null) { super(message); this.name = 'ChatApiError'; this.code = code; this.status = status; }
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function parseChatResponse(data) {
  const invalid = () => { throw new ChatApiError('invalid_response', 'Не удалось прочитать ответ чата. Попробуйте уточнить запрос.'); };
  if (!data || typeof data.session_id !== 'string' || !uuid.test(data.session_id) || typeof data.message !== 'string' || !data.message.trim() || !Array.isArray(data.products) || !['openai', 'fallback'].includes(data.mode)) invalid();
  const tools = data.tools_used ?? [];
  if (!Array.isArray(tools) || !tools.every(t => typeof t === 'string')) invalid();
  const ids = new Set();
  const products = data.products.map(p => {
    if (!p || !Number.isSafeInteger(p.id) || ids.has(p.id) || !['sqlite', 'ekt_detail'].includes(p.source)) invalid();
    ids.add(p.id);
    return {
      id: p.id, name: typeof p.name === 'string' ? p.name : 'Название не предоставлено', article: typeof p.article === 'string' ? p.article : null,
      price: typeof p.price === 'string' || (typeof p.price === 'number' && Number.isFinite(p.price)) ? p.price : null,
      quantity: typeof p.quantity === 'string' || (typeof p.quantity === 'number' && Number.isFinite(p.quantity)) ? p.quantity : null,
      image: safeEktUrl(p.image), url: safeEktUrl(p.url), source: p.source
    };
  });
  const rawAnalogs = data.analogs ?? [];
  if (!Array.isArray(rawAnalogs)) invalid();
  const analogs = rawAnalogs.map(a => {
    if (!a || !Number.isSafeInteger(a.source_product_id) || !a.product || !Number.isSafeInteger(a.product.id) || typeof a.explanation !== 'string' || typeof a.disclaimer !== 'string') invalid();
    const p = a.product;
    return { sourceProductId: a.source_product_id, product: {
      id: p.id, name: typeof p.name === 'string' ? p.name : 'Название не предоставлено',
      article: typeof p.article === 'string' ? p.article : null,
      price: typeof p.price === 'string' || (typeof p.price === 'number' && Number.isFinite(p.price)) ? p.price : null,
      quantity: typeof a.quantity === 'number' && Number.isFinite(a.quantity) ? a.quantity : null,
      image: safeEktUrl(p.image), url: safeEktUrl(p.url), source: 'ekt_detail'
    }, explanation: a.explanation, disclaimer: a.disclaimer };
  });
  const validCartItem = item => item && Number.isSafeInteger(item.product_id) && typeof item.article === 'string' && Number.isSafeInteger(item.quantity) && item.quantity > 0;
  const pendingConfirmation = data.pending_confirmation ?? null;
  if (pendingConfirmation !== null && !validCartItem(pendingConfirmation)) invalid();
  const cart = data.cart ?? null;
  if (cart !== null && (cart.type !== 'demo_session' || !Array.isArray(cart.items) || !cart.items.every(item => validCartItem(item) && typeof item.name === 'string'))) invalid();
  return { sessionId: data.session_id, message: data.message, products, tools, mode: data.mode, analogs, pendingConfirmation, cart };
}
const errorMessages = {
  session_not_found: 'Диалог истёк или сервер перезапущен. Начните новый диалог.',
  session_busy: 'Предыдущий ответ ещё обрабатывается сервером. Дождитесь его завершения.',
  chat_busy: 'Сервер чата занят. Попробуйте позже.',
  chat_timeout: 'Сервер не успел завершить ответ. Попробуйте позже или уточните запрос.',
  openai_timeout: 'Сервис не успел завершить ответ. Попробуйте позже.',
  openai_rate_limit: 'Лимит сервиса исчерпан. Повторите запрос позже.',
  invalid_tool_call: 'Не удалось получить данные. Уточните запрос или артикул.',
  tool_limit: 'Запрос слишком сложный. Уточните один товар за раз.',
  incomplete_response: 'Сервер не завершил ответ. Попробуйте уточнить запрос.',
  empty_response: 'Сервер вернул пустой ответ. Попробуйте уточнить запрос.',
  tool_output_too_large: 'Слишком большой ответ каталога. Укажите конкретный артикул.'
};
export async function fetchChat(message, { sessionId = null, signal, fetchImpl = globalThis.fetch, baseUrl = 'http://127.0.0.1:8000', timeoutMs = 160000 } = {}) {
  if (typeof message !== 'string' || !message.trim() || [...message].length > 2000) throw new ChatApiError('validation', 'Введите сообщение от 1 до 2000 символов.');
  if (sessionId !== null && (typeof sessionId !== 'string' || !uuid.test(sessionId))) throw new ChatApiError('validation', 'Некорректный ID диалога. Начните новый диалог.');
  const controller = new AbortController(); let timeout = false;
  const cancel = () => controller.abort();
  if (signal?.aborted) cancel(); else signal?.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(() => { timeout = true; controller.abort(); }, timeoutMs);
  try {
    const response = await fetchImpl(new URL('/api/chat', baseUrl), { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, credentials: 'omit', signal: controller.signal, body: JSON.stringify({ message: message.trim(), session_id: sessionId }) });
    let data;
    try { data = await response.json(); } catch (error) { if (controller.signal.aborted) throw error; }
    if (!response.ok) {
      const code = typeof data?.error?.code === 'string' ? data.error.code : 'http';
      const text = response.status === 422 ? 'Проверьте сообщение: от 1 до 2000 символов. При ошибке сессии начните новый диалог.'
        : code === 'catalog_error' && typeof data.error.message === 'string' ? data.error.message
        : errorMessages[code] || `Чат недоступен (HTTP ${response.status}). Попробуйте позже.`;
      throw new ChatApiError(code, text, response.status);
    }
    return parseChatResponse(data);
  } catch (error) {
    if (signal?.aborted) throw new ChatApiError('cancelled', 'Запрос отменён.');
    if (timeout) throw new ChatApiError('timeout', 'Время ожидания истекло. Сервер ещё может обрабатывать запрос; автоматического повтора не будет.');
    if (error instanceof ChatApiError) throw error;
    throw new ChatApiError('network', 'Нет связи с чатом. Проверьте запуск backend и CORS для POST.');
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', cancel); }
}

export function createChatSession(request = fetchChat) {
  let sessionId = null, generation = 0, controller, busy = false;
  return {
    get busy() { return busy; },
    reset() { generation++; controller?.abort(); sessionId = null; busy = false; },
    async send(message) {
      if (busy) throw new ChatApiError('session_busy', errorMessages.session_busy, 409);
      const turn = generation; busy = true; controller = new AbortController();
      try {
        const data = await request(message, { sessionId, signal: controller.signal });
        if (generation !== turn) throw new ChatApiError('cancelled', 'Запрос отменён.');
        sessionId = data.sessionId;
        return data;
      } catch (error) {
        if (generation === turn && error.code === 'session_not_found') sessionId = null;
        throw error;
      } finally { if (generation === turn) busy = false; }
    }
  };
}
