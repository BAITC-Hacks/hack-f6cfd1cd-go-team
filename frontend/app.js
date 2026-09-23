import { products, categories } from './catalog.js';
import { money, normalize, searchProducts, available, addToCart, isExplicitConfirmation, restoreCart } from './domain.js';
import { initLiveSearch } from './live-search.js';

const $ = selector => document.querySelector(selector);
const cities = ['Алматы', 'Астана', 'Шымкент'];
const paths = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  bolt: '<path d="m13 2-9 12h7l-1 8 10-13h-8z"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  heart: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"/>',
  cart: '<path d="M2 3h3l3 13h11l3-9H6"/><circle cx="9" cy="21" r="1"/><circle cx="18" cy="21" r="1"/>',
  pin: '<path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/>',
  sparkles: '<path d="m12 3 2.6 6.4L21 12l-6.4 2.6L12 21l-2.6-6.4L3 12l6.4-2.6Z"/><path d="m20 2 .6 1.4L22 4l-1.4.6L20 6l-.6-1.4L18 4l1.4-.6Z"/>',
  'arrow-up-right': '<path d="M6 18 18 6M6 6h12v12"/>',
  'arrow-up': '<path d="M12 19V5m-6 6 6-6 6 6"/>',
  'check-circle': '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
  warehouse: '<path d="M3 21V8l9-5 9 5v13M1 21h22M7 21V11h10v10M7 15h10M7 18h10"/>',
  shield: '<path d="m12 2 8 4v6c0 5-8 10-8 10S4 17 4 12V6Z"/><path d="m8 12 3 3 5-6"/>',
  bulb: '<path d="M9 18h6m-5 3h4M8 14a7 7 0 1 1 8 0c-1 1-1 2-1 2H9s0-1-1-2Z"/>',
  box: '<path d="m12 2 9 5v10l-9 5-9-5V7Zm0 10 9-5M12 12 3 7m9 5v10M7 4.8l9 5"/>',
  sliders: '<path d="M4 4v5m0 5v6M12 4v9m0 5v2M20 4v2m0 5v9M1 9h6m2 9h6m2-12h6"/>',
  headphones: '<path d="M3 14v-3a9 9 0 0 1 18 0v7c0 3-3 3-6 3"/><rect x="3" y="11" width="4" height="8" rx="2"/><rect x="17" y="11" width="4" height="8" rx="2"/>',
  repeat: '<path d="m17 2 4 4-4 4M3 11V8a2 2 0 0 1 2-2h16M7 22l-4-4 4-4m14-1v3a2 2 0 0 1-2 2H3"/>',
  truck: '<path d="M1 4h13v13H1Zm13 5h5l4 5v3h-9"/><circle cx="5" cy="19" r="2"/><circle cx="18" cy="19" r="2"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/>'
};
const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.box}</svg>`;
document.querySelectorAll('[data-icon]').forEach(el => el.innerHTML = icon(el.dataset.icon));

const storage = { get(key) { try { return localStorage.getItem(key); } catch { return null; } }, set(key, value) { try { localStorage.setItem(key, value); } catch { /* Browser can deny storage. The demo still works in memory. */ } } };
let city = cities.includes(storage.get('ekt-city')) ? storage.get('ekt-city') : 'Алматы';
let cart = restoreCart(storage.get('ekt-cart'), products, cities);
let favorites;
try { favorites = new Set(JSON.parse(storage.get('ekt-favorites') || '[]').filter(id => products.some(p => p.id === id))); } catch { favorites = new Set(); }
let category = 'all', brandFilters = new Set(), favoritesOnly = false, pending = null, currentProduct = null, busy = false;
let proposalSerial = 0, toastTimer;
const byId = id => products.find(p => p.id === Number(id));
const liveSearch = initLiveSearch(() => { renderCategories(); renderProducts(); renderCounters(); });
$('#favorites-button').setAttribute('aria-label', 'Избранное демо-подборки');
$('#cart-button').setAttribute('aria-label', 'Демонстрационная корзина');
$('.chat-disclaimer').textContent = 'Демо-чат · не использует результаты поиска API';
$('.welcome p').textContent = 'Это демонстрационный диалог по 8 тестовым позициям. Поиск по настоящему каталогу работает в строке поиска магазина.';

function toast(text) { $('#toast').textContent = text; $('#toast').classList.add('visible'); clearTimeout(toastTimer); toastTimer = setTimeout(() => $('#toast').classList.remove('visible'), 3600); }
function saveCart() { storage.set('ekt-cart', JSON.stringify(cart)); renderCounters(); renderProducts(); if ($('#cart-dialog').open) renderCart(); }
function renderCounters() {
  const total = cart.reduce((sum, i) => sum + i.quantity, 0);
  $('#cart-count').textContent = total; $('#cart-count').hidden = !total;
  $('#favorite-count').textContent = favorites.size; $('#favorite-count').hidden = !favorites.size;
  $('#favorites-button').setAttribute('aria-pressed', String(favoritesOnly));
}
function renderCategories() {
  $('#categories').innerHTML = categories.map(c => `<button class="category ${category === c.id ? 'active' : ''}" data-category="${c.id}" aria-pressed="${category === c.id}">${icon(c.icon)}<span>${c.name}</span><span class="category-count">${c.id === 'all' ? products.length : products.filter(p => p.category === c.id).length}</span></button>`).join('');
}
$('#brands').innerHTML = ['Legrand', 'Megalight', 'Schneider Electric', 'Другие'].map(b => `<label class="check-row"><input type="checkbox" data-brand="${b}"><span>${b}</span></label>`).join('');
function renderProducts() {
  if (liveSearch.render()) return;
  let list = searchProducts(products, $('#search').value).filter(p => (category === 'all' || p.category === category) && (!brandFilters.size || brandFilters.has(p.brand)) && (!$('#in-stock').checked || available(p, city) > 0) && (!favoritesOnly || favorites.has(p.id)));
  if ($('#sort').value === 'price-asc') list.sort((a, b) => a.price - b.price);
  if ($('#sort').value === 'price-desc') list.sort((a, b) => b.price - a.price);
  if ($('#sort').value === 'name') list.sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  $('#result-count').textContent = list.length;
  $('#results-caption').textContent = favoritesOnly ? 'Ваше избранное' : $('#search').value ? `Поиск: «${$('#search').value}»` : 'Для вашего проекта';
  $('#product-grid').innerHTML = list.length ? list.map(p => {
    const stock = available(p, city), selected = favorites.has(p.id);
    return `<article class="product-card">${p.tag ? `<span class="product-tag ${!stock ? 'unavailable' : ''}">${stock ? p.tag === 'Под заказ' ? 'В наличии' : p.tag : 'Нет в этом городе'}</span>` : ''}<button class="favorite ${selected ? 'selected' : ''}" data-favorite="${p.id}" aria-label="${selected ? 'Убрать из избранного' : 'В избранное'}: ${p.name}" aria-pressed="${selected}">${icon('heart')}</button><button class="product-visual" data-detail="${p.id}" aria-label="Подробнее: ${p.name}"><img src="${p.image}" alt="${p.name}" loading="lazy"></button><div class="product-meta"><span class="brand">${p.brand}</span><span>Арт. ${p.vendor || p.article}</span></div><button class="product-title" data-detail="${p.id}">${p.name}</button><p class="product-subtitle">${p.subtitle}</p><span class="stock ${!stock ? 'empty' : ''}">${stock ? `В наличии · ${stock} шт.` : 'Нет в наличии'}${!p.verified ? ' · демо' : ''}</span><div class="product-bottom"><span class="price">${money(p.price)} <small>/ шт.</small></span><button class="add-button" ${stock ? `data-add="${p.id}" aria-label="Добавить в корзину: ${p.name}"` : `data-ask="${p.id}" aria-label="Найти аналог: ${p.name}"`}>${icon(stock ? 'cart' : 'repeat')}</button></div></article>`;
  }).join('') : `<div class="empty-state">${icon('search')}<h3>${favoritesOnly ? 'Здесь пока пусто' : 'Товары не найдены'}</h3><p>${favoritesOnly ? 'Нажмите на сердечко у понравившегося товара.' : 'Попробуйте другой запрос или сбросьте фильтры.'}</p><button id="empty-reset">Показать все товары</button></div>`;
}
function resetFilters() { category = 'all'; brandFilters.clear(); favoritesOnly = false; $('#search').value = ''; $('#in-stock').checked = false; $('#sort').value = 'recommended'; document.querySelectorAll('[data-brand]').forEach(el => el.checked = false); if (liveSearch.active) liveSearch.search(true); renderCategories(); renderProducts(); renderCounters(); }
function addProduct(p, qty = 1, targetCity = city) { const result = addToCart(cart, p, targetCity, qty); if (result.error) { toast(result.error); return false; } cart = result.cart; saveCart(); toast(`Добавлено в корзину: ${qty} шт.`); return true; }
function openCart() { renderCart(); if (!$('#cart-dialog').open) $('#cart-dialog').showModal(); if (location.hash !== '#cart') history.pushState(null, '', '#cart'); }
function renderCart() {
  $('#drawer-count').textContent = cart.reduce((sum, i) => sum + i.quantity, 0);
  $('#cart-items').innerHTML = cart.length ? cart.map(i => { const p = byId(i.id); return `<article class="cart-item"><img src="${p.image}" alt="${p.name}"><div class="cart-item-copy"><h3>${p.name}</h3><p>${p.vendor || p.article} · ${i.city}</p><div class="cart-item-bottom"><div class="quantity-control"><button data-cart-change="-1" data-id="${p.id}" data-city="${i.city}" aria-label="Уменьшить количество">−</button><span>${i.quantity}</span><button data-cart-change="1" data-id="${p.id}" data-city="${i.city}" aria-label="Увеличить количество" ${available(p, i.city, cart) < 1 ? 'disabled' : ''}>+</button></div><strong>${money(p.price * i.quantity)}</strong></div></div><button class="icon-button remove-item" data-remove="${p.id}" data-city="${i.city}" aria-label="Удалить ${p.name}">${icon('trash')}</button></article>`; }).join('') : `<div class="empty-state">${icon('cart')}<h3>Начнём ваш проект?</h3><p>Добавьте товары из каталога<br>или попросите ассистента помочь.</p><button data-close="cart-dialog">Перейти к покупкам</button></div>`;
  $('#cart-summary').innerHTML = cart.length ? `<div class="summary-line"><span>Итого</span><span>${money(cart.reduce((sum, i) => sum + byId(i.id).price * i.quantity, 0))}</span></div><button class="full-button" id="export-cart">Скачать список товаров</button>` : '';
}
function detail(p) {
  currentProduct = p;
  $('#product-detail').innerHTML = `<div class="detail-grid"><img src="${p.image}" alt="${p.name}"><div><span class="eyebrow muted">${p.brand} · ${p.vendor || p.article}</span><h2>${p.name}</h2><p class="product-subtitle">${p.subtitle}</p><dl>${p.specs.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>${p.conflict ? '<p class="warning">В источнике есть расхождение: в названии и описании — 160 А, в поле характеристик — 250 А. Уточните номинал перед выбором.</p>' : ''}<span class="stock ${available(p, city) ? '' : 'empty'}">${city}: ${available(p, city)} шт.</span><div class="price">${money(p.price)}</div><p class="stock-note">${p.verified ? 'Снимок API от 23.09.2026. Остатки не обновляются онлайн.' : 'Демонстрационные остатки. Цена из снимка каталога.'}</p><div class="detail-actions"><button data-add="${p.id}" ${!available(p, city, cart) ? 'disabled' : ''}>Добавить в корзину</button><button data-discuss="${p.id}">Спросить о товаре</button></div><p class="stock-note">Сертификат не загружен в демонстрационную выборку.</p></div></div>`;
  $('#product-dialog').showModal();
}
const info = {
  delivery: ['Доставка и оплата', '<p>Условия зависят от города, состава заказа и способа получения. В демонстрации стоимость и сроки доставки не рассчитываются.</p><p>Актуальные условия уточните на <a href="https://ekt.kz/" target="_blank" rel="noopener noreferrer">сайте Электрокомплект</a> или по телефону <a href="tel:+77273468888">+7 (727) 346-88-88</a>.</p>'],
  demo: ['О демонстрации', '<p>Это прототип для HackAlem AI, а не действующий интернет-магазин. Чат работает по демонстрационным сценариям без подключения языковой модели.</p><p>Названия, изображения и цены — снимок API EKT от 23 сентября 2026 года. Остатки товара 027228 взяты из API; у остальных товаров — тестовые значения. Валюта отображается как тенге для демонстрации.</p><p>Корзина и избранное хранятся только в этом браузере. Заказы и платежи не отправляются. На следующем этапе интерфейс подключается к бэкенду команды.</p>']
};
function openInfo(type) {
  $('#info-title').textContent = info[type][0]; $('#info-body').innerHTML = info[type][1];
  if (type === 'demo') {
    const searchNote = document.createElement('p');
    searchNote.textContent = 'Режим «Поиск в каталоге EKT» обращается к локальному backend и показывает данные SQLite без тестовых остатков. Чат, избранное и корзина работают только с демо-подборкой. Внешний EKT API напрямую из браузера не вызывается.';
    $('#info-body').prepend(searchNote);
  }
  $('#info-dialog').showModal();
}
function openChat(focus = true) { $('#assistant').classList.add('mobile-open'); $('#chat-launch').classList.add('hidden'); if (focus) $('#chat-input').focus({ preventScroll: true }); }
function scrollChat() { $('#messages').scrollTop = $('#messages').scrollHeight; }
function message(text, who = 'assistant') { const el = document.createElement('div'); el.className = `${who}-message`; el.textContent = text; $('#messages').append(el); scrollChat(); return el; }
function chatProduct(p) {
  const el = document.createElement('div'); el.className = 'chat-product';
  el.innerHTML = `<div class="chat-product-top"><img src="${p.image}" alt="${p.name}"><div><strong>${p.name}</strong><small>${p.vendor || p.article} · ${city} · ${available(p, city)} шт.</small><span class="chat-price">${money(p.price)}</span></div></div><button data-propose="${p.id}">${available(p, city, cart) ? 'Выбрать и указать количество' : 'Посмотреть характеристики'}</button>`;
  $('#messages').append(el); scrollChat();
}
function cancelProposal(reason) {
  if (!pending) return;
  const el = document.getElementById(`proposal-${pending.token}`);
  if (el) { el.className = 'confirmation-done'; el.textContent = reason || 'Предложение отменено'; }
  pending = null;
}
function propose(p, quantity = 1) {
  cancelProposal('Предложение заменено новым');
  const remaining = available(p, city, cart);
  if (!remaining) { message(`Для города ${city} нельзя добавить эту позицию: свободный остаток — 0. Можно посмотреть характеристики или выбрать другой товар.`); return; }
  if (!Number.isSafeInteger(quantity) || quantity < 1) { message('Укажите целое количество от 1.'); return; }
  if (quantity > remaining) { message(`Вы запросили ${quantity} шт., но для города ${city} можно добавить ещё ${remaining} шт. Укажите меньшее количество — я подготовлю новое предложение.`); currentProduct = p; return; }
  pending = { token: ++proposalSerial, id: p.id, city, quantity };
  const el = document.createElement('div'); el.className = 'chat-proposal'; el.id = `proposal-${pending.token}`;
  el.innerHTML = `<strong>Добавить в корзину?</strong><span>${p.name} · ${p.vendor || p.article}</span><div>${quantity} шт. × ${money(p.price)} · ${city}</div>${p.conflict ? '<p class="warning">В каталоге расходятся номиналы 160 / 250 А. Подбор по току требует уточнения.</p>' : ''}<div class="proposal-total">Итого ${money(p.price * quantity)}</div><div class="proposal-actions"><button data-confirm="${pending.token}">Да, добавить ${quantity} шт.</button><button data-cancel="${pending.token}">Отмена</button></div>`;
  $('#messages').append(el); currentProduct = p; scrollChat();
}
function confirmProposal(token) {
  if (!pending || pending.token !== Number(token)) return;
  const proposal = pending;
  const result = addToCart(cart, byId(proposal.id), proposal.city, proposal.quantity);
  if (result.error) { cancelProposal('Предложение недоступно'); message(result.error + ' Укажите новое количество.'); return; }
  cart = result.cart; cancelProposal('✓ Добавлено в корзину'); saveCart();
  const el = message(`Готово! Добавлено ${proposal.quantity} шт. Список товаров можно проверить в корзине.`);
  const link = document.createElement('a'); link.href = '#cart'; link.className = 'chat-cart-link'; link.textContent = 'Перейти в корзину →'; link.addEventListener('click', e => { e.preventDefault(); openCart(); }); el.append(link); scrollChat();
}
function answer(raw) {
  const text = normalize(raw);
  if (isExplicitConfirmation(raw)) { if (pending) confirmProposal(pending.token); else message('Сначала выберите товар и количество. Я покажу предложение, которое можно подтвердить.'); return; }
  if (/^(нет|отмена|не надо|не добавляй|не добавлять)[.!\s]*$/.test(text)) { cancelProposal(); message('Хорошо, ничего не добавляю. Продолжим подбор?'); return; }
  // Any new intent invalidates an old proposal; a later "yes" cannot confirm an outdated choice.
  cancelProposal('Предложение отменено после нового сообщения');
  if (/(достав|оплат|минимальн)/.test(text)) { message(`Для города ${city} сроки и стоимость доставки нужно уточнить у менеджера. В демо эти условия не загружены. Актуальная информация доступна на ekt.kz или по телефону +7 (727) 346-88-88. Платёжные данные в чат отправлять не нужно.`); return; }
  if (/(спасибо|благодарю)/.test(text)) { message('Пожалуйста! Если понадобится ещё что-то для проекта — напишите.'); return; }
  const match = products.find(p => [p.article, p.vendor].filter(Boolean).some(a => text.includes(normalize(a))));
  const qtyMatch = text.match(/(?:^|\s)(-?\d+(?:[.,]\d+)?)\s*(?:шт(?:ук[аи]?)?\.?|штук|единиц)/) || (!match && text.match(/(?:добавь(?:те)?|добавить|возьм[еу]|нужно|нужны)\s+(-?\d+(?:[.,]\d+)?)(?=\s|$)/));
  const quantity = qtyMatch ? Number(qtyMatch[1].replace(',', '.')) : 1;
  if (/(аналог|замен)/.test(text)) {
    const p = match || currentProduct;
    if (!p) { message('Напишите артикул товара, для которого нужна замена. Например: «Нужен аналог 027230».'); return; }
    if (p.category === 'breakers') {
      message('Для замены нужно сопоставить номинальный ток, число полюсов, отключающую способность и монтаж. У 027228 в каталоге есть расхождение 160 / 250 А; у 027230 указано 25 кА вместо 18 кА. Я не могу подтвердить их взаимозаменяемость. Покажу кандидата для проверки специалистом.');
      chatProduct(byId(p.id === 515291 ? 515288 : 515291)); return;
    }
    message('В демонстрационной выборке нет подтверждённого аналога этой позиции. Уточните требования к характеристикам у менеджера.'); return;
  }
  if (/сертификат/.test(text)) { message('В загруженной выборке сертификат не предоставлен. Я не буду подставлять неподтверждённую ссылку. Запросите документ у менеджера по артикулу товара.'); return; }
  if (/(добав|возьм|купить|нужно\s+\d|нужны\s+\d)/.test(text) && !/(не\s+добав|без\s+добав)/.test(text) && (match || currentProduct)) { propose(match || currentProduct, quantity); return; }
  if (qtyMatch && currentProduct && !match) { propose(currentProduct, quantity); return; }
  if (match) {
    currentProduct = match;
    message(`${match.name}, артикул ${match.vendor || match.article}.\n${city}: ${available(match, city)} шт. Цена из снимка каталога: ${money(match.price)}.${match.conflict ? '\nВнимание: в названии и описании указан ток 160 А, а в характеристиках — 250 А. Номинал требует уточнения.' : ''}\n${match.verified ? 'Это снимок остатков от 23.09.2026, не онлайн-проверка.' : 'Остатки этой позиции демонстрационные.'}`);
    chatProduct(match); return;
  }
  let group = /автомат|выключател/.test(text) ? 'breakers' : /ламп|свет/.test(text) ? 'lighting' : /короб|монтаж/.test(text) ? 'installation' : /реле|автоматизац/.test(text) ? 'automation' : null;
  let matches = group ? products.filter(p => p.category === group) : searchProducts(products, text);
  if (matches.length) { currentProduct = null; message(group === 'breakers' ? 'Какой номинальный ток и число полюсов нужны? Вот несколько позиций из каталога. Укажите артикул и количество — подготовлю предложение.' : 'Вот подходящие позиции из демонстрационной выборки. Выберите товар или напишите его артикул и количество.'); matches.slice(0, 2).forEach(chatProduct); return; }
  if (/налич/.test(text)) { message('Напишите артикул, например 027228. Покажу остаток для выбранного города.'); return; }
  message('В демо я могу найти товар по артикулу, показать автоматы, лампы, коробки и реле, объяснить наличие и подготовить корзину. Попробуйте «Есть 027228?» или «Подбери лампу».');
}
async function send(text) {
  if (busy || !text.trim()) return;
  openChat(false); message(text.trim(), 'user'); $('#quick-actions')?.remove();
  $('#chat-input').value = ''; $('#chat-input').style.height = '';
  busy = true; $('#chat-form button').disabled = true;
  const typing = document.createElement('div'); typing.className = 'typing'; typing.textContent = 'Смотрю в каталоге…'; $('#messages').append(typing); scrollChat();
  await new Promise(resolve => setTimeout(resolve, 430)); typing.remove();
  try { answer(text); } catch { message('Не удалось обработать запрос. Попробуйте ещё раз.'); }
  finally { busy = false; $('#chat-form button').disabled = false; scrollChat(); }
}

document.addEventListener('click', e => {
  const button = e.target.closest('button'); if (!button) return;
  const d = button.dataset;
  if (d.category) { category = d.category; favoritesOnly = false; renderCategories(); renderProducts(); renderCounters(); $('#catalog').scrollIntoView({ behavior: 'smooth' }); }
  if (d.favorite) { const id = Number(d.favorite); favorites.has(id) ? favorites.delete(id) : favorites.add(id); storage.set('ekt-favorites', JSON.stringify([...favorites])); renderProducts(); renderCounters(); }
  if (d.detail) detail(byId(d.detail));
  if (d.add) addProduct(byId(d.add));
  if (d.ask) send(`Нужен аналог ${byId(d.ask).vendor || byId(d.ask).article}`);
  if (d.discuss) { $('#product-dialog').close(); send(`Расскажи о ${byId(d.discuss).vendor || byId(d.discuss).article}`); }
  if (d.prompt) send(d.prompt);
  if (d.propose) { const p = byId(d.propose); cancelProposal('Предложение отменено: выбран другой товар'); if (available(p, city, cart)) { currentProduct = p; message(`Выбран ${p.vendor || p.article}. Сколько штук нужно? Напишите, например, «2 шт.».`); $('#chat-input').focus(); } else detail(p); }
  if (d.confirm) confirmProposal(d.confirm);
  if (d.cancel && pending?.token === Number(d.cancel)) { cancelProposal(); message('Предложение отменено. Корзина не изменилась.'); }
  if (d.close) document.getElementById(d.close).close();
  if (d.info) openInfo(d.info);
  if (d.remove) { cart = cart.filter(i => !(i.id === Number(d.remove) && i.city === d.city)); saveCart(); }
  if (d.cartChange) { const item = cart.find(i => i.id === Number(d.id) && i.city === d.city); if (!item) return; if (d.cartChange === '1') addProduct(byId(item.id), 1, item.city); else { item.quantity--; if (!item.quantity) cart = cart.filter(i => i !== item); saveCart(); } }
  if (button.id === 'empty-reset') resetFilters();
  if (button.id === 'export-cart') {
    const lines = ['Демонстрационная корзина EKT — заказ не оформлен', '', ...cart.map(i => `${byId(i.id).name} | ${byId(i.id).article} | ${i.city} | ${i.quantity} шт. | ${money(byId(i.id).price * i.quantity)}`), '', `Итого: ${money(cart.reduce((s, i) => s + byId(i.id).price * i.quantity, 0))}`];
    const url = URL.createObjectURL(new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/plain;charset=utf-8' })); const link = document.createElement('a'); link.href = url; link.download = 'ekt-cart.txt'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
});
$('#city').value = city;
$('#chat-city').textContent = `Подбираем товары: ${city}`;
$('#city').addEventListener('change', () => { city = $('#city').value; storage.set('ekt-city', city); $('#chat-city').textContent = `Подбираем товары: ${city}`; cancelProposal('Предложение отменено: город изменился'); renderProducts(); message(`Теперь подбираем товары для города ${city}. Ранее добавленные позиции остаются привязаны к своим городам.`); });
$('#search').addEventListener('input', () => { if (liveSearch.active) liveSearch.search(); else renderProducts(); });
$('#search-form').addEventListener('submit', e => { e.preventDefault(); if (liveSearch.active) liveSearch.search(true); $('#catalog').scrollIntoView({ behavior: 'smooth' }); });
$('#sort').addEventListener('change', renderProducts); $('#in-stock').addEventListener('change', renderProducts);
$('#brands').addEventListener('change', e => { if (!e.target.dataset.brand) return; e.target.checked ? brandFilters.add(e.target.dataset.brand) : brandFilters.delete(e.target.dataset.brand); renderProducts(); });
$('#reset-filters').addEventListener('click', resetFilters);
$('#favorites-button').addEventListener('click', () => { favoritesOnly = !favoritesOnly; liveSearch.setDemo(); renderProducts(); renderCounters(); $('#catalog').scrollIntoView({ behavior: 'smooth' }); });
$('#cart-button').addEventListener('click', openCart);
$('#cart-dialog').addEventListener('close', () => { if (location.hash === '#cart') history.replaceState(null, '', location.pathname + location.search); });
window.addEventListener('popstate', () => { if (location.hash === '#cart') openCart(); else $('#cart-dialog').close(); });
$('#catalog-jump').addEventListener('click', () => { resetFilters(); $('#catalog').scrollIntoView({ behavior: 'smooth' }); });
$('#filter-toggle').addEventListener('click', () => { const open = $('#filters').classList.toggle('open'); $('#filter-toggle').setAttribute('aria-expanded', String(open)); });
['hero-help', 'nav-help', 'sidebar-help', 'chat-launch'].forEach(id => $('#' + id).addEventListener('click', () => openChat()));
$('#chat-close').addEventListener('click', () => { $('#assistant').classList.remove('mobile-open'); $('#chat-launch').classList.remove('hidden'); $('#chat-launch').focus(); });
$('#chat-form').addEventListener('submit', e => { e.preventDefault(); send($('#chat-input').value); });
$('#chat-input').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(e.target.value); } });
$('#chat-input').addEventListener('input', e => { e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 100) + 'px'; });
document.addEventListener('keydown', e => { if (e.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName) && !document.querySelector('dialog[open]')) { e.preventDefault(); $('#search').focus(); } if (e.key === 'Escape' && !document.querySelector('dialog[open]')) { $('#assistant').classList.remove('mobile-open'); $('#chat-launch').classList.remove('hidden'); } });
document.querySelectorAll('dialog').forEach(dialog => dialog.addEventListener('click', e => { if (e.target === dialog) { const r = dialog.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) dialog.close(); } }));
document.addEventListener('error', e => { if (e.target.tagName === 'IMG') { e.target.hidden = true; const placeholder = document.createElement('span'); placeholder.className = 'image-fallback'; placeholder.textContent = 'Фото недоступно'; e.target.after(placeholder); } }, true);
renderCategories(); renderProducts(); renderCounters();
if (location.hash === '#cart') openCart();
