const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const centroApi = require("../api/centro-conversaciones");
const {
  COOKIE_SESION_CONTACTIA,
  DURACION_SESION_CONTACTIA_SEGUNDOS,
  crearTokenSesionContactia,
  validarTokenSesionContactia
} = require("../lib/sesion-contactia");


function ejecutar(req) {
  return new Promise((resolve) => {
    const res = {
      statusCode: 0,
      headers: {},
      setHeader(nombre, valor) {
        this.headers[nombre] = valor;
      },
      end(cuerpo) {
        resolve({
          status: this.statusCode,
          headers: this.headers,
          body: JSON.parse(cuerpo)
        });
      }
    };

    centroApi(req, res);
  });
}


function solicitud(cuerpo, cookie = "") {
  return {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie
    },
    body: cuerpo
  };
}


function guardarEntorno() {
  return Object.fromEntries([
    "VERCEL_ENV",
    "CONTACTIA_CENTRO_SECRET",
    "AIRTABLE_API_KEY",
    "AIRTABLE_BASE_ID",
    "AIRTABLE_CONVERSACIONES_TABLE"
  ].map((nombre) => [nombre, process.env[nombre]]));
}


function restaurarEntorno(anterior) {
  for (const [nombre, valor] of Object.entries(anterior)) {
    if (valor === undefined) {
      delete process.env[nombre];
    } else {
      process.env[nombre] = valor;
    }
  }
}


test("el centro administrativo no existe en Producción", async () => {
  const anterior = guardarEntorno();
  const fetchAnterior = global.fetch;
  let consultas = 0;

  process.env.VERCEL_ENV = "production";
  process.env.CONTACTIA_CENTRO_SECRET = "clave-contactia-de-prueba-con-32-caracteres";
  global.fetch = async () => {
    consultas += 1;
  };

  try {
    const respuesta = await ejecutar(solicitud({ accion: "listar" }));

    assert.equal(respuesta.status, 404);
    assert.equal(consultas, 0);
  } finally {
    global.fetch = fetchAnterior;
    restaurarEntorno(anterior);
  }
});


test("la sesión de Contactia está firmada, caduca y no sirve si se altera", () => {
  const anterior = guardarEntorno();
  process.env.CONTACTIA_CENTRO_SECRET = "clave-contactia-de-prueba-con-32-caracteres";
  const ahora = Date.parse("2026-09-18T10:00:00.000Z");

  try {
    const token = crearTokenSesionContactia(ahora);

    assert.equal(validarTokenSesionContactia(token, ahora + 1000), true);
    assert.equal(
      validarTokenSesionContactia(
        token,
        ahora + DURACION_SESION_CONTACTIA_SEGUNDOS * 1000 + 1
      ),
      false
    );
    assert.equal(validarTokenSesionContactia(`${token}x`, ahora + 1000), false);
  } finally {
    restaurarEntorno(anterior);
  }
});


test("solo la clave administrativa correcta crea la cookie HttpOnly", async () => {
  const anterior = guardarEntorno();
  process.env.VERCEL_ENV = "preview";
  process.env.CONTACTIA_CENTRO_SECRET = "clave-contactia-de-prueba-con-32-caracteres";

  try {
    const incorrecta = await ejecutar(solicitud({
      accion: "iniciar_sesion",
      clave: "incorrecta"
    }));
    assert.equal(incorrecta.status, 401);
    assert.equal(incorrecta.headers["Set-Cookie"], undefined);

    const correcta = await ejecutar(solicitud({
      accion: "iniciar_sesion",
      clave: process.env.CONTACTIA_CENTRO_SECRET
    }));
    assert.equal(correcta.status, 200);
    assert.match(correcta.headers["Set-Cookie"], new RegExp(`^${COOKIE_SESION_CONTACTIA}=`));
    assert.match(correcta.headers["Set-Cookie"], /HttpOnly/);
    assert.match(correcta.headers["Set-Cookie"], /Secure/);
    assert.match(correcta.headers["Set-Cookie"], /SameSite=Strict/);
  } finally {
    restaurarEntorno(anterior);
  }
});


