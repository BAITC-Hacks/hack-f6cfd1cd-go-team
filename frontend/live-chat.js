import { createChatSession } from './chat-api.js';
import { priceLabel } from './search-model.js';

const $ = s => document.querySelector(s);
function el(tag, className, text) { const node = document.createElement(tag); node.className = className; if (text !== undefined) node.textContent = text; return node; }
export function initLiveChat({ openChat, scrollChat, message }) {
  const session = createChatSession(); let generation = 0;
  const input = $('#chat-input'), submit = $('#chat-form button'), log = $('#messages');
  input.maxLength = 2000;
  $('.chat-disclaimer').textContent = 'Данные каталога · без оформления заказа';
  $('.chat-safety').textContent = 'Чат консультирует по каталогу. Корзина пока не подключена.';
  $('#chat-city').textContent = 'Остатки из каталога, без привязки к выбранному городу';
  const badge = $('.demo-badge'); badge.textContent = 'Чат';
  $('.ai-badge').textContent = 'Чат';
  const modeNote = el('p', 'chat-mode-note', 'Для точной проверки укажите артикул в сообщении.');
  $('.chat-context').after(modeNote);
  const newChat = el('button', 'new-chat-button', 'Новый диалог'); newChat.type = 'button';
  $('.chat-bottom').prepend(newChat);
  const greeting = () => {
    log.replaceChildren();
    message('Помогу найти товар и проверить данные каталога. Начните с артикула, например: «Есть ли 200300285_ в наличии?»');
    const quick = el('button', 'chat-example-button', 'Проверить 200300285_');
    quick.type = 'button'; quick.addEventListener('click', () => send('Есть ли товар 200300285_ в наличии и сколько он стоит?')); log.append(quick);
  };
  greeting();
  function reset() { generation++; session.reset(); submit.disabled = false; input.value = ''; input.style.height = ''; badge.textContent = 'Чат'; modeNote.textContent = 'Начат новый диалог. Укажите артикул товара.'; greeting(); }
  newChat.addEventListener('click', reset);
  function productCard(p) {
    const card = el('div', 'chat-product'); const top = el('div', 'chat-product-top');
    if (p.image) { const img = el('img', ''); img.src = p.image; img.alt = p.name; top.append(img); }
    const copy = el('div', ''); copy.append(el('strong', '', p.name), el('small', '', `Артикул: ${p.article || 'нет данных'}`), el('span', 'chat-price', priceLabel(p.price)));
    top.append(copy); card.append(top);
    const qty = p.quantity === null || p.quantity === '' ? 'нет данных' : String(p.quantity);
    card.append(el('p', 'chat-stock', p.source === 'ekt_detail' ? `Количество по данным EKT: ${qty}` : 'Наличие: нет актуальных данных'));
    card.append(el('small', '', p.source === 'ekt_detail' ? 'Источник: карточка EKT. Количество не привязано к выбранному городу.' : 'Источник: локальный каталог. Цена и наличие требуют уточнения.'));
    if (p.url) { const link = el('a', 'live-product-link', 'Открыть на сайте EKT ↗'); link.href = p.url; link.target = '_blank'; link.rel = 'noopener noreferrer'; card.append(link); }
    log.append(card);
  }
  async function send(text) {
    if (session.busy || !text.trim()) return;
    if ([...text].length > 2000) { message('Введите не больше 2000 символов.'); return; }
    const turn = generation; openChat(false); message(text.trim(), 'user');
    input.value = ''; input.style.height = ''; submit.disabled = true;
    const pending = el('div', 'typing', 'Проверяю каталог…'); log.append(pending); scrollChat();
    const slow = setTimeout(() => { pending.textContent = 'Сервер ещё работает. Ответ может занять до 150 секунд…'; scrollChat(); }, 15000);
    try {
      const result = await session.send(text);
      if (turn !== generation) return;
      // Both backend modes share the same presentation and session lifecycle.
      badge.textContent = 'Чат';
      modeNote.textContent = 'Для точной проверки укажите артикул в сообщении.';
      message(result.message); result.products.forEach(productCard);
    } catch (error) {
      if (turn !== generation || error.code === 'cancelled') return;
      const bubble = message(error.message); bubble.classList.add('chat-error');
      if (error.code === 'session_not_found') {
        const restart = el('button', 'chat-retry', 'Начать новый диалог'); restart.type = 'button'; restart.addEventListener('click', reset); bubble.append(restart);
      } else {
        const retry = el('button', 'chat-retry', 'Вернуть вопрос в поле ввода'); retry.type = 'button';
        retry.addEventListener('click', () => { if (!input.value) { input.value = text; input.focus(); } else message('Сохраните текущий черновик перед повтором предыдущего вопроса.'); }); bubble.append(retry);
      }
    } finally {
      clearTimeout(slow); pending.remove();
      if (turn === generation) { submit.disabled = false; scrollChat(); }
    }
  }
  return { send };
}
