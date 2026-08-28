const crypto = require("crypto");


const ACCIONES_AUDITABLES = new Set([
  "datos_anonimizados",
  "estado_actualizado",
  "mesas_actualizadas",
  "reserva_cancelada",
  "reserva_creada",
  "reserva_modificada",
  "reserva_reactivada"
]);

const ORIGENES_AUDITABLES = new Set([
  "panel_restaurante",
  "sistema",
  "web_cliente"
]);

const CLAVES_DETALLE_PERMITIDAS = new Set([
  "anterior",
  "capacidad",
  "estado",
  "fecha",
  "hora",
  "mesas",
  "nuevo",
  "personas",
  "tipo"
]);


function limpiarTexto(valor, maximo = 120) {
  return String(valor || "").trim().slice(0, maximo);
}


function limpiarValorDetalle(valor) {
  if (Array.isArray(valor)) {
    return valor
      .slice(0, 20)
      .map((elemento) => limpiarValorDetalle(elemento))
      .filter((elemento) => elemento !== undefined);
  }

  if (valor && typeof valor === "object") {
    return Object.fromEntries(
      Object.entries(valor)
        .filter(([clave]) => CLAVES_DETALLE_PERMITIDAS.has(clave))
        .map(([clave, contenido]) => [clave, limpiarValorDetalle(contenido)])
        .filter(([, contenido]) => contenido !== undefined)
    );
  }

  if (typeof valor === "number" && Number.isFinite(valor)) {
    return valor;
  }

  if (typeof valor === "boolean") {
    return valor;
  }

  if (typeof valor === "string") {
    return limpiarTexto(valor);
  }

  return undefined;
}


function serializarDetallesAuditoria(detalles) {
  const detallesLimpios = limpiarValorDetalle(detalles || {});
  return JSON.stringify(detallesLimpios).slice(0, 5000);
}


function crearCamposAuditoria({
  restauranteId,
  reservaId,
  accion,
  origen,
  estadoAnterior = "",
  estadoNuevo = "",
  detalles = {},
  ahora = new Date()
}) {
  const restaurante = Number(restauranteId);
  const accionLimpia = limpiarTexto(accion, 40);
  const origenLimpio = limpiarTexto(origen, 40);

  if (!Number.isInteger(restaurante) || restaurante <= 0) {
    throw new Error("El restaurante de la auditoría no es válido.");
  }

  if (!ACCIONES_AUDITABLES.has(accionLimpia)) {
    throw new Error("La acción de auditoría no está permitida.");
  }

  if (!ORIGENES_AUDITABLES.has(origenLimpio)) {
    throw new Error("El origen de auditoría no está permitido.");
  }

  return {
    evento_id: `AUD-${crypto.randomUUID()}`,
    fecha_hora: new Date(ahora).toISOString(),
    restaurante_id: restaurante,
    reserva_id: limpiarTexto(reservaId, 40),
    accion: accionLimpia,
    origen: origenLimpio,
    estado_anterior: limpiarTexto(estadoAnterior, 40),
    estado_nuevo: limpiarTexto(estadoNuevo, 40),
    detalles: serializarDetallesAuditoria(detalles)
  };
}


async function registrarAuditoria(datos) {
  if (!process.env.AIRTABLE_API_KEY || !process.env.AIRTABLE_BASE_ID) {
    console.warn("Auditoría omitida: falta la configuración de Airtable.");
    return false;
  }

  let campos;

  try {
    campos = crearCamposAuditoria(datos);
  } catch (error) {
    console.error("No se pudo preparar el registro de auditoría:", error);
    return false;
  }

  try {
    const respuesta = await fetch(
      `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/AUDITORIA`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.AIRTABLE_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ fields: campos })
      }
    );

    if (!respuesta.ok) {
      console.error(
        "No se pudo guardar el registro de auditoría. HTTP",
        respuesta.status
      );
      return false;
    }

    return true;
  } catch (error) {
    console.error("No se pudo guardar el registro de auditoría:", error);
    return false;
  }
}


module.exports = {
  crearCamposAuditoria,
  registrarAuditoria,
  serializarDetallesAuditoria
};

