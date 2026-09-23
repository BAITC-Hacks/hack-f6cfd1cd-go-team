"""Run manually: python -m backend.sync_catalog."""
import asyncio
import sqlite3
from contextlib import closing
from datetime import datetime, timezone

import httpx

from backend.catalog import CatalogStore, product_values
from backend.config import Settings
from backend.ekt_service import EktError, EktService


async def sync_catalog(service: EktService, store: CatalogStore, progress=None,
                       max_pages: int = 10000) -> dict:
    store.initialize()
    with closing(sqlite3.connect(store.path, timeout=1)) as db:
        # One transaction: failed/interrupted sync rolls back to the previous catalogue.
        db.execute("BEGIN IMMEDIATE")
        try:
            db.execute("DELETE FROM products")
            first_page = None
            seen_pages = set()
            for page in range(1, max_pages + 1):
                for attempt in range(3):
                    try:
                        data = await service.get_products(page)
                        break
                    except EktError as exc:
                        if exc.status_code not in (502, 503, 504) or attempt == 2:
                            raise
                        if progress:
                            progress(f"Страница {page}: повтор {attempt + 1}/2 после ошибки {exc.status_code}")
                        await asyncio.sleep(attempt + 1)
                if not isinstance(data, dict) or not isinstance(data.get("items"), list):
                    raise EktError(502, "Неожиданная структура каталога EKT API.")
                values = [product_values(item) for item in data["items"]]
                signature = tuple(sorted(row[0] for row in values))
                if not values or (page > 1 and signature == first_page):
                    count = db.execute("SELECT count(*) FROM products").fetchone()[0]
                    timestamp = datetime.now(timezone.utc).isoformat()
                    db.execute("INSERT OR REPLACE INTO sync_metadata VALUES (1, ?, ?, ?)",
                               (timestamp, page - 1, count))
                    db.commit()
                    return {"products": count, "pages": page - 1, "synced_at": timestamp}
                if signature in seen_pages:
                    raise EktError(502, "EKT повторяет промежуточную страницу. Синхронизация отменена.")
                if page == 1:
                    first_page = signature
                seen_pages.add(signature)
                db.executemany("INSERT OR REPLACE INTO products VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", values)
                if progress:
                    count = db.execute("SELECT count(*) FROM products").fetchone()[0]
                    progress(f"Страница {page}: загружено {count} уникальных товаров (ещё не опубликовано)")
            raise EktError(502, "Достигнут предел страниц. Синхронизация отменена.")
        except BaseException:
            db.rollback()
            raise


async def main():
    settings = Settings()
    if not (settings.ekt_api_username.get_secret_value() and settings.ekt_api_password.get_secret_value()):
        raise EktError(503, "Заполните credentials EKT в локальном .env.")
    async with httpx.AsyncClient() as client:
        result = await sync_catalog(EktService(client, settings),
                                    CatalogStore(settings.catalog_db_path),
                                    progress=lambda message: print(message, flush=True))
    print(f"Готово: {result['products']} товаров, {result['pages']} страниц. База: {settings.catalog_db_path}")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except EktError as exc:
        print(f"Ошибка: {exc.detail} Предыдущий каталог сохранён.")
        raise SystemExit(1)
    except sqlite3.Error:
        print("Ошибка SQLite: проверьте файл базы и отсутствие другой синхронизации. Предыдущий каталог сохранён.")
        raise SystemExit(1)
    except KeyboardInterrupt:
        print("Синхронизация прервана. Предыдущий каталог сохранён.")
        raise SystemExit(130)
