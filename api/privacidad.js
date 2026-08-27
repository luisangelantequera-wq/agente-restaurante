const crypto = require("crypto");
const {
  crearCamposListaEsperaAnonimizada,
  crearCamposReservaAnonimizada,
  numeroEnteroPositivo,
  obtenerPrivacidadHasta,
  registroDebeAnonimizarse
} = require("../lib/privacidad");


function responder(res, status, datos) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  return res.end(JSON.stringify(datos));
}


function secretoCronValido(req) {
  const recibido = String(req.headers.authorization || "");
  const esperado = process.env.CRON_SECRET
    ? `Bearer ${process.env.CRON_SECRET}`
    : "";
  const bufferRecibido = Buffer.from(recibido);
  const bufferEsperado = Buffer.from(esperado);

  return Boolean(
    esperado &&
    bufferRecibido.length === bufferEsperado.length &&
    crypto.timingSafeEqual(bufferRecibido, bufferEsperado)
  );
}


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
    throw new Error(`Airtable devolvió una respuesta no válida. HTTP ${respuesta.status}`);
  }

  if (!respuesta.ok) {
    throw new Error(
      datos?.error?.message || `Error de Airtable. HTTP ${respuesta.status}`
    );
  }

  return datos;
}


async function listarRegistros(tabla, formula = "") {
  const registros = [];
  let offset = "";

  do {
    const parametros = new URLSearchParams({ pageSize: "100" });

    if (formula) {
      parametros.set("filterByFormula", formula);
    }

    if (offset) {
      parametros.set("offset", offset);
    }

    const url =
      `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/` +
      `${encodeURIComponent(tabla)}?${parametros.toString()}`;
    const datos = await consultarAirtable(url);

    registros.push(...(datos.records || []));
    offset = datos.offset || "";
  } while (offset);

  return registros;
}


async function actualizarRegistros(tabla, actualizaciones) {
  const url =
    `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/` +
    encodeURIComponent(tabla);

  for (let indice = 0; indice < actualizaciones.length; indice += 10) {
    await consultarAirtable(url, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        records: actualizaciones.slice(indice, indice + 10)
      })
    });
  }
}


function obtenerDuracionRestaurante(campos, duracionesPorRestaurante) {
  const restauranteId = Array.isArray(campos?.restaurante)
    ? campos.restaurante[0]
    : null;

  return numeroEnteroPositivo(campos?.duracion_reserva_minutos) ||
    duracionesPorRestaurante.get(restauranteId) || null;
}


async function ejecutarAnonimizacion(ahora = new Date()) {
  const restaurantes = await listarRegistros("RESTAURANTES");
  const duracionesPorRestaurante = new Map(
    restaurantes.map((restaurante) => [
      restaurante.id,
      numeroEnteroPositivo(restaurante.fields.duracion_reserva_minutos)
    ])
  );
  const [reservas, listaEspera] = await Promise.all([
    listarRegistros("RESERVAS", "NOT({anonimizada})"),
    listarRegistros("LISTA_ESPERA", "NOT({anonimizada})")
  ]);
  const actualizacionesReservas = [];
  const actualizacionesListaEspera = [];
  let reservasAnonimizadas = 0;
  let reservasPreparadas = 0;
  let esperasAnonimizadas = 0;
  let esperasPreparadas = 0;
  let omitidasSinFecha = 0;

  for (const reserva of reservas) {
    const duracion = obtenerDuracionRestaurante(
      reserva.fields,
      duracionesPorRestaurante
    );
    const privacidadHasta = obtenerPrivacidadHasta(reserva.fields, duracion);

    if (!privacidadHasta) {
      omitidasSinFecha += 1;
      continue;
    }

    if (registroDebeAnonimizarse(reserva.fields, duracion, ahora)) {
      actualizacionesReservas.push({
        id: reserva.id,
        fields: crearCamposReservaAnonimizada(ahora)
      });
      reservasAnonimizadas += 1;
      continue;
    }

    const metadatos = {};

    if (!reserva.fields.privacidad_hasta) {
      metadatos.privacidad_hasta = privacidadHasta.toISOString();
    }

    if (!numeroEnteroPositivo(reserva.fields.duracion_reserva_minutos) && duracion) {
      metadatos.duracion_reserva_minutos = duracion;
    }

    if (Object.keys(metadatos).length > 0) {
      actualizacionesReservas.push({ id: reserva.id, fields: metadatos });
      reservasPreparadas += 1;
    }
  }

  for (const solicitud of listaEspera) {
    const duracion = obtenerDuracionRestaurante(
      solicitud.fields,
      duracionesPorRestaurante
    );
    const privacidadHasta = obtenerPrivacidadHasta(solicitud.fields, duracion);

    if (!privacidadHasta) {
      omitidasSinFecha += 1;
      continue;
    }

    if (registroDebeAnonimizarse(solicitud.fields, duracion, ahora)) {
      actualizacionesListaEspera.push({
        id: solicitud.id,
        fields: crearCamposListaEsperaAnonimizada(ahora)
      });
      esperasAnonimizadas += 1;
    } else if (!solicitud.fields.privacidad_hasta) {
      actualizacionesListaEspera.push({
        id: solicitud.id,
        fields: { privacidad_hasta: privacidadHasta.toISOString() }
      });
      esperasPreparadas += 1;
    }
  }

  await actualizarRegistros("RESERVAS", actualizacionesReservas);
  await actualizarRegistros("LISTA_ESPERA", actualizacionesListaEspera);

  return {
    reservas_anonimizadas: reservasAnonimizadas,
    reservas_preparadas: reservasPreparadas,
    esperas_anonimizadas: esperasAnonimizadas,
    esperas_preparadas: esperasPreparadas,
    omitidas_sin_fecha: omitidasSinFecha
  };
}


module.exports = async (req, res) => {
  if (req.method !== "GET") {
    return responder(res, 405, { ok: false, error: "Método no permitido." });
  }

  if (!process.env.CRON_SECRET) {
    return responder(res, 503, {
      ok: false,
      error: "La tarea de privacidad no está configurada."
    });
  }

  if (!secretoCronValido(req)) {
    return responder(res, 401, { ok: false, error: "No autorizado." });
  }

  try {
    const resultado = await ejecutarAnonimizacion();
    return responder(res, 200, { ok: true, ...resultado });
  } catch (error) {
    console.error("ERROR TAREA PRIVACIDAD:", error.message);
    return responder(res, 500, {
      ok: false,
      error: "No se pudo completar la tarea de privacidad."
    });
  }
};


module.exports.ejecutarAnonimizacion = ejecutarAnonimizacion;

