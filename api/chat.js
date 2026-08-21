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
  personas
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

      return (
        capacidad >= Number(personas) &&
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


// 5️⃣ GENERAR LOCALIZADOR
function generarIdReserva(fecha) {

  const fechaLimpia =
    fecha.replaceAll("-", "");

  const aleatorio =
    Math.floor(1000 + Math.random() * 9000);

  return `SOL-${fechaLimpia}-${aleatorio}`;
}


// 6️⃣ HANDLER PRINCIPAL
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


    // ========================================================
    // 9️⃣ ACCIÓN: VERIFICAR
    // ========================================================

    if (accion === "verificar") {

      const mesaLibre =
        await buscarMesaDisponible(
          restaurante_id,
          fecha,
          hora,
          numeroPersonas
        );


      if (!mesaLibre) {

        return responder(res, 200, {
          ok: true,
          disponible: false,
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
          numeroPersonas
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