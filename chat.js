// === CHAT.JS – Contactia (VERSIÓN CORREGIDA FINAL) ===
// Conexión con Airtable + Gmail + Twilio
// Corregido para usar el campo lookup "id (from restaurante)"

const nodemailer = require("nodemailer");
const twilio = require("twilio");
const fetch = (...args) => import("node-fetch").then(({ default: fetch }) => fetch(...args));

function diaSemanaES(fechaISO) {
  const d = new Date(fechaISO);
  return d.toLocaleDateString("es-ES", { weekday: "long" }).toLowerCase();
}

function horaEnRangos(horaHHMM, rangos) {
  if (!Array.isArray(rangos)) return false;
  const toMin
 = (hhmm) => {
    const [h, m] = hhmm.split(":").map(Number);
    return h * 60 + m;
  };
  const hm = toMin(horaHHMM);
  return rangos.some((r) => {
    const [ini, fin] = r.split("-").map((s) => s.trim());
    return hm >= toMin(ini) && hm <= toMin(fin);
  });
}

function generarIdReserva(nombreRest, fechaISO) {
  const pref = (nombreRest || "RES").replace(/[^A-Za-z0-9]/g, "").slice(0, 3).toUpperCase();
  const yyyymmdd = fechaISO.replaceAll("-", "");
  const suf = Math.floor(Math.random() * 9000 + 1000);
  return `${pref}-${yyyymmdd}-${suf}`;
}

function safeJSON(value, fallback) {
  if (value == null) return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

async function enviarCorreoConfirmacion({ email, nombre, fecha, hora, personas, idReserva, restaurante, direccion }) {
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_PASS,
    },
  });

  const html = `
  <div style="font-family:Arial,sans-serif;padding:20px;">
    <h2>🍷 Confirmación de tu reserva en ${restaurante}</h2>
    <p>Hola ${nombre}, tu reserva ha sido <strong>confirmada</strong>.</p>
    <p>📅 ${fecha} – ${hora}</p>
    <p>👥 ${personas} personas</p>
    <p>🎫 ID de reserva: <strong>${idReserva}</strong></p>
    <p>📍 ${direccion || ""}</p>
  </div>`;

  await transporter.sendMail({
    from: `"${process.env.FROM_NAME}" <${process.env.FROM_EMAIL}>`,
    to: email,
    subject: `🍷 Confirmación de tu reserva en ${restaurante}`,
    html,
  });
}

const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

async function enviarWhatsAppCliente({ telefono, nombre, restaurante, fecha, hora, personas, idReserva }) {
  try {
    const mensaje = `🍽 *${restaurante}*\n\n✅ *Tu reserva está confirmada*\n📅 ${fecha} - ${hora}\n👥 ${personas} personas\n🧑 ${nombre}\n🎫 ID: ${idReserva}`;
    await client.messages.create({
      from: process.env.TWILIO_WHATSAPP_FROM,
      to: `whatsapp:${telefono}`,
      body: mensaje,
    });
  } catch (err) {
    console.error("❌ Error al enviar WhatsApp:", err);
  }
}

