// === CHAT.JS — Contactia (modo DEBUG) ===
// Conexión con Airtable + Gmail + Twilio
// Incluye console.log detallado para ver lo que ocurre en Vercel

const nodemailer = require("nodemailer");
const twilio = require("twilio");
const fetch = (...args) => import("node-fetch").then(({ default: fetch }) => fetch(...args));

function diaSemanaES(fechaISO) {
  const d = new Date(fechaISO);
  return d.toLocaleDateString("es-ES", { weekday: "long" }).toLowerCase();
}

function horaEnRangos(horaHHMM, rangos) {
  if (!Array.isArray(rangos)) return false;
  const toMin = (hhmm) => {
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
    <p>🪪 ID de reserva: <strong>${idReserva}</strong></p>
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
    const mensaje = `🍽 *${restaurante}*\n\n✅ *Tu reserva está confirmada*\n📅 ${fecha} - ${hora}\n👥 ${personas} personas\n🧍 ${nombre}\n🪪 ID: ${idReserva}`;
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
  if (req.method !== "POST") {
    res.statusCode = 405;
    return res.end(JSON.stringify({ reply: "Método no permitido" }));
  }

  try {
    let body = "";
    if (!req.body) {
      req.on("data", chunk => (body += chunk.toString()));
      await new Promise(resolve => req.on("end", resolve));
      req.body = JSON.parse(body || "{}");
    }

    const { restaurante_id, fecha, hora, personas, nombre, email, telefono, mensaje = "" } = req.body;
    console.log("📥 Datos recibidos:", req.body);



// === 🔎 COMPROBACIÓN DE DISPONIBILIDAD (VERIFICAR) ===

if (req.body.accion === "verificar") {
  try {
    console.log("🧩 Ejecutando verificación de mesas disponibles...");

    const mesasURL = `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/MESAS?filterByFormula=${encodeURIComponent(`{id (from restaurante)}='${String(restaurante_id)}'`)}`;
    const mesasResp = await fetch(mesasURL, {
      headers: { Authorization: `Bearer ${process.env.AIRTABLE_API_KEY}` },
    });
    const mesasData = await mesasResp.json();

    console.log("🪑 Mesas encontradas en verificar:", mesasData.records?.length || 0);
    mesasData.records?.forEach((m, i) => {
      console.log(`→ Mesa ${i + 1}:`, m.fields.nombre_mesa, "| Capacidad:", m.fields.capacidad, "| Estado:", m.fields.estado);
    });

    const reservasURL = `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/RESERVAS?filterByFormula=${encodeURIComponent(`AND({fecha}='${fecha}', {hora}='${hora}', {estado}='confirmada')`)}`;
    const reservasResp = await fetch(reservasURL, {
      headers: { Authorization: `Bearer ${process.env.AIRTABLE_API_KEY}` },
    });
    const reservasData = await reservasResp.json();
    const reservas = reservasData.records || [];

    const mesasOcupadas = reservas.map((r) => r.fields.mesa?.[0]).filter(Boolean);
    const mesaLibre = mesasData.records.find(
      (m) => !mesasOcupadas.includes(m.id) && m.fields.estado?.toLowerCase() === "libre" && m.fields.capacidad >= personas
    );

    console.log("✅ Resultado verificación:", mesaLibre ? `Mesa libre encontrada: ${mesaLibre.fields.nombre_mesa}` : "No hay mesas libres.");

    res.setHeader("Content-Type", "application/json");
    return res.end(JSON.stringify({ disponible: !!mesaLibre }));
  } catch (err) {
    console.error("💥 Error en verificación:", err);
    res.statusCode = 500;
    return res.end(JSON.stringify({ reply: "Error al verificar disponibilidad" }));
  }
}



    // === 1️⃣ Buscar restaurante ===

const restResp = await fetch(
  `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/RESTAURANTES?filterByFormula=${encodeURIComponent(`{id}='${String(restaurante_id)}'`)}`,
  { headers: { Authorization: `Bearer ${process.env.AIRTABLE_API_KEY}` } }
);

    const restData = await restResp.json();
    console.log("🏨 Restaurante encontrado:", JSON.stringify(restData, null, 2));

    if (!restData.records?.length) {
      res.statusCode = 404;
      return res.end(JSON.stringify({ reply: "Restaurante no encontrado." }));
    }

    const R = restData.records[0].fields;
    const dia = diaSemanaES(fecha);
    const horario_reservas = safeJSON(R.horario_reservas, {});
    console.log("🕓 Horario reservas:", horario_reservas);

    // === 2️⃣ Obtener mesas ===
    const mesasResp = await fetch(
  `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/MESAS?filterByFormula=${encodeURIComponent(`{restaurante}='${R.nombre}'`)}`
      { headers: { Authorization: `Bearer ${process.env.AIRTABLE_API_KEY}` } }
    );
    const mesasData = await mesasResp.json();
    console.log("🪑 Mesas encontradas:", mesasData.records?.length || 0);
    mesasData.records?.forEach((m, i) => {
      console.log(`→ Mesa ${i + 1}:`, m.fields.nombre_mesa, "| Capacidad:", m.fields.capacidad, "| Estado:", m.fields.estado, "| Restaurante:", m.fields.restaurante);
    });

    // === 3️⃣ Seleccionar mesa libre ===
    const mesaLibre = mesasData.records.find(
      (m) => Number(m.fields.capacidad) >= Number(personas) && m.fields.estado?.toLowerCase() === "libre"
    );

    if (!mesaLibre) {
      console.log("❌ No se encontró mesa libre para", personas, "personas");
      res.setHeader("Content-Type", "application/json");
      return res.end(JSON.stringify({ reply: `No hay mesas disponibles para ${personas} personas.` }));
    }

    console.log("✅ Mesa libre encontrada:", mesaLibre.fields.nombre_mesa);

    // === 4️⃣ Crear reserva ===
    const idReserva = generarIdReserva(R.nombre, fecha);
    console.log("🪪 Creando reserva:", idReserva);

    await fetch(
      `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/RESERVAS`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.AIRTABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          fields: {
            id_reserva: idReserva,
            restaurante: [restData.records[0].id],
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
        }),
      }
    );

    console.log("📦 Reserva creada correctamente en Airtable.");

    // === 5️⃣ Confirmaciones ===
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

    if (telefono) {
      await enviarWhatsAppCliente({
        telefono,
        nombre,
        restaurante: R.nombre,
        fecha,
        hora,
        personas,
        idReserva,
      });
    }

    res.setHeader("Content-Type", "application/json");
    return res.end(JSON.stringify({
      reply: `✅ Reserva confirmada en ${R.nombre} para ${personas} personas el ${fecha} a las ${hora}.
🪑 Mesa: ${mesaLibre.fields.nombre_mesa}
🪪 ID: ${idReserva}`
    }));

  } catch (err) {
    console.error("💥 ERROR GENERAL:", err);
    res.statusCode = 500;
    res.end(JSON.stringify({ reply: "Error interno del servidor." }));
  }
};
