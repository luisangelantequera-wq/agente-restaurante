"use strict";

const crypto = require("node:crypto");

// Un único documento por restaurante. La comparación y sustitución se ejecutan
// juntas en Redis: dos instancias nunca pueden adquirir la misma franja.
// No se usa un mutex con TTL que pueda caducar mientras Airtable escribe.
const LEER = `local t=redis.call('TIME'); return {redis.call('GET',KEYS[1]) or '',t[1],t[2]}`;
const CAS = `local t=redis.call('TIME'); local now=t[1]*1000+math.floor(t[2]/1000)
if now >= tonumber(ARGV[3]) then return 0 end
if (redis.call('GET',KEYS[1]) or '') ~= ARGV[1] then return 0 end
redis.call('SET',KEYS[1],ARGV[2]); return 1`;
const DURACION_RETENCION_MS = 3 * 60 * 1000;
const MAX_ENTRADAS = 1000;

class ErrorRetencion extends Error {
  constructor(codigo, mensaje) { super(mensaje); this.name = "ErrorRetencion"; this.codigo = codigo; }
}

function hash(valor) { return crypto.createHash("sha256").update(valor).digest("hex"); }
function tokenValido(token) { return typeof token === "string" && /^[a-f0-9]{48}$/.test(token); }

function solicitudNormalizada({ fecha, hora, duracion, personas, zona = "" }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(hora) ||
      !Number.isInteger(duracion) || duracion < 1 || duracion > 1440 ||
      !Number.isInteger(personas) || personas < 1 || personas > 1000 || typeof zona !== "string") {
    throw new ErrorRetencion("datos", "Datos de retención no válidos.");
  }
  // Coordenada civil, no instante UTC: compara también franjas que cruzan medianoche.
  const inicio = Date.parse(`${fecha}T${hora}:00Z`);
  if (!Number.isFinite(inicio) || new Date(inicio).toISOString().slice(0, 10) !== fecha) {
    throw new ErrorRetencion("datos", "Fecha de retención no válida.");
  }
  return { fecha, hora, duracion, personas, zona, inicio, fin: inicio + duracion * 60000 };
}

function limpiar(estado, ahora) {
  for (const [id, r] of Object.entries(estado)) {
    if ((r.estado === "ofrecida" && r.vence <= ahora) ||
        (["confirmada", "resuelta"].includes(r.estado) && r.solicitud.fin + 86400000 < ahora)) delete estado[id];
  }
  // Una escritura cuyo resultado no conocemos NO se libera automáticamente.
  // Requiere conciliación: podría haberse guardado en Airtable aunque fallase la red.
}

