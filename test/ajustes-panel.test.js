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
  const primera = await preguntar("¿Qué horarios tenéis?"); assert.match(primera.respuesta, /De lunes a domingo: de 13:00 a 16:00/);
  const datos = horario(); datos.horario.lunes = [];
  const actual = await llamar("consultar", "horarios"); await llamar("guardar", "horarios", { revision: actual.revision, datos });
  assert.match((await preguntar("¿Qué horarios tenéis?")).respuesta, /Cerramos los lunes/);
}));

test("ajustes: calendario especial se guarda sin cambiar tablas y responde al día solicitado", async () => escenario(async (e, llamar, preguntar) => {
  const inicial = await llamar("consultar", "horarios");
  const datos = modelo.desdeEditor({ habitual: ["13:00-16:00"], cerrados: ["lunes"], semanales: {}, especiales: [{ fecha: "12-25", rangos: [] }, { fecha: "01-01", rangos: ["14:00-17:00"] }] });
  const guardado = await llamar("guardar", "horarios", { revision: inicial.revision, datos });
  assert.equal(guardado.datos_guardados, true);
  assert.deepEqual(Object.keys(e.patches[0]).sort(), ["cierres_especiales", "dias_cierre", "horario_reservas"]);
  const leido = await llamar("consultar", "horarios");
  assert.deepEqual(leido.datos, datos);
  assert.match((await preguntar("¿Abrís el 25 de diciembre?")).respuesta, /25 de diciembre.*cerrado/);
  assert.match((await preguntar("¿Qué horarios tenéis el 1 de enero?")).respuesta, /14:00 a 17:00/);
}));
test("ajustes: cierre anual avisa de reservas afectadas y exige nueva confirmación si cambian", async () => escenario(async (e, llamar) => {
  const fecha = new Date(Date.now() + 86400000 * 7).toISOString().slice(0, 10);
  const registro = localizador => ({ id: "recPrueba", fields: { restaurante: [REST], id_reserva: localizador, fecha, hora: "14:00", estado: "confirmada" } });
  e.reservas = [registro("SOL-UNO")];
  const inicial = await llamar("consultar", "horarios");
  const datos = modelo.desdeEditor({ habitual: ["13:00-16:00"], cerrados: [], semanales: {}, especiales: [{ fecha: fecha.slice(5), rangos: [] }] });
  const previo = await llamar("guardar", "horarios", { revision: inicial.revision, datos });
  assert.equal(previo.requiere_confirmacion, true);
  e.reservas.push(registro("SOL-DOS"));
  const cambiado = await llamar("guardar", "horarios", { revision: inicial.revision, datos, confirmacion_afectadas: previo.revision_afectadas });
  assert.equal(cambiado.requiere_confirmacion, true);
  assert.equal(cambiado.reservas_afectadas.length, 2);
  assert.equal(e.patches.length, 0);
}));

