"""Conservative, literal comparisons; no claim of electrical interchangeability."""
import asyncio
import re

from starlette.concurrency import run_in_threadpool

from backend.ekt_service import EktError

TECH_FIELDS = {
    'KOLICHESTVO_POLYUSOV', 'NOMINALNAYA_OTKLYUCHAYUSHCHAYA_SPOSOBNOST',
    'NOMINALNOE_NAPRYAZHENIE', 'NOMINALNYY_TOK', 'TIP_USTANOVKI',
    'KATEGORIYA_SVETILNIKA', 'MATERIAL_KORPUSA', 'MOSHCHNOST_W',
    'SVETOVOY_POTOK_LM', 'SPOSOB_MONTAZHA', 'TIP_ISTOCHNIKA',
    'TIP_SVETILNIKA', 'TSVETOVAYA_TEMPERATURA', 'FORMA_LAMPY', 'TSVET_KORPUSA',
}
DISCLAIMER = 'Полная взаимозаменяемость не подтверждена; перед заменой нужна проверка специалистом.'


def tokens(name):
    return re.findall(r'\w+', str(name).casefold())


def properties(product):
    raw = product.get('properties')
    if not isinstance(raw, dict):
        return {}
    return {k: str(v).strip().casefold() for k, v in raw.items()
            if k in TECH_FIELDS and isinstance(v, (str, int, float)) and str(v).strip()}


class AnalogService:
    def __init__(self, catalog, ekt):
        self.catalog, self.ekt = catalog, ekt

    async def find(self, source):
        try:
            return await asyncio.wait_for(self._find(source), timeout=25)
        except (EktError, asyncio.TimeoutError):
            return {'items': [], 'message': 'Не удалось проверить доступные аналоги: каталог или EKT временно недоступен.'}

    async def _find(self, source):
        name_tokens = tokens(source.get('name', ''))
        if not name_tokens:
            return {'items': [], 'message': 'Надёжный аналог не найден: недостаточно данных исходного товара.'}
        queries = [source.get('name', '').strip(' *!')[:200]]
        words = sorted(set(t for t in name_tokens if len(t) >= 4 and not t.isdigit()), key=lambda t: (-len(t), t))
        queries.extend(words[:2])
        candidates = {}
        for query in dict.fromkeys(queries):
            if not query:
                continue
            result = await run_in_threadpool(self.catalog.search, query)
            # Rank all local hits cheaply, then retain only the best few.
            for product in result['items']:
                if product['id'] != source['id']:
                    candidates[product['id']] = product
        original = set(name_tokens)
        def rank(product):
            other = set(tokens(product.get('name', '')))
            return len(original & other) / max(1, len(original | other))
        candidates = sorted(candidates.values(), key=lambda p: (-rank(p), p['id']))[:3]
        for candidate in candidates:
            try:
                detail = await self.ekt.get_product_detail(candidate['id'])
            except EktError:
                continue
            quantity = detail.get('quantity')
            if type(quantity) not in (int, float) or quantity <= 0:
                continue
            source_props, other_props = properties(source), properties(detail)
            shared = source_props.keys() & other_props.keys()
            if any(source_props[k] != other_props[k] for k in shared):
                continue
            common = {k: source['properties'][k] for k in sorted(shared)}
            other_tokens = tokens(detail.get('name', ''))
            exact_name = name_tokens == other_tokens
            explicit_parameters = [t for t in name_tokens if any(c.isdigit() for c in t)
                                   and any(c.isalpha() for c in t)]
            # Sparse properties are acceptable ONLY when complete names match,
            # including at least two explicit alphanumeric parameters.
            name_evidence = exact_name and len(set(explicit_parameters)) >= 2
            prop_evidence = (len(source_props) >= 3 and source_props.keys() <= other_props.keys()
                             and len(original & set(other_tokens)) >= 2)
            if not (name_evidence or prop_evidence):
                continue
            reason = ('Совпадает название без декоративных символов; совпали обозначения из названия: '
                      + ', '.join(dict.fromkeys(explicit_parameters)) + '.') if name_evidence else ''
            if common:
                reason += ' Совпали свойства EKT: ' + '; '.join(f'{k}={v}' for k, v in common.items()) + '.'
            summary = {key: detail.get(key) for key in
                       ('id', 'name', 'article', 'price', 'quantity', 'image', 'url')}
            return {'items': [{'source_product_id': source['id'], 'product': summary,
                               'quantity': quantity, 'explanation': reason.strip(),
                               'matched_properties': common, 'disclaimer': DISCLAIMER}],
                    'message': 'Найден доступный кандидат по совпадающим данным. ' + DISCLAIMER}
        return {'items': [], 'message': 'Надёжный доступный аналог среди проверенных кандидатов не найден.'}
