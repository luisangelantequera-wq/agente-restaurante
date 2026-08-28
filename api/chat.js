// ============================================================

const crypto = require("crypto");
const {
  calcularPrivacidadHastaDesdeAhora,
  crearMetadatosPrivacidadListaEspera,
  crearMetadatosPrivacidadReserva,
  numeroEnteroPositivo,
  registroDebeAnonimizarse
} = require("../lib/privacidad");
const {
  sesionRestauranteValida
} = require("../lib/sesion-restaurante");
const {
  determinarOrigenAuditoria,
  registrarAuditoria
} = require("../lib/auditoria");
const CADUCIDAD_RESERVA_PENDIENTE_MS = 2 * 60 * 1000;
const MAX_REQUEST_BODY_BYTES = 32 * 1024;
const MAX_DIAS_ANTELACION_CONFIGURADO = Number(
  process.env.MAX_RESERVA_DIAS || 730
);
const MAX_DIAS_ANTELACION =
  Number.isInteger(MAX_DIAS_ANTELACION_CONFIGURADO) &&
  MAX_DIAS_ANTELACION_CONFIGURADO > 0
    ? MAX_DIAS_ANTELACION_CONFIGURADO
    : 730;
const ACCIONES_PERMITIDAS = new Set([
  "actualizar_disponibilidad",
  "actualizar_estado",
  "actualizar_lista_espera",
  "actualizar_observaciones",
  "cambiar_mesas",
  "cancelar",
  "consultar",
  "lista_espera_crear",
  "modificar",
  "ocupar_mesa",
  "opciones_mesas",
  "reactivar",
  "reservar",
  "reservar_panel",
  "verificar"
]);
const ACCIONES_CON_FECHA_RESERVA = new Set([
  "lista_espera_crear",
  "modificar",
  "ocupar_mesa",
  "reactivar",
  "reservar",
  "reservar_panel",
  "verificar"
]);
const LIMITES_CAMPOS_TEXTO = {
  accion: 40,
  clave_restaurante: 256,
  email: 254,
  estado_espera: 40,
  estado_nuevo: 40,
  fecha: 10,
  fecha_desde: 10,
  hora: 5,
  localizador: 40,
  mensaje: 1000,
  mesa_id: 40,
  nombre: 120,
  recurso_id: 40,
  registro_espera_id: 40,
  telefono: 25,
  tipo_recurso: 20,
  token_gestion: 48
};
// CONTACTIA V2 - api/chat.js
// FASE 2: comprobar disponibilidad + crear reserva
// ============================================================


// 1️⃣ RESPONDER SIEMPRE EN JSON
function responder(res, status, datos) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  return res.end(JSON.stringify(datos));
}


function obtenerTamanoSolicitud(req) {
  const longitudDeclarada = Number(req.headers?.["content-length"] || 0);

  if (Number.isFinite(longitudDeclarada) && longitudDeclarada > 0) {
    return longitudDeclarada;
  }

  if (typeof req.body === "string") {
    return Buffer.byteLength(req.body, "utf8");
  }

  if (req.body && typeof req.body === "object") {
    return Buffer.byteLength(JSON.stringify(req.body), "utf8");
  }

  return 0;
}


function validarCamposTexto(body) {
  for (const [campo, limite] of Object.entries(LIMITES_CAMPOS_TEXTO)) {
    if (body[campo] === undefined || body[campo] === null) {
      continue;
    }

    if (typeof body[campo] !== "string" || body[campo].length > limite) {
      return `El campo ${campo} no tiene un formato válido.`;
    }
  }

  if (body.mesa_ids !== undefined) {
    if (
      !Array.isArray(body.mesa_ids) ||
      body.mesa_ids.length > 20 ||
      body.mesa_ids.some((id) =>
        typeof id !== "string" || id.length > 40
      )
    ) {
      return "La selección de mesas no tiene un formato válido.";
    }
  }

  return "";
}


function datosContactoValidos(nombre, email, telefono, emailObligatorio = true) {
  const nombreNormalizado = String(nombre || "").trim();
  const emailNormalizado = String(email || "").trim().toLowerCase();
  const telefonoNormalizado = String(telefono || "").trim();

  return nombreNormalizado.length >= 2 &&
    nombreNormalizado.length <= 120 &&
    (!emailObligatorio || emailNormalizado.length > 0) &&
    (!emailNormalizado || (
      emailNormalizado.length <= 254 &&
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailNormalizado)
    )) &&
    /^[+0-9\s()-]{7,25}$/.test(telefonoNormalizado);
}


function fechaReservaDentroDeRango(fecha) {
  const partes = String(fecha || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);

  if (!partes || !obtenerDiaSemana(fecha)) {
    return false;
  }

  const fechaSolicitada = Date.UTC(
    Number(partes[1]),
    Number(partes[2]) - 1,
    Number(partes[3])
  );
  const ahora = new Date();
  const hoy = Date.UTC(
    ahora.getFullYear(),
    ahora.getMonth(),
    ahora.getDate()
  );
  const diferenciaDias = Math.floor(
    (fechaSolicitada - hoy) / (24 * 60 * 60 * 1000)
  );

  return diferenciaDias >= 0 && diferenciaDias <= MAX_DIAS_ANTELACION;
}


// 2️⃣ CONSULTA SEGURA A AIRTABLE
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


// 3️⃣ BUSCAR RESTAURANTE
async function buscarRestaurante(restaurante_id) {

  const formula =
    encodeURIComponent(`{id}=${Number(restaurante_id)}`);

  const url =
    `https://api.airtable.com/v0/` +
    `${process.env.AIRTABLE_BASE_ID}/RESTAURANTES` +
    `?filterByFormula=${formula}`;

  const datos = await consultarAirtable(url);

  return datos.records?.[0] || null;
}


// 4️⃣ BUSCAR MESA O COMBINACIÓN DISPONIBLE
async function buscarAsignacionDisponible(
  restaurante_id,
  restauranteRecordId,
  fecha,
  hora,
  personas,
  margenCapacidad,
  duracionReservaMinutos,
  reservaExcluirId = null,
  devolverTodas = false
) {


  // Buscar mesas del restaurante
  const formulaMesas =
    `FIND('${String(restaurante_id)}',` +
    `ARRAYJOIN({id (from restaurante)}))`;

  const urlMesas =
    `https://api.airtable.com/v0/` +
    `${process.env.AIRTABLE_BASE_ID}/MESAS` +
    `?filterByFormula=${encodeURIComponent(formulaMesas)}`;

  const datosMesas = await consultarAirtable(urlMesas);

  const mesas = datosMesas.records || [];
  const urlZonas =
    `https://api.airtable.com/v0/` +
    `${process.env.AIRTABLE_BASE_ID}/ZONA`;
  const datosZonas = await consultarAirtable(urlZonas);
  const zonasActivas = new Set(
    (datosZonas.records || [])
      .filter((zona) => {
        const estado = String(zona.fields.estado || "activo")
          .trim()
          .toLowerCase();
        return estado !== "inactivo" &&
          Array.isArray(zona.fields.restaurante) &&
          zona.fields.restaurante.includes(restauranteRecordId);
      })
      .map((zona) => zona.id)
  );


  // Descartamos únicamente las mesas fuera de servicio
  const mesasOperativas = mesas.filter((mesa) => {

    const estado =
      String(mesa.fields.estado || "")
        .trim()
        .toLowerCase();

    const zona = Array.isArray(mesa.fields.zona) &&
      mesa.fields.zona.length === 1
      ? mesa.fields.zona[0]
      : null;

    return estado !== "fuera de servicio" && zonasActivas.has(zona);
  });


  // Buscar reservas ya confirmadas

const formulaReservas =
  `AND(` +
  `DATETIME_FORMAT({fecha},'YYYY-MM-DD')='${fecha}',` +
  `OR(` +
  `LOWER(TRIM({estado}))='confirmada',` +
  `LOWER(TRIM({estado}))='ocupada',` +
  `LOWER(TRIM({estado}))='con retraso',` +
  `LOWER(TRIM({estado}))='cobrada'` +
  `),` +
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

  // Obtener las mesas de cualquier reserva cuya franja se solape.
  const mesasOcupadas = new Set();
  const inicioSolicitado = horaAMinutos(hora);
  const duracion = Number(duracionReservaMinutos);

  if (inicioSolicitado === null || !Number.isInteger(duracion) || duracion <= 0) {
    throw new Error(
      "El campo duracion_reserva_minutos del restaurante no es válido."
    );
  }

  const finSolicitado = inicioSolicitado + duracion;

  for (const reserva of reservas) {
    if (reserva.id === reservaExcluirId) {
      continue;
    }

    const inicioReserva = horaAMinutos(reserva.fields.hora);

    if (inicioReserva === null) {
      continue;
    }

    const finReserva = inicioReserva + duracion;
    const seSolapan =
      inicioSolicitado < finReserva && finSolicitado > inicioReserva;

    if (!seSolapan) {
      continue;
    }

    const mesasReserva = reserva.fields.mesa;

    if (Array.isArray(mesasReserva)) {

      for (const mesaId of mesasReserva) {
        mesasOcupadas.add(mesaId);
      }
    }
  }


  // Buscar la mesa adecuada más pequeña
  const mesasAdecuadas = mesasOperativas

    .filter((mesa) => {

      const capacidad =
        Number(mesa.fields.capacidad || 0);



     
const personasNum = Number(personas);
const margenNum = Number(margenCapacidad || 0);

return (
  capacidad >= personasNum &&
  (devolverTodas || capacidad <= personasNum + margenNum) &&
  !mesasOcupadas.has(mesa.id)
);



    })

    .sort(
      (a, b) =>
        Number(a.fields.capacidad) -
        Number(b.fields.capacidad)
    );


  const asignacionesMesas = mesasAdecuadas.map((mesa) => ({
      ids: [mesa.id],
      nombre: mesa.fields.nombre_mesa,
      capacidad: Number(mesa.fields.capacidad || 0),
      tipo: "mesa",
      zona_id: Array.isArray(mesa.fields.zona) && mesa.fields.zona.length === 1
        ? mesa.fields.zona[0]
        : null
    }));

  if (!devolverTodas && asignacionesMesas[0]) {
    return asignacionesMesas[0];
  }

  const urlCombinaciones =
    `https://api.airtable.com/v0/` +
    `${process.env.AIRTABLE_BASE_ID}/COMBINACIONES_MESAS`;
  const datosCombinaciones = await consultarAirtable(urlCombinaciones);
  const mesasPorId = new Map(mesasOperativas.map((mesa) => [mesa.id, mesa]));
  const personasNum = Number(personas);
  const margenNum = Number(margenCapacidad || 0);

  const combinacionesAdecuadas = (datosCombinaciones.records || [])
    .filter((combinacion) => {
      const estado = String(combinacion.fields.estado || "").trim().toLowerCase();
      const restaurantes = combinacion.fields.restaurante;
      const idsMesas = combinacion.fields.mesas;
      return estado === "activa" &&
        Array.isArray(restaurantes) &&
        restaurantes.includes(restauranteRecordId) &&
        Array.isArray(idsMesas) && idsMesas.length >= 2;
    })
    .map((combinacion) => {
      const idsMesas = combinacion.fields.mesas;
      const mesasCombinacion = idsMesas.map((id) => mesasPorId.get(id));

      if (mesasCombinacion.some((mesa) => !mesa) ||
          idsMesas.some((id) => mesasOcupadas.has(id))) {
        return null;
      }

      const zonas = mesasCombinacion.map((mesa) => {
        const zona = mesa.fields.zona;
        return Array.isArray(zona) && zona.length === 1 ? zona[0] : null;
      });
      if (!zonas[0] || zonas.some((zona) => zona !== zonas[0])) {
        return null;
      }

      const capacidad = mesasCombinacion.reduce(
        (total, mesa) => total + Number(mesa.fields.capacidad || 0), 0
      );
      if (
        capacidad < personasNum ||
        (!devolverTodas && capacidad > personasNum + margenNum)
      ) {
        return null;
      }

      return {
        ids: idsMesas,
        nombre: combinacion.fields.nombre ||
          mesasCombinacion.map((mesa) => mesa.fields.nombre_mesa).join(" + "),
        capacidad,
        prioridad: Number(combinacion.fields.prioridad || 999999),
        tipo: "combinacion",
        zona_id: zonas[0]
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.capacidad - b.capacidad || a.prioridad - b.prioridad);

  if (!devolverTodas) {
    return combinacionesAdecuadas[0] || null;
  }

  const nombresZonas = new Map(
    (datosZonas.records || []).map((zona) => [
      zona.id,
      zona.fields.nombre || zona.fields.zona || zona.fields.id_zona || "Sin zona"
    ])
  );

  return [...asignacionesMesas, ...combinacionesAdecuadas]
    .map((asignacion) => ({
      ...asignacion,
      zona: nombresZonas.get(asignacion.zona_id) || "Sin zona"
    }))
    .sort((a, b) =>
      a.capacidad - b.capacidad ||
      a.zona.localeCompare(b.zona, "es") ||
      a.nombre.localeCompare(b.nombre, "es")
    );
}


async function existeAsignacionCompatible(
  restaurante_id,
  restauranteRecordId,
  personas,
  margenCapacidad
) {
  const formulaMesas =
    `FIND('${String(restaurante_id)}',` +
    `ARRAYJOIN({id (from restaurante)}))`;
  const urlMesas =
    `https://api.airtable.com/v0/` +
    `${process.env.AIRTABLE_BASE_ID}/MESAS` +
    `?filterByFormula=${encodeURIComponent(formulaMesas)}`;
  const datosMesas = await consultarAirtable(urlMesas);
  const urlZonas =
    `https://api.airtable.com/v0/` +
    `${process.env.AIRTABLE_BASE_ID}/ZONA`;
  const datosZonas = await consultarAirtable(urlZonas);
  const zonasActivas = new Set(
    (datosZonas.records || [])
      .filter((zona) => {
        const estado = String(zona.fields.estado || "activo")
          .trim()
          .toLowerCase();
        return estado !== "inactivo" &&
          Array.isArray(zona.fields.restaurante) &&
          zona.fields.restaurante.includes(restauranteRecordId);
      })
      .map((zona) => zona.id)
  );
  const mesasOperativas = (datosMesas.records || []).filter((mesa) => {
    const zona = Array.isArray(mesa.fields.zona) &&
      mesa.fields.zona.length === 1
      ? mesa.fields.zona[0]
      : null;
    return String(mesa.fields.estado || "").trim().toLowerCase() !==
      "fuera de servicio" && zonasActivas.has(zona);
  });
  const personasNum = Number(personas);
  const margenNum = Number(margenCapacidad || 0);
  const capacidadCompatible = (capacidad) =>
    capacidad >= personasNum && capacidad <= personasNum + margenNum;

  if (mesasOperativas.some((mesa) =>
    capacidadCompatible(Number(mesa.fields.capacidad || 0))
  )) {
    return true;
  }

  const urlCombinaciones =
    `https://api.airtable.com/v0/` +
    `${process.env.AIRTABLE_BASE_ID}/COMBINACIONES_MESAS`;
  const datosCombinaciones = await consultarAirtable(urlCombinaciones);
  const mesasPorId = new Map(mesasOperativas.map((mesa) => [mesa.id, mesa]));

  return (datosCombinaciones.records || []).some((combinacion) => {
    const estado = String(combinacion.fields.estado || "").trim().toLowerCase();
    const restaurantes = combinacion.fields.restaurante;
    const idsMesas = combinacion.fields.mesas;

    if (
      estado !== "activa" ||
      !Array.isArray(restaurantes) ||
      !restaurantes.includes(restauranteRecordId) ||
      !Array.isArray(idsMesas) ||
      idsMesas.length < 2
    ) {
      return false;
    }

    const mesasCombinacion = idsMesas.map((id) => mesasPorId.get(id));

    if (mesasCombinacion.some((mesa) => !mesa)) {
      return false;
    }

    const zonas = mesasCombinacion.map((mesa) => {
      const zona = mesa.fields.zona;
      return Array.isArray(zona) && zona.length === 1 ? zona[0] : null;
    });

    if (!zonas[0] || zonas.some((zona) => zona !== zonas[0])) {
      return false;
    }

    const capacidad = mesasCombinacion.reduce(
      (total, mesa) => total + Number(mesa.fields.capacidad || 0),
      0
    );
    return capacidadCompatible(capacidad);
  });
}


async function confirmarReservaSinConflictos(
  reservaCreada,
  restaurante_id,
  fecha,
  hora,
  duracionReservaMinutos,
  mesasAsignadas,
  reservasExcluirIds = [],
  estadoGanador = "confirmada"
) {
  const formula =
    `AND(` +
    `DATETIME_FORMAT({fecha},'YYYY-MM-DD')='${fecha}',` +
    `OR(` +
    `LOWER(TRIM({estado}))='confirmada',` +
    `LOWER(TRIM({estado}))='ocupada',` +
    `LOWER(TRIM({estado}))='con retraso',` +
    `LOWER(TRIM({estado}))='cobrada',` +
    `LOWER(TRIM({estado}))='pendiente'` +
    `),` +
    `FIND('${String(restaurante_id)}',` +
    `ARRAYJOIN({id (from restaurante)}))` +
    `)`;
  const url =
    `https://api.airtable.com/v0/` +
    `${process.env.AIRTABLE_BASE_ID}/RESERVAS` +
    `?filterByFormula=${encodeURIComponent(formula)}`;
  const datos = await consultarAirtable(url);
  const inicioActual = horaAMinutos(hora);
  const finActual = inicioActual + Number(duracionReservaMinutos);
  const idsMesas = new Set(mesasAsignadas);
  const idsReservasExcluidas = new Set(reservasExcluirIds);
  const ahora = Date.now();
  const pendientesExpiradas = (datos.records || []).filter((reserva) => {
    if (reserva.id === reservaCreada.id) {
      return false;
    }

    const estado = String(reserva.fields.estado || "").trim().toLowerCase();
    const creadaEn = Date.parse(reserva.createdTime || "");

    return estado === "pendiente" &&
      Number.isFinite(creadaEn) &&
      ahora - creadaEn > CADUCIDAD_RESERVA_PENDIENTE_MS;
  });

  await Promise.all(pendientesExpiradas.map((reserva) => {
    const urlPendiente =
      `https://api.airtable.com/v0/` +
      `${process.env.AIRTABLE_BASE_ID}/RESERVAS/${reserva.id}`;

    return consultarAirtable(urlPendiente, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fields: {
          estado: "expirada",
          privacidad_hasta: calcularPrivacidadHastaDesdeAhora()
        }
      })
    });
  }));

  const idsExpiradas = new Set(
    pendientesExpiradas.map((reserva) => reserva.id)
  );

  const conflictos = (datos.records || []).filter((reserva) => {
    if (idsExpiradas.has(reserva.id)) {
      return false;
    }

    if (idsReservasExcluidas.has(reserva.id)) {
      return false;
    }

    if (reserva.id === reservaCreada.id) {
      return true;
    }

    const inicio = horaAMinutos(reserva.fields.hora);
    const mesas = Array.isArray(reserva.fields.mesa) ? reserva.fields.mesa : [];

    if (inicio === null || !mesas.some((id) => idsMesas.has(id))) {
      return false;
    }

    const fin = inicio + Number(duracionReservaMinutos);
    return inicioActual < fin && finActual > inicio;
  });

  const estadosQueBloquean = new Set([
    "confirmada",
    "ocupada",
    "con retraso",
    "cobrada"
  ]);
  const hayConfirmadaAnterior = conflictos.some((reserva) =>
    reserva.id !== reservaCreada.id &&
    estadosQueBloquean.has(
      String(reserva.fields.estado || "").trim().toLowerCase()
    )
  );
  const pendientes = conflictos
    .filter((reserva) =>
      String(reserva.fields.estado || "").trim().toLowerCase() === "pendiente"
    )
    .sort((a, b) =>
      String(a.createdTime || "").localeCompare(String(b.createdTime || "")) ||
      a.id.localeCompare(b.id)
    );
  const esGanadora =
    !hayConfirmadaAnterior && pendientes[0]?.id === reservaCreada.id;
  const estadoFinal = esGanadora ? estadoGanador : "rechazada_conflicto";
  const urlReserva =
    `https://api.airtable.com/v0/` +
    `${process.env.AIRTABLE_BASE_ID}/RESERVAS/${reservaCreada.id}`;
  const actualizada = await consultarAirtable(urlReserva, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      fields: {
        estado: estadoFinal,
        ...(!esGanadora
          ? { privacidad_hasta: calcularPrivacidadHastaDesdeAhora() }
          : {})
      }
    })
  });

  return { confirmada: esGanadora, reserva: actualizada };
}


