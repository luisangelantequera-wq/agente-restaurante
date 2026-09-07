const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const {
  cifrarCopia,
  copiaContieneCamposProhibidos,
  crearCopiaSegura,
  descifrarCopia
} = require("../lib/backup");


test("la copia excluye datos personales y secretos", () => {
  const copia = crearCopiaSegura({
    RESTAURANTES: [{
      id: "recRestaurante001",
      fields: {
        id: 1,
        nombre: "Restaurante Sol",
        api_key_restaurante: "clave-no-publicable"
      }
    }],
    RESERVAS: [{
      id: "recReserva0000001",
      fields: {
        id_reserva: "SOL-20260901-ABCDEF1234",
        token_gestion: "token-no-publicable",
        nombre_completo: "Luis",
        telefono: "+34123456789",
        email: "cliente@example.com",
        mensaje: "Alergia",
        fecha: "2026-09-01",
        hora: "13:30",
        personas: 3,
        estado: "confirmada",
        mesa: ["recMesa000000001"]
      }
    }],
    LISTA_ESPERA: [{
      id: "recEspera00000001",
      fields: {
        id_espera: "ESP-123",
        nombre_completo: "Ana",
        telefono: "+34987654321",
        email: "espera@example.com",
        observaciones: "Ventana",
        fecha: "2026-09-01",
        hora: "14:00",
        personas: 2,
        estado: "pendiente",
        zona_preferida: "TERRAZA"
      }
    }],
    ZONA: [{
      id: "recZona0000000001",
      fields: {
        id_zona: "SOL-TERRAZA",
        nombre: "TERRAZA",
        horario_reservas: "{\"viernes\":[\"20:00-23:00\"]}"
      }
    }],
    CONOCIMIENTO_RESTAURANTE: [{
      id: "recConocimiento01",
      fields: {
        id_conocimiento: "SOL-TERRAZA-001",
        restaurante: ["recRestaurante001"],
        tema: "terraza",
        preguntas: "¿Tenéis terraza?",
        palabras_clave: "terraza, exterior",
        respuesta: "Sí, disponemos de terraza.",
        prioridad: 100,
        estado: "Activo"
      }
    }]
  }, "2026-08-28T20:00:00.000Z");
  const texto = JSON.stringify(copia);

  assert.equal(copia.contiene_datos_personales_clientes, false);
  assert.equal(copia.tablas.RESERVAS[0].fields.fecha, "2026-09-01");
  assert.equal(copia.tablas.RESERVAS[0].fields.personas, 3);
  assert.equal(
    copia.tablas.LISTA_ESPERA[0].fields.zona_preferida,
    "TERRAZA"
  );
  assert.equal(
    copia.tablas.ZONA[0].fields.horario_reservas,
    "{\"viernes\":[\"20:00-23:00\"]}"
  );
  assert.equal(
    copia.tablas.CONOCIMIENTO_RESTAURANTE[0].fields.respuesta,
    "Sí, disponemos de terraza."
  );
  assert.equal(copiaContieneCamposProhibidos(copia), false);
  assert.doesNotMatch(
    texto,
    /Luis|Ana|cliente@example\.com|espera@example\.com|token-no-publicable|clave-no-publicable|Alergia|Ventana/
  );
});


test("la copia cifrada se puede verificar y recuperar", () => {
  const clave = crypto.randomBytes(32).toString("base64");
  const copia = crearCopiaSegura({
    MESAS: [{
      id: "recMesa000000001",
      fields: { id: 1, nombre_mesa: "Interior 1", capacidad: 4 }
    }]
  }, "2026-08-28T20:00:00.000Z");
  const sobre = cifrarCopia(copia, clave);
  const recuperada = descifrarCopia(sobre, clave);

  assert.equal(sobre.algoritmo, "AES-256-GCM");
  assert.notEqual(sobre.contenido, JSON.stringify(copia));
  assert.deepEqual(recuperada, copia);
});


test("una clave incorrecta no puede abrir la copia", () => {
  const clave = crypto.randomBytes(32).toString("base64");
  const otraClave = crypto.randomBytes(32).toString("base64");
  const copia = crearCopiaSegura({}, "2026-08-28T20:00:00.000Z");
  const sobre = cifrarCopia(copia, clave);

  assert.throws(() => descifrarCopia(sobre, otraClave));
});

