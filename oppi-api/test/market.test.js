'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./helper');

let ctx;
before(async () => { ctx = await setup(); });
after(() => ctx.close());

async function marketFixture() {
  const { api, register } = ctx;
  const client = await register();
  const handy = await register({ role: 'handyman' });
  const handy2 = await register({ role: 'handyman' });
  const task = await api('POST', '/api/tasks', {
    token: client.token,
    body: { title: 'Arreglar canilla', description: 'Gotea', category: 'plomería', barrio: 'Sajonia', price_min_gs: 80000, price_max_gs: 120000, urgent: true },
  });
  return { api, client, handy, handy2, taskId: task.json.task.id };
}

test('tareas: publicar y filtrar urgentes (?urgent=1)', async () => {
  const { api, client } = await marketFixture();
  await api('POST', '/api/tasks', {
    token: client.token, body: { title: 'Pintar pieza', category: 'pintura', barrio: 'Villa Morra' },
  });
  const urgent = await api('GET', '/api/tasks', { query: { urgent: 1 } });
  assert.ok(urgent.json.tasks.length >= 1);
  assert.ok(urgent.json.tasks.every((t) => t.urgent === true));
  assert.ok(urgent.json.tasks.some((t) => t.title === 'Arreglar canilla'));
});

test('tareas: publicar sin título → 400', async () => {
  const { api, register } = ctx;
  const client = await register();
  const r = await api('POST', '/api/tasks', { token: client.token, body: { description: 'sin título' } });
  assert.equal(r.status, 400);
});

test('ofertas: marketplace abierto — cualquiera (menos el dueño) puede ofertar', async () => {
  const { api, client, handy, taskId } = await marketFixture();
  // El dueño no puede ofertar en su propia tarea.
  const own = await api('POST', `/api/tasks/${taskId}/offers`, {
    token: client.token, body: { amount_gs: 50000 },
  });
  assert.equal(own.status, 400);
  // Un cliente común sí puede ofertar (sin gate de rol).
  const ok = await api('POST', `/api/tasks/${taskId}/offers`, {
    token: handy.token, body: { amount_gs: 90000, message: 'Voy mañana' },
  });
  assert.equal(ok.status, 201);
  assert.equal(ok.json.offer.status, 'pending');
  const intruso = await ctx.register();
  const ok2 = await api('POST', `/api/tasks/${taskId}/offers`, {
    token: intruso.token, body: { amount_gs: 70000 },
  });
  assert.equal(ok2.status, 201);
});

test('ofertas: aceptar crea el job, cobra el 100% del precio y rechaza las demás', async () => {
  const { api, client, handy, handy2, taskId } = await marketFixture();
  const o1 = await api('POST', `/api/tasks/${taskId}/offers`, { token: handy.token, body: { amount_gs: 100000 } });
  const o2 = await api('POST', `/api/tasks/${taskId}/offers`, { token: handy2.token, body: { amount_gs: 120000 } });

  // Otro cliente (no el dueño) no puede aceptar → 403
  const intruso = await ctx.register();
  const no = await api('POST', `/api/offers/${o1.json.offer.id}/accept`, { token: intruso.token });
  assert.equal(no.status, 403);

  const yes = await api('POST', `/api/offers/${o1.json.offer.id}/accept`, { token: client.token });
  assert.equal(yes.status, 201);
  assert.equal(yes.json.job.agreed_price_gs, 100000);
  assert.equal(yes.json.job.paid_gs, 100000); // 100% del precio acordado
  assert.equal(yes.json.job.status, 'quoting');

  const task = await api('GET', `/api/tasks/${taskId}`);
  assert.equal(task.json.task.status, 'assigned');
  const statuses = Object.fromEntries(task.json.offers.map((o) => [o.id, o.status]));
  assert.equal(statuses[o1.json.offer.id], 'accepted');
  assert.equal(statuses[o2.json.offer.id], 'rejected');
});

test('ofertas: al aceptado se le otorga rol handyman (sin re-login)', async () => {
  const { api, register } = ctx;
  const client = await register();
  const worker = await register(); // rol 'client'
  const task = await api('POST', '/api/tasks', {
    token: client.token, body: { title: 'Pintar', description: 'x', category: 'pintura', barrio: 'Sajonia' },
  });
  const taskId = task.json.task.id;
  const o = await api('POST', `/api/tasks/${taskId}/offers`, {
    token: worker.token, body: { amount_gs: 50000 },
  });
  assert.equal(o.status, 201);
  const acc = await api('POST', `/api/offers/${o.json.offer.id}/accept`, { token: client.token });
  assert.equal(acc.status, 201);
  // El rol se lee fresco de la DB: el mismo token ya sirve para cotizar.
  const me = await api('GET', '/api/me', { token: worker.token });
  assert.equal(me.json.user.role, 'handyman');
});

test('jobs: solo involucrados cambian estado; quoting → in_progress → completed', async () => {
  const { api, client, handy, taskId } = await marketFixture();
  const o = await api('POST', `/api/tasks/${taskId}/offers`, { token: handy.token, body: { amount_gs: 80000 } });
  const acc = await api('POST', `/api/offers/${o.json.offer.id}/accept`, { token: client.token });
  const jobId = acc.json.job.id;

  const outsider = await ctx.register();
  const denied = await api('PATCH', `/api/jobs/${jobId}`, { token: outsider.token, body: { status: 'in_progress' } });
  assert.equal(denied.status, 403);

  const skip = await api('PATCH', `/api/jobs/${jobId}`, { token: client.token, body: { status: 'completed' } });
  assert.equal(skip.status, 400); // no se puede saltear in_progress

  const go = await api('PATCH', `/api/jobs/${jobId}`, { token: handy.token, body: { status: 'in_progress' } });
  assert.equal(go.status, 200);
  const done = await api('PATCH', `/api/jobs/${jobId}`, { token: client.token, body: { status: 'completed' } });
  assert.equal(done.status, 200);
  assert.equal(done.json.job.status, 'completed');
});