async function buscarReservaPorLocalizador(restaurante_id, localizador) {
  const formula =
    `AND(` +
    `UPPER(TRIM({id_reserva}))='${localizador}',` +
    `FIND('${String(restaurante_id)}',` +
    `ARRAYJOIN({id (from restaurante)}))` +
    `)`;
  const url =
    `https://api.airtable.com/v0/` +
    `${process.env.AIRTABLE_BASE_ID}/RESERVAS` +
    `?filterByFormula=${encodeURIComponent(formula)}`;
  const datos = await consultarAirtable(url);

  return datos.records?.[0] || null;
}


async function buscarReservaPorToken(restaurante_id, tokenGestion) {
  const formula =
    `AND(` +
    `TRIM({token_gestion})='${tokenGestion}',` +
    `FIND('${String(restaurante_id)}',` +
    `ARRAYJOIN({id (from restaurante)}))` +
    `)`;
  const url =
    `https://api.airtable.com/v0/` +
    `${process.env.AIRTABLE_BASE_ID}/RESERVAS` +
    `?filterByFormula=${encodeURIComponent(formula)}`;
  const datos = await consultarAirtable(url);

  return datos.records?.[0] || null;
}


async function buscarReservaGestion(
  restaurante_id,
  localizador,
  tokenGestion,
  permitirLocalizador = false
) {
  let reserva;

  if (tokenGestion) {
    const tokenNormalizado = String(tokenGestion).trim().toLowerCase();

    if (!/^[a-f0-9]{48}$/.test(tokenNormalizado)) {
      throw new Error("El token de gestión no tiene un formato válido.");
    }

    reserva = await buscarReservaPorToken(restaurante_id, tokenNormalizado);
  } else if (permitirLocalizador) {
    const localizadorNormalizado = String(localizador || "").trim().toUpperCase();

    if (!/^[A-Z0-9-]{8,40}$/.test(localizadorNormalizado)) {
      throw new Error("El localizador no tiene un formato válido.");
    }

    reserva = await buscarReservaPorLocalizador(
      restaurante_id,
      localizadorNormalizado
    );
  } else {
    return null;
  }

  if (!reserva) {
    return null;
  }

  let duracion = numeroEnteroPositivo(
    reserva.fields.duracion_reserva_minutos
  );

  if (!duracion) {
    const restaurante = await buscarRestaurante(restaurante_id);
    duracion = numeroEnteroPositivo(
      restaurante?.fields?.duracion_reserva_minutos
    );
  }

  return registroDebeAnonimizarse(reserva.fields, duracion)
    ? null
    : reserva;
}


function resumirReserva(reserva) {
  return {
    localizador: reserva.fields.id_reserva,
    fecha: reserva.fields.fecha,
    hora: reserva.fields.hora,
    personas: reserva.fields.personas,
    nombre: reserva.fields.nombre_completo,
    estado: reserva.fields.estado,
    observaciones: normalizarObservaciones(reserva.fields.mensaje)
  };
}


function mismosIdsMesa(idsA, idsB) {
  if (!Array.isArray(idsA) || !Array.isArray(idsB) || idsA.length !== idsB.length) {
    return false;
  }

  const ordenadosA = [...idsA].map(String).sort();
  const ordenadosB = [...idsB].map(String).sort();
  return ordenadosA.every((id, indice) => id === ordenadosB[indice]);
}


