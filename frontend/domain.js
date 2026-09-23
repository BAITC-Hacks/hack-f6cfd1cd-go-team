export const money = value => new Intl.NumberFormat('ru-RU').format(value) + ' ₸';
export const normalize = value => String(value).toLocaleLowerCase('ru').replace(/ё/g, 'е').trim();
export function searchProducts(products, query) {
  const words = normalize(query).split(/\s+/).filter(Boolean);
  return products.filter(p => words.every(w => normalize([p.name, p.subtitle, p.article, p.vendor, p.brand].join(' ')).includes(w)));
}
export function available(product, city, cart = []) {
  return Math.max(0, (product.stocks[city] || 0) - (cart.find(i => i.id === product.id && i.city === city)?.quantity || 0));
}
export function addToCart(cart, product, city, quantity) {
  if (!Number.isSafeInteger(quantity) || quantity < 1) return { error: 'Укажите целое количество от 1.' };
  const remaining = available(product, city, cart);
  if (quantity > remaining) return { error: `Можно добавить ещё ${remaining} шт. для города ${city}.` };
  const next = cart.map(i => ({ ...i }));
  const item = next.find(i => i.id === product.id && i.city === city);
  if (item) item.quantity += quantity;
  else next.push({ id: product.id, city, quantity });
  return { cart: next };
}
export function isExplicitConfirmation(text) {
  return /^(да[,!\s]*добавь(те)?|да[,!\s]*добавить|подтверждаю|добавь(те)?|добавить)[.!\s]*$/i.test(text.trim());
}
export function restoreCart(raw, products, cities) {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.reduce((cart, item) => {
      const product = products.find(p => p.id === item?.id);
      if (!product || !cities.includes(item.city)) return cart;
      return addToCart(cart, product, item.city, item.quantity).cart || cart;
    }, []);
  } catch { return []; }
}
