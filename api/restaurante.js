const crypto = require("crypto");
const { registroDebeAnonimizarse } = require("../lib/privacidad");


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


function normalizarObservaciones(valor) {
  const texto = String(valor || "").trim().slice(0, 1000);
  const mensajesInternos = [
    /^reserva telefónica añadida desde el panel\.?$/i,
    /^cliente sin reserva añadido desde el panel\.?$/i,
    /^bloqueo temporal para /i
  ];

  return mensajesInternos.some((patron) => patron.test(texto)) ? "" : texto;
}


function horaAMinutos(hora) {
  const partes = String(hora || "").match(/^(\d{2}):(\d{2})$/);

  if (!partes) {
    return null;
  }

  const horas = Number(partes[1]);
  const minutos = Number(partes[2]);

  if (horas > 23 || minutos > 59) {
    return null;
  }

  return horas * 60 + minutos;
}


function estadoBloqueaMesa(estado) {
  return ["confirmada", "ocupada", "con retraso", "cobrada"].includes(
    normalizarEstado(estado)
  );
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
    const horaMesas = String(body.hora_mesas || "14:00").trim();
    const clave = body.clave;

    if (
      !Number.isInteger(restauranteId) ||
      restauranteId <= 0 ||
      !fechaValida(fecha) ||
      horaAMinutos(horaMesas) === null
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

    const formula =
      `AND(` +
      `DATETIME_FORMAT({fecha},'YYYY-MM-DD')='${fecha}',` +
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
    const urlZonas =
      `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/ZONA`;
    const datosZonas = await consultarAirtable(urlZonas);
    const formulaListaEspera =
      `DATETIME_FORMAT({fecha},'YYYY-MM-DD')='${fecha}'`;
    const urlListaEspera =
      `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/LISTA_ESPERA` +
      `?filterByFormula=${encodeURIComponent(formulaListaEspera)}`;
    const datosListaEspera = await consultarAirtable(urlListaEspera);
    const duracion = Number(restaurante.fields.duracion_reserva_minutos);

    if (!Number.isInteger(duracion) || duracion <= 0) {
      throw new Error(
        "El campo duracion_reserva_minutos del restaurante no es válido."
      );
    }

    const ahora = new Date();
    const idsReservasVencidas = new Set(
      (datos.records || [])
        .filter((reserva) =>
          registroDebeAnonimizarse(reserva.fields, duracion, ahora)
        )
        .map((reserva) => reserva.id)
    );
    const idsEsperasVencidas = new Set(
      (datosListaEspera.records || [])
        .filter((solicitud) =>
          registroDebeAnonimizarse(solicitud.fields, duracion, ahora)
        )
        .map((solicitud) => solicitud.id)
    );
    const zonasRestaurante = (datosZonas.records || [])
      .filter((zona) =>
        Array.isArray(zona.fields.restaurante) &&
        zona.fields.restaurante.includes(restaurante.id)
      )
      .map((zona) => ({
        id: zona.id,
        nombre:
          zona.fields.nombre || zona.fields.zona ||
          zona.fields.id_zona || "Sin zona",
        estado: normalizarEstado(zona.fields.estado || "activo")
      }));
    const zonasPorId = new Map(
      zonasRestaurante.map((zona) => [zona.id, zona])
    );
    const datosMesasPorId = new Map(
      (datosMesas.records || []).map((mesa) => [
        mesa.id,
        {
          id: mesa.id,
          nombre:
            mesa.fields.nombre_mesa || String(mesa.fields.id || "Mesa"),
          capacidad: Number(mesa.fields.capacidad || 0),
          estado: normalizarEstado(mesa.fields.estado),
          zona_id: mesa.fields.zona?.[0] || null,
          zona: zonasPorId.get(mesa.fields.zona?.[0])?.nombre || "Sin zona",
          zona_estado:
            zonasPorId.get(mesa.fields.zona?.[0])?.estado || "inactivo"
        }
      ])
    );
    const estadosVisibles = new Set([
      "confirmada",
      "ocupada",
      "con retraso",
      "cobrada",
      "libre",
      "cancelada"
    ]);
    const reservas = (datos.records || [])
      .filter((reserva) => estadosVisibles.has(
        normalizarEstado(reserva.fields.estado)
      ))
      .map((reserva) => {
        const anonimizada = Boolean(
          reserva.fields.anonimizada || idsReservasVencidas.has(reserva.id)
        );
        const mesasAsignadas = (reserva.fields.mesa || []).map((mesaId) =>
          datosMesasPorId.get(mesaId) || { nombre: "Mesa", capacidad: 0 }
        );

        return {
          id: anonimizada ? null : reserva.id,
          localizador: anonimizada ? "" : (reserva.fields.id_reserva || ""),
          fecha: reserva.fields.fecha || fecha,
          hora: reserva.fields.hora || "",
          personas: Number(reserva.fields.personas || 0),
          mesa_ids: Array.isArray(reserva.fields.mesa)
            ? reserva.fields.mesa
            : [],
          mesas: mesasAsignadas.map((mesa) => mesa.nombre),
          capacidad_mesas: mesasAsignadas.reduce(
            (total, mesa) => total + mesa.capacidad,
            0
          ),
          nombre: anonimizada
            ? "Datos personales eliminados"
            : (reserva.fields.nombre_completo || ""),
          email: anonimizada ? "" : (reserva.fields.email || ""),
          telefono: anonimizada ? "" : (reserva.fields.telefono || ""),
          observaciones: anonimizada
            ? ""
            : normalizarObservaciones(reserva.fields.mensaje),
          estado: normalizarEstado(reserva.fields.estado),
          anonimizada
        };
      })
      .sort((a, b) =>
        String(a.hora).localeCompare(String(b.hora)) ||
        String(a.localizador).localeCompare(String(b.localizador))
      );
    const noCanceladas = reservas.filter((reserva) =>
      reserva.estado !== "cancelada"
    );
    const inicioConsulta = horaAMinutos(horaMesas);
    const finConsulta = inicioConsulta + duracion;
    const mesasOcupadas = new Set();

    for (const reserva of reservas) {
      if (!estadoBloqueaMesa(reserva.estado)) {
        continue;
      }

      const inicioReserva = horaAMinutos(reserva.hora);

      if (inicioReserva === null) {
        continue;
      }

      const finReserva = inicioReserva + duracion;

      if (inicioConsulta < finReserva && finConsulta > inicioReserva) {
        reserva.mesa_ids.forEach((mesaId) => mesasOcupadas.add(mesaId));
      }
    }

    const mesasDisponibles = Array.from(datosMesasPorId.values())
      .filter((mesa) =>
        mesa.estado !== "fuera de servicio" &&
        mesa.zona_estado !== "inactivo" &&
        !mesasOcupadas.has(mesa.id)
      )
      .sort((a, b) =>
        String(a.zona).localeCompare(String(b.zona), "es") ||
        String(a.nombre).localeCompare(String(b.nombre), "es", {
          numeric: true
        })
      )
      .map(({ id, nombre, capacidad, zona }) => ({
        id,
        nombre,
        capacidad,
        zona
      }));
    const mesasConfiguracion = Array.from(datosMesasPorId.values())
      .sort((a, b) =>
        String(a.zona).localeCompare(String(b.zona), "es") ||
        String(a.nombre).localeCompare(String(b.nombre), "es", {
          numeric: true
        })
      )
      .map(({ id, nombre, capacidad, estado, zona_id, zona, zona_estado }) => ({
        id,
        nombre,
        capacidad,
        estado,
        zona_id,
        zona,
        zona_estado
      }));
    const prioridadEstadoEspera = {
      pendiente: 0,
      avisado: 1,
      convertida: 2,
      cancelada: 3
    };
    const listaEspera = (datosListaEspera.records || [])
      .filter((solicitud) =>
        Array.isArray(solicitud.fields.restaurante) &&
        solicitud.fields.restaurante.includes(restaurante.id)
      )
      .map((solicitud) => {
        const anonimizada = Boolean(
          solicitud.fields.anonimizada ||
          idsEsperasVencidas.has(solicitud.id)
        );

        return {
          id: anonimizada ? null : solicitud.id,
          id_espera: anonimizada ? "" : (solicitud.fields.id_espera || ""),
          fecha: solicitud.fields.fecha || fecha,
          hora: solicitud.fields.hora || "",
          personas: Number(solicitud.fields.personas || 0),
          nombre: anonimizada
            ? "Datos personales eliminados"
            : (solicitud.fields.nombre_completo || ""),
          telefono: anonimizada ? "" : (solicitud.fields.telefono || ""),
          email: anonimizada ? "" : (solicitud.fields.email || ""),
          observaciones: anonimizada
            ? ""
            : normalizarObservaciones(solicitud.fields.observaciones),
          estado: normalizarEstado(solicitud.fields.estado || "pendiente"),
          creada_en: solicitud.createdTime || "",
          anonimizada
        };
      })
      .sort((a, b) =>
        (prioridadEstadoEspera[a.estado] ?? 9) -
          (prioridadEstadoEspera[b.estado] ?? 9) ||
        String(a.hora).localeCompare(String(b.hora)) ||
        String(a.creada_en).localeCompare(String(b.creada_en))
      );

    return responder(res, 200, {
      ok: true,
      restaurante: {
        id: restauranteId,
        nombre: restaurante.fields.nombre || "Restaurante"
      },
      fecha,
      hora_mesas: horaMesas,
      resumen: {
        reservas: noCanceladas.length,
        canceladas: reservas.length - noCanceladas.length,
        personas: noCanceladas.reduce((total, reserva) =>
          total + reserva.personas, 0)
      },
      reservas,
      lista_espera: listaEspera,
      mesas_disponibles: mesasDisponibles,
      zonas: zonasRestaurante.sort((a, b) =>
        a.nombre.localeCompare(b.nombre, "es")
      ),
      mesas_configuracion: mesasConfiguracion
    });
  } catch (error) {
    console.error("ERROR PANEL RESTAURANTE:", error);
    return responder(res, 500, {
      ok: false,
      error: "No se pudieron cargar las reservas del restaurante."
    });
  }
};

