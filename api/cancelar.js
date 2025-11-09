// === CANCELAR.JS — Contactia ===
//
// API para cancelar reservas: actualiza Airtable, libera mesa y envía correo de confirmación


import nodemailer from "nodemailer";
// ───────────────────────────────────────────────────────────────────────────────
// UTILIDAD: Buscar registro en Airtable por filtro
// ───────────────────────────────────────────────────────────────────────────────
async function buscarEnAirtable(tabla, campo, valor) {
  const url = `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/${tabla}?filterByFormula=${encodeURIComponent(`{${campo}}='${valor}'`)}`;
  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${process.env.AIRTABLE_API_KEY}` },
  });
  const data = await resp.json();
  return data.records?.[0] || null;
}

// ───────────────────────────────────────────────────────────────────────────────
// Envío de correo de confirmación de cancelación
// ───────────────────────────────────────────────────────────────────────────────
async function enviarCorreoCancelacion({ email, nombre, fecha, hora, restaurante, idReserva }) {
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
        <td style="text-align:center;padding:20px 0;background-color:#b71c1c;border-top-left-radius:12px;border-top-right-radius:12px;">
          <img src="https://upload.wikimedia.org/wikipedia/commons/thumb/4/45/Aiga_restaurant_inv.svg/1024px-Aiga_restaurant_inv.svg.png" alt="Logo Restaurante" width="70" style="margin-bottom:10px;">
          <h1 style="color:#fff;margin:0;font-size:22px;">${restaurante}</h1>
        </td>
      </tr>
      <tr>
        <td style="padding:28px;">
          <p style="font-size:16px;color:#333;">Hola <strong>${nombre}</strong>,</p>
          <p style="font-size:16px;color:#333;line-height:1.5;">
            Tu reserva <strong>${idReserva}</strong> ha sido cancelada correctamente.
          </p>
          <table style="width:100%;margin-top:18px;border-collapse:collapse;">
            <tr><td style="padding:8px 0;"><strong>🗓 Fecha:</strong></td><td>${fecha}</td></tr>
            <tr><td style="padding:8px 0;"><strong>🕒 Hora:</strong></td><td>${hora}</td></tr>
          </table>
          <p style="font-size:14px;color:#555;margin-top:22px;line-height:1.5;">
            Esperamos verte pronto en <strong>${restaurante}</strong>. ¡Gracias por avisarnos!
          </p>
        </td>
      </tr>
    </table>
  </div>
  `;

  await transporter.sendMail({
    from: `"${process.env.FROM_NAME}" <${process.env.FROM_EMAIL}>`,
    to: email,
    subject: `❌ Cancelación de tu reserva en ${restaurante}`,
    html,
  });
}

// ───────────────────────────────────────────────────────────────────────────────
// HANDLER PRINCIPAL — Cancelar reserva
// ───────────────────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ reply: "Método no permitido" });
  }

  try {
    const { id_reserva, email } = req.body;

    if (!id_reserva || !email) {
      return res.status(400).json({ reply: "Faltan datos: id_reserva o email." });
    }

    // 1️⃣ Buscar la reserva
    const reserva = await buscarEnAirtable("Reservas", "id_reserva", id_reserva);
    if (!reserva) {
      return res.status(404).json({ reply: "No se encontró ninguna reserva con ese ID." });
    }

    const F = reserva.fields;
    const restaurante = Array.isArray(F.restaurante) ? F.restaurante[0] : null;
    const mesa = Array.isArray(F.mesa) ? F.mesa[0] : null;

    // 2️⃣ Marcar la reserva como cancelada
    await fetch(`https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/Reservas/${reserva.id}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${process.env.AIRTABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ fields: { estado: "cancelada" } }),
    });


// Enviar WhatsApp al cliente (si hay teléfono)
if (reserva.fields.telefono) {
  await enviarWhatsAppCancelacion({
    telefono: reserva.fields.telefono,
    nombre: reserva.fields.nombre_completo,
    restaurante: reserva.fields.restaurante_nombre || "Tu restaurante",
    fecha: reserva.fields.fecha,
    hora: reserva.fields.hora,
    personas: reserva.fields.personas,
    idReserva: reserva.fields.id_reserva
  });
}


    // 3️⃣ Liberar la mesa (si existía)
    if (mesa) {
      await fetch(`https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/Mesas/${mesa}`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${process.env.AIRTABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ fields: { estado: "libre" } }),
      });
    }

    // 4️⃣ Enviar correo de confirmación
    await enviarCorreoCancelacion({
      email,
      nombre: F.nombre_completo,
      fecha: F.fecha,
      hora: F.hora,
      restaurante: F.restaurante_nombre || "el restaurante",
      idReserva: id_reserva,
    });

    // 5️⃣ Responder al usuario
    return res.status(200).json({
      reply: `❌ Tu reserva ${id_reserva} ha sido cancelada correctamente. 
📧 Se ha enviado un correo de confirmación a ${email}.`,
    });
  } catch (err) {
    console.error("Error en cancelación:", err);
    return res.status(500).json({ reply: "Error interno al cancelar la reserva." });
  }
}

// === 5️⃣ Enviar confirmación por WhatsApp al cliente ===
import twilio from "twilio";
const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

async function enviarWhatsAppCancelacion({ telefono, nombre, restaurante, fecha, hora, personas, idReserva }) {
  try {
    const mensaje = `❌ *Tu reserva ha sido cancelada correctamente*\n\n🍽 *${restaurante}*\n📅 ${fecha} - ${hora}\n👥 ${personas} personas\n🧍 ${nombre}\n🪪 ID: ${idReserva}\n\nEsperamos verte pronto 👋`;

    await client.messages.create({
      from: process.env.TWILIO_WHATSAPP_FROM,
      to: `whatsapp:${telefono}`,
      body: mensaje
    });

    console.log("✅ WhatsApp de cancelación enviado:", telefono);
  } catch (err) {
    console.error("❌ Error al enviar WhatsApp de cancelación:", err);
  }
}
