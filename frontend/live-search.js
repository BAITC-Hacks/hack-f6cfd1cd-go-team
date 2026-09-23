import { fetchProductSearch } from './api.js';
import { createSearchController, priceLabel, sortedSearchItems } from './search-model.js';

const $ = selector => document.querySelector(selector);
function element(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}
function image(product) {
  if (!product.image) return element('span', 'image-fallback', 'Фото не предоставлено');
  const img = element('img'); img.src = product.image; img.alt = product.name; img.loading = 'lazy';
  return img;
}
function siteLink(product) {
  if (!product.url) return element('span', 'stock-note', 'Ссылка на товар не предоставлена');
  const link = element('a', 'live-product-link', 'На сайте EKT ↗');
  link.href = product.url; link.target = '_blank'; link.rel = 'noopener noreferrer';
  return link;
}
function showDetail(product) {
  const layout = element('div', 'detail-grid'); layout.append(image(product));
  const copy = element('div');
  copy.append(element('span', 'eyebrow muted', `Артикул ${product.article}`), element('h2', '', product.name), element('p', 'price', priceLabel(product.price)), element('p', 'stock-note', 'Цена из локального каталога. Валюта и единица продажи в ответе не указаны.'), element('p', 'stock unknown', 'Наличие уточняется'), element('p', 'dialog-note', 'Характеристики и сертификаты поиск пока не возвращает. Добавление реальных товаров в корзину ещё не подключено.'), siteLink(product));
  layout.append(copy); $('#product-detail').replaceChildren(layout); $('#product-dialog').showModal();
}
function card(product) {
  const article = element('article', 'product-card live-product');
  const visual = element('button', 'product-visual'); visual.type = 'button'; visual.setAttribute('aria-label', `Подробнее: ${product.name}`); visual.append(image(product)); visual.addEventListener('click', () => showDetail(product));
  const title = element('button', 'product-title', product.name); title.type = 'button'; title.addEventListener('click', () => showDetail(product));
  const bottom = element('div', 'product-bottom'); bottom.append(element('span', 'price', priceLabel(product.price)));
  article.append(visual, element('div', 'product-meta', `Арт. ${product.article}`), title, element('span', 'stock unknown', 'Наличие уточняется'), bottom, siteLink(product));
  return article;
}

export function initLiveSearch(onModeChange) {
  let active = true, state = { phase: 'idle' };
  const controls = element('div', 'catalog-source');
  const liveButton = element('button', '', 'Поиск в каталоге EKT');
  const demoButton = element('button', '', 'Демо-подборка');
  liveButton.type = demoButton.type = 'button'; controls.append(liveButton, demoButton);
  $('.section-heading').after(controls);
  const status = element('p', 'search-status'); status.setAttribute('role', 'status');
  const note = element('p', 'search-data-note', 'Поиск по названию и артикулу. Наличие, характеристики и корзина пока не подключены.');
  $('.results-toolbar').after(status, note);
  const controller = createSearchController({ request: fetchProductSearch, publish: next => { state = next; render(); } });

  function mode(next) {
    active = next; controller.cancel();
    if (active) controller.search($('#search').value, true);
    onModeChange();
  }
  liveButton.addEventListener('click', () => mode(true)); demoButton.addEventListener('click', () => mode(false));

  function render() {
    liveButton.setAttribute('aria-pressed', String(active)); demoButton.setAttribute('aria-pressed', String(!active));
    document.querySelectorAll('[data-category], [data-brand], #in-stock, #reset-filters').forEach(el => { el.disabled = active; el.title = active ? 'Доступно в демо-подборке: поиск пока не возвращает эти поля' : ''; });
    $('#filters').classList.toggle('live-filters', active);
    $('#product-grid').setAttribute('aria-busy', String(active && state.phase === 'loading'));
    note.hidden = !active;
    if (!active) { status.textContent = 'Демонстрационные товары и остатки. Поиск выполняется в этой подборке.'; return false; }
    $('#results-caption').textContent = 'Результаты backend';
    $('#result-count').textContent = '';
    const grid = $('#product-grid'); grid.replaceChildren();
    status.textContent = '';
    const empty = (title, text) => {
      const box = element('div', 'empty-state'); box.append(element('h3', '', title), element('p', '', text)); grid.append(box); return box;
    };
    if (state.phase === 'idle') empty('Найдите товар в каталоге EKT', 'Введите название или артикул в строке поиска. Например: Legrand или 200300285_.');
    if (state.phase === 'loading') { status.textContent = 'Ищем товары…'; empty('Ищем в каталоге', 'Ожидаем ответ backend.'); }
    if (state.phase === 'error') {
      status.textContent = state.message;
      const box = empty('Поиск недоступен', state.message);
      if (state.retry) { const retry = element('button', '', 'Повторить поиск'); retry.type = 'button'; retry.addEventListener('click', () => controller.search($('#search').value, true)); box.append(retry); }
    }
    if (state.phase === 'success') {
      const { data } = state;
      $('#result-count').textContent = data.count;
      const date = data.syncedAt ? new Date(data.syncedAt).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' }) : 'не указана';
      status.textContent = `${data.matchType === 'exact_article' ? 'Точный артикул. ' : ''}Получено: ${data.count}. Обновление каталога: ${date} (местное время).${data.complete ? '' : ' Каталог загружен частично — результаты могут быть неполными.'}`;
      if (!data.items.length) empty('Ничего не найдено', data.complete ? 'Попробуйте другое название или артикул.' : 'Каталог загружен частично. Товар может появиться после синхронизации.');
      else grid.append(...sortedSearchItems(data.items, $('#sort').value).map(card));
    }
    return true;
  }
  return { get active() { return active; }, render, search: immediate => controller.search($('#search').value, immediate), setDemo: () => mode(false) };
}