test("listar exige sesión y devuelve únicamente datos anonimizados", async () => {
  const anterior = guardarEntorno();
  const fetchAnterior = global.fetch;
  process.env.VERCEL_ENV = "preview";
  process.env.CONTACTIA_CENTRO_SECRET = "clave-contactia-de-prueba-con-32-caracteres";
  process.env.AIRTABLE_API_KEY = "patPrueba";
  process.env.AIRTABLE_BASE_ID = "appPrueba";

  try {
    const sinSesion = await ejecutar(solicitud({ accion: "listar" }));
    assert.equal(sinSesion.status, 401);

    const token = crearTokenSesionContactia();
    const cookie = `${COOKIE_SESION_CONTACTIA}=${encodeURIComponent(token)}`;
    let urlConsultada = "";
    global.fetch = async (url) => {
      urlConsultada = String(url);
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          records: [
            {
              id: "recIncidencia",
              fields: {
                id_conversacion: "CONV-INCIDENCIA-1234",
                slug_publico: "restaurante-sol",
                canal: "voz",
                Idioma: "Español",
                Resultado: "Sin completar",
                iniciado_en: "2026-09-18T11:59:58.000Z",
                actualizado_en: "2026-09-18T12:00:00.000Z",
                estado: "cerrada",
                ultimo_paso: "RES-04",
                numero_turnos: 3,
                numero_repreguntas: 1,
                requiere_revision: true,
                tipo_revision: "repregunta",
                pasos_revision: "RES-04",
                motivo_revision: "1 repregunta en RES-04.",
                transcripcion_anonimizada: JSON.stringify([
                  {
                    id_turno: "T001",
                    codigo_paso: "RES-04",
                    actor: "cliente",
                    texto: "demtro",
                    audio_disponible: true,
                    creado_en: "2026-09-18T12:00:00.000Z"
                  }
                ]),
                email_privado_que_no_debe_salir: "persona@example.invalid"
              }
            },
            {
              id: "recCorrecta",
              fields: {
                id_conversacion: "CONV-CORRECTA-1234",
                Idioma: "Inglés",
                Resultado: "Reserva confirmada",
                requiere_revision: false,
                transcripcion_anonimizada: "[]"
              }
            }
          ]
        })
      };
    };

    const respuesta = await ejecutar(solicitud({
      accion: "listar",
      filtros: {
        revision: "con_incidencia",
        idioma: "todos",
        resultado: "todos"
      }
    }, cookie));

    assert.equal(respuesta.status, 200);
    assert.equal(respuesta.body.conversaciones.length, 1);
    assert.equal(respuesta.body.resumen.con_incidencia, 1);
    assert.equal(
      respuesta.body.conversaciones[0].iniciado_en,
      "2026-09-18T11:59:58.000Z"
    );
    assert.equal(
      respuesta.body.conversaciones[0].actualizado_en,
      "2026-09-18T12:00:00.000Z"
    );
    assert.equal(respuesta.body.conversaciones[0].transcripcion[0].texto, "demtro");
    assert.equal(
      respuesta.body.conversaciones[0].transcripcion[0].audio_disponible,
      true
    );
    assert.equal(
      JSON.stringify(respuesta.body).includes("persona@example.invalid"),
      false
    );
    assert.match(urlConsultada, /CONVERSACIONES/);
    assert.match(urlConsultada, /actualizado_en/);
  } finally {
    global.fetch = fetchAnterior;
    restaurarEntorno(anterior);
  }
});


test("rechaza filtros que no están en las listas permitidas", async () => {
  const anterior = guardarEntorno();
  process.env.VERCEL_ENV = "preview";
  process.env.CONTACTIA_CENTRO_SECRET = "clave-contactia-de-prueba-con-32-caracteres";
  const token = crearTokenSesionContactia();

  try {
    const respuesta = await ejecutar(solicitud({
      accion: "listar",
      filtros: { revision: "=BORRAR()", idioma: "todos", resultado: "todos" }
    }, `${COOKIE_SESION_CONTACTIA}=${encodeURIComponent(token)}`));

    assert.equal(respuesta.status, 400);
  } finally {
    restaurarEntorno(anterior);
  }
});


test("la página interna es independiente y no se enlaza desde el restaurante", () => {
  const centroHtml = fs.readFileSync(
    path.join(__dirname, "..", "centro-contactia.html"),
    "utf8"
  );
  const centroJs = fs.readFileSync(
    path.join(__dirname, "..", "centro-contactia.js"),
    "utf8"
  );
  const paginasPublicas = ["index.html", "restaurante.html"]
    .map((archivo) => fs.readFileSync(path.join(__dirname, "..", archivo), "utf8"))
    .join("\n");

  assert.match(centroHtml, /Acceso exclusivo de Contactia/);
  assert.match(centroHtml, /noindex, nofollow, noarchive/);
  assert.ok(
    centroHtml.indexOf('<option value="todas">Todas</option>') <
      centroHtml.indexOf('<option value="con_incidencia">Con incidencias</option>')
  );
  assert.match(centroJs, /textContent/);
  assert.match(centroJs, /\/api\/audio-conversacion/);
  assert.match(centroJs, /Escuchar/);
  assert.doesNotMatch(centroJs, /localStorage|sessionStorage/);
  assert.doesNotMatch(paginasPublicas, /centro-contactia/);
});

test("revisión de retenciones exige sesión, Preview e identificadores válidos", async () => {
  const anterior = guardarEntorno();
  process.env.VERCEL_ENV = 'preview';
  process.env.CONTACTIA_CENTRO_SECRET = 'clave-contactia-de-prueba-con-32-caracteres';
  try {
    for (const accion of ['listar_retenciones', 'comprobar_retencion', 'listar_avisos']) {
      assert.equal((await ejecutar(solicitud({ accion }))).status, 401);
    }
    const cookie = `${COOKIE_SESION_CONTACTIA}=${encodeURIComponent(crearTokenSesionContactia())}`;
    assert.equal((await ejecutar(solicitud({ accion: 'comprobar_retencion', id: 'invalido' }, cookie))).status, 400);
    process.env.VERCEL_ENV = 'production';
    assert.equal((await ejecutar(solicitud({ accion: 'listar_retenciones' }, cookie))).status, 404);
  } finally { restaurarEntorno(anterior); }
});
