// ============================================================

const crypto = require("crypto");
const CADUCIDAD_RESERVA_PENDIENTE_MS = 2 * 60 * 1000;
// CONTACTIA V2 - api/chat.js
// FASE 2: comprobar disponibilidad + crear reserva
// ============================================================


// 1️⃣ RESPONDER SIEMPRE EN JSON
function responder(res, status, datos) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  return res.end(JSON.stringify(datos));
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


  // Descartamos únicamente las mesas fuera de servicio
  const mesasOperativas = mesas.filter((mesa) => {

    const estado =
      String(mesa.fields.estado || "")
        .trim()
        .toLowerCase();

    return estado !== "fuera de servicio";
  });


  // Buscar reservas ya confirmadas

const formulaReservas =
  `AND(` +
  `DATETIME_FORMAT({fecha},'YYYY-MM-DD')='${fecha}',` +
  `LOWER(TRIM({estado}))='confirmada',` +
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

  const urlZonas =
    `https://api.airtable.com/v0/` +
    `${process.env.AIRTABLE_BASE_ID}/ZONA`;
  const datosZonas = await consultarAirtable(urlZonas);
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
      body: JSON.stringify({ fields: { estado: "expirada" } })
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

  const hayConfirmadaAnterior = conflictos.some((reserva) =>
    reserva.id !== reservaCreada.id &&
    String(reserva.fields.estado || "").trim().toLowerCase() === "confirmada"
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
    body: JSON.stringify({ fields: { estado: estadoFinal } })
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


async function buscarReservaGestion(restaurante_id, localizador, tokenGestion) {
  if (tokenGestion) {
    const tokenNormalizado = String(tokenGestion).trim().toLowerCase();

    if (!/^[a-f0-9]{48}$/.test(tokenNormalizado)) {
      throw new Error("El token de gestión no tiene un formato válido.");
    }

    return buscarReservaPorToken(restaurante_id, tokenNormalizado);
  }

  const localizadorNormalizado = String(localizador || "").trim().toUpperCase();

  if (!/^[A-Z0-9-]{8,40}$/.test(localizadorNormalizado)) {
    throw new Error("El localizador no tiene un formato válido.");
  }

  return buscarReservaPorLocalizador(restaurante_id, localizadorNormalizado);
}


function resumirReserva(reserva) {
  return {
    localizador: reserva.fields.id_reserva,
    fecha: reserva.fields.fecha,
    hora: reserva.fields.hora,
    personas: reserva.fields.personas,
    nombre: reserva.fields.nombre_completo,
    estado: reserva.fields.estado
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
function generarIdReserva(fecha) {

  const fechaLimpia =
    fecha.replaceAll("-", "");

  const aleatorio =
    Math.floor(1000 + Math.random() * 9000);

  return `SOL-${fechaLimpia}-${aleatorio}`;
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
    ? `${urlPublica}/?gestion=${tokenGestion}`
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
  const texto =
    `${titulo}\n\n` +
    `${diaSemana} ${fechaCorta} / Hora: ${hora} / ${personas} personas\n` +
    `Cliente: ${nombreCliente}\n` +
    `Email: ${emailCliente}\n` +
    `Teléfono: ${telefonoCliente}\n` +
    `Localizador: ${localizador}\n` +
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


  try {

    const body =
      typeof req.body === "string"
        ? JSON.parse(req.body || "{}")
        : (req.body || {});


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
      mesa_ids
    } = body;

    // Consulta y cancelación no necesitan fecha, hora ni comensales.
    if (accion === "consultar" || accion === "cancelar") {
      if (!restaurante_id || (!localizador && !token_gestion)) {
        return responder(res, 400, {
          ok: false,
          error: "Faltan restaurante_id y el identificador de la reserva."
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
        token_gestion
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

      if (estadoActual !== "confirmada") {
        return responder(res, 200, {
          ok: true,
          cancelada: false,
          motivo: "La reserva no está confirmada y no se puede cancelar.",
          reserva: resumirReserva(reserva)
        });
      }

      const urlReserva =
        `https://api.airtable.com/v0/` +
        `${process.env.AIRTABLE_BASE_ID}/RESERVAS/${reserva.id}`;
      const reservaActualizada = await consultarAirtable(urlReserva, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fields: { estado: "cancelada" } })
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

      if (accion === "reservar") {
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
      ["reactivar", "opciones_mesas", "cambiar_mesas"].includes(accion) &&
      !clave_restaurante
    ) {
      return responder(res, 401, {
        ok: false,
        error: "Esta operación requiere la clave del restaurante."
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

        const alternativas =
          await buscarHorariosAlternativos(
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
          disponible: false,
          alternativas,
          motivo:
            "No hay una mesa disponible con capacidad suficiente."
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
        token_gestion
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
            nombre_completo: reservaActual.fields.nombre_completo,
            telefono: reservaActual.fields.telefono,
            email: reservaActual.fields.email,
            mensaje:
              `Bloqueo temporal para ${esReactivacion ? "reactivar" : "modificar"} ` +
              reservaActual.fields.id_reserva,
            estado: "pendiente"
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
            ...(esReactivacion ? { estado: "confirmada" } : {})
          }
        })
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
        null
      );

      if (!reservaActual) {
        return responder(res, 404, {
          ok: false,
          error: "No se ha encontrado una reserva con ese localizador."
        });
      }

      if (
        String(reservaActual.fields.estado || "").trim().toLowerCase() !==
        "confirmada"
      ) {
        return responder(res, 200, {
          ok: true,
          mesas_cambiadas: false,
          motivo: "Solo se pueden reorganizar reservas confirmadas."
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
            nombre_completo: reservaActual.fields.nombre_completo,
            telefono: reservaActual.fields.telefono,
            email: reservaActual.fields.email,
            mensaje:
              `Bloqueo temporal para reorganizar ${
                reservaActual.fields.id_reserva
              }`,
            estado: "pendiente"
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

    if (accion === "reservar") {

      // Para crear la reserva necesitamos estos datos.
      if (!nombre || !email || !telefono) {

        return responder(res, 400, {
          ok: false,
          error:
            "Faltan nombre, email o teléfono."
        });
      }


      // IMPORTANTE:
      // Volvemos a comprobar disponibilidad.
      //
      // No confiamos en la comprobación realizada unos
      // minutos antes en el navegador.

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

        return responder(res, 200, {
          ok: true,
          reservado: false,
          disponible: false,
          motivo:
            "La mesa ya no está disponible."
        });
      }


      // 1️⃣1️⃣ GENERAR LOCALIZADOR

      const idReserva =
        generarIdReserva(fecha);
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

          email: email,

          mensaje: mensaje || "",

          estado: "pendiente"
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

    console.error(
      "ERROR CONTACTIA:",
      error
    );

    return responder(res, 500, {
      ok: false,
      error:
        error.message ||
        "Error interno del servidor."
    });
  }
};

