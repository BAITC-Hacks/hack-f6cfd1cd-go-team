"""Session-only demo cart. No EKT cart integration or checkout URL."""
import math
import re

from starlette.concurrency import run_in_threadpool


CONFIRM = {'да, добавь', 'да добавь', 'да, добавьте', 'да добавьте'}
CANCEL = {'нет', 'отмена', 'отмени'}
ADD = re.compile(
    r'добав(?:ь|ьте)\s+([+-]?\d{1,9})\s+(?:штук[аиу]?|шт\.?)\s+'
    r'(?:товар[а]?\s+)?([\w./-]+?)(?:\s+в\s+корзину)?[.!?]?', re.IGNORECASE)


def cart_state(session):
    return {'type': 'demo_session', 'items': [dict(item) for item in session.cart.values()]}


def fits(stock, total):
    return type(stock) in (int, float) and math.isfinite(stock) and 0 < total <= stock


def product_summary(product):
    return {**{k: product.get(k) for k in ('id', 'name', 'article', 'price', 'quantity', 'image', 'url')},
            'source': 'ekt_detail'}


async def handle_cart(message, session, catalog, ekt):
    normalized = message.strip().casefold().rstrip('.!?').strip()
    match = ADD.fullmatch(message.strip())
    used, products = [], []

    def reply(text):
        return {'message': text, 'products': products, 'analogs': [],
                'tools_used': used, 'mode': 'fallback'}

    if normalized in CANCEL:
        session.pending_cart_action = None
        return reply('Действие отменено. Demo/session cart не изменена.')
    if normalized in CONFIRM:
        pending = session.pending_cart_action
        # Consume once before any I/O. Failure requires a new proposal.
        session.pending_cart_action = None
        if pending is None:
            return reply('Нет ожидающего подтверждения. Demo/session cart не изменена.')
        product = await ekt.get_product_detail(pending['product_id'])
        used.append('get_product_detail')
        products.append(product_summary(product))
        if product.get('article') != pending['article']:
            return reply('Артикул карточки изменился. Запросите добавление заново; корзина не изменена.')
        old_quantity = session.cart.get(product['id'], {}).get('quantity', 0)
        total = old_quantity + pending['quantity']
        if not fits(product.get('quantity'), total):
            return reply('Добавление запрещено: актуальный остаток недостаточен или неизвестен. Demo/session cart не изменена.')
        session.cart[product['id']] = {'product_id': product['id'], 'article': product.get('article'),
                                       'name': product.get('name'), 'quantity': total}
        return reply(f"Добавлено {pending['quantity']} шт. {product.get('name') or pending['article']} "
                     'в demo/session cart. Это не корзина сайта ekt.kz; заказ не оформлен.')
    if session.pending_cart_action is not None and match is None:
        session.pending_cart_action = None
        return reply('Явное подтверждение не получено. Ожидание отменено; demo/session cart не изменена. Для добавления отправьте запрос заново.')
    if match is None:
        # Keep all attempted cart commands away from the model; it cannot mutate cart.
        if re.search(r'добав|корзин|без подтвержден', normalized):
            return reply('Demo/session cart: напишите «Добавь 2 штуки товара АРТИКУЛ». Затем отдельно «Да, добавь». Без подтверждения добавление невозможно.')
        return None

    session.pending_cart_action = None
    quantity, article = int(match.group(1)), match.group(2)
    if quantity <= 0:
        return reply('Количество должно быть положительным целым числом. Demo/session cart не изменена.')
    result = await run_in_threadpool(catalog.search, article)
    used.append('search_products')
    matches = [p for p in result['items'] if p.get('article', '').strip().casefold() == article.casefold()]
    if len(matches) != 1:
        return reply('Точный артикул не найден или неоднозначен. Уточните товар; demo/session cart не изменена.')
    product = await ekt.get_product_detail(matches[0]['id'])
    used.append('get_product_detail')
    products.append(product_summary(product))
    if str(product.get('article', '')).strip().casefold() != article.casefold():
        return reply('Артикул в detail не совпал с поиском. Demo/session cart не изменена.')
    total = session.cart.get(product['id'], {}).get('quantity', 0) + quantity
    if not fits(product.get('quantity'), total):
        return reply('Добавление запрещено: запрошенное количество с учётом demo/session cart превышает остаток или остаток неизвестен.')
    session.pending_cart_action = {'product_id': product['id'], 'article': product['article'], 'quantity': quantity}
    return reply(f"Добавить {quantity} шт. {product.get('name') or article} в demo/session cart? "
                 'Корзина пока не изменена. Ответьте отдельным сообщением «Да, добавь» или «Нет». Это не настоящая корзина ekt.kz.')
