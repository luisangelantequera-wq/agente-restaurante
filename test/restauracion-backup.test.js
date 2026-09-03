const test = require("node:test");
const assert = require("node:assert/strict");
const { crearCopiaSegura } = require("../lib/backup");
const {
  camposEnlaceRemapeados,
  camposSinEnlaces,
  crearPlanRestauracion,
  crearTokenConfirmacion,
  validarCopiaRestaurable,
  validarTokenConfirmacion
} = require("../lib/restauracion-backup");


function copiaDePrueba() {
  return crearCopiaSegura({
    RESTAURANTES: [{
      id: "recRestaurante001",
      fields: {
        id: 1,
        nombre: "Restaurante Sol",
        slug_publico: "restaurante-sol",
        prefijo_reserva: "SOL",
        estado: "activo"
      }
    }],
    ZONA: [{
      id: "recZona0000000001",
      fields: {
        id_zona: "SOL-INTERIOR",
        nombre: "Interior",
        restaurante: ["recRestaurante001"]
      }
    }],
    MESAS: [{
      id: "recMesa0000000001",
      fields: {
        id: 1,
        nombre_mesa: "Interior 1",
        capacidad: 4,
        restaurante: ["recRestaurante001"],
        zona: ["recZona0000000001"]
      }
    }],
    RESERVAS: [{
      id: "recReserva0000001",
      fields: {
        restaurante: ["recRestaurante001"],
        mesa: ["recMesa0000000001"],
        fecha: "2026-09-01",
        hora: "13:30",
        personas: 3,
        estado: "confirmada"
      }
    }]
  }, "2026-08-28T20:00:00.000Z");
}


test("la restauración valida la copia y solo crea lo que falta", () => {
  const copia = copiaDePrueba();
  const actuales = {
    RESTAURANTES: [{
      id: "recRestaurante001",
      fields: { id: 1, nombre: "Restaurante Sol" }
    }]
  };
  const plan = crearPlanRestauracion(copia, actuales, "faltantes");

  assert.equal(validarCopiaRestaurable(copia), true);
  assert.equal(plan.resumen.RESTAURANTES.crear, 0);
  assert.equal(plan.resumen.RESTAURANTES.conservar, 1);
  assert.equal(plan.resumen.MESAS.crear, 1);
  assert.equal(plan.resumen.RESERVAS.crear, 1);
  assert.equal(plan.resumen.RESERVAS.actualizar, 0);
});


test("la restauración conserva los identificadores del restaurante", () => {
  const copia = copiaDePrueba();
  const fields = camposSinEnlaces(
    "RESTAURANTES",
    copia.tablas.RESTAURANTES[0]
  );

  assert.equal(fields.slug_publico, "restaurante-sol");
  assert.equal(fields.prefijo_reserva, "SOL");
});


test("las reservas recuperadas reciben un identificador técnico sin datos personales", () => {
  const copia = copiaDePrueba();
  const reserva = copia.tablas.RESERVAS[0];
  const fields = camposSinEnlaces("RESERVAS", reserva, true);

  assert.match(fields.id_reserva, /^RECUPERADA-[A-F0-9]{20}$/);
  assert.equal(fields.fecha, "2026-09-01");
  assert.equal(Object.hasOwn(fields, "nombre_completo"), false);
  assert.equal(Object.hasOwn(fields, "telefono"), false);
  assert.equal(Object.hasOwn(fields, "email"), false);
});


test("un registro vacío existente se reconoce por su identificador de Airtable", () => {
  const copia = copiaDePrueba();
  const origenId = "recCombinacion0001";
  copia.tablas.COMBINACIONES_MESAS.push({ origen_id: origenId, fields: {} });

  const plan = crearPlanRestauracion(copia, {
    COMBINACIONES_MESAS: [{ id: origenId, fields: {} }]
  });

  assert.equal(plan.resumen.COMBINACIONES_MESAS.crear, 0);
  assert.equal(plan.resumen.COMBINACIONES_MESAS.conservar, 1);
});


test("una combinación sin identificador recibe uno técnico si debe recrearse", () => {
  const registro = {
    origen_id: "recCombinacion0002",
    fields: { nombre: "Combinación recuperada" }
  };
  const fields = camposSinEnlaces(
    "COMBINACIONES_MESAS",
    registro,
    true
  );

  assert.match(
    fields.id_combinacion,
    /^COMB-RECUPERADA-[A-F0-9]{20}$/
  );
});


test("no inventa un identificador numérico al recrear una mesa", () => {
  const copia = copiaDePrueba();
  delete copia.tablas.MESAS[0].fields.id;

  assert.throws(
    () => crearPlanRestauracion(copia, {}),
    /identificador principal de MESAS/
  );
});


test("los enlaces se reconstruyen con los nuevos identificadores de Airtable", () => {
  const copia = copiaDePrueba();
  const mapeos = {
    RESTAURANTES: new Map([["recRestaurante001", "recRestNuevo00001"]]),
    ZONA: new Map([["recZona0000000001", "recZonaNueva000001"]]),
    MESAS: new Map([["recMesa0000000001", "recMesaNueva000001"]]),
    RESERVAS: new Map(),
    COMBINACIONES_MESAS: new Map(),
    LISTA_ESPERA: new Map(),
    AUDITORIA: new Map()
  };
  const fields = camposEnlaceRemapeados(
    "RESERVAS",
    copia.tablas.RESERVAS[0],
    mapeos
  );

  assert.deepEqual(fields.restaurante, ["recRestNuevo00001"]);
  assert.deepEqual(fields.mesa, ["recMesaNueva000001"]);
});


test("la restauración rechaza campos que no pertenecen a la copia segura", () => {
  const copia = copiaDePrueba();
  copia.tablas.RESERVAS[0].fields.email = "cliente@example.com";

  assert.throws(
    () => validarCopiaRestaurable(copia),
    /personales|autorizados/
  );
});


test("la confirmación está ligada al archivo, modo y plazo de diez minutos", () => {
  const secreto = "secreto-de-restauracion";
  const datos = {
    archivo: "contactia-backup-2026-08-28.json.enc",
    sha256: "a".repeat(64),
    modo: "faltantes",
    secreto,
    ahora: 1000
  };
  const token = crearTokenConfirmacion(datos);

  assert.equal(validarTokenConfirmacion(token, datos), true);
  assert.equal(validarTokenConfirmacion(token, {
    ...datos,
    modo: "completa"
  }), false);
  assert.equal(validarTokenConfirmacion(token, {
    ...datos,
    ahora: 1000 + 10 * 60 * 1000 + 1
  }), false);
});