test("gastronomía: información por líneas conserva días, encargos y mínimos sin inventar disponibilidad", () => {
  const texto = "Los miércoles tenemos cocido.\nLos jueves tenemos paella, por encargo y para un mínimo de dos personas.";
  const datos = { informacion: { gastronomia: texto } };
  for (const q of ["¿Tenéis cocido?", "¿Qué días tenéis cocido?", "Cocido", "¿Qué tenéis los miércoles?"]) assert.equal(modelo.responderGastronomia(datos, q), texto.split("\n")[0]);
  for (const q of ["¿Tenéis paella?", "¿Se puede encargar paella?", "¿Puedo pedir paella para una persona?", "¿Qué tenéis los jueves?"]) assert.equal(modelo.responderGastronomia(datos, q), texto.split("\n")[1]);
  assert.equal(modelo.responderGastronomia(datos, "¿Qué especialidades tenéis?"), texto);
  for (const q of ["¿Hay aparcamiento el jueves?", "¿Abrís el miércoles?", "¿Tenéis sushi?", "¿La paella tiene gluten?", "¿La paella tiene leche?", "¿Qué platos vegetarianos tenéis?"]) assert.equal(modelo.responderGastronomia(datos, q), null);
  assert.equal(modelo.responderGastronomia({ informacion: {} }, "¿Tenéis cocido?"), null);
  assert.throws(() => modelo.validarGastronomia({ gastronomia: "x".repeat(1001) }));
  assert.throws(() => modelo.validarGastronomia({ gastronomia: "Cocido", api_key: "no" }));
});
test("gastronomía: editor propio guarda solo su información, conserva contacto y FAQ y permite borrar", async () => escenario(async (e, llamar, preguntar) => {
  e.fields.informacion_publica = JSON.stringify({ mascotas: "Admitimos perros en terraza.", pagos: "Aceptamos tarjeta." });
  const inicial = await llamar("consultar", "gastronomia"); assert.equal(inicial.status, 200); assert.deepEqual(inicial.datos, { gastronomia: "", encargos: [] });
  const texto = "Los miércoles tenemos cocido.\nLos jueves tenemos paella, por encargo y para un mínimo de dos personas.";
  const r = await llamar("guardar", "gastronomia", { revision: inicial.revision, datos: { gastronomia: texto } });
  assert.equal(r.status, 200); assert.equal(r.memoria.sincronizada, true); assert.deepEqual(Object.keys(e.patches[0]), ["informacion_publica"]);
  assert.equal(JSON.parse(e.fields.informacion_publica).mascotas, "Admitimos perros en terraza."); assert.equal(JSON.parse(e.fields.informacion_publica).pagos, "Aceptamos tarjeta.");
  assert.equal((await preguntar("¿Tenéis cocido?")).respuesta, texto.split("\n")[0]);
  assert.equal((await preguntar("¿Qué días tenéis cocido?")).respuesta, texto.split("\n")[0]);
  assert.equal((await preguntar("¿Tenéis paella?")).respuesta, texto.split("\n")[1]);
  assert.equal((await preguntar("¿Hay aparcamiento el jueves?")).encontrada, false);
  assert.equal((await preguntar("¿La paella tiene gluten?")).encontrada, false);
  const consultaGeneral = await llamar("consultar", "publico"); const datos = consultaGeneral.datos; datos.informacion.pagos = "Solo efectivo.";
  const otro = await llamar("guardar", "publico", { revision: consultaGeneral.revision, datos }); assert.equal(otro.status, 200); assert.equal(JSON.parse(e.fields.informacion_publica).gastronomia, texto);
  assert.equal((await llamar("guardar", "gastronomia", { revision: inicial.revision, datos: { gastronomia: "Otro plato" } })).status, 409);
  const retirada = await llamar("guardar", "gastronomia", { revision: r.revision, datos: { gastronomia: "" } }); assert.equal(retirada.status, 200);
  assert.equal((await preguntar("¿Tenéis cocido?")).encontrada, false); assert.equal(JSON.parse(e.fields.informacion_publica).pagos, "Solo efectivo.");
}));
test("gastronomía: requiere sesión y origen, limita el tamaño y recupera la memoria sin repetir guardado", async () => escenario(async (e, llamar) => {
  assert.equal((await llamar("consultar", "gastronomia", {}, { cookie: "" })).status, 401);
  assert.equal((await llamar("consultar", "gastronomia", {}, { origin: "https://otra.example" })).status, 403);
  assert.equal(e.lecturas.length, 0);
  const inicial = await llamar("consultar", "gastronomia");
  assert.equal((await llamar("guardar", "gastronomia", { revision: inicial.revision, datos: { gastronomia: "x".repeat(1001) } })).status, 400);
  e.caido = true;const r = await llamar("guardar", "gastronomia", { revision: inicial.revision, datos: { gastronomia: "Los miércoles tenemos cocido." } });
  assert.equal(r.datos_guardados, true); assert.equal(r.memoria.sincronizada, false); e.caido = false;
  assert.equal((await llamar("sincronizar", "gastronomia")).memoria.sincronizada, true); assert.equal(e.patches.length, 1);
}));

test("pregunta de horarios con caché fría reutiliza una sola lectura de RESTAURANTES", async () =>
  escenario(async (e, _llamar, preguntar) => {
    const respuesta = await preguntar("¿Qué horarios tenéis?");
    assert.match(respuesta.respuesta, /De lunes a domingo: de 13:00 a 16:00/);
    assert.equal(e.lecturas.filter(t => t === "RESTAURANTES").length, 1,
      "La primera pregunta no debe volver a leer la misma tabla");
    const nuevaConfiguracion = horario();
    nuevaConfiguracion.horario.lunes = [];
    Object.assign(e.fields, modelo.camposHorario(nuevaConfiguracion));
    const segunda = await preguntar("¿Qué horarios tenéis?");
    assert.match(segunda.respuesta, /Cerramos los lunes/);
    assert.equal(e.lecturas.filter(t => t === "RESTAURANTES").length, 2,
      "Una petición posterior debe releer el horario actual");
  }));

test("información estable fría se reutiliza sin guardar el registro completo en Redis", async () =>
  escenario(async (e, _llamar, preguntar) => {
    const respuesta = await preguntar("¿Admitís mascotas?");
    assert.equal(respuesta.ok, true);
    assert.equal(e.lecturas.filter(t => t === "RESTAURANTES").length, 1,
      "No deben producirse dos lecturas en la primera consulta informativa");
    const valoresCache = [...e.redis.values()].map(JSON.parse);
    const contactos = valoresCache.filter(x => x.datos?.fields?.telefono1);
    assert.equal(contactos.length, 1);
    assert.deepEqual(Object.keys(contactos[0].datos.fields).sort(),
      ["id", "nombre", "telefono1", "telefono2"].filter(c => c in contactos[0].datos.fields).sort());
    assert.equal(contactos[0].datos.fields.estado, undefined);
    assert.equal(contactos[0].datos.fields.horario_reservas, undefined);
    assert.equal(contactos[0].datos.fields.informacion_publica, undefined);
  }));

test("con caché desactivada las preguntas distintas releen configuración operativa", async () =>
  escenario(async (e, _llamar, preguntar) => {
    process.env.CONTACTIA_CACHE_PUBLICA = "0";
    await preguntar("¿Qué horarios tenéis?");
    assert.equal(e.lecturas.filter(t => t === "RESTAURANTES").length, 1);
    const cambio = horario();
    cambio.horario.martes = [];
    Object.assign(e.fields, modelo.camposHorario(cambio));
    const nueva = await preguntar("¿Qué horarios tenéis?");
    assert.match(nueva.respuesta, /Cerramos los martes/);
    assert.equal(e.lecturas.filter(t => t === "RESTAURANTES").length, 2);
  }));
