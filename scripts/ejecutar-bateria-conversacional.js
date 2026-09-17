const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const entrada = require("../lib/entrada-conversacional");
const zonas = require("../lib/zona-reserva");


const ZONAS_PRUEBA = [
  { nombre: "INTERIOR" },
  { nombre: "SALA VIP1" },
  { nombre: "TERRAZA" }
];


const INTERPRETES = Object.freeze({
  intencion_reserva: (caso) => entrada.esIntencionReserva(caso.entrada_cliente),
  respuesta_binaria: (caso) => entrada.interpretarRespuestaBinaria(
    caso.entrada_cliente
  ),
  validacion_datos: (caso) => entrada.interpretarValidacionDatos(
    caso.entrada_cliente
  ),
  personas: (caso) => entrada.extraerPersonas(caso.entrada_cliente),
  hora: (caso) => entrada.extraerHora(caso.entrada_cliente, true),
  zona: (caso) => zonas.extraerZonaPreferida(
    caso.entrada_cliente,
    ZONAS_PRUEBA
  )
});


function cargarCasos(ruta = path.join(
  __dirname,
  "..",
  "test",
  "casos-conversacion.json"
)) {
  return JSON.parse(fs.readFileSync(ruta, "utf8"));
}


function ejecutarBateria(casos = cargarCasos()) {
  const resultados = [];

  for (const caso of casos.filter((elemento) => elemento.activa !== false)) {
    const interpretar = INTERPRETES[caso.interprete];

    if (!interpretar) {
      resultados.push({
        id_caso: caso.id_caso,
        correcto: false,
        error: `Intérprete desconocido: ${caso.interprete}`
      });
      continue;
    }

    const obtenido = interpretar(caso);
    let error = "";

    try {
      assert.deepEqual(obtenido, caso.esperado);
    } catch {
      error = `Esperado ${JSON.stringify(caso.esperado)}; ` +
        `obtenido ${JSON.stringify(obtenido)}`;
    }

    resultados.push({
      id_caso: caso.id_caso,
      codigo_paso: caso.paso_codigo,
      entrada_cliente: caso.entrada_cliente,
      correcto: !error,
      error
    });
  }

  return resultados;
}


function imprimirInforme(resultados) {
  const fallidos = resultados.filter((resultado) => !resultado.correcto);

  for (const resultado of resultados) {
    const marca = resultado.correcto ? "OK" : "FALLO";
    const detalle = resultado.error ? ` — ${resultado.error}` : "";
    console.log(
      `${marca} ${resultado.id_caso} ${resultado.codigo_paso || ""}` +
      ` — ${resultado.entrada_cliente || ""}${detalle}`
    );
  }

  console.log(
    `\nResultado: ${resultados.length - fallidos.length}/${resultados.length} ` +
    "casos superados."
  );

  return fallidos.length === 0;
}


if (require.main === module) {
  process.exitCode = imprimirInforme(ejecutarBateria()) ? 0 : 1;
}


module.exports = {
  cargarCasos,
  ejecutarBateria,
  imprimirInforme
};
