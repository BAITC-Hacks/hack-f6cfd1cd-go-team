import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchChat, parseChatResponse, createChatSession, ChatApiError } from '../chat-api.js';
import { renderSessionCart } from '../live-chat.js';
const id = '11111111-1111-4111-8111-111111111111';
const response = (changes = {}) => ({ session_id: id, message: 'Ответ', products: [], tools_used: [], mode: 'fallback', ...changes });

test('Older chat responses keep optional features absent', () => {
  const parsed = parseChatResponse(response());
  assert.deepEqual(parsed.analogs, []);
  assert.equal(parsed.cart, null);
  assert.equal(parsed.pendingConfirmation, null);
});

test('Analog explanation and disclaimer survive both modes; unsafe links are removed', () => {
  const analog = {source_product_id:1,product:{id:2,name:'Кандидат',article:'A',price:null,quantity:7,image:'https://evil.example/x',url:'javascript:alert(1)'},quantity:7,explanation:'Совпали обозначения',matched_properties:{},disclaimer:'Совместимость не подтверждена'};
  for (const mode of ['openai','fallback']) {
    const result = parseChatResponse(response({mode,analogs:[analog]})).analogs[0];
    assert.equal(result.explanation,analog.explanation);
    assert.equal(result.disclaimer,analog.disclaimer);
    assert.equal(result.product.quantity,7);
    assert.equal(result.product.price,null);
    assert.equal(result.product.image,null);
    assert.equal(result.product.url,null);
  }
});

test('Proposal and confirmation use ordinary messages in the same session; only server changes cart', async () => {
  const bodies=[];
  const item={product_id:515291,article:'200300285_',quantity:2};
  const session=createChatSession((message,options)=>fetchChat(message,{...options,fetchImpl:async (_url,init)=>{
    bodies.push(JSON.parse(init.body));
    return {ok:true,json:async()=>response({cart:{type:'demo_session',items:bodies.length===1?[]:[{...item,name:'Legrand'}]},pending_confirmation:bodies.length===1?item:null})};
  }}));
  const proposal=await session.send('Добавь 2 штуки товара 200300285_');
  assert.deepEqual(proposal.cart.items,[]);
  assert.equal(proposal.pendingConfirmation.quantity,2);
  const confirmed=await session.send('Да, добавь');
  assert.equal(confirmed.pendingConfirmation,null);
  assert.equal(confirmed.cart.items[0].quantity,2);
  assert.deepEqual(bodies,[{message:'Добавь 2 штуки товара 200300285_',session_id:null},{message:'Да, добавь',session_id:id}]);
});

test('Malformed cart or proposal cannot appear as a successful cart snapshot', () => {
  for (const changes of [
    {cart:{type:'real',items:[]}},
    {cart:{type:'demo_session',items:[{product_id:1,article:'A',name:'A',quantity:-2}]}},
    {pending_confirmation:{product_id:1,article:'A',quantity:0}},
    {analogs:[{product:{id:2}}]}
  ]) assert.throws(()=>parseChatResponse(response(changes)),{code:'invalid_response'});
});

