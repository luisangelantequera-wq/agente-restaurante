// ============================================================
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


// 4️⃣ BUSCAR MESA DISPONIBLE
async function buscarMesaDisponible(
  restaurante_id,
  fecha,
  hora,
  personas,
  margenCapacidad
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
  `TRIM({hora})='${hora}',` +
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

//AÑADIDO PROVISIONAL
console.log("Reservas encontradas para esa fecha/hora:", reservas.length);

reservas.forEach((r) => {
  console.log("Reserva encontrada:", {
    id_reserva: r.fields.id_reserva,
    fecha: r.fields.fecha,
    hora: r.fields.hora,
    estado: r.fields.estado,
    mesa: r.fields.mesa
  });
});



  // Obtener mesas ocupadas
  const mesasOcupadas = new Set();

  for (const reserva of reservas) {

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
  capacidad <= personasNum + margenNum &&
  !mesasOcupadas.has(mesa.id)
);



    })

    .sort(
      (a, b) =>
        Number(a.fields.capacidad) -
        Number(b.fields.capacidad)
    );


  return mesasAdecuadas[0] || null;
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
  fecha,
  hora,
  personas,
  margenCapacidad,
  intervaloMinutos,
  camposRestaurante
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

  const candidatos = [];

  // Se alterna antes/después para mantener el orden por cercanía.
  // En caso de empate se ofrece primero la hora anterior.
  for (let distancia = intervalo; distancia <= 60; distancia += intervalo) {
    for (const desplazamiento of [-distancia, distancia]) {
      const minutosCandidatos = horaSolicitada + desplazamiento;

      // Las alternativas pertenecen siempre a la misma fecha solicitada.
      if (minutosCandidatos < 0 || minutosCandidatos >= 24 * 60) {
        continue;
      }

      candidatos.push(minutosAHora(minutosCandidatos));
    }
  }

  const alternativas = [];

  for (const horaCandidata of candidatos) {
    const validacionHorario = validarHorarioRestaurante(
      camposRestaurante,
      fecha,
      horaCandidata
    );

    if (!validacionHorario.valido) {
      continue;
    }

    const mesaLibre = await buscarMesaDisponible(
      restaurante_id,
      fecha,
      horaCandidata,
      personas,
      margenCapacidad
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
      mensaje
    } = body;


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

    const validacionHorario =
      validarHorarioRestaurante(
        restaurante.fields,
        fecha,
        hora
      );

    if (!validacionHorario.valido) {
      if (accion === "reservar") {
        return responder(res, 200, {
          ok: true,
          reservado: false,
          disponible: false,
          motivo: validacionHorario.motivo,
          cambio_requerido: validacionHorario.cambioRequerido
        });
      }

      return responder(res, 200, {
        ok: true,
        disponible: false,
        alternativas: [],
        motivo: validacionHorario.motivo,
        cambio_requerido: validacionHorario.cambioRequerido
      });
    }


    // ========================================================
    // 9️⃣ ACCIÓN: VERIFICAR
    // ========================================================

    if (accion === "verificar") {

      const mesaLibre =
await buscarMesaDisponible(
  restaurante_id,
  fecha,
  hora,
  numeroPersonas,
  margenCapacidad
);


      if (!mesaLibre) {

        const alternativas =
          await buscarHorariosAlternativos(
            restaurante_id,
            fecha,
            hora,
            numeroPersonas,
            margenCapacidad,
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
          id: mesaLibre.id,
          nombre: mesaLibre.fields.nombre_mesa,
          capacidad: mesaLibre.fields.capacidad
        }
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
   await buscarMesaDisponible(
    restaurante_id,
    fecha,
    hora,
    numeroPersonas,
    margenCapacidad
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


      // 1️⃣2️⃣ CREAR REGISTRO EN AIRTABLE

      const urlCrearReserva =
        `https://api.airtable.com/v0/` +
        `${process.env.AIRTABLE_BASE_ID}/RESERVAS`;


      const nuevaReserva = {

        fields: {

          id_reserva: idReserva,

          restaurante: [
            restaurante.id
          ],

          mesa: [
            mesaLibre.id
          ],

          fecha: fecha,

          hora: hora,

          personas: numeroPersonas,

          nombre_completo: nombre,

          telefono: telefono,

          email: email,

          mensaje: mensaje || "",

          estado: "confirmada"
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


      console.log(
        "RESERVA CREADA:",
        idReserva
      );


      // 1️⃣3️⃣ RESPUESTA AL CLIENTE

      return responder(res, 200, {

        ok: true,

        reservado: true,

        id_reserva: idReserva,

        airtable_record_id:
          reservaCreada.id,

        mesa: {
          id: mesaLibre.id,
          nombre:
            mesaLibre.fields.nombre_mesa,
          capacidad:
            mesaLibre.fields.capacidad
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

