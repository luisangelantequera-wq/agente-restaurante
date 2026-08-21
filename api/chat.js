// === CONTACTIA V2 - api/chat.js ===
// FASE 1: comprobar disponibilidad en Airtable
// Sin Gmail, sin Twilio, sin cancelaciones y sin crear reservas.

// ─────────────────────────────────────────────────────────────
// 1️⃣ UTILIDAD PARA RESPONDER SIEMPRE EN JSON
// ─────────────────────────────────────────────────────────────
function responder(res, status, datos) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  return res.end(JSON.stringify(datos));
}


// ─────────────────────────────────────────────────────────────
// 2️⃣ CONSULTA SEGURA A AIRTABLE
// ─────────────────────────────────────────────────────────────
async function consultarAirtable(url, opciones = {}) {
  const respuesta = await fetch(url, {
    ...opciones,
    headers: {
      Authorization: `Bearer ${process.env.AIRTABLE_API_KEY}`,
      ...(opciones.headers || {})
    }
  });

  const texto = await respuesta.text();

  let datos;

  try {
    datos = texto ? JSON.parse(texto) : {};
  } catch {
    throw new Error(
      `Airtable devolvió una respuesta no válida. HTTP ${respuesta.status}`
    );
  }

  if (!respuesta.ok) {
    console.error("Error Airtable:", datos);

    throw new Error(
      datos?.error?.message ||
      `Error de Airtable. HTTP ${respuesta.status}`
    );
  }

  return datos;
}