// 5️⃣ BUSCAR HORARIOS ALTERNATIVOS
function horaAMinutos(hora) {
  const partes = String(hora).match(/^(\d{1,2}):(\d{2})$/);

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


function minutosAHora(minutosTotales) {
  const horas = Math.floor(minutosTotales / 60);
  const minutos = minutosTotales % 60;

  return `${String(horas).padStart(2, "0")}:${String(minutos).padStart(2, "0")}`;
}


function leerJSONCampo(valor, valorPredeterminado, nombreCampo) {
  if (valor === undefined || valor === null || valor === "") {
    return valorPredeterminado;
  }

  if (typeof valor === "object") {
    return valor;
  }

  try {
    return JSON.parse(valor);
  } catch {
    throw new Error(
      `El campo ${nombreCampo} del restaurante no contiene un JSON válido.`
    );
  }
}


function obtenerDiaSemana(fecha) {
  const partes = String(fecha).match(/^(\d{4})-(\d{2})-(\d{2})$/);

  if (!partes) {
    return null;
  }

  const anio = Number(partes[1]);
  const mes = Number(partes[2]);
  const dia = Number(partes[3]);
  const fechaUTC = new Date(Date.UTC(anio, mes - 1, dia));

  if (
    fechaUTC.getUTCFullYear() !== anio ||
    fechaUTC.getUTCMonth() !== mes - 1 ||
    fechaUTC.getUTCDate() !== dia
  ) {
    return null;
  }

  return [
    "domingo",
    "lunes",
    "martes",
    "miércoles",
    "jueves",
    "viernes",
    "sábado"
  ][fechaUTC.getUTCDay()];
}


function validarHorarioRestaurante(campos, fecha, hora) {
  const estado = String(campos.estado || "activo")
    .trim()
    .toLowerCase();

  if (estado !== "activo") {
    return {
      valido: false,
      motivo: "El restaurante no está aceptando reservas en este momento.",
      cambioRequerido: "fecha"
    };
  }

  const diaSemana = obtenerDiaSemana(fecha);
  const minutosSolicitados = horaAMinutos(hora);

  if (!diaSemana || minutosSolicitados === null) {
    return {
      valido: false,
      motivo: "La fecha o la hora solicitada no es válida.",
      cambioRequerido: "fecha"
    };
  }

  const horario = leerJSONCampo(
    campos.horario_reservas,
    {},
    "horario_reservas"
  );
  const diasCierre = leerJSONCampo(
    campos.dias_cierre,
    [],
    "dias_cierre"
  );
  const cierresEspeciales = leerJSONCampo(
    campos.cierres_especiales,
    [],
    "cierres_especiales"
  );

  if (
    typeof horario !== "object" ||
    Array.isArray(horario) ||
    !Array.isArray(diasCierre) ||
    !Array.isArray(cierresEspeciales)
  ) {
    throw new Error(
      "La configuración de horarios o cierres del restaurante no es válida."
    );
  }

  const cierresSemanales = diasCierre.map((dia) =>
    String(dia).trim().toLowerCase()
  );

  if (cierresSemanales.includes(diaSemana)) {
    return {
      valido: false,
      motivo:
        `El ${diaSemana} es nuestro día de cierre.`,
      cambioRequerido: "fecha"
    };
  }

  if (cierresEspeciales.map(String).includes(fecha)) {
    return {
      valido: false,
      motivo: "El restaurante está cerrado en esa fecha.",
      cambioRequerido: "fecha"
    };
  }

  const rangos = horario[diaSemana];

  if (!Array.isArray(rangos) || rangos.length === 0) {
    return {
      valido: false,
      motivo: `El restaurante no admite reservas ese día (${diaSemana}).`,
      cambioRequerido: "fecha"
    };
  }

  const intervalo = Number(campos.intervalo_minutos);

  if (!Number.isInteger(intervalo) || intervalo <= 0) {
    throw new Error(
      "El campo intervalo_minutos del restaurante no es válido."
    );
  }

  let dentroDeUnTurno = false;
  let coincideConIntervalo = false;

  for (const rango of rangos) {
    const partesRango = String(rango).split("-").map((parte) => parte.trim());

    if (partesRango.length !== 2) {
      throw new Error(
        `El rango ${rango} de horario_reservas no es válido.`
      );
    }

    const inicio = horaAMinutos(partesRango[0]);
    const fin = horaAMinutos(partesRango[1]);

    if (inicio === null || fin === null || inicio >= fin) {
      throw new Error(
        `El rango ${rango} de horario_reservas no es válido.`
      );
    }

    if (minutosSolicitados >= inicio && minutosSolicitados < fin) {
      dentroDeUnTurno = true;
      coincideConIntervalo =
        (minutosSolicitados - inicio) % intervalo === 0;
      break;
    }
  }

  if (!dentroDeUnTurno) {
    return {
      valido: false,
      motivo:
        `El horario de reservas para el ${diaSemana} es ` +
        `${rangos.join(" y ")}.`,
      cambioRequerido: "hora"
    };
  }

  if (!coincideConIntervalo) {
    return {
      valido: false,
      motivo:
        `Las reservas se admiten en intervalos de ${intervalo} minutos.`,
      cambioRequerido: "hora"
    };
  }

  return { valido: true };
}


async function buscarHorariosAlternativos(
  restaurante_id,
  restauranteRecordId,
  fecha,
  hora,
  personas,
  margenCapacidad,
  duracionReservaMinutos,
  intervaloMinutos,
  camposRestaurante,
  reservaExcluirId = null
) {
  const horaSolicitada = horaAMinutos(hora);
  const intervalo = Number(intervaloMinutos);

  if (
    horaSolicitada === null ||
    !Number.isInteger(intervalo) ||
    intervalo <= 0
  ) {
    return [];
  }

  // Las alternativas deben pertenecer al mismo servicio que la hora pedida.
  // Así una petición para comer nunca ofrece horas del turno de cena.
  const diaSemana = obtenerDiaSemana(fecha);
  const horario = leerJSONCampo(
    camposRestaurante.horario_reservas,
    {},
    "horario_reservas"
  );
  const rangosDelDia = Array.isArray(horario[diaSemana])
    ? horario[diaSemana]
    : [];
  const rangosValidos = rangosDelDia
    .map((rango) => String(rango).split("-").map((parte) =>
      horaAMinutos(parte.trim())
    ))
    .filter(([inicio, fin]) =>
      inicio !== null && fin !== null && inicio < fin
    );
  let rangoSolicitado = rangosValidos.find(([inicio, fin]) =>
    horaSolicitada >= inicio && horaSolicitada < fin
  );

  // Si la hora queda justo fuera de un servicio, se utiliza el servicio
  // más cercano dentro del margen de una hora. Por ejemplo, una petición
  // a las 13:00 puede ofrecer las 13:30 si el turno comienza entonces.
  if (!rangoSolicitado) {
    rangoSolicitado = rangosValidos
      .map((rango) => {
        const [inicio, fin] = rango;
        const distancia = horaSolicitada < inicio
          ? inicio - horaSolicitada
          : horaSolicitada - fin;
        return { rango, distancia };
      })
      .filter(({ distancia }) => distancia <= 60)
      .sort((a, b) => a.distancia - b.distancia)[0]?.rango;
  }

  if (!rangoSolicitado) {
    return [];
  }

  const [inicioServicio, finServicio] = rangoSolicitado;

  const candidatos = [];

  for (
    let minutosCandidatos = inicioServicio;
    minutosCandidatos < finServicio;
    minutosCandidatos += intervalo
  ) {
    const distancia = Math.abs(minutosCandidatos - horaSolicitada);

    if (distancia > 0 && distancia <= 60) {
      candidatos.push({
        hora: minutosAHora(minutosCandidatos),
        minutos: minutosCandidatos,
        distancia
      });
    }
  }

  candidatos.sort((a, b) =>
    a.distancia - b.distancia || a.minutos - b.minutos
  );

  const alternativas = [];

  for (const candidato of candidatos) {
    const horaCandidata = candidato.hora;
    const validacionHorario = validarHorarioRestaurante(
      camposRestaurante,
      fecha,
      horaCandidata
    );

    if (!validacionHorario.valido) {
      continue;
    }

    const mesaLibre = await buscarAsignacionDisponible(
      restaurante_id,
      restauranteRecordId,
      fecha,
      horaCandidata,
      personas,
      margenCapacidad,
      duracionReservaMinutos,
      reservaExcluirId
    );

    if (mesaLibre) {
      alternativas.push(horaCandidata);
    }

    if (alternativas.length === 4) {
      break;
    }
  }

  return alternativas;
}


// 6️⃣ GENERAR LOCALIZADOR
function generarIdReserva(fecha, prefijo = "SOL") {
  const fechaLimpia = String(fecha || "").replaceAll("-", "");
  const aleatorio = crypto.randomBytes(5).toString("hex").toUpperCase();

  return `${prefijo}-${fechaLimpia}-${aleatorio}`;
}


async function generarIdReservaUnico(restauranteId, fecha, prefijo = "SOL") {
  for (let intento = 0; intento < 5; intento += 1) {
    const localizador = generarIdReserva(fecha, prefijo);
    const existente = await buscarReservaPorLocalizador(
      restauranteId,
      localizador
    );

    if (!existente) {
      return localizador;
    }
  }

  throw new Error("No se pudo generar un localizador único.");
}


function generarIdEspera(fecha) {
  const fechaLimpia = String(fecha || "").replaceAll("-", "");
  const aleatorio = crypto.randomBytes(5).toString("hex").toUpperCase();

  return `ESP-${fechaLimpia}-${aleatorio}`;
}


function escaparFormulaAirtable(valor) {
  return String(valor || "")
    .replaceAll("\\", "\\\\")
    .replaceAll("'", "\\'");
}


function generarTokenGestion() {
  return crypto.randomBytes(24).toString("hex");
}


function clavesRestauranteCoinciden(recibida, configurada) {
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


function generarEnlaceGestion(tokenGestion) {
  const urlPublica = String(
    process.env.PUBLIC_BASE_URL || "https://contactia.net"
  ).trim().replace(/\/+$/, "");

  return tokenGestion
    ? `${urlPublica}/#gestion=${tokenGestion}`
    : urlPublica;
}


function generarEnlacePanelRestaurante(fecha, restauranteId) {
  const urlPublica = String(
    process.env.PUBLIC_BASE_URL || "https://contactia.net"
  ).trim().replace(/\/+$/, "");
  const parametros = new URLSearchParams({
    fecha: String(fecha),
    restaurante: String(restauranteId)
  });

  return `${urlPublica}/restaurante.html?${parametros.toString()}`;
}


function escaparHtml(valor) {
  return String(valor ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}


function formatearFechaLarga(fecha) {
  const [anio, mes, dia] = String(fecha || "").split("-").map(Number);

  if (!anio || !mes || !dia) {
    return String(fecha || "");
  }

  return new Intl.DateTimeFormat("es-ES", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC"
  })
    .format(new Date(Date.UTC(anio, mes - 1, dia)))
    .replace(",", "");
}


function formatearFechaOperativa(fecha) {
  const partes = String(fecha || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);

  if (!partes) {
    return {
      diaSemana: "",
      fechaCorta: String(fecha || "")
    };
  }

  return {
    diaSemana: obtenerDiaSemana(fecha) || "",
    fechaCorta: `${partes[3]}/${partes[2]}/${partes[1]}`
  };
}


function normalizarTexto(valor) {
  if (Array.isArray(valor)) {
    return valor.map(normalizarTexto).filter(Boolean).join(", ");
  }

  if (valor && typeof valor === "object") {
    return normalizarTexto(valor.name || valor.value || "");
  }

  return String(valor ?? "").trim();
}


function normalizarObservaciones(valor) {
  const texto = normalizarTexto(valor).slice(0, 1000);
  const mensajesInternos = [
    /^reserva telefónica añadida desde el panel\.?$/i,
    /^cliente sin reserva añadido desde el panel\.?$/i,
    /^bloqueo temporal para /i
  ];

  return mensajesInternos.some((patron) => patron.test(texto)) ? "" : texto;
}


function observacionEsPrioritaria(valor) {
  const texto = normalizarObservaciones(valor)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

  return /alerg|anafil|celiac|gluten|intoleran/.test(texto);
}


function obtenerNombreRestaurante(restaurante) {
  const campos = restaurante?.fields || {};
  const candidatos = [
    campos.nombre_restaurante,
    campos.nombre,
    campos.restaurante
  ];

  for (const candidato of candidatos) {
    const nombre = normalizarTexto(candidato);

    if (nombre) {
      return nombre;
    }
  }

  return "Restaurante Sol";
}


function obtenerTelefonoRestaurante(restaurante) {
  const campos = restaurante?.fields || {};
  const telefonos = [campos.telefono1, campos.telefono2];

  for (const telefono of telefonos) {
    const valor = normalizarTexto(telefono);

    if (valor) {
      return valor;
    }
  }

  return "";
}


async function enviarCorreoResend({
  destinatario,
  asunto,
  texto,
  html,
  contexto
}) {
  if (!process.env.RESEND_API_KEY || !destinatario) {
    console.warn(
      `Correo de ${contexto} omitido: falta RESEND_API_KEY o destinatario.`
    );
    return false;
  }

  const remitente =
    process.env.EMAIL_FROM ||
    "Contactia <reservas@contactia.net>";

  try {
    const respuesta = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: remitente,
        to: [destinatario],
        subject: asunto,
        text: texto,
        html
      })
    });

    if (!respuesta.ok) {
      console.error(
        `Error Resend al enviar el correo de ${contexto}:`,
        respuesta.status,
        await respuesta.text()
      );
      return false;
    }

    return true;
  } catch (error) {
    console.error(`No se pudo enviar el correo de ${contexto}:`, error);
    return false;
  }
}


async function enviarCorreoConfirmacionReserva({
  destinatario,
  nombre,
  nombreRestaurante,
  fecha,
  hora,
  personas,
  localizador,
  enlaceGestion
}) {
  nombreRestaurante = normalizarTexto(nombreRestaurante) || "Restaurante Sol";
  const fechaLarga = formatearFechaLarga(fecha);
  const asunto =
    `Reserva confirmada en ${nombreRestaurante} el ${fechaLarga} ` +
    `a las ${hora}.`;
  const texto =
    `Hola ${nombre},\n\n` +
    `Tu reserva está confirmada.\n\n` +
    `${nombreRestaurante}\n` +
    `Localizador: ${localizador}\n` +
    `Fecha: ${fechaLarga}\n` +
    `Hora: ${hora}\n` +
    `Personas: ${personas}\n\n` +
    `Puedes consultar, modificar o cancelar tu reserva aquí:\n${enlaceGestion}\n`;
  const html = `
    <p>Hola ${escaparHtml(nombre)},</p>
    <p>Tu reserva está confirmada.</p>
    <h2>${escaparHtml(nombreRestaurante)}</h2>
    <ul>
      <li><strong>Localizador:</strong> ${escaparHtml(localizador)}</li>
      <li><strong>Fecha:</strong> ${escaparHtml(fechaLarga)}</li>
      <li><strong>Hora:</strong> ${escaparHtml(hora)}</li>
      <li><strong>Personas:</strong> ${escaparHtml(personas)}</li>
    </ul>
    <p>
      <a href="${escaparHtml(enlaceGestion)}">
        Consultar, modificar o cancelar la reserva
      </a>
    </p>
  `;

  return enviarCorreoResend({
    destinatario,
    asunto,
    texto,
    html,
    contexto: "confirmación"
  });
}


async function enviarCorreoModificacionReserva({
  destinatario,
  nombre,
  nombreRestaurante,
  fecha,
  hora,
  personas,
  localizador,
  enlaceGestion,
  reactivada = false
}) {
  nombreRestaurante = normalizarTexto(nombreRestaurante) || "Restaurante Sol";
  const fechaLarga = formatearFechaLarga(fecha);
  const estadoTexto = reactivada ? "reactivada" : "modificada";
  const asunto =
    `Reserva ${estadoTexto} en ${nombreRestaurante} para el ${fechaLarga} ` +
    `a las ${hora}.`;
  const texto =
    `Hola ${nombre},\n\n` +
    `Tu reserva ha sido ${estadoTexto}. Estos son los datos actualizados:\n\n` +
    `${nombreRestaurante}\n` +
    `Localizador: ${localizador}\n` +
    `Fecha: ${fechaLarga}\n` +
    `Hora: ${hora}\n` +
    `Personas: ${personas}\n\n` +
    `Puedes consultar, modificar o cancelar tu reserva aquí:\n${enlaceGestion}\n`;
  const html = `
    <p>Hola ${escaparHtml(nombre)},</p>
    <p>Tu reserva ha sido ${escaparHtml(estadoTexto)}. Estos son los datos actualizados:</p>
    <h2>${escaparHtml(nombreRestaurante)}</h2>
    <ul>
      <li><strong>Localizador:</strong> ${escaparHtml(localizador)}</li>
      <li><strong>Fecha:</strong> ${escaparHtml(fechaLarga)}</li>
      <li><strong>Hora:</strong> ${escaparHtml(hora)}</li>
      <li><strong>Personas:</strong> ${escaparHtml(personas)}</li>
    </ul>
    <p>
      <a href="${escaparHtml(enlaceGestion)}">
        Consultar, modificar o cancelar la reserva
      </a>
    </p>
  `;

  return enviarCorreoResend({
    destinatario,
    asunto,
    texto,
    html,
    contexto: reactivada ? "reactivación" : "modificación"
  });
}


