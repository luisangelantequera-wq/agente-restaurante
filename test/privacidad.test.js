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

