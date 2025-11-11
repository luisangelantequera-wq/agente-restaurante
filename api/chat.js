// === CHAT.JS — Contactia (versión CommonJS para Vercel) ===
// Sistema de reservas con Airtable + Gmail (nodemailer) + Twilio (WhatsApp)
// Compatible con entorno Node.js (sin "type": "module")

const nodemailer = require("nodemailer");
const twilio = require("twilio");
const fetch = (...args) => import("node-fetch").then(({ default: fetch }) => fetch(...args));

// ────────────────────────────────────────────────────────────────
// UTILIDADES
// ────────────────────────────────────────────────────────────────
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

// ────────────────────────────────────────────────────────────────
// EMAIL
// ────────────────────────────────────────────────────────────────
async function enviarCorreoConfirmacion({ email, nombre, fecha, hora, personas, idReserva, restaurante, direccion }) {
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_PASS,
    },
  });

  const html = `
  <div style="background-color:#fafafa;padding:40px 0;font-family:Arial,sans-serif;">
    <table style="max-width:600px;margin:auto;background-color:#fff;border-radius:12px;box-shadow:0 2px 8px rgba(0,0,0,0.05);">
      <tr>
        <td style="text-align:center;padding:20px 0;background-color:#d35400;border-top-left-radius:12px;border-top-right-radius:12px;">
          <h1 style="color:#fff;margin:0;font-size:22px;">${restaurante}</h1>
          ${direccion ? `<div style="color:#ffeede;font-size:12px;margin-top:6px;">${direccion}</div>` : ``}
        </td>
      </tr>
      <tr>
        <td style="padding:28px;">
          <p style="font-size:16px;color:#333;">Hola <strong>${nombre}</strong>, tu reserva ha sido <strong>confirmada</strong>.</p>
          <p>📅 ${fecha} – ${hora}</p>
          <p>👥 ${personas} personas</p>
          <p>🪪 ID de reserva: <strong>${idReserva}</strong></p>
          <p>¡Gracias por reservar con Contactia!</p>
        </td>
      </tr>
    </table>
  </div>`;

  await transporter.sendMail({
    from: `"${process.env.FROM_NAME}" <${process.env.FROM_EMAIL}>`,
    to: email,
    subject: `🍷 Confirmación de tu reserva en ${restaurante}`,
    html,
  });
}

// ────────────────────────────────────────────────────────────────
// WHATSAPP
// ────────────────────────────────────────────────────────────────
const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

async function enviarWhatsAppCliente({ telefono, nombre, restaurante, fecha, hora, personas, idReserva }) {
  try {
    const mensaje = `🍽 *${restaurante}*\n\n✅ *Tu reserva está confirmada*\n📅 ${fecha} - ${hora}\n👥 ${personas} personas\n🧍 ${nombre}\n🪪 ID: ${idReserva}\n\nSi necesitas modificar o cancelar, responde a este mensaje.`;

    await client.messages.create({
      from: process.env.TWILIO_WHATSAPP_FROM,
      to: `whatsapp:${telefono}`,
      body: mensaje,
    });
  } catch (err) {
    console.error("❌ Error al enviar WhatsApp:", err);
  }
}

// ────────────────────────────────────────────────────────────────
// HANDLER PRINCIPAL
// ────────────────────────────────────────────────────────────────
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

    const { restaurante_id, fecha, hora, personas, nombre, email, telefono, mensaje = "", accion } = req.body;

    // === 1️⃣ Verificar disponibilidad ===
    if (accion === "verificar") {
      const mesasURL = `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/Mesas?filterByFormula=${encodeURIComponent(`{restaurante_id}='${restaurante_id}'`)}`;
      const mesasResp = await fetch(mesasURL, { headers: { Authorization: `Bearer ${process.env.AIRTABLE_API_KEY}` } });
      const mesasData = await mesasResp.json();
      const mesas = mesasData.records || [];

      const reservasURL = `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/Reservas?filterByFormula=${encodeURIComponent(`AND({fecha}='${fecha}', {hora}='${hora}', {estado}='confirmada')`)}`;
      const reservasResp = await fetch(reservasURL, { headers: { Authorization: `Bearer ${process.env.AIRTABLE_API_KEY}` } });
      const reservasData = await reservasResp.json();
      const reservas = reservasData.records || [];

      const mesasOcupadas = reservas.map(r => r.fields.mesa?.[0]).filter(Boolean);
      const mesaLibre = mesas.find(m => !mesasOcupadas.includes(m.id) && m.fields.capacidad >= personas);

      res.setHeader("Content-Type", "application/json");
      return res.end(JSON.stringify({ disponible: !!mesaLibre }));
    }

    // === 2️⃣ Obtener restaurante ===
    const restResp = await fetch(
      `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/Restaurantes?filterByFormula=${encodeURIComponent(`{id}=${Number(restaurante_id)}`)}`,
      { headers: { Authorization: `Bearer ${process.env.AIRTABLE_API_KEY}` } }
    );
    const restData = await restResp.json();
    if (!restData.records?.length) {
      res.statusCode = 404;
      return res.end(JSON.stringify({ reply: "Restaurante no encontrado." }));
    }

    const R = restData.records[0].fields;

    // === 3️⃣ Validar horario ===
    const dia = diaSemanaES(fecha);
    const horario_reservas = safeJSON(R.horario_reservas, {});
    const dias_cierre = safeJSON(R.dias_cierre, []);
    const cierres_especiales = safeJSON(R.cierres_especiales, []);

    if (dias_cierre.includes(dia)) return res.end(JSON.stringify({ reply: `El restaurante cierra los ${dia}s.` }));
    if (cierres_especiales.includes(fecha)) return res.end(JSON.stringify({ reply: `El restaurante estará cerrado el ${fecha}.` }));
    if (!horaEnRangos(hora, horario_reservas[dia])) return res.end(JSON.stringify({ reply: `Hora fuera del horario del ${dia}.` }));

    // === 4️⃣ Buscar mesa libre ===
    const mesasResp = await fetch(
      `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/Mesas?filterByFormula=${encodeURIComponent(`{Restaurante}='${R.nombre}'`)}`,
      { headers: { Authorization: `Bearer ${process.env.AIRTABLE_API_KEY}` } }
    );
    const mesasData = await mesasResp.json();
    const mesaLibre = mesasData.records.find(
      (m) => Number(m.fields.capacidad) >= Number(personas) && m.fields.estado?.toLowerCase() === "libre"
    );
    if (!mesaLibre) return res.end(JSON.stringify({ reply: `No hay mesas disponibles para ${personas} personas.` }));

    // === 5️⃣ Crear reserva ===
    const idReserva = generarIdReserva(R.nombre, fecha);
    await fetch(
      `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/Reservas`,
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

    // === 6️⃣ Confirmaciones ===
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
🪑 Mesa: ${mesaLibre.fields.nombre}
🪪 ID: ${idReserva}
📧 Correo de confirmación enviado a ${email}.`
    }));
  } catch (err) {
    console.error("❌ Error general:", err);
    res.statusCode = 500;
    res.end(JSON.stringify({ reply: "Error interno del servidor." }));
  }
};
