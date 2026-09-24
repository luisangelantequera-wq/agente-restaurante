// Comprobación contra el Upstash de Preview usando sus variables ya configuradas.
// No consulta Airtable, no crea reservas y no envía correos.
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { desdeEntorno } = require("../lib/retenciones-mesas");

async function comprobar() {
  const almacen = desdeEntorno();
  if (!almacen) throw new Error("Active CONTACTIA_RETENCIONES=1 solo en Preview para esta comprobación.");
  const restaurante = `diagnostico-${crypto.randomBytes(8).toString("hex")}`;
  const datos = { fecha: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
    hora: "14:00", duracion: 90, personas: 2, zona: "prueba" };
  const candidatos = [{ ids: ["mesaDiagnostico"] }];
  const tokens = [];
  try {
    const resultados = await Promise.allSettled([
      almacen.adquirir(restaurante, datos, candidatos),
      almacen.adquirir(restaurante, datos, candidatos)
    ]);
    for (const r of resultados) if (r.status === "fulfilled" && r.value) tokens.push(r.value.token);
    assert.equal(resultados.filter(r => r.status === "rejected").length, 0);
    assert.equal(tokens.length, 1);
    const token = tokens[0];
    await almacen.iniciar(restaurante, token, datos);
    assert.equal(await almacen.liberar(restaurante, token), false);
    assert.equal(await almacen.adquirir(restaurante, datos, candidatos), null);
    // Es seguro descartar: este script nunca ha escrito nada en Airtable.
    await almacen.descartar(restaurante, token);
    const siguiente = await almacen.adquirir(restaurante, datos, candidatos);
    assert.ok(siguiente);
    tokens.push(siguiente.token);
    console.log("OK: exclusión simultánea, inicio de confirmación y liberación en Upstash Preview.");
  } finally {
    await Promise.all(tokens.map(token => almacen.descartar(restaurante, token)));
  }
}

comprobar().catch(() => {
  console.error("No se ha superado la comprobación de retenciones. Revise configuración y conectividad de Preview; no se han creado reservas.");
  process.exitCode = 1;
});