// ─────────────────────────────────────────────────────────────
// 3️⃣ HANDLER PRINCIPAL DE VERCEL
// ─────────────────────────────────────────────────────────────
module.exports = async (req, res) => {

  // Solo permitimos POST
  if (req.method !== "POST") {
    return responder(res, 405, {
      ok: false,
      error: "Método no permitido"
    });
  }

  try {

    // Vercel normalmente ya entrega req.body como objeto.
    const body =
      typeof req.body === "string"
        ? JSON.parse(req.body || "{}")
        : (req.body || {});

    const {
      accion,
      restaurante_id,
      fecha,
      hora,
      personas
    } = body;


    // ─────────────────────────────────────────────────────────
    // 4️⃣ ESTA VERSIÓN SOLO COMPRUEBA DISPONIBILIDAD
    // ─────────────────────────────────────────────────────────
    if (accion !== "verificar") {
      return responder(res, 400, {
        ok: false,
        error: "Esta versión de prueba solo admite accion='verificar'."
      });
    }


    // ─────────────────────────────────────────────────────────
    // 5️⃣ VALIDAR LOS DATOS RECIBIDOS
    // ─────────────────────────────────────────────────────────
    if (!restaurante_id || !fecha || !hora || !personas) {
      return responder(res, 400, {
        ok: false,
        disponible: false,
        error: "Faltan restaurante_id, fecha, hora o personas."
      });
    }

    const numeroPersonas = Number(personas);

    if (!Number.isInteger(numeroPersonas) || numeroPersonas <= 0) {
      return responder(res, 400, {
        ok: false,
        disponible: false,
        error: "El número de personas no es válido."
      });
    }

    console.log("=== CONTACTIA: VERIFICAR ===");
    console.log({
      restaurante_id,
      fecha,
      hora,
      personas: numeroPersonas
    });


    // ─────────────────────────────────────────────────────────
    // 6️⃣ BUSCAR EL RESTAURANTE
    // ─────────────────────────────────────────────────────────
    const filtroRestaurante = encodeURIComponent(
      `{id}=${Number(restaurante_id)}`
    );

    const urlRestaurante =
      `https://api.airtable.com/v0/` +
      `${process.env.AIRTABLE_BASE_ID}/RESTAURANTES` +
      `?filterByFormula=${filtroRestaurante}`;

    const datosRestaurante =
      await consultarAirtable(urlRestaurante);

    if (!datosRestaurante.records?.length) {
      return responder(res, 404, {
        ok: false,
        disponible: false,
        error: "Restaurante no encontrado."
      });
    }

    const restaurante = datosRestaurante.records[0];

    console.log(
      "Restaurante encontrado:",
      restaurante.fields.nombre
    );


    // ─────────────────────────────────────────────────────────
    // 7️⃣ BUSCAR LAS MESAS DEL RESTAURANTE
    //
    // En MESAS tenemos:
    // restaurante
    // id (from restaurante)
    //
    // Como el lookup puede ser una lista, ARRAYJOIN hace
    // el filtro más robusto.
    // ─────────────────────────────────────────────────────────
    const formulaMesas =
      `FIND('${String(restaurante_id)}',` +
      `ARRAYJOIN({id (from restaurante)}))`;

    const urlMesas =
      `https://api.airtable.com/v0/` +
      `${process.env.AIRTABLE_BASE_ID}/MESAS` +
      `?filterByFormula=${encodeURIComponent(formulaMesas)}`;

    const datosMesas =
      await consultarAirtable(urlMesas);

    const mesas = datosMesas.records || [];

    console.log("Mesas encontradas:", mesas.length);

    if (mesas.length === 0) {
      return responder(res, 200, {
        ok: true,
        disponible: false,
        motivo: "No hay mesas configuradas para este restaurante."
      });
    }


    // ─────────────────────────────────────────────────────────
    // 8️⃣ DESCARTAR MESAS FUERA DE SERVICIO
    //
    // IMPORTANTE:
    // No utilizamos "reservada" para decidir si una mesa está
    // ocupada en una fecha concreta.
    //
    // La ocupación se calculará mirando RESERVAS.
    // ─────────────────────────────────────────────────────────
    const mesasOperativas = mesas.filter((mesa) => {
      const estado =
        String(mesa.fields.estado || "")
          .trim()
          .toLowerCase();

      return estado !== "fuera de servicio";
    });


    // ─────────────────────────────────────────────────────────
    // 9️⃣ BUSCAR RESERVAS CONFIRMADAS
    // PARA ESA FECHA Y ESA HORA
    // ─────────────────────────────────────────────────────────
    const formulaReservas =
      `AND(` +
      `{fecha}='${fecha}',` +
      `{hora}='${hora}',` +
      `{estado}='confirmada',` +
      `FIND('${String(restaurante_id)}',` +
      `ARRAYJOIN({id (from restaurante)}))` +
      `)`;

    const urlReservas =
      `https://api.airtable.com/v0/` +
      `${process.env.AIRTABLE_BASE_ID}/RESERVAS` +
      `?filterByFormula=${encodeURIComponent(formulaReservas)}`;

    const datosReservas =
      await consultarAirtable(urlReservas);

    const reservas = datosReservas.records || [];

    console.log(
      "Reservas confirmadas en esa fecha/hora:",
      reservas.length
    );


    // ─────────────────────────────────────────────────────────
    // 🔟 OBTENER LAS MESAS YA OCUPADAS
    //
    // RESERVAS.mesa es un enlace a MESAS.
    // Airtable devuelve los Record ID de las mesas vinculadas.
    // ─────────────────────────────────────────────────────────
    const mesasOcupadas = new Set();

    for (const reserva of reservas) {
      const mesasReserva = reserva.fields.mesa;

      if (Array.isArray(mesasReserva)) {
        for (const mesaId of mesasReserva) {
          mesasOcupadas.add(mesaId);
        }
      }
    }


    // ─────────────────────────────────────────────────────────
    // 1️⃣1️⃣ BUSCAR LA MESA LIBRE MÁS PEQUEÑA
    // QUE TENGA CAPACIDAD SUFICIENTE
    //
    // Así evitamos ocupar una mesa de 8 personas
    // para una reserva de 2 si existe una de 2 o 4.
    // ─────────────────────────────────────────────────────────
    const mesasAdecuadas = mesasOperativas
      .filter((mesa) => {
        const capacidad =
          Number(mesa.fields.capacidad || 0);

        return (
          capacidad >= numeroPersonas &&
          !mesasOcupadas.has(mesa.id)
        );
      })
      .sort(
        (a, b) =>
          Number(a.fields.capacidad) -
          Number(b.fields.capacidad)
      );

    const mesaLibre = mesasAdecuadas[0] || null;


    // ─────────────────────────────────────────────────────────
    // 1️⃣2️⃣ RESPUESTA A script.js
    // ─────────────────────────────────────────────────────────
    if (!mesaLibre) {
      console.log("No hay disponibilidad.");

      return responder(res, 200, {
        ok: true,
        disponible: false,
        motivo: "No hay una mesa disponible con capacidad suficiente."
      });
    }

    console.log(
      "Mesa disponible:",
      mesaLibre.fields.nombre_mesa,
      "- capacidad:",
      mesaLibre.fields.capacidad
    );

    return responder(res, 200, {
      ok: true,
      disponible: true,

      // Estos datos nos vienen bien para comprobar la prueba.
      // Todavía NO estamos creando la reserva.
      mesa: {
        id: mesaLibre.id,
        nombre: mesaLibre.fields.nombre_mesa,
        capacidad: mesaLibre.fields.capacidad
      }
    });

  } catch (error) {

    console.error(
      "ERROR CONTACTIA:",
      error
    );

    return responder(res, 500, {
      ok: false,
      disponible: false,
      error: error.message || "Error interno del servidor."
    });
  }
};