async function enviarCorreoCancelacionReserva({
  destinatario,
  nombre,
  nombreRestaurante,
  fecha,
  hora,
  personas,
  localizador,
  enlaceNuevaReserva
}) {
  nombreRestaurante = normalizarTexto(nombreRestaurante) || "Restaurante Sol";
  const fechaLarga = formatearFechaLarga(fecha);
  const asunto =
    `Reserva cancelada en ${nombreRestaurante} para el ${fechaLarga} ` +
    `a las ${hora}.`;
  const texto =
    `Hola ${nombre},\n\n` +
    `Tu reserva ha sido cancelada correctamente.\n\n` +
    `${nombreRestaurante}\n` +
    `Localizador: ${localizador}\n` +
    `Fecha: ${fechaLarga}\n` +
    `Hora: ${hora}\n` +
    `Personas: ${personas}\n\n` +
    `Realice una nueva reserva:\n${enlaceNuevaReserva}\n`;
  const html = `
    <p>Hola ${escaparHtml(nombre)},</p>
    <p>Tu reserva ha sido cancelada correctamente.</p>
    <h2>${escaparHtml(nombreRestaurante)}</h2>
    <ul>
      <li><strong>Localizador:</strong> ${escaparHtml(localizador)}</li>
      <li><strong>Fecha:</strong> ${escaparHtml(fechaLarga)}</li>
      <li><strong>Hora:</strong> ${escaparHtml(hora)}</li>
      <li><strong>Personas:</strong> ${escaparHtml(personas)}</li>
    </ul>
    <p>
      <a href="${escaparHtml(enlaceNuevaReserva)}">
        Realice una nueva reserva
      </a>
    </p>
  `;

  return enviarCorreoResend({
    destinatario,
    asunto,
    texto,
    html,
    contexto: "cancelación"
  });
}


async function enviarCorreoRetrasoReserva({
  destinatario,
  nombre,
  nombreRestaurante,
  fecha,
  hora,
  personas,
  localizador,
  enlaceGestion
}) {
  nombreRestaurante = normalizarTexto(nombreRestaurante) || "Restaurante Sol";
  const fechaLarga = formatearFechaLarga(fecha);
  const asunto = `Te estamos esperando en ${nombreRestaurante}`;
  const texto =
    `Hola ${normalizarTexto(nombre) || "cliente"},\n\n` +
    `Tu mesa en ${nombreRestaurante} sigue reservada. ` +
    `La reserva era para el ${fechaLarga} a las ${hora}.\n\n` +
    `Localizador: ${localizador}\n` +
    `Personas: ${personas}\n\n` +
    `Si finalmente no puedes venir, puedes gestionar la reserva aquí:\n` +
    `${enlaceGestion}\n`;
  const html = `
    <p>Hola ${escaparHtml(normalizarTexto(nombre) || "cliente")},</p>
    <p>
      Tu mesa en <strong>${escaparHtml(nombreRestaurante)}</strong> sigue
      reservada. La reserva era para el ${escaparHtml(fechaLarga)} a las
      <strong>${escaparHtml(hora)}</strong>.
    </p>
    <p>
      <strong>Localizador:</strong> ${escaparHtml(localizador)}<br>
      <strong>Personas:</strong> ${escaparHtml(personas)}
    </p>
    <p>Si finalmente no puedes venir, puedes gestionar la reserva aquí:</p>
    <p>
      <a href="${escaparHtml(enlaceGestion)}">
        Consultar, modificar o cancelar la reserva
      </a>
    </p>
  `;

  return enviarCorreoResend({
    destinatario,
    asunto,
    texto,
    html,
    contexto: "aviso de retraso"
  });
}


async function enviarAvisoRestaurante({
  destinatario,
  tipo,
  nombreRestaurante,
  fecha,
  hora,
  personas,
  localizador,
  nombreCliente,
  emailCliente,
  telefonoCliente,
  observaciones,
  enlaceGestion
}) {
  nombreRestaurante = normalizarTexto(nombreRestaurante) || "Restaurante Sol";
  const fechaLarga = formatearFechaLarga(fecha);
  const { diaSemana, fechaCorta } = formatearFechaOperativa(fecha);
  const titulos = {
    nueva: "Nueva reserva",
    modificada: "Reserva modificada",
    reactivada: "Reserva reactivada",
    cancelada: "Reserva cancelada"
  };
  const titulo = titulos[tipo] || "Actualización de reserva";
  const observacionesLimpias = normalizarObservaciones(observaciones);
  const observacionesPrioritarias = observacionEsPrioritaria(
    observacionesLimpias
  );
  const asunto =
    `${titulo} · ${fechaLarga} a las ${hora} · ${personas} personas`;
  const textoEnlace = enlaceGestion
    ? `\nGestionar reservas del día:\n${enlaceGestion}\n`
    : "";
  const htmlEnlace = enlaceGestion
    ? `
      <p>
        <a href="${escaparHtml(enlaceGestion)}">Gestionar reservas del día</a>
      </p>
    `
    : "";
  const textoObservaciones = observacionesLimpias
    ? `Observaciones: ${observacionesLimpias}\n`
    : "";
  const htmlObservaciones = observacionesLimpias
    ? `
      <div style="margin: 16px 0; border: 1px solid ${
        observacionesPrioritarias ? "#d94a4a" : "#dfc88d"
      }; border-radius: 10px; padding: 12px 14px; background: ${
        observacionesPrioritarias ? "#fff0f0" : "#fff9e9"
      }; color: ${observacionesPrioritarias ? "#9f2424" : "#5f4a18"};">
        <strong>${observacionesPrioritarias ? "⚠ " : ""}Observaciones:</strong><br>
        ${escaparHtml(observacionesLimpias).replace(/\n/g, "<br>")}
      </div>
    `
    : "";
  const texto =
    `${titulo}\n\n` +
    `${diaSemana} ${fechaCorta} / Hora: ${hora} / ${personas} personas\n` +
    `Cliente: ${nombreCliente}\n` +
    `Email: ${emailCliente}\n` +
    `Teléfono: ${telefonoCliente}\n` +
    `Localizador: ${localizador}\n` +
    textoObservaciones +
    textoEnlace;
  const html = `
    <h2>${escaparHtml(titulo)}</h2>
    <ul>
      <li>
        ${escaparHtml(diaSemana)} <strong>${escaparHtml(fechaCorta)}</strong>
        &nbsp;/&nbsp; Hora: <strong>${escaparHtml(hora)}</strong>
        &nbsp;/&nbsp; <strong>${escaparHtml(personas)}</strong> personas
      </li>
      <li><strong>Cliente:</strong> ${escaparHtml(nombreCliente)}</li>
      <li><strong>Email:</strong> ${escaparHtml(emailCliente)}</li>
      <li><strong>Teléfono:</strong> ${escaparHtml(telefonoCliente)}</li>
      <li><strong>Localizador:</strong> ${escaparHtml(localizador)}</li>
    </ul>
    ${htmlObservaciones}
    <div style="margin-left: 2rem;">${htmlEnlace}</div>
  `;

  return enviarCorreoResend({
    destinatario,
    asunto,
    texto,
    html,
    contexto: `aviso interno de reserva ${tipo}`
  });
}


