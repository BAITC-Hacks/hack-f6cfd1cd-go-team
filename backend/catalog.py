import sqlite3
from contextlib import closing
from pathlib import Path

from backend.ekt_service import EktError


FIELDS = ("id", "name", "article", "price", "image", "url", "url_api_detail")


class CatalogStore:
    def __init__(self, path: Path):
        self.path = Path(path)

    def initialize(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with closing(sqlite3.connect(self.path, timeout=1)) as db, db:
            db.executescript("""
                CREATE TABLE IF NOT EXISTS products (
                    id INTEGER PRIMARY KEY, name TEXT NOT NULL, article TEXT NOT NULL,
                    price, image TEXT, url TEXT, url_api_detail TEXT,
                    name_search TEXT NOT NULL, article_search TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS products_article ON products(article_search);
                CREATE TABLE IF NOT EXISTS sync_metadata (
                    singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
                    synced_at TEXT NOT NULL, pages INTEGER NOT NULL, products INTEGER NOT NULL
                );
            """)

    def search(self, query: str) -> dict:
        query = query.strip()
        if not query:
            raise EktError(422, "Поисковый запрос не должен быть пустым.")
        if not self.path.is_file():
            raise EktError(503, "Локальный каталог не загружен. Выполните python -m backend.sync_catalog.")
        normalized = query.casefold()
        try:
            # Read-only connection per request; sync commits products and metadata together.
            with closing(sqlite3.connect(self.path.resolve().as_uri() + "?mode=ro",
                                         uri=True, timeout=1)) as db:
                db.row_factory = sqlite3.Row
                db.execute("BEGIN")
                metadata = db.execute("SELECT * FROM sync_metadata WHERE singleton=1").fetchone()
                if metadata is None:
                    raise EktError(503, "Каталог ещё не синхронизирован. Выполните python -m backend.sync_catalog.")
                columns = ", ".join(FIELDS)
                items = db.execute(f"SELECT {columns} FROM products WHERE article_search=? ORDER BY id",
                                   (normalized,)).fetchall()
                match_type = "exact_article"
                if not items:
                    match_type = "substring"
                    # instr treats %, _ and quotes literally. Unicode folding is done in Python.
                    items = db.execute(
                        f"SELECT {columns} FROM products WHERE instr(name_search, ?) > 0 "
                        "OR instr(article_search, ?) > 0 ORDER BY id", (normalized, normalized)
                    ).fetchall()
                return {"query": query, "match_type": match_type, "count": len(items),
                        "items": [dict(item) for item in items], "source": "sqlite",
                        "synced_at": metadata["synced_at"], "pages_scanned": 0,
                        "catalog_complete": True}
        except sqlite3.Error:
            raise EktError(503, "Локальный каталог недоступен. Проверьте файл базы и повторите синхронизацию.") from None


def product_values(item: dict) -> tuple:
    if (not isinstance(item, dict) or type(item.get("id")) is not int
            or not isinstance(item.get("name"), str)
            or not isinstance(item.get("article"), str)):
        raise EktError(502, "Неожиданная структура товара EKT API.")
    for field in ("image", "url", "url_api_detail"):
        if item.get(field) is not None and not isinstance(item[field], str):
            raise EktError(502, "Неожиданная структура ссылки товара EKT API.")
    price = item.get("price")
    if price is not None and type(price) not in (str, int, float):
        raise EktError(502, "Неожиданная структура цены EKT API.")
    return tuple(item.get(field) for field in FIELDS) + (
        item["name"].casefold(), item["article"].strip().casefold())
