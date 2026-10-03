'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./helper');

let ctx;
before(async () => { ctx = await setup(); });
after(() => ctx.close());

async function chatFixture() {
  const { api, register } = ctx;
  const client = await register();
  const handy = await register({ role: 'handyman' });
  const pro = await register({ role: 'pro' });
  const conv = await api('POST', '/api/conversations', {
    token: client.token, body: { participants: [handy.user.id] },
  });
  return { api, client, handy, pro, convId: conv.json.conversation.id };
}

test('chat: crear conversación y mandar mensaje', async () => {
  const { api, client, handy, convId } = await chatFixture();
  const m = await api('POST', `/api/conversations/${convId}/messages`, {
    token: client.token, body: { text: 'Hola, ¿cuándo podés pasar?' },
  });
  assert.equal(m.status, 201);
  const list = await api('GET', `/api/conversations/${convId}/messages`, { token: handy.token });
  assert.equal(list.status, 200);
  assert.equal(list.json.messages.length, 1);
});

test('chat: no participante no puede leer ni escribir → 403', async () => {
  const { api, pro, convId } = await chatFixture();
  const read = await api('GET', `/api/conversations/${convId}/messages`, { token: pro.token });
  assert.equal(read.status, 403);
  const write = await api('POST', `/api/conversations/${convId}/messages`, {
    token: pro.token, body: { text: 'Me meto' },
  });
  assert.equal(write.status, 403);
});

test('chat: solo el handyman puede CREAR un quote — cliente → 403, pro → 403', async () => {
  const { api, register } = ctx;
  const client = await register();
  const handy = await register({ role: 'handyman' });
  const pro = await register({ role: 'pro' });
  const conv = await api('POST', '/api/conversations', {
    token: client.token, body: { participants: [handy.user.id, pro.user.id] },
  });
  const convId = conv.json.conversation.id;

  const clientQuote = await api('POST', `/api/conversations/${convId}/messages`, {
    token: client.token, body: { text: 'te cotizo', quote: { amount_gs: 50000, detail: 'x' } },
  });
  assert.equal(clientQuote.status, 403);
  assert.match(clientQuote.json.error, /handyman/);

  const proQuote = await api('POST', `/api/conversations/${convId}/messages`, {
    token: pro.token, body: { text: 'te cotizo', quote: { amount_gs: 50000, detail: 'x' } },
  });
  assert.equal(proQuote.status, 403);

  const handyQuote = await api('POST', `/api/conversations/${convId}/messages`, {
    token: handy.token,
    body: { text: 'Acá va mi cotización', quote: { amount_gs: 120000, detail: 'Mano de obra incluida' } },
  });
  assert.equal(handyQuote.status, 201);
  assert.equal(handyQuote.json.message.quote.status, 'pending');
  assert.equal(handyQuote.json.message.quote.amount_gs, 120000);
});

test('chat: solo el cliente puede ACEPTAR/RECHAZAR — handyman → 403', async () => {
  const { api, client, handy, convId } = await chatFixture();
  const qm = await api('POST', `/api/conversations/${convId}/messages`, {
    token: handy.token, body: { quote: { amount_gs: 90000, detail: 'Reparación' } },
  });
  const msgId = qm.json.message.id;

  const handyAccepts = await api('PATCH', `/api/messages/${msgId}/quote`, {
    token: handy.token, body: { status: 'accepted' },
  });
  assert.equal(handyAccepts.status, 403);
  assert.match(handyAccepts.json.error, /cliente/);

  const ok = await api('PATCH', `/api/messages/${msgId}/quote`, {
    token: client.token, body: { status: 'accepted' },
  });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.quote.status, 'accepted');

  const twice = await api('PATCH', `/api/messages/${msgId}/quote`, {
    token: client.token, body: { status: 'rejected' },
  });
  assert.equal(twice.status, 400);
});

test('chat: acepta la cotización quien es cliente DEL TRABAJO (aunque su rol sea handyman)', async () => {
  const { api, register } = ctx;
  const boss = await register({ role: 'handyman' }); // rol handyman, pero cliente en ESTE trabajo
  const worker = await register(); // será handyman del trabajo al aceptarle la oferta
  const workerId = worker.user.id;
  // boss publica la tarea, worker oferta, boss acepta → boss es client del job
  const task = await api('POST', '/api/tasks', {
    token: boss.token, body: { title: 'Arreglar techo', description: 'x', category: 'albañilería', barrio: 'Sajonia' },
  });
  const taskId = task.json.task.id;
  const o = await api('POST', `/api/tasks/${taskId}/offers`, {
    token: worker.token, body: { amount_gs: 200000 },
  });
  assert.equal(o.status, 201);
  const acc = await api('POST', `/api/offers/${o.json.offer.id}/accept`, { token: boss.token });
  assert.equal(acc.status, 201);
  // conversación del trabajo
  const conv = await api('POST', '/api/conversations', {
    token: boss.token, body: { participants: [workerId], task_id: taskId },
  });
  assert.equal(conv.status, 201);
  const convId = conv.json.conversation.id;
  // worker (ya es handyman por el accept) cotiza
  const qm = await api('POST', `/api/conversations/${convId}/messages`, {
    token: worker.token, body: { quote: { amount_gs: 210000, detail: 'Extra' } },
  });
  assert.equal(qm.status, 201);
  // boss tiene rol handyman pero ES el cliente del trabajo → puede aceptar
  const ok = await api('PATCH', `/api/messages/${qm.json.message.id}/quote`, {
    token: boss.token, body: { status: 'accepted' },
  });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.quote.status, 'accepted');
  // el worker (handyman del trabajo) no puede aceptar su propia cotización
  const qm2 = await api('POST', `/api/conversations/${convId}/messages`, {
    token: worker.token, body: { quote: { amount_gs: 220000, detail: 'Otra' } },
  });
  assert.equal(qm2.status, 201);
  const no = await api('PATCH', `/api/messages/${qm2.json.message.id}/quote`, {
    token: worker.token, body: { status: 'accepted' },
  });
  assert.equal(no.status, 403);
  // un tercero no participante tampoco
  const intruso = await register();
  const no2 = await api('PATCH', `/api/messages/${qm2.json.message.id}/quote`, {
    token: intruso.token, body: { status: 'rejected' },
  });
  assert.equal(no2.status, 403);
});

test('chat: mensaje con fotos guarda la metadata', async () => {  const { api, client, convId } = await chatFixture();
  const m = await api('POST', `/api/conversations/${convId}/messages`, {
    token: client.token,
    body: { text: 'Mirá cómo está', photos: [{ filename: 'canilla.jpg', url: '/uploads/canilla.jpg' }] },
  });
  assert.equal(m.status, 201);
  assert.deepEqual(m.json.message.photos, [{ filename: 'canilla.jpg', url: '/uploads/canilla.jpg' }]);
});