function coincide(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
function conflicto(estado, solicitud, mesas, registro = "", propio = "") {
  return Object.entries(estado).some(([id, r]) => {
    if (id === propio) return false;
    if (registro && r.registro === registro && r.estado === "confirmada") return false;
    if (registro && r.registro === registro && r.estado === "guardando") return true;
    return solicitud.inicio < r.solicitud.fin && solicitud.fin > r.solicitud.inicio &&
      mesas.some(mesa => r.mesas.includes(mesa));
  });
}

function crearAlmacenRetenciones({ ejecutar, prefijo = "contactia:retenciones:v1:preview" }) {
  async function transaccion(restaurante, cambiar) {
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(String(restaurante))) throw new ErrorRetencion("datos", "Restaurante no válido.");
    const clave = `${prefijo}:${restaurante}`;
    for (let intento = 0; intento < 12; intento++) {
      const [original, segundos, micros] = await ejecutar(["EVAL", LEER, 1, clave]);
      const ahora = Number(segundos) * 1000 + Math.floor(Number(micros) / 1000);
      if (!Number.isFinite(ahora)) throw new ErrorRetencion("servicio", "No se pudo comprobar la retención.");
      const estado = original ? JSON.parse(original) : {};
      limpiar(estado, ahora);
      let limite = ahora + 5000;
      const resultado = cambiar(estado, ahora, vence => { limite = Math.min(limite, vence); });
      if (await ejecutar(["EVAL", CAS, 1, clave, original, JSON.stringify(estado), limite]) === 1) return resultado;
    }
    throw new ErrorRetencion("ocupado", "Hay varias solicitudes simultáneas. Inténtelo de nuevo.");
  }

  return {
    async vincularAlta(restaurante, token, localizador) {
      if (!tokenValido(token) || !/^[A-Z0-9-]{6,80}$/.test(localizador)) throw new ErrorRetencion("datos", "Identificador no válido.");
      return transaccion(restaurante, estado => {
        const r = estado[hash(token)];
        if (!r || r.estado !== "guardando" || r.operacion) throw new ErrorRetencion("estado", "Operación no válida.");
        r.operacion = "alta";
        r.localizador = localizador;
        return true;
      });
    },

    async listarRevision(restaurante) {
      return transaccion(restaurante, estado => Object.entries(estado)
        .filter(([, r]) => r.estado === "guardando" || r.revision)
        .map(([id, r]) => ({ id, version: hash(JSON.stringify(r)), ...r })));
    },

    // Solo el servicio administrativo aporta evidencia leída directamente de Airtable.
    async resolverRevision(restaurante, id, version, registro, resultado, origen = "contactia") {
      if (!/^[a-f0-9]{64}$/.test(id) || !/^[a-f0-9]{64}$/.test(version) ||
          !/^rec[A-Za-z0-9]+$/.test(registro) || !["confirmada", "rechazada_conflicto"].includes(resultado) || !["contactia", "automatico"].includes(origen)) {
        throw new ErrorRetencion("datos", "Resolución no válida.");
      }
      return transaccion(restaurante, (estado, ahora) => {
        const r = estado[id];
        if (!r || r.estado !== "guardando" || r.operacion !== "alta" || hash(JSON.stringify(r)) !== version) {
          throw new ErrorRetencion("cambio", "La operación ha cambiado. Actualice la lista.");
        }
        r.registro = registro;
        r.revision = { resultado, fecha: ahora, origen };
        r.estado = resultado === "confirmada" ? "confirmada" : "resuelta";
        if (r.estado === "resuelta") { r.mesasAnteriores = r.mesas; r.mesas = []; }
        return true;
      });
    },

    async iniciarCambioRegistro(restaurante, registro, datos) {
      const solicitud = solicitudNormalizada(datos);
      if (!/^[A-Za-z0-9_-]{1,80}$/.test(registro)) throw new ErrorRetencion("datos", "Reserva no válida.");
      const token = crypto.randomBytes(24).toString("hex");
      return transaccion(restaurante, (estado, ahora) => {
        if (Object.values(estado).some(r => r.registro === registro && r.estado === "guardando")) {
          throw new ErrorRetencion("en_curso", "Esta reserva se está modificando. Inténtelo de nuevo.");
        }
        if (Object.keys(estado).length >= MAX_ENTRADAS) throw new ErrorRetencion("limite", "No se puede modificar la reserva en este momento.");
        estado[hash(token)] = { estado: "guardando", solicitud, mesas: [], registro, iniciada: ahora };
        return token;
      });
    },

    async terminarCambioRegistro(restaurante, token, eliminar = false) {
      if (!tokenValido(token)) throw new ErrorRetencion("datos", "Identificador no válido.");
      return transaccion(restaurante, estado => {
        const id = hash(token), r = estado[id];
        if (!r || r.estado !== "guardando" || r.mesas.length) throw new ErrorRetencion("estado", "Cambio no válido.");
        for (const [otroId, otra] of Object.entries(estado)) {
          if (otroId === id || (eliminar && otra.registro === r.registro)) delete estado[otroId];
        }
        return true;
      });
    },

    async adquirir(restaurante, datos, candidatos, { registro = "" } = {}) {
      const solicitud = solicitudNormalizada(datos);
      if (!Array.isArray(candidatos) || candidatos.length > 1000 || candidatos.some(c =>
        !Array.isArray(c.ids) || !c.ids.length || c.ids.length > 20 || c.ids.some(id => !/^[A-Za-z0-9_-]{1,80}$/.test(id)))) {
        throw new ErrorRetencion("datos", "Mesas de retención no válidas.");
      }
      const token = crypto.randomBytes(24).toString("hex");
      return transaccion(restaurante, (estado, ahora) => {
        const elegido = candidatos.find(c => !conflicto(estado, solicitud, c.ids, registro));
        if (!elegido) return null;
        if (Object.keys(estado).length >= MAX_ENTRADAS) throw new ErrorRetencion("limite", "No se puede retener la mesa en este momento.");
        const vence = ahora + DURACION_RETENCION_MS;
        estado[hash(token)] = { estado: "ofrecida", solicitud, mesas: [...new Set(elegido.ids)], registro, vence };
        return { token, vence, asignacion: elegido };
      });
    },

    async iniciar(restaurante, token, datos) {
      if (!tokenValido(token)) throw new ErrorRetencion("caducada", "Vuelva a comprobar la disponibilidad.");
      const solicitud = solicitudNormalizada(datos);
      return transaccion(restaurante, (estado, ahora, limitar) => {
        const r = estado[hash(token)];
        if (!r || !coincide(r.solicitud, solicitud)) throw new ErrorRetencion("caducada", "La retención ha caducado o los datos han cambiado. Vuelva a comprobar la disponibilidad.");
        if (r.estado !== "ofrecida") throw new ErrorRetencion("en_curso", "Esta solicitud ya se está tramitando. No vuelva a confirmarla.");
        if (conflicto(estado, solicitud, r.mesas, r.registro, hash(token))) throw new ErrorRetencion("conflicto", "Las mesas ya no están disponibles.");
        limitar(r.vence);
        r.estado = "guardando";
        r.iniciada = ahora;
        return { mesas: r.mesas };
      });
    },

    async finalizar(restaurante, token, registro) {
      if (!tokenValido(token) || !/^[A-Za-z0-9_-]{1,80}$/.test(registro)) throw new ErrorRetencion("datos", "Identificador no válido.");
      return transaccion(restaurante, estado => {
        const id = hash(token), r = estado[id];
        if (!r || !["guardando", "confirmada"].includes(r.estado)) throw new ErrorRetencion("estado", "No se puede cerrar la retención.");
        if (r.estado === "confirmada" && r.registro !== registro) throw new ErrorRetencion("estado", "La retención ya corresponde a otra reserva.");
        for (const [otroId, otra] of Object.entries(estado)) {
          if (otroId !== id && otra.registro === registro && otra.estado === "confirmada") delete estado[otroId];
        }
        r.registro = registro;
        r.estado = "confirmada";
        return true;
      });
    },

    // Solo tras una respuesta inequívoca de Airtable que descarta la escritura.
    async descartar(restaurante, token) {
      if (!tokenValido(token)) return false;
      return transaccion(restaurante, estado => {
        const id = hash(token);
        if (estado[id]?.estado === "confirmada") return false;
        if (estado[id]?.estado === "resuelta") return true;
        delete estado[id]; return true;
      });
    },

    // Acción pública: no permite liberar una reserva en proceso de guardado.
    async liberar(restaurante, token) {
      if (!tokenValido(token)) return false;
      return transaccion(restaurante, estado => {
        const id = hash(token);
        if (estado[id]?.estado !== "ofrecida") return false;
        delete estado[id]; return true;
      });
    },

    async mesasBloqueadas(restaurante, datos, registro = "") {
      const solicitud = solicitudNormalizada(datos);
      return transaccion(restaurante, estado => [...new Set(Object.values(estado)
        .filter(r => !(registro && r.registro === registro && r.estado === "confirmada") &&
          solicitud.inicio < r.solicitud.fin && solicitud.fin > r.solicitud.inicio)
        .flatMap(r => r.mesas))]);
    }
  };
}

