const assert = require("node:assert/strict");
const test = require("node:test");

const {
  obtenerAntelacionMinimaReserva,
  validarAntelacionReserva
} = require("./antelacion-reserva");


test("usa 30 minutos cuando el restaurante no configura la antelación", () => {
  assert.equal(obtenerAntelacionMinimaReserva({}), 30);
  assert.equal(
    obtenerAntelacionMinimaReserva({
      antelacion_minima_reserva_minutos: 45
    }),
    45
  );
});


test("rechaza una fecha y hora pasadas en horario de Madrid", () => {
  const resultado = validarAntelacionReserva({
    fecha: "2026-09-15",
    hora: "09:00",
    antelacionMinimaMinutos: 30,
    ahora: new Date("2026-09-15T10:00:00Z")
  });

  assert.equal(resultado.valido, false);
  assert.equal(resultado.cambioRequerido, "hora");
  assert.equal(
    resultado.motivo,
    "Hoy ya no es posible reservar a esa hora. Indícame otra hora."
  );
});


test("rechaza una reserva con menos de 30 minutos", () => {
  const resultado = validarAntelacionReserva({
    fecha: "2026-09-15",
    hora: "12:20",
    antelacionMinimaMinutos: 30,
    ahora: new Date("2026-09-15T10:00:30Z")
  });

  assert.equal(resultado.valido, false);
  assert.match(resultado.motivo, /al menos 30 minutos/);
});


test("acepta una reserva que cumple exactamente la antelación", () => {
  const resultado = validarAntelacionReserva({
    fecha: "2026-09-15",
    hora: "12:30",
    antelacionMinimaMinutos: 30,
    ahora: new Date("2026-09-15T10:00:00Z")
  });

  assert.equal(resultado.valido, true);
});


test("aplica correctamente el horario de invierno de Madrid", () => {
  const resultado = validarAntelacionReserva({
    fecha: "2026-12-15",
    hora: "12:30",
    antelacionMinimaMinutos: 30,
    ahora: new Date("2026-12-15T11:00:00Z")
  });

  assert.equal(resultado.valido, true);
});
