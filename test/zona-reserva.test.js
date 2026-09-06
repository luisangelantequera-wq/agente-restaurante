const test = require("node:test");
const assert = require("node:assert/strict");

const chat = require("../api/chat");
const {
  extraerZonaPreferida,
  normalizarZonasPublicas,
  zonaCoincide
} = require("../lib/zona-reserva");

const RESTAURANTE_SOL = "recRestauranteSol";
const ZONA_INTERIOR = "recZonaInterior01";
const ZONA_TERRAZA = "recZonaTerraza001";
const MESA_INTERIOR = "recMesaInterior01";
const MESA_TERRAZA = "recMesaTerraza001";
const DIAS = [
  "domingo",
  "lunes",
  "martes",
  "miércoles",
  "jueves",
  "viernes",
  "sábado"
];


function horarioParaTodos(rango) {
  return JSON.stringify(Object.fromEntries(DIAS.map((dia) => [dia, [rango]])));
}


function fechaProxima() {
  const fecha = new Date();
  fecha.setDate(fecha.getDate() + 1);
  return [
    fecha.getFullYear(),
    String(fecha.getMonth() + 1).padStart(2, "0"),
    String(fecha.getDate()).padStart(2, "0")
  ].join("-");
}


function crearRespuesta() {
  return {
    statusCode: 0,
    headers: {},
    cuerpo: "",
    setHeader(nombre, valor) {
      this.headers[String(nombre).toLowerCase()] = valor;
    },
    end(cuerpo) {
      this.cuerpo = cuerpo;
      return cuerpo;
    }
  };
}


async function ejecutar(body) {
  const req = {
    method: "POST",
    headers: { "content-type": "application/json" },
    body
  };
  const res = crearRespuesta();

  await chat(req, res);

  return {
    status: res.statusCode,
    body: JSON.parse(res.cuerpo)
  };
}


function respuestaAirtable(cuerpo, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return JSON.stringify(cuerpo);
    }
  };
}


function zonas(horarioTerraza = "") {
  return [
    {
      id: ZONA_INTERIOR,
      fields: {
        id_zona: "SOL-INTERIOR",
        nombre: "INTERIOR",
        estado: "activo",
        restaurante: [RESTAURANTE_SOL],
        horario_reservas: ""
      }
    },
    {
      id: ZONA_TERRAZA,
      fields: {
        id_zona: "SOL-TERRAZA",
        nombre: "TERRAZA",
        estado: "activo",
        restaurante: [RESTAURANTE_SOL],
        horario_reservas: horarioTerraza
      }
    }
  ];
}


function instalarAirtableFalso({ horarioTerraza = "" } = {}) {
  return async (url) => {
    const ruta = new URL(url).pathname;

    if (ruta.endsWith("/RESTAURANTES")) {
      return respuestaAirtable({
        records: [{
          id: RESTAURANTE_SOL,
          fields: {
            id: 1,
            nombre: "Restaurante Sol",
            estado: "activo",
            horario_reservas: horarioParaTodos("13:00-16:00"),
            intervalo_minutos: 15,
            duracion_reserva_minutos: 90,
            margen_capacidad: 4,
            prefijo_reserva: "SOL"
          }
        }]
      });
    }

    if (ruta.endsWith("/ZONA")) {
      return respuestaAirtable({ records: zonas(horarioTerraza) });
    }

    if (ruta.endsWith("/MESAS")) {
      return respuestaAirtable({
        records: [
          {
            id: MESA_INTERIOR,
            fields: {
              id: 1,
              nombre_mesa: "Mesa interior",
              capacidad: 2,
              estado: "disponible",
              restaurante: [RESTAURANTE_SOL],
              zona: [ZONA_INTERIOR]
            }
          },
          {
            id: MESA_TERRAZA,
            fields: {
              id: 2,
              nombre_mesa: "Mesa terraza",
              capacidad: 2,
              estado: "disponible",
              restaurante: [RESTAURANTE_SOL],
              zona: [ZONA_TERRAZA]
            }
          }
        ]
      });
    }

    if (ruta.endsWith("/RESERVAS") || ruta.endsWith("/COMBINACIONES_MESAS")) {
      return respuestaAirtable({ records: [] });
    }

    throw new Error(`Consulta inesperada: ${url}`);
  };
}


test("reconoce las zonas configuradas y sus expresiones habituales", () => {
  const zonasPublicas = normalizarZonasPublicas([
    { nombre: "INTERIOR" },
    { nombre: "TERRAZA" },
    { nombre: "SALA VIP" }
  ]);

  assert.equal(
    extraerZonaPreferida("Queremos estar fuera, por favor", zonasPublicas),
    "TERRAZA"
  );
  assert.equal(
    extraerZonaPreferida("Mejor dentro", zonasPublicas),
    "INTERIOR"
  );
  assert.equal(
    extraerZonaPreferida("¿Puede ser en la vip?", zonasPublicas),
    "SALA VIP"
  );
  assert.equal(
    zonaCoincide("terraza", {
      nombre: "TERRAZA",
      id_zona: "SOL-TERRAZA"
    }),
    true
  );
});


test("si hay zonas, la API exige elegir una antes de buscar mesa", async () => {
  const fetchOriginal = global.fetch;
  global.fetch = instalarAirtableFalso();

  try {
    const respuesta = await ejecutar({
      accion: "verificar",
      restaurante_id: 1,
      fecha: fechaProxima(),
      hora: "14:00",
      personas: 2
    });

    assert.equal(respuesta.status, 200);
    assert.equal(respuesta.body.requiere_zona, true);
    assert.deepEqual(respuesta.body.zonas_disponibles, [
      "INTERIOR",
      "TERRAZA"
    ]);
  } finally {
    global.fetch = fetchOriginal;
  }
});


test("la disponibilidad se limita a las mesas de la zona elegida", async () => {
  const fetchOriginal = global.fetch;
  global.fetch = instalarAirtableFalso();

  try {
    const respuesta = await ejecutar({
      accion: "verificar",
      restaurante_id: 1,
      fecha: fechaProxima(),
      hora: "14:00",
      personas: 2,
      zona_preferida: "terraza"
    });

    assert.equal(respuesta.status, 200);
    assert.equal(respuesta.body.disponible, true);
    assert.equal(respuesta.body.zona, "TERRAZA");
    assert.deepEqual(respuesta.body.mesa.ids, [MESA_TERRAZA]);
  } finally {
    global.fetch = fetchOriginal;
  }
});


test("el horario propio de una zona prevalece sobre el general", async () => {
  const fetchOriginal = global.fetch;
  global.fetch = instalarAirtableFalso({
    horarioTerraza: horarioParaTodos("20:00-22:00")
  });

  try {
    const respuesta = await ejecutar({
      accion: "verificar",
      restaurante_id: 1,
      fecha: fechaProxima(),
      hora: "14:00",
      personas: 2,
      zona_preferida: "terraza"
    });

    assert.equal(respuesta.status, 200);
    assert.equal(respuesta.body.disponible, false);
    assert.equal(respuesta.body.zona, "TERRAZA");
    assert.match(respuesta.body.motivo, /20:00-22:00/);
  } finally {
    global.fetch = fetchOriginal;
  }
});


test("la confirmación por correo conserva la zona elegida", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const fuente = fs.readFileSync(
    path.join(__dirname, "..", "api", "chat.js"),
    "utf8"
  );

  assert.match(fuente, /Zona:\s*\$\{zonaConfirmada\}/);
  assert.match(fuente, /<strong>Zona:<\/strong>/);
  assert.match(fuente, /zona:\s*nombreZona\(zonaReserva\)/);
});