// 7️⃣ HANDLER PRINCIPAL
module.exports = async (req, res) => {

  if (req.method !== "POST") {

    return responder(res, 405, {
      ok: false,
      error: "Método no permitido."
    });
  }

  const tipoContenido = String(req.headers?.["content-type"] || "")
    .toLowerCase();

  if (!tipoContenido.startsWith("application/json")) {
    return responder(res, 415, {
      ok: false,
      error: "El contenido debe enviarse en formato JSON."
    });
  }

  if (obtenerTamanoSolicitud(req) > MAX_REQUEST_BODY_BYTES) {
    return responder(res, 413, {
      ok: false,
      error: "La solicitud es demasiado grande."
    });
  }


  try {

    let body;

    try {
      body = typeof req.body === "string"
        ? JSON.parse(req.body || "{}")
        : (req.body || {});
    } catch {
      return responder(res, 400, {
        ok: false,
        error: "El contenido JSON no es válido."
      });
    }

    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return responder(res, 400, {
        ok: false,
        error: "La solicitud no tiene un formato válido."
      });
    }

    const errorCampos = validarCamposTexto(body);

    if (errorCampos) {
      return responder(res, 400, { ok: false, error: errorCampos });
    }

    body.accion = String(body.accion || "").trim();

    if (!ACCIONES_PERMITIDAS.has(body.accion)) {
      return responder(res, 400, {
        ok: false,
        error: "Acción no reconocida."
      });
    }

    const restauranteIdSolicitud = Number(body.restaurante_id);

    if (
      !Number.isInteger(restauranteIdSolicitud) ||
      restauranteIdSolicitud <= 0 ||
      restauranteIdSolicitud > 1000000000
    ) {
      return responder(res, 400, {
        ok: false,
        error: "El restaurante no es válido."
      });
    }

    if (body.personas !== undefined) {
      const personasSolicitud = Number(body.personas);

      if (
        !Number.isInteger(personasSolicitud) ||
        personasSolicitud <= 0 ||
        personasSolicitud > 1000
      ) {
        return responder(res, 400, {
          ok: false,
          error: "El número de personas no es válido."
        });
      }
    }

    if (
      ACCIONES_CON_FECHA_RESERVA.has(body.accion) &&
      body.fecha !== undefined &&
      !fechaReservaDentroDeRango(body.fecha)
    ) {
      return responder(res, 400, {
        ok: false,
        error:
          `La fecha debe estar entre hoy y los próximos ` +
          `${MAX_DIAS_ANTELACION} días.`
      });
    }

    if (
      ACCIONES_CON_FECHA_RESERVA.has(body.accion) &&
      body.hora !== undefined &&
      !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(body.hora)
    ) {
      return responder(res, 400, {
        ok: false,
        error: "La hora no tiene un formato válido."
      });
    }


    const {
      accion,
      restaurante_id,
      fecha,
      hora,
      personas,
      nombre,
      email,
      telefono,
      mensaje,
      localizador,
      token_gestion,
      clave_restaurante,
      mesa_ids,
      estado_nuevo,
      mesa_id,
      tipo_recurso,
      recurso_id,
      habilitar,
      confirmar_afectadas,
      fecha_desde,
      registro_espera_id,
      estado_espera
    } = body;
    const mensajeIncluido = Object.prototype.hasOwnProperty.call(
      body,
      "mensaje"
    );
    const sesionRestauranteAutorizada = sesionRestauranteValida(
      req,
      restaurante_id
    );

    if (
      ["consultar", "cancelar", "modificar"].includes(accion) &&
      !token_gestion &&
      !clave_restaurante &&
      !sesionRestauranteAutorizada
    ) {
      return responder(res, 401, {
        ok: false,
        error:
          "Por seguridad, abre el enlace de gestión enviado en el correo de confirmación."
      });
    }

    if (accion === "actualizar_observaciones") {
      const restauranteIdObservaciones = Number(restaurante_id);
      const localizadorObservaciones = String(localizador || "")
        .trim()
        .toUpperCase();

      if (
        !Number.isInteger(restauranteIdObservaciones) ||
        restauranteIdObservaciones <= 0 ||
        !/^[A-Z0-9-]{8,40}$/.test(localizadorObservaciones) ||
        !mensajeIncluido
      ) {
        return responder(res, 400, {
          ok: false,
          error: "La reserva o las observaciones no son válidas."
        });
      }

      if (!clave_restaurante && !sesionRestauranteAutorizada) {
        return responder(res, 401, {
          ok: false,
          error: "La sesión del panel no es válida. Vuelve a identificarte."
        });
      }

      const restauranteObservaciones = await buscarRestaurante(
        restauranteIdObservaciones
      );

      if (
        !restauranteObservaciones ||
        (!sesionRestauranteAutorizada &&
          !clavesRestauranteCoinciden(
            clave_restaurante,
            restauranteObservaciones.fields.api_key_restaurante
          ))
      ) {
        return responder(res, 401, {
          ok: false,
          error: "La clave del restaurante no es correcta."
        });
      }

      const reservaObservaciones = await buscarReservaGestion(
        restauranteIdObservaciones,
        localizadorObservaciones,
        null,
        true
      );

      if (!reservaObservaciones) {
        return responder(res, 404, {
          ok: false,
          error: "No se ha encontrado una reserva con ese localizador."
        });
      }

      const observacionesActualizadas = normalizarObservaciones(mensaje);
      const reservaConObservaciones = await consultarAirtable(
        `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/` +
        `RESERVAS/${reservaObservaciones.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fields: { mensaje: observacionesActualizadas }
          })
        }
      );

      return responder(res, 200, {
        ok: true,
        observaciones_actualizadas: true,
        reserva: resumirReserva(reservaConObservaciones)
      });
    }

    if (accion === "actualizar_estado") {
      const restauranteIdEstado = Number(restaurante_id);
      const localizadorEstado = String(localizador || "").trim().toUpperCase();
      const estadoNuevo = String(estado_nuevo || "").trim().toLowerCase();
      const estadosOperativos = new Set([
        "confirmada",
        "ocupada",
        "con retraso",
        "cobrada",
        "libre"
      ]);

      if (
        !Number.isInteger(restauranteIdEstado) ||
        restauranteIdEstado <= 0 ||
        !/^[A-Z0-9-]{8,40}$/.test(localizadorEstado) ||
        !estadosOperativos.has(estadoNuevo)
      ) {
        return responder(res, 400, {
          ok: false,
          error: "El restaurante, la reserva o el estado no son válidos."
        });
      }

      if (!clave_restaurante && !sesionRestauranteAutorizada) {
        return responder(res, 401, {
          ok: false,
          error: "La sesión del panel no es válida. Vuelve a identificarte."
        });
      }

      const restauranteEstado = await buscarRestaurante(restauranteIdEstado);

      if (
        !restauranteEstado ||
        (!sesionRestauranteAutorizada &&
          !clavesRestauranteCoinciden(
            clave_restaurante,
            restauranteEstado.fields.api_key_restaurante
          ))
      ) {
        return responder(res, 401, {
          ok: false,
          error: "La clave del restaurante no es correcta."
        });
      }

      const reservaEstado = await buscarReservaGestion(
        restauranteIdEstado,
        localizadorEstado,
        null,
        true
      );

      if (!reservaEstado) {
        return responder(res, 404, {
          ok: false,
          error: "No se ha encontrado una reserva con ese localizador."
        });
      }

      const estadoAnterior = String(reservaEstado.fields.estado || "")
        .trim()
        .toLowerCase();

      if (!estadosOperativos.has(estadoAnterior) || estadoAnterior === "libre") {
        return responder(res, 200, {
          ok: true,
          estado_actualizado: false,
          motivo:
            estadoAnterior === "libre"
              ? "Una reserva libre ya está finalizada."
              : "Ese estado no se puede cambiar desde el panel."
        });
      }

      if (estadoAnterior === estadoNuevo) {
        return responder(res, 200, {
          ok: true,
          estado_actualizado: true,
          sin_cambios: true,
          reserva: resumirReserva(reservaEstado)
        });
      }

      const urlReservaEstado =
        `https://api.airtable.com/v0/` +
        `${process.env.AIRTABLE_BASE_ID}/RESERVAS/${reservaEstado.id}`;
      const camposEstado = {
        estado: estadoNuevo,
        ...(estadoNuevo === "libre"
          ? { privacidad_hasta: calcularPrivacidadHastaDesdeAhora() }
          : {})
      };
      const reservaActualizadaEstado = await consultarAirtable(
        urlReservaEstado,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fields: camposEstado })
        }
      );

      await registrarAuditoria({
        restauranteId: restauranteIdEstado,
        reservaId: reservaActualizadaEstado.fields.id_reserva,
        accion: "estado_actualizado",
        origen: "panel_restaurante",
        estadoAnterior,
        estadoNuevo,
        detalles: {
          anterior: { estado: estadoAnterior },
          nuevo: { estado: estadoNuevo }
        }
      });
      let correoEnviado = null;

      if (estadoNuevo === "con retraso") {
        correoEnviado = await enviarCorreoRetrasoReserva({
          destinatario: reservaActualizadaEstado.fields.email,
          nombre: reservaActualizadaEstado.fields.nombre_completo,
          nombreRestaurante: obtenerNombreRestaurante(restauranteEstado),
          fecha: reservaActualizadaEstado.fields.fecha,
          hora: reservaActualizadaEstado.fields.hora,
          personas: reservaActualizadaEstado.fields.personas,
          localizador: reservaActualizadaEstado.fields.id_reserva,
          enlaceGestion: generarEnlaceGestion(
            reservaActualizadaEstado.fields.token_gestion
          )
        });
      }

      return responder(res, 200, {
        ok: true,
        estado_actualizado: true,
        correo_enviado: correoEnviado,
        reserva: resumirReserva(reservaActualizadaEstado)
      });
    }

    if (accion === "ocupar_mesa") {
      const restauranteIdOcupacion = Number(restaurante_id);
      const mesaIdOcupacion = String(mesa_id || "").trim();
      const fechaOcupacion = String(fecha || "").trim();
      const horaOcupacion = String(hora || "").trim();
      const personasOcupacion = Number(personas);
      const nombreOcupacion = String(nombre || "").trim().slice(0, 120) ||
        "Cliente sin reserva";

      if (
        !Number.isInteger(restauranteIdOcupacion) ||
        restauranteIdOcupacion <= 0 ||
        !/^rec[a-zA-Z0-9]{14}$/.test(mesaIdOcupacion) ||
        !obtenerDiaSemana(fechaOcupacion) ||
        horaAMinutos(horaOcupacion) === null ||
        !Number.isInteger(personasOcupacion) ||
        personasOcupacion <= 0
      ) {
        return responder(res, 400, {
          ok: false,
          error: "Los datos de la ocupación no son válidos."
        });
      }

      if (!clave_restaurante && !sesionRestauranteAutorizada) {
        return responder(res, 401, {
          ok: false,
          error: "La sesión del panel no es válida. Vuelve a identificarte."
        });
      }

      const restauranteOcupacion = await buscarRestaurante(
        restauranteIdOcupacion
      );

      if (
        !restauranteOcupacion ||
        (!sesionRestauranteAutorizada &&
          !clavesRestauranteCoinciden(
            clave_restaurante,
            restauranteOcupacion.fields.api_key_restaurante
          ))
      ) {
        return responder(res, 401, {
          ok: false,
          error: "La clave del restaurante no es correcta."
        });
      }

      const urlMesaOcupacion =
        `https://api.airtable.com/v0/` +
        `${process.env.AIRTABLE_BASE_ID}/MESAS/${mesaIdOcupacion}`;
      const mesaOcupacion = await consultarAirtable(urlMesaOcupacion);
      const restaurantesMesa = Array.isArray(mesaOcupacion.fields.restaurante)
        ? mesaOcupacion.fields.restaurante
        : [];
      const estadoMesa = String(mesaOcupacion.fields.estado || "")
        .trim()
        .toLowerCase();
      const capacidadMesa = Number(mesaOcupacion.fields.capacidad || 0);
      const zonaMesaOcupacion = Array.isArray(mesaOcupacion.fields.zona) &&
        mesaOcupacion.fields.zona.length === 1
        ? mesaOcupacion.fields.zona[0]
        : null;

      if (
        !restaurantesMesa.includes(restauranteOcupacion.id) ||
        estadoMesa === "fuera de servicio" ||
        !zonaMesaOcupacion
      ) {
        return responder(res, 200, {
          ok: true,
          ocupada: false,
          motivo: "La mesa no pertenece al restaurante o está fuera de servicio."
        });
      }

      const zonaOcupacion = await consultarAirtable(
        `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/` +
        `ZONA/${zonaMesaOcupacion}`
      );

      if (
        String(zonaOcupacion.fields.estado || "activo")
          .trim()
          .toLowerCase() === "inactivo"
      ) {
        return responder(res, 200, {
          ok: true,
          ocupada: false,
          motivo: "La zona de esa mesa está fuera de servicio."
        });
      }

      if (personasOcupacion > capacidadMesa) {
        return responder(res, 200, {
          ok: true,
          ocupada: false,
          motivo: `La mesa admite un máximo de ${capacidadMesa} personas.`
        });
      }

      const duracionOcupacion = Number(
        restauranteOcupacion.fields.duracion_reserva_minutos
      );

      if (!Number.isInteger(duracionOcupacion) || duracionOcupacion <= 0) {
        throw new Error(
          "El campo duracion_reserva_minutos del restaurante no es válido."
        );
      }

      const idOcupacion = await generarIdReservaUnico(
        restauranteIdOcupacion,
        fechaOcupacion,
        "PASO"
      );
      const urlReservasOcupacion =
        `https://api.airtable.com/v0/` +
        `${process.env.AIRTABLE_BASE_ID}/RESERVAS`;
      const ocupacionPendiente = await consultarAirtable(
        urlReservasOcupacion,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fields: {
              id_reserva: idOcupacion,
              restaurante: [restauranteOcupacion.id],
              mesa: [mesaIdOcupacion],
              fecha: fechaOcupacion,
              hora: horaOcupacion,
              personas: personasOcupacion,
              nombre_completo: nombreOcupacion,
              mensaje: "Cliente sin reserva añadido desde el panel.",
              estado: "pendiente",
              ...crearMetadatosPrivacidadReserva({
                fecha: fechaOcupacion,
                hora: horaOcupacion,
                duracionReservaMinutos: duracionOcupacion
              })
            }
          })
        }
      );
      const resultadoOcupacion = await confirmarReservaSinConflictos(
        ocupacionPendiente,
        restauranteIdOcupacion,
        fechaOcupacion,
        horaOcupacion,
        duracionOcupacion,
        [mesaIdOcupacion],
        [],
        "ocupada"
      );

      if (!resultadoOcupacion.confirmada) {
        return responder(res, 200, {
          ok: true,
          ocupada: false,
          motivo:
            "Otra reserva acaba de ocupar esa mesa. Actualiza el panel y elige otra."
        });
      }

      await registrarAuditoria({
        restauranteId: restauranteIdOcupacion,
        reservaId: idOcupacion,
        accion: "reserva_creada",
        origen: "panel_restaurante",
        estadoNuevo: "ocupada",
        detalles: {
          nuevo: {
            fecha: fechaOcupacion,
            hora: horaOcupacion,
            personas: personasOcupacion,
            mesas: [mesaIdOcupacion],
            estado: "ocupada"
          }
        }
      });

      return responder(res, 200, {
        ok: true,
        ocupada: true,
        reserva: resumirReserva(resultadoOcupacion.reserva),
        mesa: {
          id: mesaOcupacion.id,
          nombre: mesaOcupacion.fields.nombre_mesa || "Mesa",
          capacidad: capacidadMesa
        }
      });
    }

    if (accion === "actualizar_disponibilidad") {
      const restauranteIdDisponibilidad = Number(restaurante_id);
      const tipoRecurso = String(tipo_recurso || "").trim().toLowerCase();
      const recursoId = String(recurso_id || "").trim();
      const fechaDesde = /^\d{4}-\d{2}-\d{2}$/.test(String(fecha_desde || ""))
        ? String(fecha_desde)
        : new Date().toISOString().slice(0, 10);

      if (
        !Number.isInteger(restauranteIdDisponibilidad) ||
        restauranteIdDisponibilidad <= 0 ||
        !["mesa", "zona"].includes(tipoRecurso) ||
        !/^rec[a-zA-Z0-9]{14}$/.test(recursoId) ||
        typeof habilitar !== "boolean"
      ) {
        return responder(res, 400, {
          ok: false,
          error: "Los datos de disponibilidad no son válidos."
        });
      }

      if (!clave_restaurante && !sesionRestauranteAutorizada) {
        return responder(res, 401, {
          ok: false,
          error: "La sesión del panel no es válida. Vuelve a identificarte."
        });
      }

      const restauranteDisponibilidad = await buscarRestaurante(
        restauranteIdDisponibilidad
      );

      if (
        !restauranteDisponibilidad ||
        (!sesionRestauranteAutorizada &&
          !clavesRestauranteCoinciden(
            clave_restaurante,
            restauranteDisponibilidad.fields.api_key_restaurante
          ))
      ) {
        return responder(res, 401, {
          ok: false,
          error: "La clave del restaurante no es correcta."
        });
      }

      const tablaRecurso = tipoRecurso === "mesa" ? "MESAS" : "ZONA";
      const recurso = await consultarAirtable(
        `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/` +
        `${tablaRecurso}/${recursoId}`
      );
      const restaurantesRecurso = Array.isArray(recurso.fields.restaurante)
        ? recurso.fields.restaurante
        : [];

      if (!restaurantesRecurso.includes(restauranteDisponibilidad.id)) {
        return responder(res, 404, {
          ok: false,
          error: "El recurso no pertenece al restaurante."
        });
      }

      let mesasAfectadasIds = [];

      if (tipoRecurso === "mesa") {
        mesasAfectadasIds = [recursoId];
      } else {
        const formulaMesasZona =
          `FIND('${String(restauranteIdDisponibilidad)}',` +
          `ARRAYJOIN({id (from restaurante)}))`;
        const datosMesasZona = await consultarAirtable(
          `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/MESAS` +
          `?filterByFormula=${encodeURIComponent(formulaMesasZona)}`
        );
        mesasAfectadasIds = (datosMesasZona.records || [])
          .filter((mesa) =>
            Array.isArray(mesa.fields.zona) &&
            mesa.fields.zona.includes(recursoId)
          )
          .map((mesa) => mesa.id);
      }

      let reservasAfectadas = [];

      if (!habilitar && mesasAfectadasIds.length) {
        const formulaReservasAfectadas =
          `AND(` +
          `OR(` +
          `LOWER(TRIM({estado}))='confirmada',` +
          `LOWER(TRIM({estado}))='ocupada',` +
          `LOWER(TRIM({estado}))='con retraso',` +
          `LOWER(TRIM({estado}))='cobrada'` +
          `),` +
          `FIND('${String(restauranteIdDisponibilidad)}',` +
          `ARRAYJOIN({id (from restaurante)}))` +
          `)`;
        const datosReservasAfectadas = await consultarAirtable(
          `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/RESERVAS` +
          `?filterByFormula=${encodeURIComponent(formulaReservasAfectadas)}`
        );
        const idsObjetivo = new Set(mesasAfectadasIds);
        reservasAfectadas = (datosReservasAfectadas.records || [])
          .filter((reserva) => {
            const fechaReserva = String(reserva.fields.fecha || "");
            const mesasReserva = Array.isArray(reserva.fields.mesa)
              ? reserva.fields.mesa
              : [];
            return fechaReserva >= fechaDesde &&
              mesasReserva.some((id) => idsObjetivo.has(id));
          })
          .sort((a, b) =>
            String(a.fields.fecha || "").localeCompare(
              String(b.fields.fecha || "")
            ) ||
            String(a.fields.hora || "").localeCompare(
              String(b.fields.hora || "")
            )
          )
          .map((reserva) => ({
            localizador: reserva.fields.id_reserva || "",
            fecha: reserva.fields.fecha || "",
            hora: reserva.fields.hora || "",
            nombre: reserva.fields.nombre_completo || "",
            personas: Number(reserva.fields.personas || 0)
          }));

        if (reservasAfectadas.length && !confirmar_afectadas) {
          return responder(res, 200, {
            ok: true,
            disponibilidad_actualizada: false,
            requiere_confirmacion: true,
            reservas_afectadas: reservasAfectadas
          });
        }
      }

      const estadoRecurso = tipoRecurso === "mesa"
        ? (habilitar ? "libre" : "fuera de servicio")
        : (habilitar ? "activo" : "inactivo");
      const recursoActualizado = await consultarAirtable(
        `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/` +
        `${tablaRecurso}/${recursoId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fields: { estado: estadoRecurso } })
        }
      );

      return responder(res, 200, {
        ok: true,
        disponibilidad_actualizada: true,
        tipo_recurso: tipoRecurso,
        estado: recursoActualizado.fields.estado,
        reservas_afectadas: reservasAfectadas
      });
    }

    if (accion === "actualizar_lista_espera") {
      const restauranteIdEspera = Number(restaurante_id);
      const registroEsperaId = String(registro_espera_id || "").trim();
      const estadoEspera = String(estado_espera || "").trim().toLowerCase();
      const estadosPermitidos = new Set([
        "pendiente",
        "avisado",
        "convertida",
        "cancelada"
      ]);

      if (
        !Number.isInteger(restauranteIdEspera) ||
        restauranteIdEspera <= 0 ||
        !/^rec[a-zA-Z0-9]{14}$/.test(registroEsperaId) ||
        !estadosPermitidos.has(estadoEspera)
      ) {
        return responder(res, 400, {
          ok: false,
          error: "La solicitud de lista de espera o el estado no son válidos."
        });
      }

      if (!clave_restaurante && !sesionRestauranteAutorizada) {
        return responder(res, 401, {
          ok: false,
          error: "La sesión del panel no es válida. Vuelve a identificarte."
        });
      }

      const restauranteEspera = await buscarRestaurante(restauranteIdEspera);

      if (
        !restauranteEspera ||
        (!sesionRestauranteAutorizada &&
          !clavesRestauranteCoinciden(
            clave_restaurante,
            restauranteEspera.fields.api_key_restaurante
          ))
      ) {
        return responder(res, 401, {
          ok: false,
          error: "La clave del restaurante no es correcta."
        });
      }

      const solicitudEspera = await consultarAirtable(
        `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/` +
        `LISTA_ESPERA/${registroEsperaId}`
      );
      const restaurantesSolicitud = Array.isArray(
        solicitudEspera.fields.restaurante
      )
        ? solicitudEspera.fields.restaurante
        : [];

      if (!restaurantesSolicitud.includes(restauranteEspera.id)) {
        return responder(res, 404, {
          ok: false,
          error: "La solicitud no pertenece al restaurante."
        });
      }

      const solicitudActualizada = await consultarAirtable(
        `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/` +
        `LISTA_ESPERA/${registroEsperaId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fields: {
              estado: estadoEspera,
              ...(estadoEspera === "cancelada"
                ? { privacidad_hasta: calcularPrivacidadHastaDesdeAhora() }
                : {})
            }
          })
        }
      );

      return responder(res, 200, {
        ok: true,
        lista_espera_actualizada: true,
        solicitud: {
          id: solicitudActualizada.id,
          id_espera: solicitudActualizada.fields.id_espera || "",
          estado: solicitudActualizada.fields.estado || estadoEspera
        }
      });
    }

    // Consulta y cancelación no necesitan fecha, hora ni comensales.
    if (accion === "consultar" || accion === "cancelar") {
      if (!restaurante_id || (!localizador && !token_gestion)) {
        return responder(res, 400, {
          ok: false,
          error: "Faltan restaurante_id y el identificador de la reserva."
        });
      }

      if (
        !token_gestion &&
        !clave_restaurante &&
        !sesionRestauranteAutorizada
      ) {
        return responder(res, 401, {
          ok: false,
          error:
            "Por seguridad, abre el enlace de gestión enviado en el correo de confirmación."
        });
      }

      if (token_gestion && !/^[a-f0-9]{48}$/i.test(String(token_gestion).trim())) {
        return responder(res, 400, {
          ok: false,
          error: "El token de gestión no tiene un formato válido."
        });
      }

      if (localizador && !/^[A-Z0-9-]{8,40}$/i.test(String(localizador).trim())) {
        return responder(res, 400, {
          ok: false,
          error: "El localizador no tiene un formato válido."
        });
      }

      if (clave_restaurante) {
        const restauranteAutorizado = await buscarRestaurante(restaurante_id);

        if (
          !restauranteAutorizado ||
          !clavesRestauranteCoinciden(
            clave_restaurante,
            restauranteAutorizado.fields.api_key_restaurante
          )
        ) {
          return responder(res, 401, {
            ok: false,
            error: "La clave del restaurante no es correcta."
          });
        }
      }

      const reserva = await buscarReservaGestion(
        restaurante_id,
        localizador,
        token_gestion,
        Boolean(clave_restaurante) || sesionRestauranteAutorizada
      );

      if (!reserva) {
        return responder(res, 404, {
          ok: false,
          error: "No se ha encontrado una reserva con ese localizador."
        });
      }

      if (accion === "consultar") {
        return responder(res, 200, {
          ok: true,
          reserva: resumirReserva(reserva)
        });
      }

      const estadoActual = String(reserva.fields.estado || "")
        .trim()
        .toLowerCase();

      if (estadoActual === "cancelada") {
        return responder(res, 200, {
          ok: true,
          cancelada: false,
          ya_cancelada: true,
          reserva: resumirReserva(reserva)
        });
      }

      if (!["confirmada", "con retraso"].includes(estadoActual)) {
        return responder(res, 200, {
          ok: true,
          cancelada: false,
          motivo: "La reserva no está pendiente de llegada y no se puede cancelar.",
          reserva: resumirReserva(reserva)
        });
      }

      const urlReserva =
        `https://api.airtable.com/v0/` +
        `${process.env.AIRTABLE_BASE_ID}/RESERVAS/${reserva.id}`;
      const reservaActualizada = await consultarAirtable(urlReserva, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fields: {
            estado: "cancelada",
            privacidad_hasta: calcularPrivacidadHastaDesdeAhora()
          }
        })
      });

      await registrarAuditoria({
        restauranteId: restaurante_id,
        reservaId: reservaActualizada.fields.id_reserva,
        accion: "reserva_cancelada",
        origen: determinarOrigenAuditoria({
          accion,
          tokenGestion: token_gestion,
          claveRestaurante: clave_restaurante,
          sesionRestauranteAutorizada
        }),
        estadoAnterior: estadoActual,
        estadoNuevo: "cancelada",
        detalles: {
          anterior: { estado: estadoActual },
          nuevo: { estado: "cancelada" }
        }
      });

      let restauranteCancelacion = null;

      try {
        restauranteCancelacion = await buscarRestaurante(restaurante_id);
      } catch (errorRestaurante) {
        console.error(
          "No se pudo obtener el nombre del restaurante para el correo:",
          errorRestaurante
        );
      }

      const nombreRestauranteCancelacion =
        obtenerNombreRestaurante(restauranteCancelacion);
      const [correoEnviado, correoRestauranteEnviado] = await Promise.all([
        enviarCorreoCancelacionReserva({
          destinatario: reservaActualizada.fields.email,
          nombre: reservaActualizada.fields.nombre_completo,
          nombreRestaurante: nombreRestauranteCancelacion,
          fecha: reservaActualizada.fields.fecha,
          hora: reservaActualizada.fields.hora,
          personas: reservaActualizada.fields.personas,
          localizador: reservaActualizada.fields.id_reserva,
          enlaceNuevaReserva: generarEnlaceGestion(null)
        }),
        enviarAvisoRestaurante({
          destinatario: restauranteCancelacion?.fields?.email,
          tipo: "cancelada",
          nombreRestaurante: nombreRestauranteCancelacion,
          fecha: reservaActualizada.fields.fecha,
          hora: reservaActualizada.fields.hora,
          personas: reservaActualizada.fields.personas,
          localizador: reservaActualizada.fields.id_reserva,
          nombreCliente: reservaActualizada.fields.nombre_completo,
          emailCliente: reservaActualizada.fields.email,
          telefonoCliente: reservaActualizada.fields.telefono,
          observaciones: reservaActualizada.fields.mensaje,
          enlaceGestion: generarEnlacePanelRestaurante(
            reservaActualizada.fields.fecha,
            restaurante_id
          )
        })
      ]);

      return responder(res, 200, {
        ok: true,
        cancelada: true,
        correo_enviado: correoEnviado,
        correo_restaurante_enviado: correoRestauranteEnviado,
        reserva: resumirReserva(reservaActualizada)
      });
    }


    // 7️⃣ VALIDACIONES GENERALES
    if (
      !restaurante_id ||
      !fecha ||
      !hora ||
      !personas
    ) {

      return responder(res, 400, {
        ok: false,
        error:
          "Faltan restaurante_id, fecha, hora o personas."
      });
    }


    const numeroPersonas = Number(personas);

    if (
      !Number.isInteger(numeroPersonas) ||
      numeroPersonas <= 0
    ) {

      return responder(res, 400, {
        ok: false,
        error:
          "El número de personas no es válido."
      });
    }


    // 8️⃣ COMPROBAR RESTAURANTE
    const restaurante =
      await buscarRestaurante(restaurante_id);

      if (!restaurante) {
      return responder(res, 404, {
        ok: false,
        error: "Restaurante no encontrado."
      });
    }

