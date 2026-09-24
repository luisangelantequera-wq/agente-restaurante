"use strict";

// Datos operativos únicamente: nunca se solicitan contactos ni tokens de gestión.
function crearServicioRevision({ almacen, leer }) {
  async function restaurantes() {
    return leer("RESTAURANTES", ["nombre"]);
  }
  async function listar() {
    const filas = [];
    for (const restaurante of await restaurantes()) {
      const operaciones = await almacen.listarRevision(restaurante.id);
      for (const r of operaciones) filas.push({
        id: r.id, restaurante_id: restaurante.id,
        restaurante: restaurante.fields.nombre || "Restaurante",
        fecha: r.solicitud.fecha, hora: r.solicitud.hora, personas: r.solicitud.personas,
        mesas: r.mesas.length ? r.mesas : (r.mesasAnteriores || []),
        iniciada: r.iniciada || null, localizador: r.localizador || "",
        resuelta: Boolean(r.revision), resultado: r.revision?.resultado || "",
        revisada: r.revision?.fecha || null, origen: r.revision?.origen || "",
        comprobable: r.estado === "guardando" && r.operacion === "alta",
        aviso: r.estado === "guardando" && r.operacion !== "alta"
          ? "Operación anterior o modificación: requiere revisión técnica. Se mantiene el bloqueo." : ""
      });
    }
    return filas;
  }
  async function comprobar(restauranteId, id) {
    if (!(await restaurantes()).some(r => r.id === restauranteId)) throw new Error("Restaurante no válido.");
    const r = (await almacen.listarRevision(restauranteId)).find(r => r.id === id);
    if (!r || r.estado !== "guardando") return "La operación ya ha cambiado o está resuelta. Actualice la lista.";
    return resolver(restauranteId, r);
  }
  async function revisarRestaurante(restauranteId) {
    const operaciones = await almacen.listarRevision(restauranteId);
    for (const r of operaciones.filter(r => r.estado === "guardando" && r.operacion === "alta")) {
      await resolver(restauranteId, r, "automatico");
    }
  }
  async function resolver(restauranteId, r, origen = "contactia") {
    if (r.operacion !== "alta" || !/^[A-Z0-9-]{6,80}$/.test(r.localizador || "")) {
      return "No existe una referencia inequívoca de esta operación. Se mantiene el bloqueo para revisión técnica.";
    }
    const reservas = await leer("RESERVAS", ["id_reserva", "restaurante", "mesa", "fecha", "hora", "personas", "duracion_reserva_minutos", "estado"], `{id_reserva}='${r.localizador}'`);
    if (reservas.length !== 1) return "No se ha encontrado una única reserva. Se mantiene el bloqueo: una escritura podría seguir pendiente.";
    const reserva = reservas[0], f = reserva.fields;
    const mismasMesas = JSON.stringify([...(f.mesa || [])].sort()) === JSON.stringify([...r.mesas].sort());
    if (f.id_reserva !== r.localizador || !Array.isArray(f.restaurante) || f.restaurante.length !== 1 ||
        f.restaurante[0] !== restauranteId || !mismasMesas || f.fecha !== r.solicitud.fecha ||
        f.hora !== r.solicitud.hora || Number(f.personas) !== r.solicitud.personas ||
        Number(f.duracion_reserva_minutos) !== r.solicitud.duracion) {
      return "Los datos de Airtable no coinciden exactamente. Se mantiene el bloqueo para revisión técnica.";
    }
    const estado = String(f.estado || "").trim().toLowerCase();
    if (!["confirmada", "rechazada_conflicto"].includes(estado)) {
      return "Airtable no acredita un resultado definitivo compatible. Se mantiene el bloqueo para revisión técnica.";
    }
    await almacen.resolverRevision(restauranteId, r.id, r.version, reserva.id, estado, origen);
    return estado === "confirmada"
      ? "Reserva confirmada en Airtable. Incidencia resuelta; la mesa continúa reservada. No se ha enviado ningún correo."
      : "Airtable acredita que esta solicitud fue rechazada. Se ha retirado únicamente su bloqueo; otras reservas siguen protegidas.";
  }
  return { listar, comprobar, revisarRestaurante };
}

async function leerAirtable(tabla, campos, formula, { fetchImpl = global.fetch, env = process.env } = {}) {
  if (!env.AIRTABLE_API_KEY || !env.AIRTABLE_BASE_ID) throw new Error("Almacenamiento no configurado.");
  const registros = [];
  let offset;
  do {
    const params = new URLSearchParams({ pageSize: "100" });
    campos.forEach(c => params.append("fields[]", c));
    if (formula) params.set("filterByFormula", formula);
    if (offset) params.set("offset", offset);
    const respuesta = await fetchImpl(`https://api.airtable.com/v0/${env.AIRTABLE_BASE_ID}/${tabla}?${params}`, {
      headers: { Authorization: `Bearer ${env.AIRTABLE_API_KEY}` }, signal: AbortSignal.timeout(10000)
    });
    if (!respuesta.ok) throw new Error("No se pudo consultar Airtable. No se ha liberado ninguna mesa.");
    const datos = await respuesta.json();
    if (!Array.isArray(datos.records)) throw new Error("Respuesta de Airtable no válida.");
    registros.push(...datos.records);
    offset = datos.offset;
    if (registros.length > 10000) throw new Error("Demasiados registros; revisión técnica necesaria.");
  } while (offset);
  return registros;
}
module.exports = { crearServicioRevision, leerAirtable };
