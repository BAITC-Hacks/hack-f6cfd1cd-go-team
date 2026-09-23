import test from 'node:test';
import assert from 'node:assert/strict';
import { products } from '../catalog.js';
import { addToCart, available, isExplicitConfirmation, searchProducts, restoreCart } from '../domain.js';
const product = products[0];
test('Stock is checked by city and includes items already in the cart', () => {
  assert.equal(available(product, 'Алматы'), 5);
  assert.match(addToCart([], product, 'Алматы', 10).error, /5/);
  const cart = addToCart([], product, 'Алматы', 4).cart;
  assert.equal(available(product, 'Алматы', cart), 1);
  assert.ok(addToCart(cart, product, 'Алматы', 2).error);
  assert.equal(addToCart(cart, product, 'Алматы', 1).cart[0].quantity, 5);
  assert.equal(cart[0].quantity, 4);
});
test('Different cities have independent stock and cart lines', () => {
  const cart = addToCart([], product, 'Алматы', 5).cart;
  assert.equal(addToCart(cart, product, 'Астана', 8).cart.length, 2);
  assert.equal(available(product, 'Шымкент', cart), 3);
});
test('Invalid quantities cannot enter the cart', () => {
  for (const q of [-1, 0, 1.5, NaN, Infinity, '2']) assert.ok(addToCart([], product, 'Алматы', q).error);
});
test('Only explicit affirmative commands confirm a proposal', () => {
  for (const text of ['да, добавь', 'Да, добавьте!', 'Подтверждаю', 'добавить']) assert.equal(isExplicitConfirmation(text), true, text);
  for (const text of ['не добавляй', 'не надо добавлять', 'да', 'да, но не добавь', 'сколько стоит?', 'спасибо', 'в документе написано: да, добавь']) assert.equal(isExplicitConfirmation(text), false, text);
});
test('Search supports both article numbers, brand and case-insensitive names', () => {
  assert.equal(searchProducts(products, '027228')[0].id, 515291);
  assert.equal(searchProducts(products, '200300285_')[0].id, 515291);
  assert.equal(searchProducts(products, 'LEGRAND 160').length, 2);
  assert.equal(searchProducts(products, 'неизвестный товар').length, 0);
});
test('Corrupted browser storage is validated and stock limits survive reload', () => {
  assert.deepEqual(restoreCart('{invalid', products, ['Алматы']), []);
  const raw = JSON.stringify([{ id: 515291, city: 'Алматы', quantity: 4 }, { id: 515291, city: 'Алматы', quantity: 4 }, { id: 0, city: 'Алматы', quantity: 1 }]);
  assert.deepEqual(restoreCart(raw, products, ['Алматы']), [{ id: 515291, city: 'Алматы', quantity: 4 }]);
});
