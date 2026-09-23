"""Deterministic exact-article lookup, not an LLM."""
import re

from starlette.concurrency import run_in_threadpool


async def fallback_reply(message, catalog, ekt, analog_service=None):
    candidates = list(dict.fromkeys(token.casefold() for token in
                                    re.findall(r'\w+(?:[-./]\w+)*', message)))
    used = []
    products = []
    analogs = []
    if not candidates or len(candidates) > 30 or any(len(token) > 200 for token in candidates):
        text = 'Резервный поиск: укажите один точный артикул товара отдельным сообщением.'
    else:
        found = {}
        for candidate in candidates:
            result = await run_in_threadpool(catalog.search, candidate)
            used.append('search_products')
            # Never select a partial article or a name match as an exact article.
            for product in result['items']:
                if product.get('article', '').strip().casefold() == candidate:
                    found[product['id']] = product
        if not found:
            text = ('Товар с точным артикулом из сообщения не найден в локальном каталоге. '
                    'Резервный поиск поддерживает только точный артикул; проверьте его написание.')
        elif len(found) > 1:
            text = 'Найдено несколько товаров с указанными артикулами. Уточните один товар; карточка не выбрана.'
        else:
            product = await ekt.get_product_detail(next(iter(found)))
            used.append('get_product_detail')
            name = product.get('name') or 'Название не указано в EKT'
            price = product.get('price')
            quantity = product.get('quantity')
            price_text = f'Цена: {price}.' if price is not None and price != '' else 'Цена не указана в EKT.'
            quantity_text = f'Остаток: {quantity}.' if quantity is not None and quantity != '' else 'Данные об остатке не указаны в EKT.'
            text = f'{name}. {price_text} {quantity_text} Данные получены из EKT.'
            products = [{**{key: product.get(key) for key in
                           ('id', 'name', 'article', 'price', 'quantity', 'image', 'url')},
                         'source': 'ekt_detail'}]
            if product.get('quantity') == 0 and analog_service is not None:
                result = await analog_service.find(product)
                used.append('find_analogs')
                analogs = result['items']
                text += ' ' + result['message']
                for analog in analogs:
                    text += (f" Кандидат: {analog['product'].get('name')}; "
                             f"артикул {analog['product'].get('article')}; остаток {analog['quantity']}. "
                             + analog['explanation'])
    return {'message': text, 'products': products, 'tools_used': used, 'analogs': analogs}
