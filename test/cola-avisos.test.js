const test = require('node:test');
const assert = require('node:assert/strict');
const { proximaRevision, ACTUALIZAR, VENCIDOS } = require('../lib/cola-avisos');
const handler = require('../lib/endpoint-avisos-programados');
const ahora = Date.now(), id = 'recPrueba';
const d = { estado: 'aceptado', iniciado: new Date(ahora - 3600000).toISOString(), actualizado: new Date(ahora - 3600000).toISOString(), id_envio: '11111111-1111-1111-1111-111111111111', intentos: 1 };
async function entorno(fn, opciones = {}) {
  const env = { ...process.env }, fetchOriginal = global.fetch;
  const cola = new Map(opciones.trabajo ? [[id, { fecha: opciones.futura ? ahora + 3600000 : ahora - 1000, version: 'original' }]] : []);
  const datos = { estado: 'confirmada', fecha: '2099-01-01', aviso_cliente_estado: 'aceptado', aviso_cliente_detalle: JSON.stringify(d), ...opciones.campos };
  const contador = { airtable: 0, resend: 0, parches: [], pausa: 0 };
  let pausado = false;
  const respuesta = result => ({ ok: true, json: async () => ({ result }) });
  try {
    Object.assign(process.env, { VERCEL_ENV: 'preview', CONTACTIA_AVISOS_SECRET: 'x'.repeat(40), KV_REST_API_URL: 'https://simulado.upstash.io', KV_REST_API_TOKEN: 'simulado', AIRTABLE_BASE_ID: 'appSimulada', AIRTABLE_API_KEY: 'simulada', RESEND_API_KEY: 'simulada' });
    global.fetch = async (url, req = {}) => {
      if (url.includes('upstash.io')) {
        if (opciones.redisCaido) throw Error('sin servicio');
        const a = JSON.parse(req.body);
        if (a[0] === 'GET') return respuesta(pausado ? '1' : null);
        if (a[0] === 'SET') { if (a[1].endsWith(':pausa')) { pausado = true; contador.pausa = a.at(-1); } return respuesta('OK'); }
        if (a[1] === VENCIDOS) return respuesta([...cola].filter(([,v]) => v.fecha <= Date.now()).flatMap(([id,v]) => [id,v.version]));
        if (a[1] === ACTUALIZAR) {
          const [, , , , , referencia, fecha, version, anterior] = a;
          if (anterior && cola.get(referencia)?.version !== anterior) return respuesta(0);
          if (!fecha) cola.delete(referencia); else cola.set(referencia, { fecha: Number(fecha), version });
          return respuesta(1);
        }
        return respuesta(1); // Liberación del mutex.
      }
      if (url.includes('airtable.com')) {
        contador.airtable++;
        if (opciones.cuota) return { ok: false, status: 429 };
        if (req.method === 'PATCH') { contador.parches.push(JSON.parse(req.body).fields); return { ok: true }; }
        const formula = new URL(url).searchParams.get('filterByFormula');
        assert.equal(formula, "OR(RECORD_ID()='recPrueba')"); // Nunca búsquedas por estado ni tabla entera.
        return { ok: true, json: async () => ({ records: opciones.ausente ? [] : [{ id, fields: datos }] }) };
      }
      if (url.includes('resend.com')) { contador.resend++; return { ok: true, json: async () => ({ id: d.id_envio, last_event: 'delivered' }) }; }
      throw Error('Destino inesperado');
    };
    const invocar = async () => {
      const res = { setHeader() {}, status(n) { this.codigo = n; return this; }, json(d) { this.datos = d; } };
      await handler({ method: 'GET', headers: { authorization: 'Bearer ' + 'x'.repeat(40) } }, res);
      return res;
    };
    await fn({ invocar, contador, cola });
  } finally { global.fetch = fetchOriginal; for (const k of Object.keys(process.env)) if (!(k in env)) delete process.env[k]; Object.assign(process.env, env); }
}
test('288 ejecuciones sin pendientes producen cero llamadas a Airtable y Resend', async () => entorno(async ({ invocar, contador }) => {
  for (let i = 0; i < 288; i++) { const r = await invocar(); assert.equal(r.codigo, 200); assert.equal(r.datos.sin_trabajo, true); }
  assert.equal(contador.airtable, 0); assert.equal(contador.resend, 0);
}));
test('aviso aún no vencido tampoco consulta Airtable', async () => entorno(async ({ invocar, contador }) => {
  assert.equal((await invocar()).datos.sin_trabajo, true); assert.equal(contador.airtable, 0);
}, { trabajo: true, futura: true }));
test('aviso vencido se consulta por ID, se entrega y sale de la cola', async () => entorno(async ({ invocar, contador, cola }) => {
  const r = await invocar(); assert.equal(r.codigo, 200); assert.equal(r.datos.comprobados, 1);
  assert.equal(contador.airtable, 2); assert.equal(contador.resend, 1); assert.equal(cola.size, 0);
  assert.ok(Object.keys(contador.parches[0]).every(k => k.startsWith('aviso_cliente_')));
  await invocar(); assert.equal(contador.airtable, 2);
}, { trabajo: true }));
for (const caso of [{ ausente: true }, { campos: { estado: 'cancelada' } }, { campos: { anonimizada: true } }]) {
  test('registro ausente, cancelado o anonimizado se retira sin correo', async () => entorno(async ({ invocar, contador, cola }) => {
    await invocar(); assert.equal(contador.airtable, 1); assert.equal(contador.resend, 0); assert.equal(cola.size, 0);
  }, { trabajo: true, ...caso }));
}
test('Airtable 429 pausa 24 horas y la siguiente ejecución no vuelve a consultar', async () => entorno(async ({ invocar, contador, cola }) => {
  assert.equal((await invocar()).codigo, 503); assert.equal(contador.pausa, 86400);
  assert.equal((await invocar()).datos.pausado, true); assert.equal(contador.airtable, 1); assert.equal(cola.size, 1);
}, { trabajo: true, cuota: true }));
test('Redis inaccesible no provoca búsquedas de respaldo en Airtable', async () => entorno(async ({ invocar, contador }) => {
  assert.equal((await invocar()).codigo, 503); assert.equal(contador.airtable, 0);
}, { redisCaido: true }));
test('comprobaciones de entrega tienen esperas crecientes y máximo cuatro', () => {
  for (const [n, espera] of [900000, 3600000, 21600000, 43200000].entries()) {
    assert.equal(proximaRevision({ ...d, comprobado: new Date(ahora).toISOString(), comprobaciones: n }, ahora), ahora + espera);
  }
  assert.equal(proximaRevision({ ...d, comprobaciones: 4 }, ahora), null);
  for (const estado of ['entregado', 'rechazado']) assert.equal(proximaRevision({ ...d, estado }, ahora), null);
  assert.equal(proximaRevision({ ...d, iniciado: new Date(ahora - 86400000).toISOString() }, ahora), null);
});
