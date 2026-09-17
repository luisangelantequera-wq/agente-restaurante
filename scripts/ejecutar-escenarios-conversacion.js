const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const {
  crearSimuladorConversacion
} = require("../test/soporte/simulador-conversacion");


const VALORES_PRUEBA = Object.freeze({
  $EMAIL_PRUEBA: "cliente.prueba@example.invalid",
  $NOMBRE_PRUEBA: "Cliente Prueba",
  $TELEFONO_NORMALIZADO: "+34" + "6" + "0".repeat(8),
  $TELEFONO_PRUEBA: "6" + "0".repeat(8)
});


function resolverValorPrueba(valor) {
  return typeof valor === "string" && Object.hasOwn(VALORES_PRUEBA, valor)
    ? VALORES_PRUEBA[valor]
    : valor;
}


function cargarEscenarios(ruta = path.join(
  __dirname,
  "..",
  "test",
  "escenarios-conversacion.json"
)) {
  return JSON.parse(fs.readFileSync(ruta, "utf8"));
}


function comprobarFragmentos(texto, incluidos = [], excluidos = []) {
  for (const fragmento of incluidos) {
    assert.ok(
      texto.includes(fragmento),
      `No se encontró ${JSON.stringify(fragmento)} en ${JSON.stringify(texto)}`
    );
  }

  for (const fragmento of excluidos) {
    assert.ok(
      !texto.includes(fragmento),
      `No debía aparecer ${JSON.stringify(fragmento)} en ${JSON.stringify(texto)}`
    );
  }
}


async function ejecutarEscenario(escenario) {
  const simulador = await crearSimuladorConversacion({
    hash: escenario.hash,
    ...escenario.servidor
  });
  let ultimaRespuesta = "";

  for (const turno of escenario.turnos) {
    const entrada = resolverValorPrueba(turno.entrada);
    const resultado = await simulador.enviar(entrada);
    ultimaRespuesta = resultado.respuesta;

    if (turno.paso) {
      assert.equal(
        resultado.paso,
        turno.paso,
        `${escenario.id_escenario}: paso tras ${JSON.stringify(turno.entrada)}`
      );
    }

    comprobarFragmentos(
      resultado.respuesta,
      turno.respuesta_incluye,
      turno.respuesta_no_incluye
    );
  }

  for (const [accion, cantidad] of Object.entries(
    escenario.acciones_esperadas || {}
  )) {
    assert.equal(
      simulador.solicitudes.filter((solicitud) => solicitud.accion === accion).length,
      cantidad,
      `${escenario.id_escenario}: número de solicitudes ${accion}`
    );
  }

  if (escenario.payload_esperado) {
    const solicitudes = simulador.solicitudes.filter(
      (solicitud) => solicitud.accion === escenario.payload_esperado.accion
    );
    const payload = solicitudes.at(-1);

    assert.ok(payload, `${escenario.id_escenario}: falta el payload esperado`);

    for (const [campo, valor] of Object.entries(
      escenario.payload_esperado.contiene || {}
    )) {
      assert.deepEqual(
        payload[campo],
        resolverValorPrueba(valor),
        `${escenario.id_escenario}: campo ${campo}`
      );
    }
  }

  comprobarFragmentos(
    ultimaRespuesta,
    [],
    escenario.respuesta_final_no_incluye
  );

  return {
    id_escenario: escenario.id_escenario,
    nombre: escenario.nombre,
    correcto: true,
    turnos: escenario.turnos.length,
    solicitudes: simulador.solicitudes.length
  };
}


async function ejecutarEscenarios(escenarios = cargarEscenarios()) {
  const resultados = [];

  for (const escenario of escenarios) {
    try {
      resultados.push(await ejecutarEscenario(escenario));
    } catch (error) {
      resultados.push({
        id_escenario: escenario.id_escenario,
        nombre: escenario.nombre,
        correcto: false,
        error: error.message
      });
    }
  }

  return resultados;
}


function imprimirInforme(resultados) {
  const fallidos = resultados.filter((resultado) => !resultado.correcto);

  for (const resultado of resultados) {
    console.log(
      `${resultado.correcto ? "OK" : "FALLO"} ${resultado.id_escenario}` +
      ` — ${resultado.nombre}` +
      (resultado.error ? ` — ${resultado.error}` : "")
    );
  }

  console.log(
    `\nResultado de flujos: ${resultados.length - fallidos.length}/` +
    `${resultados.length} escenarios superados.`
  );

  return fallidos.length === 0;
}


if (require.main === module) {
  ejecutarEscenarios().then((resultados) => {
    process.exitCode = imprimirInforme(resultados) ? 0 : 1;
  });
}


module.exports = {
  cargarEscenarios,
  ejecutarEscenario,
  ejecutarEscenarios,
  imprimirInforme
};
