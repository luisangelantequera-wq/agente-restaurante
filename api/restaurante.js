const crypto = require("crypto");


function responder(res, status, datos) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  return res.end(JSON.stringify(datos));
}


async function consultarAirtable(url) {
  const respuesta = await fetch(url, {
    headers: {
      Authorization: `Bearer ${process.env.AIRTABLE_API_KEY}`
    }
  });
  const texto = await respuesta.text();
  let datos;

  try {
    datos = texto ? JSON.parse(texto) : {};
  } catch {
    throw new Error(`Airtable devolvió una respuesta no válida. HTTP ${respuesta.status}`);
  }

  if (!respuesta.ok) {
    throw new Error(
      datos?.error?.message || `Error de Airtable. HTTP ${respuesta.status}`
    );
  }

  return datos;
}


async function buscarRestaurante(restauranteId) {
  const formula = encodeURIComponent(`{id}=${Number(restauranteId)}`);
  const url =
    `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/RESTAURANTES` +
    `?filterByFormula=${formula}`;
  const datos = await consultarAirtable(url);
  return datos.records?.[0] || null;
}


function clavesCoinciden(recibida, configurada) {
  const claveRecibida = Buffer.from(String(recibida || "").trim());
  const claveConfigurada = Buffer.from(String(configurada || "").trim());

  if (
    claveRecibida.length === 0 ||
    claveConfigurada.length === 0 ||
    claveRecibida.length !== claveConfigurada.length
  ) {
    return false;
  }

  return crypto.timingSafeEqual(claveRecibida, claveConfigurada);
}


function fechaValida(fecha) {
  const partes = String(fecha || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);

  if (!partes) {
    return false;
  }

  const anio = Number(partes[1]);
  const mes = Number(partes[2]);
  const dia = Number(partes[3]);
  const valor = new Date(Date.UTC(anio, mes - 1, dia));

  return valor.getUTCFullYear() === anio &&
    valor.getUTCMonth() === mes - 1 &&
    valor.getUTCDate() === dia;
}


function normalizarEstado(valor) {
  return String(valor || "").trim().toLowerCase();
}


async function ejecutarAccionReserva(body) {
  const urlPublica = String(
    process.env.PUBLIC_BASE_URL || "https://contactia.net"
  ).trim().replace(/\/+$/, "");
  const datosAccion = {
    accion: body.accion,
    restaurante_id: Number(body.restaurante_id),
    localizador: body.localizador
  };

  if (body.accion === "modificar") {
    datosAccion.fecha = body.fecha;
    datosAccion.hora = body.hora;
    datosAccion.personas = body.personas;
  }

  const respuesta = await fetch(`${urlPublica}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(datosAccion)
  });
  const texto = await respuesta.text();
  let datos;

  try {
    datos = texto ? JSON.parse(texto) : {};
  } catch {
    throw new Error("La operación sobre la reserva devolvió una respuesta no válida.");
  }

  return {
    status: respuesta.status,
    datos
  };
}


module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return responder(res, 405, {
      ok: false,
      error: "Método no permitido."
    });
  }

  try {
    const body = typeof req.body === "string"
      ? JSON.parse(req.body || "{}")
      : (req.body || {});
    const restauranteId = Number(body.restaurante_id);
    const fecha = String(body.fecha || "").trim();
    const clave = body.clave;

    if (
      !Number.isInteger(restauranteId) ||
      restauranteId <= 0 ||
      (!body.accion && !fechaValida(fecha))
    ) {
      return responder(res, 400, {
        ok: false,
        error: "El restaurante o la fecha no son válidos."
      });
    }

    const restaurante = await buscarRestaurante(restauranteId);

    if (!restaurante) {
      return responder(res, 404, {
        ok: false,
        error: "Restaurante no encontrado."
      });
    }

    if (!clavesCoinciden(clave, restaurante.fields.api_key_restaurante)) {
      return responder(res, 401, {
        ok: false,
        error: "La clave del restaurante no es correcta."
      });
    }

    if (body.accion) {
      if (!["modificar", "cancelar"].includes(body.accion)) {
        return responder(res, 400, {
          ok: false,
          error: "La acción solicitada no es válida."
        });
      }

      if (!/^[A-Z0-9-]{8,40}$/i.test(String(body.localizador || "").trim())) {
        return responder(res, 400, {
          ok: false,
          error: "El localizador no es válido."
        });
      }

      const resultadoAccion = await ejecutarAccionReserva(body);
      return responder(res, resultadoAccion.status, resultadoAccion.datos);
    }

    const formula =
      `AND(` +
      `DATETIME_FORMAT({fecha},'YYYY-MM-DD')='${fecha}',` +
      `OR(` +
      `LOWER(TRIM({estado}))='confirmada',` +
      `LOWER(TRIM({estado}))='cancelada'` +
      `),` +
      `FIND('${String(restauranteId)}',` +
      `ARRAYJOIN({id (from restaurante)}))` +
      `)`;
    const url =
      `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/RESERVAS` +
      `?filterByFormula=${encodeURIComponent(formula)}`;
    const datos = await consultarAirtable(url);
    const formulaMesas =
      `FIND('${String(restauranteId)}',` +
      `ARRAYJOIN({id (from restaurante)}))`;
    const urlMesas =
      `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/MESAS` +
      `?filterByFormula=${encodeURIComponent(formulaMesas)}`;
    const datosMesas = await consultarAirtable(urlMesas);
    const nombresMesas = new Map(
      (datosMesas.records || []).map((mesa) => [
        mesa.id,
        mesa.fields.nombre_mesa || String(mesa.fields.id || "Mesa")
      ])
    );
    const reservas = (datos.records || [])
      .map((reserva) => ({
        id: reserva.id,
        localizador: reserva.fields.id_reserva || "",
        hora: reserva.fields.hora || "",
        personas: Number(reserva.fields.personas || 0),
        mesas: (reserva.fields.mesa || []).map((mesaId) =>
          nombresMesas.get(mesaId) || "Mesa"
        ),
        nombre: reserva.fields.nombre_completo || "",
        email: reserva.fields.email || "",
        telefono: reserva.fields.telefono || "",
        estado: normalizarEstado(reserva.fields.estado)
      }))
      .sort((a, b) =>
        String(a.hora).localeCompare(String(b.hora)) ||
        String(a.localizador).localeCompare(String(b.localizador))
      );
    const confirmadas = reservas.filter((reserva) =>
      reserva.estado === "confirmada"
    );

    return responder(res, 200, {
      ok: true,
      restaurante: {
        id: restauranteId,
        nombre: restaurante.fields.nombre || "Restaurante"
      },
      fecha,
      resumen: {
        confirmadas: confirmadas.length,
        canceladas: reservas.length - confirmadas.length,
        personas: confirmadas.reduce((total, reserva) =>
          total + reserva.personas, 0)
      },
      reservas
    });
  } catch (error) {
    console.error("ERROR PANEL RESTAURANTE:", error);
    return responder(res, 500, {
      ok: false,
      error: "No se pudieron cargar las reservas del restaurante."
    });
  }
};

