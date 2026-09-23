import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchChat, parseChatResponse, createChatSession, ChatApiError } from '../chat-api.js';
const id = '11111111-1111-4111-8111-111111111111';
const response = (changes = {}) => ({ session_id: id, message: 'Ответ', products: [], tools_used: [], mode: 'fallback', ...changes });
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
