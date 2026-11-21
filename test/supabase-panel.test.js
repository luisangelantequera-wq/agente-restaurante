const test = require('node:test');
const assert = require('node:assert/strict');
const { crearLectorPanel } = require('../lib/supabase-panel');
const opciones = { url: 'https://prueba.supabase.co', publishableKey: 'sb_publishable_prueba' };

test('rechaza claves privilegiadas y destinos inseguros', () => {
  for (const publishableKey of ['sb_secret_prueba', '',
    'x.' + Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url') + '.x']) {
    assert.throws(() => crearLectorPanel({ ...opciones, publishableKey }));
  }
  assert.throws(() => crearLectorPanel({ ...opciones, url: 'http://prueba.supabase.co' }));
});

test('sin sesión válida no consulta ningún proveedor', async () => {
  const lector = crearLectorPanel({ ...opciones, fetchImpl() { assert.fail('No debe consultar'); } });
  for (const accessToken of ['', null, 'con espacios', opciones.publishableKey]) {
    await assert.rejects(lector.leerConfiguracion({ accessToken, restauranteId: 1 }));
  }
  await assert.rejects(lector.leerConfiguracion({ accessToken: 'jwt-usuario', restauranteId: '1' }));
});

test('usa JWT del usuario y filtros de restaurante, sin datos secretos en la selección', async () => {
  const llamadas = [];
  const lector = crearLectorPanel({ ...opciones, fetchImpl: async (url, init) => {
    const u = new URL(url);
    llamadas.push(u);
    assert.equal(init.headers.Authorization, 'Bearer jwt-usuario');
    assert.equal(init.headers.apikey, opciones.publishableKey);
    assert.equal(init.redirect, 'error');
    assert.equal(init.cache, 'no-store');
    assert.ok(!u.searchParams.get('select').includes('*'));
    assert.ok(!u.searchParams.get('select').includes('airtable_record_id'));
    return { ok: true, json: async () => u.pathname.endsWith('/restaurantes') ? [{ id: 1 }] : [] };
  } });
  assert.deepEqual(await lector.leerConfiguracion({ accessToken: 'jwt-usuario', restauranteId: 1 }),
    { restaurante: { id: 1 }, zonas: [], mesas: [] });
  assert.equal(llamadas.length, 3);
  assert.equal(llamadas[0].searchParams.get('id'), 'eq.1');
  assert.ok(llamadas.slice(1).every(u => u.searchParams.get('restaurante_id') === 'eq.1'));
});

test('un restaurante invisible por RLS impide leer zonas y mesas', async () => {
  let llamadas = 0;
  const lector = crearLectorPanel({ ...opciones, fetchImpl: async () => {
    llamadas++;
    return { ok: true, json: async () => [] };
  } });
  await assert.rejects(lector.leerConfiguracion({ accessToken: 'jwt-otro', restauranteId: 2 }));
  assert.equal(llamadas, 1);
});

test('errores del proveedor no filtran información ni provocan fallback a Airtable', async () => {
  const lector = crearLectorPanel({ ...opciones, fetchImpl: async () => ({
    ok: false, json: () => assert.fail('No debe exponer errores internos')
  }) });
  await assert.rejects(lector.leerConfiguracion({ accessToken: 'jwt-usuario', restauranteId: 1 }),
    { message: 'No se pudo consultar la configuración autorizada.' });
});
