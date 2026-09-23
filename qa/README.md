# QA + AI Logic для EKT

Адаптировано к origin/backend **f449d46** и его chat-api-contract.md.
Backend влит в ai-qa (merge 93df963); production-код QA не исправляет.

- [AI-правила](ai-logic.md), [матрица](test-matrix.md), [найденные проблемы](findings.md).
- tests/test_ekt_qa.py: 22 проверки search/detail, включая два исправленных дефекта.
- tests/test_chat_acceptance.py: 39 активных проверок (B18 + C8 + D6 + F7).
- qa/chat_cases.py: синтетические карточки; qa/chat_harness.py: изолированное окружение.
- [Результат](test-results.json), [полный журнал](test-run.txt).

## Запуск

Из корня QA worktree в окружении с requirements.txt:

```bash
python -m pip install -r requirements.txt
python -m unittest discover -s tests -v
```

Для сохранения полного журнала и JSON-счётчиков:

```bash
python -m qa.run_tests
```

Только acceptance:

```bash
python -m unittest discover -s tests -p test_chat_acceptance.py -v
```

В локальной Windows-среде зависимости лежат в игнорируемом .qa-deps:

```powershell
$env:PYTHONPATH = (Join-Path (Get-Location) '.qa-deps')
py -m qa.run_tests
```

Итог: **121 = 117 passed + 4 failed**, errors/skipped/expectedFailure = 0.
Runner возвращает ненулевой exit code при падениях. Проблемы не скрыты skip/xfail.

## Граница покрытия

Цепочка: HTTP /api/chat → настоящий ChatService → CatalogStore/SQLite, EktService,
AnalogService и demo-cart. Каталог заполняется настоящим sync_catalog из тестового HTTP.
Подменены только HTTP EKT (MockTransport) и Responses-клиент LLM (заданный сценарий
вызовов инструментов, ответов и ошибок). Spy SQLite вызывает настоящий поиск.
Обычный AsyncHTTPTransport заблокирован, .env не читается, рабочая SQLite не используется.
Платных LLM-вызовов нет; цены/остатки fixtures не являются данными магазина.

Scripted LLM проверяет исполнение tools, передачу фактов, историю и ошибки, но не
самостоятельное распознавание intent или качество ответа модели. Заранее заданный
mock-текст не засчитывается как доказательство отсутствия галлюцинаций.
Для fallback/cart проверяется реальная детерминированная логика; F03 подаёт намеренно
ложный ответ модели для проверки серверной защиты.

Тесты не доказывают электротехническую совместимость, живые остатки EKT или checkout.
Корзина исключительно demo_session, без заказа на ekt.kz.
Старый EKT_QA_CHAT_ADAPTER больше не используется. Ожидание /api/chat снято.
