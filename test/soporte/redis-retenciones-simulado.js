const assert = require("node:assert/strict");
const { crearAlmacenRetenciones, LEER, CAS } = require("../../lib/retenciones-mesas");

function crearRedisSimulado() {
  const documentos = new Map();
  let ahora = Date.now();
  let disponible = true;
  const ejecutar = async ([cmd, script, n, clave, previo, nuevo, limite]) => {
    if (!disponible) throw new Error("Redis no disponible");
    assert.equal(cmd, "EVAL"); assert.equal(n, 1);
    if (script === LEER) return [documentos.get(clave) || "", Math.floor(ahora / 1000), (ahora % 1000) * 1000];
    assert.equal(script, CAS);
    if (ahora >= limite || (documentos.get(clave) || "") !== previo) return 0;
    documentos.set(clave, nuevo); return 1;
  };
  return { ejecutar, documentos, instancia: () => crearAlmacenRetenciones({ ejecutar }),
    avanzar: ms => { ahora += ms; }, fallar: () => { disponible = false; } };
}

module.exports = { crearRedisSimulado };
