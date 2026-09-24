const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");
const moduloRetenciones = require("../lib/retenciones-mesas");
const { crearRedisSimulado } = require("./soporte/redis-retenciones-simulado");
const archivo = path.join(__dirname, "../api/chat.js");
const codigo = fs.readFileSync(archivo, "utf8");
const requerir = createRequire(archivo);
const REST = "recRestauranteSol", MESA = "recMesa0000000001", ZONA = "recZona0000000001";
const fecha = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
const datos = { restaurante_id: 1, fecha, hora: "14:00", personas: 4, zona_preferida: "TERRAZA" };
const contacto = { nombre: "Prueba", email: "prueba@example.com", telefono: "+34600111222" };

function entorno() {
  const redis = crearRedisSimulado(), reservas = new Map();
  const escrituras = [];
  let fallarPost = false, cantidad = 0;
  const restaurante = { id: REST, fields: { id: 1, nombre: "Restaurante Sol", estado: "activo",
    horario_reservas: JSON.stringify(Object.fromEntries(["lunes", "martes", "miercoles", "jueves", "viernes", "sabado", "domingo"].map(d => [d, ["13:00-23:00"]]))),
    duracion_reserva_minutos: 90, intervalo_minutos: 15, margen_capacidad: 2, prefijo_reserva: "SOL",
    api_key_restaurante: "claveprueba" } };
  const zona = { id: ZONA, fields: { nombre: "TERRAZA", restaurante: [REST], estado: "activo" } };
  const mesa = { id: MESA, fields: { nombre_mesa: "Mesa", restaurante: [REST], zona: [ZONA], capacidad: 4, estado: "libre" } };
  const respuesta = datos => ({ ok: true, status: 200, text: async () => JSON.stringify(datos) });
  const fetchFalso = async (url, opciones = {}) => {
    const u = new URL(url), partes = u.pathname.split("/"), tabla = partes[3], id = partes[4];
    if (tabla === "RESTAURANTES") return respuesta({ records: [restaurante] });
    if (tabla === "ZONA") return respuesta(id ? zona : { records: [zona] });
    if (tabla === "MESAS") return respuesta(id ? mesa : { records: [mesa] });
    if (tabla === "COMBINACIONES_MESAS") return respuesta({ records: [] });
    assert.equal(tabla, "RESERVAS", `No debe llamar a servicios reales: ${tabla}`);
    if (opciones.method === "POST") {
      const r = { id: `rec${String(++cantidad).padStart(14, "0")}`, createdTime: new Date().toISOString(), ...JSON.parse(opciones.body) };
      reservas.set(r.id, r); escrituras.push(structuredClone(r));
      if (fallarPost) throw new Error("Respuesta perdida tras guardar");
      return respuesta(r);
    }
    if (opciones.method === "PATCH") {
      const r = reservas.get(id); assert.ok(r);
      Object.assign(r.fields, JSON.parse(opciones.body).fields); escrituras.push(structuredClone(r));
      return respuesta(r);
    }
    if (id) return respuesta(reservas.get(id));
    const formula = u.searchParams.get("filterByFormula") || "";
    const registros = [...reservas.values()].filter(r => {
      if (formula.includes("{id_reserva}=")) return formula.includes(r.fields.id_reserva);
      if (formula.includes("{token_gestion}=")) return formula.includes(r.fields.token_gestion);
      if (formula.includes("'pendiente'")) return ["pendiente", "confirmada", "ocupada", "con retraso", "cobrada"].includes(r.fields.estado);
      return ["confirmada", "ocupada", "con retraso", "cobrada"].includes(r.fields.estado);
    });
    return respuesta({ records: registros });
  };
  function instancia() {
    const contexto = vm.createContext({
      require: nombre => nombre === "../lib/retenciones-mesas"
        ? { ...moduloRetenciones, desdeEntorno: () => redis.instancia() }
        : nombre === "../lib/auditoria" ? { registrarAuditoria: async () => {}, determinarOrigenAuditoria: () => "prueba" }
        : requerir(nombre),
      module: { exports: {} }, process: { env: { AIRTABLE_BASE_ID: "appPrueba" } },
      Buffer, URLSearchParams, console: { log() {}, warn() {}, error() {} }, fetch: fetchFalso
    });
    vm.runInContext(codigo, contexto);
    return async body => {
      const res = { setHeader() {}, end(texto) { this.body = JSON.parse(texto); } };
      await contexto.module.exports({ method: "POST", headers: { "content-type": "application/json" }, body }, res);
      return { status: res.statusCode, ...res.body };
    };
  }
  return { instancia, redis, reservas, escrituras, fallarPost: () => { fallarPost = true; } };
}

test("API real: dos verificaciones simultáneas solo anuncian disponibilidad a una", async () => {
  const e = entorno(), a = e.instancia(), b = e.instancia();
  const resultados = await Promise.all([a({ ...datos, accion: "verificar" }), b({ ...datos, accion: "verificar" })]);
  assert.equal(resultados.filter(r => r.disponible).length, 1, JSON.stringify(resultados));
  assert.ok(resultados.find(r => r.disponible).retencion_token);
  assert.equal(e.reservas.size, 0);
});

