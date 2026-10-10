const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');

test('abrir, iniciar sesión y cambiar filtros no consulta datos; cada botón carga solo su apartado', async () => {
  const nodes = new Map();
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, { value: 'todas', textContent: '', disabled: false,
      classList: { add() {}, remove() {} }, listeners: {},
      addEventListener(name, fn) { this.listeners[name] = fn; },
      replaceChildren() {}, appendChild() {}, append() {}, focus() {}, select() {} });
    return nodes.get(id);
  };
  const calls = [];
  vm.runInNewContext(fs.readFileSync(require.resolve('../centro-contactia.js'), 'utf8'), {
    document: { querySelector: node, createElement: () => node(Math.random()), createTextNode: s => s },
    fetch: async (_, options) => { calls.push(JSON.parse(options.body).accion);
      return { ok: true, json: async () => ({ resumen: {}, operaciones: [], avisos: [] }) }; },
    Intl, Date, URLSearchParams
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls, ['validar_sesion']);
  await node('#formularioAcceso').listeners.submit({ preventDefault() {} });
  for (const id of ['#filtroRevision', '#filtroIdioma', '#filtroResultado']) node(id).listeners.change();
  assert.deepEqual(calls, ['validar_sesion', 'iniciar_sesion']);
  await node('#actualizar').listeners.click();
  assert.equal(calls.at(-1), 'listar');
  assert.equal(calls.length, 3);
  await node('#actualizarAvisos').listeners.click();
  assert.equal(calls.at(-1), 'listar_avisos');
  await node('#comprobarProgramados').listeners.click();
  assert.equal(calls.at(-1), 'inspeccionar_programados');
});

test('el programador en modo manual devuelve pausa sin realizar peticiones externas', async () => {
  const originalEnv = { ...process.env }, originalFetch = global.fetch;
  try {
    process.env.VERCEL_ENV = 'preview';
    process.env.CONTACTIA_AVISOS_SECRET = 's'.repeat(32);
    delete process.env.CONTACTIA_PROGRAMADOR_AUTOMATICO;
    global.fetch = async () => { throw new Error('No debe consultar servicios externos'); };
    const res = { setHeader() {}, status(value) { this.code = value; return this; }, json(value) { this.body = value; } };
    await require('../lib/endpoint-avisos-programados')({ method: 'GET', headers: { authorization: `Bearer ${process.env.CONTACTIA_AVISOS_SECRET}` }, query: { accion: 'ejecutar_programados' } }, res);
    assert.equal(res.code, 200);
    assert.equal(res.body.modo, 'manual');
    assert.equal(res.body.consultas_airtable, 0);
    assert.equal(res.body.pausado, true);
  } finally { process.env = originalEnv; global.fetch = originalFetch; }
});
