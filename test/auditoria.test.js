const test = require("node:test");
const assert = require("node:assert/strict");
const {
  crearCamposAuditoria,
  registrarAuditoria
} = require("../lib/auditoria");


test("la auditoría elimina datos personales y tokens de los detalles", () => {
  const campos = crearCamposAuditoria({
    restauranteId: 1,
    reservaId: "SOL-20260828-ABCDEF1234",
    accion: "reserva_modificada",
    origen: "web_cliente",
    estadoAnterior: "confirmada",
    estadoNuevo: "confirmada",
    detalles: {
      anterior: {
        fecha: "2026-08-28",
        hora: "14:00",
        personas: 2,
        nombre: "Nombre que no debe guardarse",
        email: "persona@example.com",
        telefono: "+34123456789",
        token_gestion: "secreto"
      },
      nuevo: {
        fecha: "2026-08-29",
        hora: "14:30",
        personas: 3,
        mesas: ["recMesa000000001"]
      }
    },
    ahora: "2026-08-28T20:00:00.000Z"
  });
  const detalles = JSON.parse(campos.detalles);

  assert.equal(campos.fecha_hora, "2026-08-28T20:00:00.000Z");
  assert.equal(detalles.anterior.fecha, "2026-08-28");
  assert.equal(detalles.nuevo.personas, 3);
  assert.equal(Object.hasOwn(detalles.anterior, "nombre"), false);
  assert.equal(Object.hasOwn(detalles.anterior, "email"), false);
  assert.equal(Object.hasOwn(detalles.anterior, "telefono"), false);
  assert.equal(Object.hasOwn(detalles.anterior, "token_gestion"), false);
  assert.doesNotMatch(campos.detalles, /persona@example\.com|secreto/);
});


test("el registro de auditoría usa únicamente la tabla AUDITORIA", async () => {
  const fetchOriginal = global.fetch;
  const apiKeyAnterior = process.env.AIRTABLE_API_KEY;
  const baseAnterior = process.env.AIRTABLE_BASE_ID;
  let solicitud = null;

  process.env.AIRTABLE_API_KEY = "clave-de-prueba";
  process.env.AIRTABLE_BASE_ID = "appBaseDePrueba01";
  global.fetch = async (url, opciones) => {
    solicitud = { url, opciones };
    return { ok: true, status: 200 };
  };

  try {
    const registrada = await registrarAuditoria({
      restauranteId: 1,
      reservaId: "SOL-20260828-ABCDEF1234",
      accion: "reserva_cancelada",
      origen: "panel_restaurante",
      estadoAnterior: "confirmada",
      estadoNuevo: "cancelada",
      detalles: {
        anterior: { estado: "confirmada" },
        nuevo: { estado: "cancelada" }
      }
    });

    assert.equal(registrada, true);
    assert.match(solicitud.url, /\/AUDITORIA$/);
    assert.equal(solicitud.opciones.method, "POST");
    assert.equal(
      solicitud.opciones.headers.Authorization,
      "Bearer clave-de-prueba"
    );
    assert.equal(
      JSON.parse(solicitud.opciones.body).fields.accion,
      "reserva_cancelada"
    );
  } finally {
    global.fetch = fetchOriginal;

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