module.exports = async (req, res) => {
  // Configurar CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  // Manejar preflight
  if (req.method === "OPTIONS") {
    res.statusCode = 200;
    return res.end();
  }

  if (req.method !== "POST") {
    res.statusCode = 405;
    return res.end(JSON.stringify({ reply: "Método no permitido" }));
  }


// ===============================
// ✅ Body parsing robusto (Vercel)
// ===============================


let parsedBody = {};

if (req.body && typeof req.body === "object" && Object.keys(req.body).length > 0) {
  parsedBody = req.body;
} else if (typeof req.body === "string") {
  parsedBody = safeJSON(req.body, {});
} else if (Buffer.isBuffer(req.body)) {
  parsedBody = safeJSON(req.body.toString("utf8"), {});
} else {
  let body = "";
  req.on("data", (chunk) => (body += chunk.toString()));
  await new Promise((resolve) => req.on("end", resolve));
  parsedBody = safeJSON(body, {});
}

req.body = parsedBody;

// 🔎 Logs de diagnóstico
console.log("🧾 Content-Type:", req.headers["content-type"]);
console.log("🧾 Body keys:", Object.keys(req.body || {}));

// ✅ Sacar restaurante_id de donde venga
const resolvedRestauranteId =
  (req.body && (req.body.restaurante_id ?? req.body.restauranteId ?? req.body.restaurante)) ||
  (req.query && (req.query.restaurante_id ?? req.query.restauranteId ?? req.query.restaurante));

// 🔥 Parche temporal mientras probamos (Restaurante Sol = 1)


const resolvedRestauranteId =
  (req.body && (req.body.restaurante_id ?? req.body.restauranteId ?? req.body.restaurante)) ||
  (req.query && (req.query.restaurante_id ?? req.query.restauranteId ?? req.query.restaurante));

const restaurante_id = resolvedRestauranteId ?? 1;

console.log("🔥 restaurante_id recibido:", restaurante_id);
console.log("🔥 Payload completo:", JSON.stringify(req.body, null, 2));

// A partir de aquí ya puedes usar req.body con seguridad:
const { fecha, hora, personas, nombre, email, telefono, mensaje = "" } = req.body || {};


    // === 1️⃣ BUSCAR RESTAURANTE ===

    console.log("🔍 Buscando restaurante con id:", restaurante_id);

    // ✅ Funciona si {id} es número o texto
    const filtroRestaurante = `OR({id}=${Number(restaurante_id)}, {id}='${String(restaurante_id)}')`;
    const restUrl = `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/RESTAURANTES?filterByFormula=${encodeURIComponent(
      filtroRestaurante
    )}`;

    console.log("🔗 REST URL:", restUrl);

    const restResp = await fetch(restUrl, {
      headers: { Authorization: `Bearer ${process.env.AIRTABLE_API_KEY}` },
    });

    const restText = await restResp.text();
    const restData = safeJSON(restText, {});
    console.log("🏨 Restaurante status:", restResp.status, restResp.statusText);
    console.log("🏨 Registros RESTAURANTES:", restData.records?.length || 0);

    if (!restData.records?.length) {
      console.log("❌ No se encontró el restaurante con id:", restaurante_id);
      res.statusCode = 404;
      return res.end(JSON.stringify({ reply: "Restaurante no encontrado." }));
    }

    const R = restData.records[0].fields;
    const restauranteRecordId = restData.records[0].id;
    console.log("✅ Restaurante:", R.nombre, "| Record ID:", restauranteRecordId);
    





    // === 2️⃣ VERIFICACIÓN DE DISPONIBILIDAD ===
    if (req.body.accion === "verificar") {
      try {
        console.log("🧩 Verificando disponibilidad...");
        console.log("   📍 Restaurante ID:", restaurante_id);
        console.log("   📅 Fecha:", fecha, "| Hora:", hora, "| Personas:", personas);

        // CLAVE: Filtrar por el campo lookup "id (from restaurante)"
        
        const filtroMesasFormula = `OR({id (from restaurante)}=${Number(restaurante_id)}, {id (from restaurante)}='${String(restaurante_id)}')`;
        const mesasUrl = `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/MESAS?filterByFormula=${encodeURIComponent(filtroMesasFormula)}`;
       

       console.log("🔗 Consultando mesas:", mesasUrl);
        
        const mesasResp = await fetch(mesasUrl, {
          headers: { Authorization: `Bearer ${process.env.AIRTABLE_API_KEY}` }
        });


         const mesasText = await mesasResp.text();
         const mesasData = safeJSON(mesasText, {});
         console.log("🪑 Mesas status:", mesasResp.status, mesasResp.statusText);

        
        mesasData.records?.forEach((m, i) => {
          console.log(`   → Mesa ${i + 1}:`, {
            id_mesa: m.fields.id,
            nombre: m.fields.nombre_mesa,
            capacidad: m.fields.capacidad,
            estado: m.fields.estado,
            id_restaurante: m.fields["id (from restaurante)"]
          });
        });

        if (!mesasData.records?.length) {
          console.log("⚠️ No se encontraron mesas para el restaurante con id:", restaurante_id);
          res.setHeader("Content-Type", "application/json");
          return res.end(JSON.stringify({ disponible: false }));
        }

        // Buscar reservas existentes
        const reservasURL = `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/RESERVAS?filterByFormula=${encodeURIComponent(`AND({fecha}='${fecha}', {hora}='${hora}', {estado}='confirmada')`)}`;
        
        const reservasResp = await fetch(reservasURL, {
          headers: { Authorization: `Bearer ${process.env.AIRTABLE_API_KEY}` },
        });


        const reservasText = await reservasResp.text();
        const reservasData = safeJSON(reservasText, {});
        console.log("📅 Reservas status:", reservasResp.status, reservasResp.statusText);

        const mesasOcupadas = reservas
          .map((r) => r.fields.mesa?.[0])
          .filter(Boolean);
        
        console.log("🚫 Mesas ocupadas:", mesasOcupadas);

        // Buscar mesa disponible
        const mesaLibre = mesasData.records.find(
          (m) => !mesasOcupadas.includes(m.id) && 
                 m.fields.estado?.toLowerCase() === "libre" && 
                 Number(m.fields.capacidad) >= Number(personas)
        );

        if (mesaLibre) {
          console.log("✅ Mesa disponible:", mesaLibre.fields.nombre_mesa);
        } else {
          console.log("❌ No hay mesas disponibles");
        }

        res.setHeader("Content-Type", "application/json");
        return res.end(JSON.stringify({ disponible: !!mesaLibre }));
      } catch (err) {
        console.error("💥 Error en verificación:", err);
        res.statusCode = 500;
        return res.end(JSON.stringify({ reply: "Error al verificar disponibilidad" }));
      }
    }

    // === 3️⃣ PROCESO DE RESERVA COMPLETO ===
    console.log("🎯 Iniciando reserva...");

    // Obtener mesas usando el campo lookup

    const filtroMesasFormula = `OR({id (from restaurante)}=${Number(restaurante_id)}, {id (from restaurante)}='${String(restaurante_id)}')`;
    const mesasUrl = `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/MESAS?filterByFormula=${encodeURIComponent(filtroMesasFormula)}`;


    const mesasResp = await fetch(mesasUrl, {
      headers: { Authorization: `Bearer ${process.env.AIRTABLE_API_KEY}` },
    });

     const mesasText = await mesasResp.text();
     const mesasData = safeJSON(mesasText, {});
     console.log("🪑 Mesas status:", mesasResp.status, mesasResp.statusText);

    if (!mesasData.records?.length) {
      console.log("❌ No hay mesas para este restaurante");
      res.setHeader("Content-Type", "application/json");
      return res.end(JSON.stringify({ 
        reply: `No hay mesas configuradas para ${R.nombre}.` 
      }));
    }

    // Buscar mesa libre
    const mesaLibre = mesasData.records.find(
      (m) => Number(m.fields.capacidad) >= Number(personas) && 
             m.fields.estado?.toLowerCase() === "libre"
    );

    if (!mesaLibre) {
      console.log("❌ No hay mesa disponible");
      res.setHeader("Content-Type", "application/json");
      return res.end(JSON.stringify({ 
        reply: `No hay mesas disponibles para ${personas} personas.` 
      }));
    }

    console.log("✅ Mesa seleccionada:", mesaLibre.fields.nombre_mesa);

    // === 4️⃣ CREAR RESERVA ===
    const idReserva = generarIdReserva(R.nombre, fecha);
    console.log("🎫 Creando reserva:", idReserva);

    const reservaData = {
      fields: {
        id_reserva: idReserva,
        restaurante: [restauranteRecordId],
        mesa: [mesaLibre.id],
        fecha,
        hora,
        personas: Number(personas),
        nombre_completo: nombre,
        email,
        telefono,
        mensaje,
        estado: "confirmada",
      },
    };

    const crearReservaResp = await fetch(
      `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/RESERVAS`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.AIRTABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(reservaData),
      }
    );

    const reservaCreada = await crearReservaResp.json();
    
    if (!crearReservaResp.ok) {
      console.error("❌ Error al crear reserva:", reservaCreada);
      res.statusCode = 500;
      return res.end(JSON.stringify({ 
        reply: "Error al crear la reserva.",
        error: reservaCreada 
      }));
    }

    console.log("📦 Reserva creada:", reservaCreada.id);

    // === 5️⃣ CONFIRMACIONES ===
    try {
      await enviarCorreoConfirmacion({
        email,
        nombre,
        fecha,
        hora,
        personas,
        idReserva,
        restaurante: R.nombre,
        direccion: R.direccion,
      });
      console.log("📧 Correo enviado");
    } catch (emailErr) {
      console.error("⚠️ Error email:", emailErr.message);
    }

    if (telefono) {
      try {
        await enviarWhatsAppCliente({
          telefono,
          nombre,
          restaurante: R.nombre,
          fecha,
          hora,
          personas,
          idReserva,
        });
        console.log("📱 WhatsApp enviado");
      } catch (whatsappErr) {
        console.error("⚠️ Error WhatsApp:", whatsappErr.message);
      }
    }

    res.setHeader("Content-Type", "application/json");
    return res.end(JSON.stringify({
      reply: `✅ Reserva confirmada en ${R.nombre} para ${personas} personas el ${fecha} a las ${hora}.
🪑 Mesa: ${mesaLibre.fields.nombre_mesa}
🎫 ID: ${idReserva}`
    }));

  } catch (err) {
    console.error("💥 ERROR GENERAL:", err);
    console.error("Stack:", err.stack);
    res.statusCode = 500;
    res.end(JSON.stringify({ 
      reply: "Error interno del servidor.",
      error: err.message 
    }));
  }
};