function desdeEntorno(env = process.env, fetchImpl = global.fetch) {
  // Activación expresa hasta completar la verificación del circuito en Preview.
  if (env.CONTACTIA_RETENCIONES !== "1") return null;
  if (env.VERCEL_ENV !== "preview") throw new ErrorRetencion("configuracion", "Las retenciones solo están habilitadas en Preview.");
  const url = env.KV_REST_API_URL, token = env.KV_REST_API_TOKEN;
  if (!url || !token || !/^https:\/\/[a-z0-9.-]+\.upstash\.io\/?$/i.test(url)) {
    throw new ErrorRetencion("configuracion", "Falta configurar el servicio de retenciones.");
  }
  return crearAlmacenRetenciones({
    prefijo: `contactia:retenciones:v1:preview:${hash(env.AIRTABLE_BASE_ID || "").slice(0, 16)}`,
    ejecutar: async comando => {
      try {
        const respuesta = await fetchImpl(url, {
          method: "POST", redirect: "error", signal: AbortSignal.timeout(5000),
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify(comando)
        });
        if (!respuesta.ok) throw new Error("HTTP");
        const datos = await respuesta.json();
        if (datos.error || !("result" in datos)) throw new Error("Redis");
        return datos.result;
      } catch {
        // No registrar URL, credenciales, comandos ni datos de las retenciones.
        throw new ErrorRetencion("servicio", "No se puede asegurar la mesa en este momento. Inténtelo de nuevo más tarde.");
      }
    }
  });
}

module.exports = { crearAlmacenRetenciones, desdeEntorno, ErrorRetencion, solicitudNormalizada, DURACION_RETENCION_MS, LEER, CAS };
