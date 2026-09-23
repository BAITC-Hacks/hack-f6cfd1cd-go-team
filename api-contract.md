# API поиска для frontend

## Актуальная карточка товара

`GET /api/products/detail?id=515291` — `id` обязателен, положительное целое число. Каждый запрос обращается к EKT через Basic Auth на сервере; SQLite и кэш карточек не используются. Ответ HTTP 200 — исходный объект EKT без дополнительной обёртки и без преобразования полей.

На реальной карточке `515291` подтверждены поля: `id`, `name`, `article`, `description`, `price`, `quantity`, `stores`, `image`, `url`, `offers`, `properties`. `stores` — массив объектов `id`, `name`, `quantity`; `properties` — объект, содержащий строки и массивы. На момент проверки цена 64920, количество 23, 24 записи складов. Значения могут изменяться при последующих запросах.

Сертификат или ссылка на него в этой карточке не обнаружены. Отсутствующие поля не добавляются; дополнительные поля EKT передаются как есть. Нельзя делать вывод об отсутствии сертификатов во всём каталоге по одному товару.

В исходных данных есть расхождение: название и описание указывают 160 А, а `properties.NOMINALNYY_TOK` — `250 А`. Backend не исправляет данные самостоятельно.

Ошибки в формате `{"detail": "описание"}`: 404 — EKT вернул 404; 502 — ошибка EKT, авторизации, JSON или карточка с отсутствующим/неверным ID; 503 — нет credentials либо лимит EKT; 504 — таймаут. Некорректный параметр `id` — 422. Тела ошибок EKT и credentials наружу не передаются.

Backend: `http://127.0.0.1:8000`. Разрешённый origin: `http://127.0.0.1:5173`.
CORS разрешает GET/POST и OPTIONS preflight; cookies/credentials не требуются, wildcard не используется. `http://localhost:5173` — другой origin, он не разрешён.

## Запрос

`GET /api/products/search?q=200300285_`

`q` — обязательная строка длиной 1–200 символов. Внешние пробелы удаляются, пустая после обрезки строка недопустима (422). Поиск без учёта регистра по названию и артикулу. Если есть точный артикул, возвращаются только его совпадения; иначе — совпадения по подстроке. Поиск читает SQLite без запросов к EKT/detail.

## Ответы

Примеры HTTP 200 получены из рабочей SQLite; HTTP 503 — из отдельной временной базы со схемой, но без успешной синхронизации.

### 200 — найден товар, q=200300285_

```json
{
  "query": "200300285_",
  "match_type": "exact_article",
  "count": 1,
  "items": [
    {
      "id": 515291,
      "name": "027228 АВ DRX250 MT 3ф 160А 18ka Legrand (1)",
      "article": "200300285_",
      "price": 64920,
      "image": "https://ekt.kz/upload/iblock/47e/yow62nu665xqw3kk1es94ktbpl2z8pkt/027228_av_drx250_mt_3f_160a_18ka_legrand_1.jpg",
      "url": "https://ekt.kz/catalog/nizkovoltnaya_apparatura/silovye_avtomaticheskie_vyklyuchateli/drx250_mt_10_250_a_legrand/027228_av_drx250_mt_3f_160a_18ka_legrand_1/",
      "url_api_detail": "https://ekt.kz/api/products/detail?id=515291"
    }
  ],
  "source": "sqlite",
  "synced_at": "2026-09-23T10:16:14.709488+00:00",
  "pages_scanned": 0,
  "catalog_complete": true
}
```

### 200 — ничего не найдено, q=EKT_NO_MATCH_9d013b

```json
{
  "query": "EKT_NO_MATCH_9d013b",
  "match_type": "substring",
  "count": 0,
  "items": [],
  "source": "sqlite",
  "synced_at": "2026-09-23T10:16:14.709488+00:00",
  "pages_scanned": 0,
  "catalog_complete": true
}
```

### 503 — каталог ещё не синхронизирован

```json
{
  "detail": "Каталог ещё не синхронизирован. Выполните python -m backend.sync_catalog."
}
```

Если файла базы вообще нет, статус также 503, а detail: `Локальный каталог не загружен. Выполните python -m backend.sync_catalog.` Frontend должен определять состояние по HTTP-статусу, а не по точному тексту ошибки.

## Поля

Товар содержит ровно семь полей:

| Поле | Тип |
| --- | --- |
| id | integer |
| name | string |
| article | string |
| price | number / string / null (значение из каталога без преобразования) |
| image | string / null |
| url | string / null |
| url_api_detail | string / null |

`url_api_detail` — адрес внешнего EKT API, для него нужны серверные credentials; frontend не должен обращаться к нему напрямую. Полей остатков, характеристик и сертификатов в поисковом ответе нет.

Обёртка: `query` — запрос после обрезки пробелов; `match_type` — `exact_article` или `substring`; `count` — длина `items`; `source` — `sqlite`; `synced_at` — время последней синхронизации в ISO 8601; `pages_scanned` — 0; `catalog_complete` — true для опубликованного локального снимка. Цены соответствуют времени синхронизации.

Frontend: при 200 показать товары или пустое состояние по `items.length`; при 503 показать сообщение о недоступном каталоге; при 422 — ошибку параметра запроса.

Чат: [контракт POST /api/chat](chat-api-contract.md).
