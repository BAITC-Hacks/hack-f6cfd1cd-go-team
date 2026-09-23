"""Synthetic EKT fixtures for real backend integration, never live inventory."""
SOURCE_ID = 515291
ALTERNATIVE_ID = 515292
ARTICLE = "200300285_"
TECH = {"NOMINALNYY_TOK": "160 А", "KOLICHESTVO_POLYUSOV": "3",
        "NOMINALNOE_NAPRYAZHENIE": "400 В"}
SOURCE = {
    "id": SOURCE_ID, "article": ARTICLE, "name": "Автомат модульный серия A",
    "price": 100, "quantity": 3, "properties": TECH,
    "description": "Синтетическая QA-карточка", "offers": [],
    "stores": [{"name": "QA склад", "quantity": 3}],
    "image": None, "url": "https://ekt.kz/catalog/qa-source/",
}
ALTERNATIVE = {
    "id": ALTERNATIVE_ID, "article": "QA-ANALOG", "name": "Автомат модульный серия B",
    "price": 120, "quantity": 5, "properties": TECH,
    "description": "Синтетический кандидат, не реальная рекомендация",
    "image": None, "url": "https://ekt.kz/catalog/qa-alternative/",
}
