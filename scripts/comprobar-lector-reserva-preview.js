"use strict";
// Prueba manual: una sola lectura de un registro anonimizado en la base de Preview.
// No se importa desde rutas ni se ejecuta en despliegues normales.
const assert = require("node:assert/strict");
const { crearLector } = require("../lib/reserva-resultado-whatsapp");
const BASE = "app6rSnGO92wrC4ml";
const REGISTRO = "recvUojqOSgpUPjKd";
async function comprobar({ env = process.env, fetchImpl = global.fetch } = {}) {
  assert.equal(env.VERCEL_ENV, "preview", "Solo Preview");
  assert.equal(env.AIRTABLE_BASE_ID, BASE, "Base de pruebas incorrecta");
  let consultas = 0;
  const lecturaEnv = { ...env,
    CONTACTIA_WHATSAPP_CONFIRMACION_HABILITADA: "1",
    CONTACTIA_WHATSAPP_LECTURA_RESERVA_HABILITADA: "1"
  };
  // Banderas solo en esta instancia aislada; no modifica process.env ni Vercel.
  const lector = crearLector({ env: lecturaEnv, fetchImpl: async (url, opciones) => {
    consultas++;
    assert.equal(consultas, 1, "No se admiten consultas adicionales");
    const destino = new URL(url);
    assert.equal(destino.origin, "https://api.airtable.com");
    assert.equal(destino.pathname, "/v0/" + BASE + "/RESERVAS");
    assert.equal(destino.searchParams.get("filterByFormula"), "RECORD_ID()='" + REGISTRO + "'");
    assert.equal(opciones.method, "GET");
    return fetchImpl(url, opciones);
  } });
  const resultado = await lector(REGISTRO);
  assert.equal(consultas, 1);
  assert.ok(resultado, "No se encontro el registro de prueba");
  assert.deepEqual(Object.keys(resultado).sort(), ["estado", "huella", "id", "whatsapp_autorizado"]);
  assert.equal(resultado.id, REGISTRO);
  assert.equal(resultado.estado, "anonimizada", "El registro ya no esta anonimizado");
  assert.equal(resultado.whatsapp_autorizado, false);
  assert.equal(resultado.huella, null);
  return { lectura_correcta: true, reserva_anonimizada_bloqueada: true,
    consultas_airtable: consultas, escrituras: 0, comunicaciones: 0 };
}
if (require.main === module) comprobar().then(r => {
  console.log("CONTACTIA_LECTOR_REAL_OK " + JSON.stringify(r));
}).catch(e => {
  // No imprimir cuerpo de Airtable, URLs, credenciales ni datos de reserva.
  console.error("CONTACTIA_LECTOR_REAL_FALLO " + JSON.stringify({
    status: Number.isInteger(e.status) ? e.status : null
  }));
  process.exitCode = 1;
});
module.exports = { comprobar };