const margenCapacidad =
Number(restaurante.fields.margen_capacidad || 0);

const intervaloMinutos =
Number(restaurante.fields.intervalo_minutos);

const duracionReservaMinutos =
Number(restaurante.fields.duracion_reserva_minutos);

    const validacionHorario =
      validarHorarioRestaurante(
        restaurante.fields,
        fecha,
        hora
      );

    if (!validacionHorario.valido) {
      const alternativas = validacionHorario.cambioRequerido === "hora"
        ? await buscarHorariosAlternativos(
          restaurante_id,
          restaurante.id,
          fecha,
          hora,
          numeroPersonas,
          margenCapacidad,
          duracionReservaMinutos,
          intervaloMinutos,
          restaurante.fields
        )
        : [];

      if (["reservar", "reservar_panel"].includes(accion)) {
        return responder(res, 200, {
          ok: true,
          reservado: false,
          disponible: false,
          alternativas,
          motivo: validacionHorario.motivo,
          cambio_requerido: validacionHorario.cambioRequerido
        });
      }

      return responder(res, 200, {
        ok: true,
        disponible: false,
        alternativas,
        motivo: validacionHorario.motivo,
        cambio_requerido: validacionHorario.cambioRequerido
      });
    }

    if (
      !sesionRestauranteAutorizada &&
      clave_restaurante &&
      !clavesRestauranteCoinciden(
        clave_restaurante,
        restaurante.fields.api_key_restaurante
      )
    ) {
      return responder(res, 401, {
        ok: false,
        error: "La clave del restaurante no es correcta."
      });
    }

    if (
      [
        "reactivar",
        "opciones_mesas",
        "cambiar_mesas",
        "reservar_panel"
      ].includes(accion) &&
      !clave_restaurante &&
      !sesionRestauranteAutorizada
    ) {
      return responder(res, 401, {
        ok: false,
        error: "La sesión del panel no es válida. Vuelve a identificarte."
      });
    }

    if (accion === "lista_espera_crear") {
      const nombreEspera = String(nombre || "").trim();
      const emailEspera = String(email || "").trim().toLowerCase();
      const telefonoEspera = String(telefono || "").trim();

      if (!datosContactoValidos(
        nombreEspera,
        emailEspera,
        telefonoEspera
      )) {
        return responder(res, 400, {
          ok: false,
          error: "El nombre, el correo electrónico o el teléfono no son válidos."
        });
      }

      const hayAsignacionCompatible = await existeAsignacionCompatible(
        restaurante_id,
        restaurante.id,
        numeroPersonas,
        margenCapacidad
      );

      if (!hayAsignacionCompatible) {
        return responder(res, 200, {
          ok: true,
          lista_espera_creada: false,
          requiere_contacto_restaurante: true,
          telefono_restaurante: obtenerTelefonoRestaurante(restaurante),
          motivo:
            "No existe una mesa o combinación automática adecuada para ese número de personas."
        });
      }

      const asignacionDisponible = await buscarAsignacionDisponible(
        restaurante_id,
        restaurante.id,
        fecha,
        hora,
        numeroPersonas,
        margenCapacidad,
        duracionReservaMinutos
      );

      if (asignacionDisponible) {
        return responder(res, 200, {
          ok: true,
          lista_espera_creada: false,
          disponible_ahora: true,
          motivo: "Se acaba de liberar una mesa adecuada."
        });
      }

      const formulaListaEspera =
        `AND(` +
        `DATETIME_FORMAT({fecha},'YYYY-MM-DD')='${escaparFormulaAirtable(fecha)}',` +
        `{hora}='${escaparFormulaAirtable(hora)}',` +
        `OR(` +
        `LOWER(TRIM({estado}))='pendiente',` +
        `LOWER(TRIM({estado}))='avisado'` +
        `)` +
        `)`;
      const solicitudesCoincidentes = await consultarAirtable(
        `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/` +
        `LISTA_ESPERA?filterByFormula=${encodeURIComponent(formulaListaEspera)}`
      );
      const telefonoComparable = telefonoEspera.replace(/\D/g, "");
      const solicitudExistente = (solicitudesCoincidentes.records || []).find(
        (solicitud) => {
          const restaurantes = Array.isArray(solicitud.fields.restaurante)
            ? solicitud.fields.restaurante
            : [];
          const mismoEmail = String(solicitud.fields.email || "")
            .trim()
            .toLowerCase() === emailEspera;
          const mismoTelefono = String(solicitud.fields.telefono || "")
            .replace(/\D/g, "") === telefonoComparable;

          return restaurantes.includes(restaurante.id) &&
            (mismoEmail || mismoTelefono);
        }
      );

      if (solicitudExistente) {
        return responder(res, 200, {
          ok: true,
          lista_espera_creada: true,
          ya_existia: true,
          id_espera: solicitudExistente.fields.id_espera || ""
        });
      }

      const idEspera = generarIdEspera(fecha);
      const solicitudCreada = await consultarAirtable(
        `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/LISTA_ESPERA`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fields: {
              id_espera: idEspera,
              restaurante: [restaurante.id],
              fecha,
              hora,
              personas: numeroPersonas,
              nombre_completo: nombreEspera,
              telefono: telefonoEspera,
              email: emailEspera,
              observaciones: normalizarObservaciones(mensaje),
              estado: "pendiente",
              ...crearMetadatosPrivacidadListaEspera({
                fecha,
                hora,
                duracionReservaMinutos
              })
            }
          })
        }
      );

      return responder(res, 200, {
        ok: true,
        lista_espera_creada: true,
        id_espera: idEspera,
        airtable_record_id: solicitudCreada.id
      });
    }


    // ========================================================
    // 9️⃣ ACCIÓN: VERIFICAR
    // ========================================================

    if (accion === "verificar") {

      const mesaLibre =
await buscarAsignacionDisponible(
  restaurante_id,
  restaurante.id,
  fecha,
  hora,
  numeroPersonas,
  margenCapacidad,
  duracionReservaMinutos
);


      if (!mesaLibre) {
        const hayAsignacionCompatible = await existeAsignacionCompatible(
          restaurante_id,
          restaurante.id,
          numeroPersonas,
          margenCapacidad
        );
        const alternativas = hayAsignacionCompatible
          ? await buscarHorariosAlternativos(
            restaurante_id,
            restaurante.id,
            fecha,
            hora,
            numeroPersonas,
            margenCapacidad,
            duracionReservaMinutos,
            intervaloMinutos,
            restaurante.fields
          )
          : [];

        return responder(res, 200, {
          ok: true,
          disponible: false,
          alternativas,
          requiere_contacto_restaurante: !hayAsignacionCompatible,
          telefono_restaurante: !hayAsignacionCompatible
            ? obtenerTelefonoRestaurante(restaurante)
            : "",
          motivo:
            hayAsignacionCompatible
              ? "No hay una mesa disponible con capacidad suficiente."
              : "No existe una mesa o combinación automática adecuada para ese número de personas."
        });
      }


      return responder(res, 200, {
        ok: true,
        disponible: true,

        mesa: {
          id: mesaLibre.ids[0],
          ids: mesaLibre.ids,
          nombre: mesaLibre.nombre,
          capacidad: mesaLibre.capacidad,
          tipo: mesaLibre.tipo
        }
      });
    }


    // ========================================================
    // ACCIÓN: MODIFICAR O REACTIVAR UNA RESERVA EXISTENTE
    // ========================================================

    if (accion === "modificar" || accion === "reactivar") {
      const esReactivacion = accion === "reactivar";

      if (!localizador && !token_gestion) {
        return responder(res, 400, {
          ok: false,
          error: "Falta el identificador de la reserva."
        });
      }

      if (
        !token_gestion &&
        !clave_restaurante &&
        !sesionRestauranteAutorizada
      ) {
        return responder(res, 401, {
          ok: false,
          error:
            "Por seguridad, abre el enlace de gestión enviado en el correo de confirmación."
        });
      }

      if (token_gestion && !/^[a-f0-9]{48}$/i.test(String(token_gestion).trim())) {
        return responder(res, 400, {
          ok: false,
          error: "El token de gestión no tiene un formato válido."
        });
      }

      if (localizador && !/^[A-Z0-9-]{8,40}$/i.test(String(localizador).trim())) {
        return responder(res, 400, {
          ok: false,
          error: "El localizador no tiene un formato válido."
        });
      }

      const reservaActual = await buscarReservaGestion(
        restaurante_id,
        localizador,
        token_gestion,
        Boolean(clave_restaurante) || sesionRestauranteAutorizada
      );

      if (!reservaActual) {
        return responder(res, 404, {
          ok: false,
          error: "No se ha encontrado una reserva con ese localizador."
        });
      }

      const estadoReservaActual = String(reservaActual.fields.estado || "")
        .trim()
        .toLowerCase();
      const estadoEsperado = esReactivacion ? "cancelada" : "confirmada";

      if (estadoReservaActual !== estadoEsperado) {
        return responder(res, 200, {
          ok: true,
          modificada: false,
          reactivada: false,
          motivo: esReactivacion
            ? "Solo se pueden reactivar reservas canceladas."
            : "Solo se pueden modificar reservas confirmadas."
        });
      }

      const asignacion = await buscarAsignacionDisponible(
        restaurante_id,
        restaurante.id,
        fecha,
        hora,
        numeroPersonas,
        margenCapacidad,
        duracionReservaMinutos,
        reservaActual.id
      );

      if (!asignacion) {
        const alternativas = await buscarHorariosAlternativos(
          restaurante_id,
          restaurante.id,
          fecha,
          hora,
          numeroPersonas,
          margenCapacidad,
          duracionReservaMinutos,
          intervaloMinutos,
          restaurante.fields,
          reservaActual.id
        );

        return responder(res, 200, {
          ok: true,
          modificada: false,
          reactivada: false,
          disponible: false,
          alternativas,
          motivo: esReactivacion
            ? "No hay disponibilidad para reactivar la reserva con esos datos."
            : "No hay disponibilidad para modificar la reserva con esos datos."
        });
      }

      const idBloqueo =
        `${esReactivacion ? "REA" : "MOD"}-${Date.now()}-` +
        crypto.randomBytes(4).toString("hex");
      const urlReservas =
        `https://api.airtable.com/v0/` +
        `${process.env.AIRTABLE_BASE_ID}/RESERVAS`;
      const bloqueo = await consultarAirtable(urlReservas, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fields: {
            id_reserva: idBloqueo,
            restaurante: [restaurante.id],
            mesa: asignacion.ids,
            fecha,
            hora,
            personas: numeroPersonas,
            mensaje: `Bloqueo temporal para ${
              esReactivacion ? "reactivar" : "modificar"
            }`,
            estado: "pendiente",
            ...crearMetadatosPrivacidadReserva({
              fecha,
              hora,
              duracionReservaMinutos
            })
          }
        })
      });

      const resultadoBloqueo = await confirmarReservaSinConflictos(
        bloqueo,
        restaurante_id,
        fecha,
        hora,
        duracionReservaMinutos,
        asignacion.ids,
        [reservaActual.id],
        "pendiente"
      );

      if (!resultadoBloqueo.confirmada) {
        return responder(res, 200, {
          ok: true,
          modificada: false,
          reactivada: false,
          disponible: false,
          motivo:
            "Otra solicitud acaba de ocupar esas mesas. " +
            (esReactivacion
              ? "La reserva continúa cancelada."
              : "La reserva original no se ha modificado.")
        });
      }

      const urlReserva =
        `https://api.airtable.com/v0/` +
        `${process.env.AIRTABLE_BASE_ID}/RESERVAS/${reservaActual.id}`;
      const reservaModificada = await consultarAirtable(urlReserva, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fields: {
            fecha,
            hora,
            personas: numeroPersonas,
            mesa: asignacion.ids,
            ...crearMetadatosPrivacidadReserva({
              fecha,
              hora,
              duracionReservaMinutos
            }),
            ...(mensajeIncluido
              ? { mensaje: normalizarObservaciones(mensaje) }
              : {}),
            ...(esReactivacion ? { estado: "confirmada" } : {})
          }
        })
      });

      await registrarAuditoria({
        restauranteId: restaurante_id,
        reservaId: reservaModificada.fields.id_reserva,
        accion: esReactivacion
          ? "reserva_reactivada"
          : "reserva_modificada",
        origen: determinarOrigenAuditoria({
          accion,
          tokenGestion: token_gestion,
          claveRestaurante: clave_restaurante,
          sesionRestauranteAutorizada
        }),
        estadoAnterior: estadoReservaActual,
        estadoNuevo: String(reservaModificada.fields.estado || estadoReservaActual)
          .trim()
          .toLowerCase(),
        detalles: {
          anterior: {
            fecha: reservaActual.fields.fecha,
            hora: reservaActual.fields.hora,
            personas: Number(reservaActual.fields.personas || 0),
            mesas: Array.isArray(reservaActual.fields.mesa)
              ? reservaActual.fields.mesa
              : [],
            estado: estadoReservaActual
          },
          nuevo: {
            fecha: reservaModificada.fields.fecha,
            hora: reservaModificada.fields.hora,
            personas: Number(reservaModificada.fields.personas || 0),
            mesas: Array.isArray(reservaModificada.fields.mesa)
              ? reservaModificada.fields.mesa
              : [],
            estado: String(
              reservaModificada.fields.estado || estadoReservaActual
            ).trim().toLowerCase()
          }
        }
      });

      const urlBloqueo =
        `https://api.airtable.com/v0/` +
        `${process.env.AIRTABLE_BASE_ID}/RESERVAS/${bloqueo.id}`;

      try {
        await consultarAirtable(urlBloqueo, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fields: {
              estado: "aplicada_modificacion"
            }
          })
        });
      } catch (errorLimpieza) {
        console.error(
          `No se pudo cerrar el bloqueo de ${
            esReactivacion ? "reactivación" : "modificación"
          }:`,
          errorLimpieza
        );
      }

      const nombreRestauranteModificacion = obtenerNombreRestaurante(restaurante);
      const enlaceGestionModificacion = generarEnlaceGestion(
        reservaModificada.fields.token_gestion ||
        reservaActual.fields.token_gestion
      );
      const [correoEnviado, correoRestauranteEnviado] = await Promise.all([
        enviarCorreoModificacionReserva({
          destinatario: reservaModificada.fields.email,
          nombre: reservaModificada.fields.nombre_completo,
          nombreRestaurante: nombreRestauranteModificacion,
          fecha: reservaModificada.fields.fecha,
          hora: reservaModificada.fields.hora,
          personas: reservaModificada.fields.personas,
          localizador: reservaModificada.fields.id_reserva,
          enlaceGestion: enlaceGestionModificacion,
          reactivada: esReactivacion
        }),
        enviarAvisoRestaurante({
          destinatario: restaurante.fields.email,
          tipo: esReactivacion ? "reactivada" : "modificada",
          nombreRestaurante: nombreRestauranteModificacion,
          fecha: reservaModificada.fields.fecha,
          hora: reservaModificada.fields.hora,
          personas: reservaModificada.fields.personas,
          localizador: reservaModificada.fields.id_reserva,
          nombreCliente: reservaModificada.fields.nombre_completo,
          emailCliente: reservaModificada.fields.email,
          telefonoCliente: reservaModificada.fields.telefono,
          observaciones: reservaModificada.fields.mensaje,
          enlaceGestion: generarEnlacePanelRestaurante(
            reservaModificada.fields.fecha,
            restaurante_id
          )
        })
      ]);

      return responder(res, 200, {
        ok: true,
        modificada: true,
        reactivada: esReactivacion,
        correo_enviado: correoEnviado,
        correo_restaurante_enviado: correoRestauranteEnviado,
        reserva: resumirReserva(reservaModificada),
        mesa: {
          ids: asignacion.ids,
          nombre: asignacion.nombre,
          capacidad: asignacion.capacidad,
          tipo: asignacion.tipo
        }
      });
    }

    // ========================================================
    // ACCIÓN: CONSULTAR O CAMBIAR LAS MESAS DE UNA RESERVA
    // ========================================================

    if (accion === "opciones_mesas" || accion === "cambiar_mesas") {
      const localizadorNormalizado = String(localizador || "")
        .trim()
        .toUpperCase();

      if (!/^[A-Z0-9-]{8,40}$/.test(localizadorNormalizado)) {
        return responder(res, 400, {
          ok: false,
          error: "El localizador no tiene un formato válido."
        });
      }

      const reservaActual = await buscarReservaGestion(
        restaurante_id,
        localizadorNormalizado,
        null,
        true
      );

      if (!reservaActual) {
        return responder(res, 404, {
          ok: false,
          error: "No se ha encontrado una reserva con ese localizador."
        });
      }

      if (![
        "confirmada",
        "ocupada",
        "con retraso"
      ].includes(
        String(reservaActual.fields.estado || "").trim().toLowerCase()
      )) {
        return responder(res, 200, {
          ok: true,
          mesas_cambiadas: false,
          motivo: "Solo se pueden reorganizar reservas activas."
        });
      }

      const fechaReserva = reservaActual.fields.fecha;
      const horaReserva = reservaActual.fields.hora;
      const personasReserva = Number(reservaActual.fields.personas || 0);
      const asignaciones = await buscarAsignacionDisponible(
        restaurante_id,
        restaurante.id,
        fechaReserva,
        horaReserva,
        personasReserva,
        margenCapacidad,
        duracionReservaMinutos,
        reservaActual.id,
        true
      );
      const mesasActuales = Array.isArray(reservaActual.fields.mesa)
        ? reservaActual.fields.mesa
        : [];

      if (accion === "opciones_mesas") {
        return responder(res, 200, {
          ok: true,
          mesas_actuales: mesasActuales,
          opciones_mesas: asignaciones.map((asignacion) => ({
            ids: asignacion.ids,
            nombre: asignacion.nombre,
            capacidad: asignacion.capacidad,
            zona: asignacion.zona,
            tipo: asignacion.tipo,
            actual: mismosIdsMesa(asignacion.ids, mesasActuales)
          }))
        });
      }

      const idsSolicitados = Array.isArray(mesa_ids)
        ? mesa_ids.map((id) => String(id).trim()).filter(Boolean)
        : [];

      if (
        idsSolicitados.length === 0 ||
        idsSolicitados.some((id) => !/^rec[a-zA-Z0-9]{14}$/.test(id))
      ) {
        return responder(res, 400, {
          ok: false,
          error: "La selección de mesas no es válida."
        });
      }

      const asignacionElegida = asignaciones.find((asignacion) =>
        mismosIdsMesa(asignacion.ids, idsSolicitados)
      );

      if (!asignacionElegida) {
        return responder(res, 200, {
          ok: true,
          mesas_cambiadas: false,
          disponible: false,
          motivo:
            "Esa mesa o combinación ya no está disponible para toda la reserva."
        });
      }

      if (mismosIdsMesa(asignacionElegida.ids, mesasActuales)) {
        return responder(res, 200, {
          ok: true,
          mesas_cambiadas: true,
          sin_cambios: true,
          mesa: asignacionElegida
        });
      }

      const urlReservas =
        `https://api.airtable.com/v0/` +
        `${process.env.AIRTABLE_BASE_ID}/RESERVAS`;
      const bloqueo = await consultarAirtable(urlReservas, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fields: {
            id_reserva:
              `MES-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`,
            restaurante: [restaurante.id],
            mesa: asignacionElegida.ids,
            fecha: fechaReserva,
            hora: horaReserva,
            personas: personasReserva,
            mensaje: "Bloqueo temporal para reorganizar mesas",
            estado: "pendiente",
            ...crearMetadatosPrivacidadReserva({
              fecha: fechaReserva,
              hora: horaReserva,
              duracionReservaMinutos
            })
          }
        })
      });
      const resultadoBloqueo = await confirmarReservaSinConflictos(
        bloqueo,
        restaurante_id,
        fechaReserva,
        horaReserva,
        duracionReservaMinutos,
        asignacionElegida.ids,
        [reservaActual.id],
        "pendiente"
      );

      if (!resultadoBloqueo.confirmada) {
        return responder(res, 200, {
          ok: true,
          mesas_cambiadas: false,
          disponible: false,
          motivo:
            "Otra reserva acaba de ocupar esas mesas. No se ha cambiado la asignación."
        });
      }

      const urlReserva =
        `https://api.airtable.com/v0/` +
        `${process.env.AIRTABLE_BASE_ID}/RESERVAS/${reservaActual.id}`;
      const reservaActualizada = await consultarAirtable(urlReserva, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fields: { mesa: asignacionElegida.ids }
        })
      });

      await registrarAuditoria({
        restauranteId: restaurante_id,
        reservaId: reservaActualizada.fields.id_reserva,
        accion: "mesas_actualizadas",
        origen: "panel_restaurante",
        estadoAnterior: String(reservaActual.fields.estado || "")
          .trim()
          .toLowerCase(),
        estadoNuevo: String(reservaActualizada.fields.estado || "")
          .trim()
          .toLowerCase(),
        detalles: {
          anterior: { mesas: mesasActuales },
          nuevo: {
            mesas: asignacionElegida.ids,
            capacidad: asignacionElegida.capacidad,
            tipo: asignacionElegida.tipo
          }
        }
      });
      const urlBloqueo =
        `https://api.airtable.com/v0/` +
        `${process.env.AIRTABLE_BASE_ID}/RESERVAS/${bloqueo.id}`;

      try {
        await consultarAirtable(urlBloqueo, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fields: { estado: "aplicada_modificacion" }
          })
        });
      } catch (errorLimpieza) {
        console.error(
          "No se pudo cerrar el bloqueo del cambio de mesas:",
          errorLimpieza
        );
      }

      return responder(res, 200, {
        ok: true,
        mesas_cambiadas: true,
        reserva: resumirReserva(reservaActualizada),
        mesa: asignacionElegida
      });
    }


    // ========================================================
    // 🔟 ACCIÓN: RESERVAR
    // ========================================================

    if (accion === "reservar" || accion === "reservar_panel") {
      const esReservaPanel = accion === "reservar_panel";

      // Para crear la reserva necesitamos estos datos.
      if (!datosContactoValidos(
        nombre,
        email,
        telefono,
        !esReservaPanel
      )) {

        return responder(res, 400, {
          ok: false,
          error:
            esReservaPanel
              ? "El nombre, el email o el teléfono no son válidos."
              : "El nombre, el correo electrónico o el teléfono no son válidos."
        });
      }

      let solicitudEsperaConversion = null;

      if (registro_espera_id) {
        const registroEsperaId = String(registro_espera_id).trim();

        if (
          !esReservaPanel ||
          !/^rec[a-zA-Z0-9]{14}$/.test(registroEsperaId)
        ) {
          return responder(res, 400, {
            ok: false,
            error: "La solicitud de lista de espera no es válida."
          });
        }

        solicitudEsperaConversion = await consultarAirtable(
          `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/` +
          `LISTA_ESPERA/${registroEsperaId}`
        );
        const restaurantesSolicitud = Array.isArray(
          solicitudEsperaConversion.fields.restaurante
        )
          ? solicitudEsperaConversion.fields.restaurante
          : [];
        const estadoSolicitud = String(
          solicitudEsperaConversion.fields.estado || ""
        ).trim().toLowerCase();

        if (!restaurantesSolicitud.includes(restaurante.id)) {
          return responder(res, 404, {
            ok: false,
            error: "La solicitud no pertenece al restaurante."
          });
        }

        if (!["pendiente", "avisado"].includes(estadoSolicitud)) {
          return responder(res, 409, {
            ok: false,
            error:
              estadoSolicitud === "convertida"
                ? "Esta solicitud ya se convirtió en una reserva."
                : "Esta solicitud ya no está activa."
          });
        }
      }


      // IMPORTANTE:
      // Volvemos a comprobar disponibilidad.
      //
      // No confiamos en la comprobación realizada unos
      // minutos antes en el navegador.

      const idsMesasManuales = esReservaPanel && Array.isArray(mesa_ids)
        ? [...new Set(mesa_ids.map((id) => String(id).trim()).filter(Boolean))]
        : [];
      let mesaLibre = null;

      if (idsMesasManuales.length) {
        if (
          idsMesasManuales.length > 20 ||
          idsMesasManuales.some((id) => !/^rec[a-zA-Z0-9]{14}$/.test(id))
        ) {
          return responder(res, 400, {
            ok: false,
            error: "La selección manual de mesas no es válida."
          });
        }

        const formulaMesasPanel =
          `FIND('${String(restaurante_id)}',` +
          `ARRAYJOIN({id (from restaurante)}))`;
        const urlMesasPanel =
          `https://api.airtable.com/v0/` +
          `${process.env.AIRTABLE_BASE_ID}/MESAS` +
          `?filterByFormula=${encodeURIComponent(formulaMesasPanel)}`;
        const datosMesasPanel = await consultarAirtable(urlMesasPanel);
        const mesasSeleccionadas = (datosMesasPanel.records || []).filter(
          (mesa) => idsMesasManuales.includes(mesa.id)
        );

        if (
          mesasSeleccionadas.length !== idsMesasManuales.length ||
          mesasSeleccionadas.some((mesa) =>
            String(mesa.fields.estado || "").trim().toLowerCase() ===
            "fuera de servicio"
          )
        ) {
          return responder(res, 200, {
            ok: true,
            reservado: false,
            disponible: false,
            motivo:
              "Alguna de las mesas seleccionadas no pertenece al restaurante o está fuera de servicio."
          });
        }

        const zonasSeleccionadas = mesasSeleccionadas.map((mesa) =>
          Array.isArray(mesa.fields.zona) && mesa.fields.zona.length === 1
            ? mesa.fields.zona[0]
            : null
        );

        if (
          !zonasSeleccionadas[0] ||
          zonasSeleccionadas.some((zona) => zona !== zonasSeleccionadas[0])
        ) {
          return responder(res, 200, {
            ok: true,
            reservado: false,
            disponible: false,
            motivo: "Las mesas seleccionadas deben pertenecer a la misma zona."
          });
        }

        const zonaManual = await consultarAirtable(
          `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/` +
          `ZONA/${zonasSeleccionadas[0]}`
        );

        if (
          String(zonaManual.fields.estado || "activo")
            .trim()
            .toLowerCase() === "inactivo"
        ) {
          return responder(res, 200, {
            ok: true,
            reservado: false,
            disponible: false,
            motivo: "La zona seleccionada está fuera de servicio."
          });
        }

        const capacidadManual = mesasSeleccionadas.reduce(
          (total, mesa) => total + Number(mesa.fields.capacidad || 0),
          0
        );

        if (capacidadManual < numeroPersonas) {
          return responder(res, 200, {
            ok: true,
            reservado: false,
            disponible: false,
            motivo:
              `Las mesas seleccionadas suman ${capacidadManual} plazas y ` +
              `la reserva es para ${numeroPersonas} personas.`
          });
        }

        mesaLibre = {
          ids: idsMesasManuales,
          nombre: mesasSeleccionadas
            .map((mesa) => mesa.fields.nombre_mesa || "Mesa")
            .join(" + "),
          capacidad: capacidadManual,
          tipo: "manual"
        };
      } else {
        mesaLibre = await buscarAsignacionDisponible(
          restaurante_id,
          restaurante.id,
          fecha,
          hora,
          numeroPersonas,
          margenCapacidad,
          duracionReservaMinutos
        );
      }


      if (!mesaLibre) {
        const alternativas = await buscarHorariosAlternativos(
          restaurante_id,
          restaurante.id,
          fecha,
          hora,
          numeroPersonas,
          margenCapacidad,
          duracionReservaMinutos,
          intervaloMinutos,
          restaurante.fields
        );

        return responder(res, 200, {
          ok: true,
          reservado: false,
          disponible: false,
          alternativas,
          motivo:
            "La mesa ya no está disponible."
        });
      }


      // 1️⃣1️⃣ GENERAR LOCALIZADOR

      const idReserva = await generarIdReservaUnico(restaurante_id, fecha);
      const tokenGestion = generarTokenGestion();


      // 1️⃣2️⃣ CREAR REGISTRO EN AIRTABLE

      const urlCrearReserva =
        `https://api.airtable.com/v0/` +
        `${process.env.AIRTABLE_BASE_ID}/RESERVAS`;


      const nuevaReserva = {

        fields: {

          id_reserva: idReserva,

          token_gestion: tokenGestion,

          restaurante: [
            restaurante.id
          ],

          mesa: mesaLibre.ids,

          fecha: fecha,

          hora: hora,

          personas: numeroPersonas,

          nombre_completo: nombre,

          telefono: telefono,

          ...(email ? { email: email } : {}),

          mensaje: normalizarObservaciones(mensaje),

          estado: "pendiente",

          ...crearMetadatosPrivacidadReserva({
            fecha,
            hora,
            duracionReservaMinutos
          })
        }
      };


      const reservaCreada =
        await consultarAirtable(
          urlCrearReserva,
          {
            method: "POST",

            headers: {
              "Content-Type":
                "application/json"
            },

            body:
              JSON.stringify(nuevaReserva)
          }
        );

      const resultadoConfirmacion = await confirmarReservaSinConflictos(
        reservaCreada,
        restaurante_id,
        fecha,
        hora,
        duracionReservaMinutos,
        mesaLibre.ids
      );

      if (!resultadoConfirmacion.confirmada) {
        return responder(res, 200, {
          ok: true,
          reservado: false,
          disponible: false,
          motivo:
            "Otra solicitud acaba de reservar esas mesas. Vuelve a comprobar la disponibilidad."
        });
      }

      await registrarAuditoria({
        restauranteId: restaurante_id,
        reservaId: idReserva,
        accion: "reserva_creada",
        origen: esReservaPanel ? "panel_restaurante" : "web_cliente",
        estadoNuevo: "confirmada",
        detalles: {
          nuevo: {
            fecha,
            hora,
            personas: numeroPersonas,
            mesas: mesaLibre.ids,
            capacidad: mesaLibre.capacidad,
            tipo: mesaLibre.tipo,
            estado: "confirmada"
          }
        }
      });

      let listaEsperaConvertida = null;

      if (solicitudEsperaConversion) {
        try {
          await consultarAirtable(
            `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/` +
            `LISTA_ESPERA/${solicitudEsperaConversion.id}`,
            {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                fields: {
                  estado: "convertida",
                  reserva: [reservaCreada.id]
                }
              })
            }
          );
          listaEsperaConvertida = true;
        } catch (errorListaEspera) {
          listaEsperaConvertida = false;
          console.error(
            "La reserva se creó, pero no se pudo cerrar su lista de espera:",
            errorListaEspera
          );
        }
      }


      console.log(
        "RESERVA CREADA:",
        idReserva
      );

      const enlaceGestion = generarEnlaceGestion(tokenGestion);
      const nombreRestauranteReserva = obtenerNombreRestaurante(restaurante);
      const [correoEnviado, correoRestauranteEnviado] = await Promise.all([
        enviarCorreoConfirmacionReserva({
          destinatario: email,
          nombre,
          nombreRestaurante: nombreRestauranteReserva,
          fecha,
          hora,
          personas: numeroPersonas,
          localizador: idReserva,
          enlaceGestion
        }),
        enviarAvisoRestaurante({
          destinatario: restaurante.fields.email,
          tipo: "nueva",
          nombreRestaurante: nombreRestauranteReserva,
          fecha,
          hora,
          personas: numeroPersonas,
          localizador: idReserva,
          nombreCliente: nombre,
          emailCliente: email,
          telefonoCliente: telefono,
          observaciones: mensaje,
          enlaceGestion: generarEnlacePanelRestaurante(fecha, restaurante_id)
        })
      ]);


      // 1️⃣3️⃣ RESPUESTA AL CLIENTE

      return responder(res, 200, {

        ok: true,

        reservado: true,

        id_reserva: idReserva,

        token_gestion: tokenGestion,

        enlace_gestion: enlaceGestion,

        correo_enviado: correoEnviado,

        correo_restaurante_enviado: correoRestauranteEnviado,

        lista_espera_convertida: listaEsperaConvertida,

        airtable_record_id:
          reservaCreada.id,

        mesa: {
          id: mesaLibre.ids[0],
          ids: mesaLibre.ids,
          nombre: mesaLibre.nombre,
          capacidad: mesaLibre.capacidad,
          tipo: mesaLibre.tipo
        }
      });
    }


    // 1️⃣4️⃣ ACCIÓN DESCONOCIDA

    return responder(res, 400, {
      ok: false,
      error:
        "Acción no reconocida."
    });


  } catch (error) {

    const idError = crypto.randomBytes(6).toString("hex");

    console.error(
      `ERROR CONTACTIA [${idError}]:`,
      error
    );

    return responder(res, 500, {
      ok: false,
      error: `Error interno del servidor. Código: ${idError}`
    });
  }
};


module.exports._seguridad = {
  generarEnlaceGestion,
  generarIdReserva
};