test("API real: verificar → reservar confirma una sola vez", async () => {
  const e = entorno(), a = e.instancia();
  const oferta = await a({ ...datos, accion: "verificar" });
  assert.equal(oferta.disponible, true, JSON.stringify(oferta));
  const peticion = { ...datos, ...contacto, accion: "reservar", retencion_token: oferta.retencion_token };
  const resultados = await Promise.all([a(peticion), e.instancia()(peticion)]);
  assert.equal(resultados.filter(r => r.reservado).length, 1, JSON.stringify(resultados));
  assert.equal([...e.reservas.values()].filter(r => r.fields.estado === "confirmada").length, 1);
  assert.equal(e.reservas.size, 1);
});

test("API real: cliente sin retención no puede saltarse la verificación", async () => {
  const e = entorno(), a = e.instancia();
  const r = await a({ ...datos, ...contacto, accion: "reservar" });
  assert.equal(r.retencion_error, "caducada", JSON.stringify(r));
  assert.equal(e.reservas.size, 0);
});

test("API real: abandono libera la mesa y una oferta caducada no crea reserva", async () => {
  const e = entorno(), a = e.instancia();
  const oferta = await a({ ...datos, accion: "verificar" });
  await a({ accion: "liberar_retencion", restaurante_id: 1, retencion_token: oferta.retencion_token });
  const nueva = await a({ ...datos, accion: "verificar" });
  assert.equal(nueva.disponible, true);
  e.redis.avanzar(180001);
  const r = await a({ ...datos, ...contacto, accion: "reservar", retencion_token: nueva.retencion_token });
  assert.equal(r.retencion_error, "caducada"); assert.equal(e.reservas.size, 0);
});

test("API real: una respuesta de Airtable perdida no libera ni duplica la reserva", async () => {
  const e = entorno(), a = e.instancia();
  const oferta = await a({ ...datos, accion: "verificar" });
  e.fallarPost();
  const r = await a({ ...datos, ...contacto, accion: "reservar", retencion_token: oferta.retencion_token });
  assert.equal(r.status, 500);
  e.redis.avanzar(180001);
  const otra = await a({ ...datos, accion: "verificar" });
  assert.equal(otra.disponible, false);
  const repetida = await a({ ...datos, ...contacto, accion: "reservar", retencion_token: oferta.retencion_token });
  assert.equal(repetida.retencion_error, "en_curso"); assert.equal(e.reservas.size, 1);
});

test("API real: reserva manual del panel no puede tomar una mesa retenida", async () => {
  const e = entorno(), a = e.instancia();
  await a({ ...datos, accion: "verificar" });
  const panel = await a({ ...datos, ...contacto, accion: "reservar_panel", clave_restaurante: "claveprueba", mesa_ids: [MESA] });
  assert.equal(panel.reservado, false, JSON.stringify(panel));
  assert.equal([...e.reservas.values()].filter(r => r.fields.estado === "confirmada").length, 0);
});

test("API real: cancelación libera también la confirmación en Redis", async () => {
  const e = entorno(), a = e.instancia();
  const oferta = await a({ ...datos, accion: "verificar" });
  const reserva = await a({ ...datos, ...contacto, accion: "reservar", retencion_token: oferta.retencion_token });
  assert.equal(reserva.reservado, true, JSON.stringify(reserva));
  const cancelacion = await a({ accion: "cancelar", restaurante_id: 1, token_gestion: reserva.token_gestion });
  assert.equal(cancelacion.cancelada, true, JSON.stringify(cancelacion));
  assert.equal((await a({ ...datos, accion: "verificar" })).disponible, true);
});

test("API real: validar hora antes de preguntar zona no retiene mesas", async () => {
  const e = entorno(), a = e.instancia();
  await a({ ...datos, accion: "verificar", solo_validar_momento: true });
  assert.equal(e.redis.documentos.size, 0);
});

test("API real: modificación conserva la reserva y cambia el bloqueo a la nueva hora", async () => {
  const e = entorno(), a = e.instancia();
  const oferta = await a({ ...datos, accion: "verificar" });
  const reserva = await a({ ...datos, ...contacto, accion: "reservar", retencion_token: oferta.retencion_token });
  const modificada = await a({ ...datos, hora: "17:00", accion: "modificar", token_gestion: reserva.token_gestion });
  assert.equal(modificada.modificada, true, JSON.stringify(modificada));
  assert.equal((await a({ ...datos, accion: "verificar" })).disponible, true);
  assert.equal((await a({ ...datos, hora: "17:00", accion: "verificar" })).disponible, false);
});

test("API real: panel puede finalizar la mesa y devolverla a disponibilidad", async () => {
  const e = entorno(), a = e.instancia();
  const oferta = await a({ ...datos, accion: "verificar" });
  const reserva = await a({ ...datos, ...contacto, accion: "reservar", retencion_token: oferta.retencion_token });
  const libre = await a({ accion: "actualizar_estado", restaurante_id: 1, localizador: reserva.id_reserva,
    clave_restaurante: "claveprueba", estado_nuevo: "libre" });
  assert.equal(libre.estado_actualizado, true, JSON.stringify(libre));
  assert.equal((await a({ ...datos, accion: "verificar" })).disponible, true);
});