test('Cart UI distinguishes pending from added quantity and renders backend text literally', () => {
  const original=globalThis.document;
  globalThis.document={createElement:tag=>({tag,textContent:'',children:[],append(...nodes){this.children.push(...nodes);}})};
  const text=node=>[node.textContent,...node.children.map(text)].join(' ');
  try {
    const pending=renderSessionCart({cart:{items:[]},pendingConfirmation:{article:'<img onerror=alert(1)>',quantity:2}});
    assert.match(text(pending),/Корзина пуста/);
    assert.match(text(pending),/ещё не добавлено/);
    assert.match(text(pending),/К добавлению: 2 шт/);
    assert.match(text(pending),/Да, добавь/);
    assert.match(text(pending),/<img onerror=alert\(1\)>/);
    assert.ok(pending.children.every(node=>node.tag!=='img' && node.tag!=='a' && node.tag!=='button'));
    const confirmed=renderSessionCart({cart:{items:[{name:'Legrand',article:'A',quantity:2}]},pendingConfirmation:null});
    assert.match(text(confirmed),/В корзине: 2 шт/);
    assert.doesNotMatch(text(confirmed),/Ожидает подтверждения/);
    assert.equal(renderSessionCart({cart:null,pendingConfirmation:null}),null);
  } finally { globalThis.document=original; }
});
test('Backend example without tools_used, image or url is accepted in both modes', () => {
  const payload = {
    session_id: id,
    message: '027228 АВ DRX250 MT 3ф 160А 18ka Legrand (1). Цена: 64920. Остаток: 23. Данные получены из EKT.',
    products: [{id:515291,name:'027228 АВ DRX250 MT 3ф 160А 18ka Legrand (1)',article:'200300285_',price:64920,quantity:23,source:'ekt_detail'}],
    mode: 'fallback'
  };
  const fallback = parseChatResponse(payload);
  const openai = parseChatResponse({...payload,mode:'openai'});
  assert.equal(fallback.message,payload.message);
  assert.equal(fallback.products[0].quantity,23);
  assert.equal(fallback.products[0].price,64920);
  assert.equal(fallback.products[0].image,null);
  assert.equal(fallback.products[0].url,null);
  assert.deepEqual(fallback.tools,[]);
  assert.deepEqual(fallback.products,openai.products);
});
test('Successive HTTP requests carry the returned session ID', async () => {
  const bodies=[];
  const session=createChatSession((message,options)=>fetchChat(message,{...options,fetchImpl:async (_url,init)=>{
    bodies.push(JSON.parse(init.body));
    return {ok:true,json:async()=>({session_id:id,message:'Ответ',products:[],mode:'fallback'})};
  }}));
  await session.send('Первый вопрос'); await session.send('Второй вопрос');
  session.reset(); await session.send('Новая беседа');
  assert.deepEqual(bodies.map(b=>b.session_id),[null,id,null]);
});
test('Chat uses POST JSON, session_id and no credentials', async () => {
  const result = await fetchChat('  Есть товар? ', { sessionId: id, fetchImpl: async (url, options) => {
    assert.equal(url.href, 'http://127.0.0.1:8000/api/chat'); assert.equal(options.method, 'POST');
    assert.equal(options.credentials, 'omit'); assert.equal(options.headers.Authorization, undefined);
    assert.deepEqual(JSON.parse(options.body), {message:'Есть товар?',session_id:id});
    return { ok:true, json:async()=>response() };
  } }); assert.equal(result.mode,'fallback');
});
test('Null fields remain unknown and zero quantity remains zero', () => {
  const p = {id:42,name:null,article:null,price:null,quantity:null,image:null,url:null,source:'ekt_detail'};
  assert.equal(parseChatResponse(response({products:[p]})).products[0].quantity,null);
  assert.equal(parseChatResponse(response({products:[{...p,quantity:0}]})).products[0].quantity,0);
  assert.equal(parseChatResponse(response({mode:'openai'})).mode,'openai');
});
test('Invalid response, unknown mode and unsafe URLs are handled', () => {
  assert.throws(()=>parseChatResponse(response({mode:'demo'})),{code:'invalid_response'});
  const p = {id:42,source:'sqlite',name:'<img onerror=alert(1)>',url:'javascript:alert(1)',image:'https://evil.example/x'};
  const parsed = parseChatResponse(response({products:[p]})).products[0];
  assert.equal(parsed.url,null); assert.equal(parsed.image,null); assert.equal(parsed.name,p.name);
});
test('Empty and too-long messages do not call backend', async () => {
  for (const text of [' ', 'a'.repeat(2001)]) await assert.rejects(fetchChat(text,{fetchImpl:()=>assert.fail()}),{code:'validation'});
});
test('404 catalog_error must not be mistaken for an expired session; 422 standard body works', async () => {
  for (const code of ['catalog_error','session_not_found','session_busy','chat_busy','chat_timeout']) {
    let calls=0;
    await assert.rejects(fetchChat('test',{fetchImpl:async()=>{calls++;return {ok:false,status:404,json:async()=>({error:{code,message:'Каталог недоступен'}})};}}),{code});
    assert.equal(calls,1);
  }
  await assert.rejects(fetchChat('test',{fetchImpl:async()=>({ok:false,status:422,json:async()=>({detail:[]})})}),{status:422});
});
test('Session ID is reused after success, only expired session clears it, no automatic retry', async () => {
  const seen=[]; let count=0;
  const session=createChatSession(async (_text,options)=>{seen.push(options.sessionId);count++;if(count===2)throw new ChatApiError('catalog_error','error',404);if(count===4)throw new ChatApiError('session_not_found','expired',404);return parseChatResponse(response());});
  await session.send('1'); await assert.rejects(session.send('2')); await session.send('3'); await assert.rejects(session.send('4')); await session.send('5');
  assert.deepEqual(seen,[null,id,id,id,null]);
});
test('Parallel messages rejected and reset prevents a stale response joining the new session', async () => {
  let resolve; const session=createChatSession(()=>new Promise(r=>resolve=r));
  const old=session.send('first'); await assert.rejects(session.send('second'),{code:'session_busy'});
  session.reset(); resolve(parseChatResponse(response())); await assert.rejects(old,{code:'cancelled'}); assert.equal(session.busy,false);
});
test('Timeout and cancel are distinct and never automatically retried', async () => {
  const fetchImpl=async (_url,{signal})=>new Promise((_resolve,reject)=>{if(signal.aborted)reject(new Error());else signal.addEventListener('abort',()=>reject(new Error()),{once:true});});
  await assert.rejects(fetchChat('test',{fetchImpl,timeoutMs:5}),{code:'timeout'});
  const controller=new AbortController(); const pending=fetchChat('test',{fetchImpl,signal:controller.signal});controller.abort();await assert.rejects(pending,{code:'cancelled'});
});
