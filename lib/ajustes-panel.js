"use strict";
const crypto = require("node:crypto");
const { sesionRestauranteValida } = require("./sesion-restaurante");
const { filtrarRegistrosRestaurante } = require("./pertenencia-restaurante");
const modelo = require("./ajustes-restaurante");
const cache = require("./cache-publica");
const fetchMedido = require("./contador-airtable").crearFetchMedido("configuracion");
const revision = datos => crypto.createHash("sha256").update(JSON.stringify(datos)).digest("hex");
function responder(res, codigo, datos) {
  res.statusCode = codigo;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  return res.end(JSON.stringify(datos));
}
async function airtable(tabla, opciones = {}, parametros = "") {
  const respuesta = await fetchMedido(`https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/${tabla}${parametros}`, {
    ...opciones, headers: { Authorization: `Bearer ${process.env.AIRTABLE_API_KEY}`, "Content-Type": "application/json" }
  });
  if (!respuesta.ok) throw new Error("No se pudo consultar o guardar la configuración. Compruebe el estado antes de repetir.");
  return JSON.parse(await respuesta.text());
}
async function buscar(id) {
  const params = new URLSearchParams({ filterByFormula: `{id}=${id}`, maxRecords: "2" });
  const datos = await airtable("RESTAURANTES", {}, "?" + params);
  if (datos.records?.length !== 1 || Number(datos.records[0].fields.id) !== id) throw new Error("No se pudo identificar el restaurante.");
  return datos.records[0];
}
async function afectadas(registro, nuevos) {
  const hoy = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Madrid" }).format(new Date());
  let offset = "", paginas = 0;
  const todas = [];
  do {
    const params = new URLSearchParams({ filterByFormula: `OR(IS_AFTER({fecha},'${hoy}'),IS_SAME({fecha},'${hoy}','day'))`, pageSize: "100" });
    if (offset) params.set("offset", offset);
    const pagina = await airtable("RESERVAS", {}, "?" + params);
    todas.push(...(pagina.records || [])); offset = pagina.offset || "";
    if (++paginas > 100) throw new Error("No se pudo completar la revisión de reservas.");
  } while (offset);
  const { validarHorarioRestaurante } = require("../api/chat")._seguridad;
  return filtrarRegistrosRestaurante(todas, registro.id)
    .filter(r => ["confirmada", "ocupada", "con retraso", "cobrada"].includes(String(r.fields.estado).toLowerCase()))
    .filter(r => !validarHorarioRestaurante({ ...registro.fields, ...modelo.camposHorario(nuevos) }, r.fields.fecha, r.fields.hora).valido)
    .map(r => ({ localizador: r.fields.id_reserva, fecha: r.fields.fecha, hora: r.fields.hora }));
}
async function sincronizar(registro, id) {
  try { return await cache.sincronizarInformacionPublica({ restauranteId: id, restauranteRecordId: registro.id, datos: modelo.normalizarPublico(registro.fields) }); }
  catch { return { activada: true, sincronizada: false }; }
}
module.exports = async (req, res) => {
  if (process.env.VERCEL_ENV !== "preview") return responder(res, 404, { ok: false, error: "Función no disponible." });
  if (req.method !== "POST") return responder(res, 405, { ok: false, error: "Método no permitido." });
  const host = String(req.headers?.host || "").toLowerCase();
  if (!/^[-a-z0-9.]+(?::\d{1,5})?$/.test(host) || req.headers?.origin !== "https://" + host) return responder(res, 403, { ok: false, error: "Origen no autorizado." });
  if (!String(req.headers?.["content-type"] || "").startsWith("application/json")) return responder(res, 415, { ok: false, error: "Formato no admitido." });
  let body;
  try {
    const raw = typeof req.body === "string" ? req.body : JSON.stringify(req.body || {});
    if (Buffer.byteLength(raw) > 16000) return responder(res, 413, { ok: false, error: "Demasiados datos." });
    body = JSON.parse(raw);
  } catch { return responder(res, 400, { ok: false, error: "Solicitud no válida." }); }
  const id = Number(body?.restaurante_id), seccion = body?.seccion;
  if (!Number.isInteger(id) || id <= 0 || id > 1000000000 || !["publico", "horarios", "gastronomia"].includes(seccion) ||
      !["ajustes_consultar", "ajustes_guardar", "ajustes_sincronizar"].includes(body.accion)) return responder(res, 400, { ok: false, error: "Operación no válida." });
  if (!sesionRestauranteValida(req, id)) return responder(res, 401, { ok: false, error: "La sesión ha caducado. Vuelva a identificarse." });
  let nuevos;
  if (body.accion === "ajustes_guardar") {
    try {
      if (!/^[a-f0-9]{64}$/.test(body.revision || "")) throw new Error("Vuelva a cargar los ajustes antes de guardar.");
      nuevos = seccion === "publico" ? modelo.validarPublico(body.datos) : seccion === "gastronomia" ? modelo.validarGastronomia(body.datos) : modelo.validarHorario(body.datos);
    } catch (error) { return responder(res, 400, { ok: false, error: error.message }); }
  }
  try {
    let registro = await buscar(id);
    const normalizar = seccion === "publico" ? modelo.normalizarPublico : seccion === "gastronomia" ? modelo.normalizarGastronomia : modelo.normalizarHorario;
    const actuales = normalizar(registro.fields);
    if (body.accion === "ajustes_consultar") return responder(res, 200, { ok: true, datos: actuales, revision: revision(actuales) });
    if (body.accion === "ajustes_guardar") {
      if (body.revision !== revision(actuales)) return responder(res, 409, { ok: false, error: "Otro encargado ha cambiado estos ajustes. Cierre y vuelva a abrir el editor." });
      if (JSON.stringify(actuales) !== JSON.stringify(nuevos)) {
        if (seccion === "horarios") {
          const reservas = await afectadas(registro, nuevos);
          const revisionAfectadas = revision(reservas);
          if (reservas.length && body.confirmacion_afectadas !== revisionAfectadas) return responder(res, 200, {
            ok: true, requiere_confirmacion: true, reservas_afectadas: reservas, revision_afectadas: revisionAfectadas
          });
        }
        const fields = seccion === "publico" ? { direccion: nuevos.direccion, web: nuevos.web, informacion_publica: JSON.stringify({ ...nuevos.informacion, encargos: require("./encargos-restaurante").leer(registro.fields) }) } : seccion === "gastronomia" ? { informacion_publica: JSON.stringify({ ...modelo.normalizarPublico(registro.fields).informacion, gastronomia: nuevos.gastronomia, encargos: nuevos.encargos }) } : modelo.camposHorario(nuevos);
        const actualizado = await airtable("RESTAURANTES/" + registro.id, { method: "PATCH", body: JSON.stringify({ fields }) });
        if (actualizado.id !== registro.id || !actualizado.fields) throw new Error("No se pudo comprobar el guardado.");
        registro = { ...registro, fields: { ...registro.fields, ...actualizado.fields } };
      }
    }
    const memoria = seccion !== "horarios" ? await sincronizar(registro, id) : null;
    const datos = normalizar(registro.fields);
    return responder(res, 200, { ok: true, datos_guardados: true, datos, revision: revision(datos), memoria,
      ...(memoria?.activada && !memoria.sincronizada ? { aviso: "Datos guardados. La actualización de memoria está pendiente; reintente la sincronización." } : {}) });
  } catch {
    return responder(res, 502, { ok: false, error: "No se pudo completar la operación. Compruebe el estado antes de volver a guardar." });
  }
};
