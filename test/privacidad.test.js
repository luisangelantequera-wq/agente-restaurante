const test = require("node:test");
const assert = require("node:assert/strict");
const {
  calcularPrivacidadHastaDesdeAhora,
  calcularPrivacidadHastaReserva,
  crearCamposListaEsperaAnonimizada,
  crearCamposReservaAnonimizada,
  crearMetadatosPrivacidadReserva,
  fechaHoraLocalAUtc,
  obtenerPrivacidadHasta,
  registroDebeAnonimizarse
} = require("../lib/privacidad");
const {
  ejecutarAnonimizacion
} = require("../api/privacidad");


test("convierte correctamente una reserva de verano en Madrid a UTC", () => {
  assert.equal(
    fechaHoraLocalAUtc("2026-08-27", "15:00").toISOString(),
    "2026-08-27T13:00:00.000Z"
  );
});


test("convierte correctamente una reserva de invierno en Madrid a UTC", () => {
  assert.equal(
    fechaHoraLocalAUtc("2026-12-10", "15:00").toISOString(),
    "2026-12-10T14:00:00.000Z"
  );
});


test("suma la duración y 48 horas a la fecha de la reserva", () => {
  assert.equal(
    calcularPrivacidadHastaReserva({
      fecha: "2026-08-27",
      hora: "15:00",
      duracionReservaMinutos: 90
    }),
    "2026-08-29T14:30:00.000Z"
  );
});


test("una cancelación conserva los datos durante 48 horas exactas", () => {
  assert.equal(
    calcularPrivacidadHastaDesdeAhora("2026-08-27T10:00:00.000Z"),
    "2026-08-29T10:00:00.000Z"
  );
});


test("la fecha de privacidad guardada prevalece sobre el cálculo heredado", () => {
  const limite = obtenerPrivacidadHasta({
    fecha: "2026-08-27",
    hora: "15:00",
    privacidad_hasta: "2026-09-01T09:00:00.000Z"
  }, 90);

  assert.equal(limite.toISOString(), "2026-09-01T09:00:00.000Z");
});


test("no oculta datos antes del límite y sí desde el límite", () => {
  const campos = {
    privacidad_hasta: "2026-08-29T10:00:00.000Z"
  };

  assert.equal(
    registroDebeAnonimizarse(campos, 90, "2026-08-29T09:59:59.999Z"),
    false
  );
  assert.equal(
    registroDebeAnonimizarse(campos, 90, "2026-08-29T10:00:00.000Z"),
    true
  );
});


test("los metadatos guardan la duración histórica de la reserva", () => {
  assert.deepEqual(
    crearMetadatosPrivacidadReserva({
      fecha: "2026-08-27",
      hora: "15:00",
      duracionReservaMinutos: 90
    }),
    {
      duracion_reserva_minutos: 90,
      privacidad_hasta: "2026-08-29T14:30:00.000Z",
      anonimizada: false
    }
  );
});


test("la reserva pierde identificadores y contacto, pero no datos estadísticos", () => {
  const campos = crearCamposReservaAnonimizada(
    new Date("2026-08-29T14:30:00.000Z")
  );

  assert.equal(campos.id_reserva, null);
  assert.equal(campos.nombre_completo, null);
  assert.equal(campos.telefono, null);
  assert.equal(campos.email, null);
  assert.equal(campos.mensaje, null);
  assert.equal(campos.token_gestion, null);
  assert.equal(campos.anonimizada, true);
  assert.equal(campos.anonimizada_en, "2026-08-29T14:30:00.000Z");
  assert.equal(Object.hasOwn(campos, "fecha"), false);
  assert.equal(Object.hasOwn(campos, "hora"), false);
  assert.equal(Object.hasOwn(campos, "personas"), false);
  assert.equal(Object.hasOwn(campos, "mesa"), false);
  assert.equal(Object.hasOwn(campos, "estado"), false);
});


test("la lista de espera pierde también su vínculo identificativo", () => {
  const campos = crearCamposListaEsperaAnonimizada(
    new Date("2026-08-29T14:30:00.000Z")
  );

  assert.equal(campos.id_espera, null);
  assert.equal(campos.nombre_completo, null);
  assert.equal(campos.telefono, null);
  assert.equal(campos.email, null);
  assert.equal(campos.observaciones, null);
  assert.deepEqual(campos.reserva, []);
  assert.equal(campos.anonimizada, true);
});


test("la tarea de privacidad elimina conversaciones al cumplir su retención", async () => {
  const fetchAnterior = global.fetch;
  const apiKeyAnterior = process.env.AIRTABLE_API_KEY;
  const baseAnterior = process.env.AIRTABLE_BASE_ID;
  const eliminaciones = [];
  const conversacionesConAudioEliminado = [];

  process.env.AIRTABLE_API_KEY = "clave-prueba";
  process.env.AIRTABLE_BASE_ID = "appBasePrueba";
  global.fetch = async (url, opciones = {}) => {
    const direccion = new URL(String(url));
    const tabla = decodeURIComponent(direccion.pathname.split("/").at(-1));

    if (opciones.method === "DELETE") {
      eliminaciones.push({ tabla, ids: direccion.searchParams.getAll("records[]") });
      return { ok: true, status: 200, text: async () => "{}" };
    }

    if (tabla === "CONVERSACIONES") {
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          records: [{
            id: "recConversacionCaducada",
            fields: {
              id_conversacion: "CONV-CADUCADA-1234",
              transcripcion_anonimizada:
                '[{"id_turno":"T001","audio_disponible":true}]'
            }
          }]
        })
      };
    }

    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ records: [] })
    };
  };

  try {
    const resultado = await ejecutarAnonimizacion(
      new Date("2026-10-18T12:00:00.000Z"),
      {
        async eliminarAudiosConversaciones(ids) {
          conversacionesConAudioEliminado.push(...ids);
          return ids.length * 2;
        }
      }
    );

    assert.equal(resultado.conversaciones_eliminadas, 1);
    assert.equal(resultado.audios_eliminados, 2);
    assert.deepEqual(
      conversacionesConAudioEliminado,
      ["CONV-CADUCADA-1234"]
    );
    assert.deepEqual(eliminaciones, [{
      tabla: "CONVERSACIONES",
      ids: ["recConversacionCaducada"]
    }]);
  } finally {
    global.fetch = fetchAnterior;
    if (apiKeyAnterior === undefined) {
      delete process.env.AIRTABLE_API_KEY;
    } else {
      process.env.AIRTABLE_API_KEY = apiKeyAnterior;
    }
    if (baseAnterior === undefined) {
      delete process.env.AIRTABLE_BASE_ID;
    } else {
      process.env.AIRTABLE_BASE_ID = baseAnterior;
    }
  }
});

