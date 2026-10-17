"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const modelo = require("../lib/ajustes-restaurante");
const editar = require("../lib/ajustes-panel");
const info = require("../api/informacion-restaurante");
const { crearTokenSesion, COOKIE_SESION } = require("../lib/sesion-restaurante");
const REST = "recRestauranteSol";
const env = { VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: "ensayo-ajustes", AIRTABLE_BASE_ID: "appEnsayoAjustes", AIRTABLE_API_KEY: "simulada", PANEL_SESSION_SECRET: "s".repeat(64), CONTACTIA_CACHE_PUBLICA: "1", CONTACTIA_PANEL_V2: "1", CONTACTIA_MEDIR_AIRTABLE: "false", KV_REST_API_URL: "https://ejemplo.upstash.io", KV_REST_API_TOKEN: "simulado-largo-para-pruebas" };
const horario = () => ({ horario: Object.fromEntries(modelo.DIAS.map(d => [d, ["13:00-16:00", "20:00-23:00"]])), cierres: [] });
const publico = () => ({ direccion: "Calle de prueba 1", web: "https://ejemplo.invalid", informacion: Object.fromEntries(modelo.TEMAS.map(t => [t.id, t.id === "mascotas" ? "Admitimos perros en la terraza." : ""])) });
function respuesta(res) { return { ok: true, status: 200, text: async () => JSON.stringify(res), json: async () => res }; }
async function escenario(probar) {
  const anteriores = Object.fromEntries(Object.keys(env).map(k => [k, process.env[k]])), anteriorFetch = global.fetch;
  Object.assign(process.env, env);
  const estado = { fields: { id: 1, nombre: "Sol", slug_publico: "restaurante-sol", estado: "activo", telefono1: "910000000", intervalo_minutos: 15, duracion_reserva_minutos: 90, ...modelo.camposHorario(horario()), direccion: "", web: "", informacion_publica: "{}" }, patches: [], reservas: [], redis: new Map(), lecturas: [], caido: false };
  global.fetch = async (url, opciones = {}) => {
    if (String(url) === env.KV_REST_API_URL) {
      if (estado.caido) throw new Error("Redis caído");
      const comando = JSON.parse(opciones.body);
      if (comando[0] === "GET") return respuesta({ result: estado.redis.get(comando[1]) || null });
      assert.equal(comando[0], "SET"); estado.redis.set(comando[1], comando[2]); return respuesta({ result: "OK" });
    }
    const tabla = new URL(url).pathname.split("/")[3];
    estado.lecturas.push(tabla);
    if (tabla === "RESTAURANTES") {
      if (opciones.method === "PATCH") { const fields = JSON.parse(opciones.body).fields; estado.patches.push(fields); Object.assign(estado.fields, fields); return respuesta({ id: REST, fields: estado.fields }); }
      return respuesta({ records: [{ id: REST, fields: estado.fields }] });
    }
    if (tabla === "RESERVAS") return respuesta({ records: estado.reservas });
    if (tabla === "CONOCIMIENTO_RESTAURANTE") return respuesta({ records: [] });
    throw new Error("Servicio no simulado: " + tabla);
  };
  const cookie = COOKIE_SESION + "=" + crearTokenSesion(1);
  async function llamar(accion, seccion, extra = {}, headers = {}) {
    const res = { setHeader() {}, end(raw) { this.body = JSON.parse(raw); } };
    await editar({ method: "POST", headers: { host: "panel.example", origin: "https://panel.example", "content-type": "application/json", cookie, ...headers }, body: { accion: "ajustes_" + accion, restaurante_id: 1, seccion, ...extra } }, res);
    return { status: res.statusCode, ...res.body };
  }
  async function preguntar(pregunta) {
    const res = { setHeader() {}, end(raw) { this.body = JSON.parse(raw); } };
    await info({ method: "POST", headers: { "content-type": "application/json" }, body: { restaurante_id: 1, pregunta } }, res);
    return res.body;
  }
  try { return await probar(estado, llamar, preguntar); }
  finally { global.fetch = anteriorFetch; for (const [k, v] of Object.entries(anteriores)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
}

test("ajustes: horarios rechazan solapes, fechas imposibles y claves no admitidas", () => {
  assert.deepEqual(modelo.validarHorario(horario()), horario());
  for (const rangos of [["14:00-13:00"], ["13:00-16:00", "15:00-17:00"], ["24:00-25:00"]]) assert.throws(() => modelo.validarHorario({ ...horario(), horario: { ...horario().horario, lunes: rangos } }));
  assert.throws(() => modelo.validarHorario({ ...horario(), cierres: ["2026-02-30"] }));
  assert.throws(() => modelo.validarHorario({ ...horario(), horario: { ...horario().horario, secreto: [] } }));
  assert.throws(() => modelo.validarPublico({ ...publico(), web: "javascript:alert(1)" }));
});
test("ajustes: sesión, origen y producción impiden lecturas y escrituras", async () => escenario(async (e, llamar) => {
  assert.equal((await llamar("consultar", "publico", {}, { cookie: "" })).status, 401);
  assert.equal((await llamar("consultar", "publico", {}, { origin: "https://otro.example" })).status, 403);
  process.env.VERCEL_ENV = "production";
  assert.equal((await llamar("consultar", "publico")).status, 404);
  assert.equal(e.lecturas.length, 0);
}));
test("ajustes: cambiar información guarda solo campos públicos y actualiza la respuesta inmediatamente", async () => escenario(async (e, llamar, preguntar) => {
  const inicial = await llamar("consultar", "publico");
  const guardado = await llamar("guardar", "publico", { revision: inicial.revision, datos: publico(), api_key_restaurante: "no-guardar" });
  assert.equal(guardado.status, 200); assert.equal(guardado.memoria.sincronizada, true);
  assert.deepEqual(Object.keys(e.patches[0]).sort(), ["direccion", "informacion_publica", "web"]);
  const a = await preguntar("¿Admitís perros?");
  assert.equal(a.respuesta, "Admitimos perros en la terraza.");
  const lecturas = e.lecturas.filter(t => t === "RESTAURANTES").length;
  assert.equal((await preguntar("¿Admitís perros?")).respuesta, a.respuesta);
  assert.equal(e.lecturas.filter(t => t === "RESTAURANTES").length, lecturas);
  const datos = publico(); datos.informacion.mascotas = "No admitimos mascotas.";
  const b = await llamar("guardar", "publico", { revision: guardado.revision, datos });
  assert.equal(b.status, 200);
  assert.equal((await preguntar("¿Admitís perros?")).respuesta, "No admitimos mascotas.");
}));
test("ajustes: una revisión obsoleta no sobrescribe información y no hay PATCH sin cambios", async () => escenario(async (e, llamar) => {
  const inicial = await llamar("consultar", "publico");
  assert.equal((await llamar("guardar", "publico", { revision: inicial.revision, datos: inicial.datos })).status, 200);
  assert.equal(e.patches.length, 0);
  e.fields.direccion = "Cambió otro encargado";
  assert.equal((await llamar("guardar", "publico", { revision: inicial.revision, datos: publico() })).status, 409);
  assert.equal(e.patches.length, 0);
}));
test("ajustes: fallo Redis distingue guardado y reintento sin duplicar PATCH", async () => escenario(async (e, llamar) => {
  const inicial = await llamar("consultar", "publico"); e.caido = true;
  const r = await llamar("guardar", "publico", { revision: inicial.revision, datos: publico() });
  assert.equal(r.datos_guardados, true); assert.equal(r.memoria.sincronizada, false); assert.ok(r.aviso);
  e.caido = false;
  assert.equal((await llamar("sincronizar", "publico")).memoria.sincronizada, true);
  assert.equal(e.patches.length, 1);
}));
test("ajustes: horarios avisan de reservas afectadas solo del propio restaurante y no las modifican", async () => escenario(async (e, llamar) => {
  const fecha = new Date(Date.now() + 86400000 * 7).toISOString().slice(0, 10);
  e.reservas = [{ id: "recReservaPrueba1", fields: { restaurante: [REST], id_reserva: "SOL-PRUEBA-12345", fecha, hora: "14:00", estado: "confirmada" } }, { id: "recOtraReserva01", fields: { restaurante: ["recRestauranteLun"], fecha, hora: "14:00", estado: "confirmada" } }];
  const inicial = await llamar("consultar", "horarios"); const datos = horario(); datos.cierres = [fecha];
  const previo = await llamar("guardar", "horarios", { revision: inicial.revision, datos });
  assert.equal(previo.requiere_confirmacion, true); assert.equal(previo.reservas_afectadas.length, 1); assert.equal(e.patches.length, 0);
  const guardado = await llamar("guardar", "horarios", { revision: inicial.revision, datos, confirmacion_afectadas: previo.revision_afectadas });
  assert.equal(guardado.datos_guardados, true); assert.equal(guardado.memoria, null);
  assert.deepEqual(Object.keys(e.patches[0]).sort(), ["cierres_especiales", "dias_cierre", "horario_reservas"]);
  assert.equal(e.reservas[0].fields.estado, "confirmada");
}));
test("ajustes: las respuestas de horarios leen cambios operativos sin usar memoria compartida", async () => escenario(async (e, llamar, preguntar) => {
  const primera = await preguntar("¿Qué horarios tenéis?"); assert.match(primera.respuesta, /Lunes: 13:00-16:00/);
  const datos = horario(); datos.horario.lunes = [];
  const actual = await llamar("consultar", "horarios"); await llamar("guardar", "horarios", { revision: actual.revision, datos });
  assert.match((await preguntar("¿Qué horarios tenéis?")).respuesta, /Lunes: cerrado/);
}));
