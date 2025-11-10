// === CHAT.JS — Contactia ===
// 06/11/2025 21:15H
// Sistema de reservas completo con Airtable + Gmail (nodemailer)
// Incluye asignación automática de mesa y correo de confirmación HTML

import nodemailer from "nodemailer";

// ───────────────────────────────────────────────────────────────────────────────
// UTILIDADES
// ───────────────────────────────────────────────────────────────────────────────
// Requisitos:
//  - Añade en Vercel (Settings → Environment Variables):
//    AIRTABLE_API_KEY, AIRTABLE_BASE_ID
//    GMAIL_USER (tu Gmail), GMAIL_PASS (App Password 16 chars)
//    FROM_EMAIL (reservas@contactia.net), FROM_NAME (Contactia)
//  - Instala nodemailer: npm install nodemailer
//  - Tablas Airtable: "Restaurantes" y "Reservas"
// ───────────────────────────────────────────────────────────────────────────────
// ───────────────────────────────────────────────────────────────────────────────

// Día de la semana (lunes, martes...)
function diaSemanaES(fechaISO) {
  const d = new Date(fechaISO);
  return d.toLocaleDateString("es-ES", { weekday: "long" }).toLowerCase();
}

// Verifica si una hora (HH:MM) cae dentro de rangos tipo ["13:30-15:30"]
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

// Genera intervalos de 15 min dentro de un rango horario
function generarIntervalos(rangos, pasoMin = 15) {
  const toMin = (hhmm) => {
    const [h, m] = hhmm.split(":").map(Number);
    return h * 60 + m;
  };
  const toHHMM = (mins) => {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  };

  const slots = [];
  for (const rango of (rangos || [])) {
    const [ini, fin] = rango.split("-").map((s) => s.trim());
    let cur = toMin(ini);
    const end = toMin(fin);
    while (cur <= end) {
      slots.push(toHHMM(cur));
      cur += pasoMin;
    }
  }
  return slots;
}

// ID de reserva legible: PREFIJO-YYYYMMDD-#### 
function generarIdReserva(nombreRest, fechaISO) {
  const pref = (nombreRest || "RES").replace(/[^A-Za-z0-9]/g, "").slice(0, 3).toUpperCase();
  const yyyymmdd = fechaISO.replaceAll("-", "");
  const suf = Math.floor(Math.random() * 9000 + 1000);
  return `${pref}-${yyyymmdd}-${suf}`;
}

// Seguridad al parsear JSON guardado en Airtable
function safeJSON(value, fallback) {
  if (value == null) return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

// ───────────────────────────────────────────────────────────────────────────────
// 5️⃣ Enviar correo de confirmación
// ───────────────────────────────────────────────────────────────────────────────
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
          <img src="https://upload.wikimedia.org/wikipedia/commons/thumb/4/45/Aiga_restaurant_inv.svg/1024px-Aiga_restaurant_inv.svg.png" alt="Logo" width="70" style="margin-bottom:10px;">
          <h1 style="color:#fff;margin:0;font-size:22px;">${restaurante}</h1>
          ${direccion ? `<div style="color:#ffeede;font-size:12px;margin-top:6px;">${direccion}</div>` : ``}
        </td>
      </tr>
      <tr>
        <td style="padding:28px;">
          <p style="font-size:16px;color:#333;">Hola <strong>${nombre}</strong>,</p>
          <p style="font-size:16px;color:#333;line-height:1.5;">Tu reserva ha sido <strong>confirmada</strong>.</p>
          <table style="width:100%;margin-top:18px;border-collapse:collapse;">
            <tr><td style="padding:8px 0;"><strong>🗓 Fecha:</strong></td><td>${fecha}</td></tr>
            <tr><td style="padding:8px 0;"><strong>🕒 Hora:</strong></td><td>${hora}</td></tr>
            <tr><td style="padding:8px 0;"><strong>👥 Personas:</strong></td><td>${personas}</td></tr>
            <tr><td style="padding:8px 0;"><strong>🔢 ID de reserva:</strong></td><td>${idReserva}</td></tr>
          </table>
          <div style="margin-top:26px;text-align:center;">
            <a href="https://contactia.net" style="background-color:#d35400;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;font-size:15px;">
              Ver mi reserva
            </a>
          </div>
          <p style="font-size:14px;color:#555;margin-top:22px;line-height:1.5;">
            Para modificar o cancelar, responde a este correo indicando tu <strong>ID de reserva</strong>.
          </p>
        </td>
      </tr>
    </table>
  </div>
  `;

  await transporter.sendMail({
    from: `"${process.env.FROM_NAME}" <${process.env.FROM_EMAIL}>`,
    to: email,
    subject: `🍷 Confirmación de tu reserva en ${restaurante}`,
    html,
  });
}

// ───────────────────────────────────────────────────────────────────────────────
// HANDLER PRINCIPAL (reservas)
// Espera body con: restaurante_id, fecha(YYYY-MM-DD), hora(HH:MM), personas, nombre, email, (opcional: mensaje)
// ───────────────────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== "POST")
    return res.status(405).json({ reply: "Método no permitido" });

  try {

// === 1️⃣ Detección de acción "verificar" (comprobación de disponibilidad) ===

if (req.body.accion === "verificar") {
  const { restaurante_id, fecha, hora, personas } = req.body;

  try {
    // Buscar mesas
    const mesasURL = `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/Mesas?filterByFormula=${encodeURIComponent(`{restaurante_id}='${restaurante_id}'`)}`;
    const mesasResp = await fetch(mesasURL, {
      headers: { Authorization: `Bearer ${process.env.AIRTABLE_API_KEY}` }
    });
    const mesasData = await mesasResp.json();
    const mesas = mesasData.records || [];

    // Buscar reservas
    const reservasURL = `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/Reservas?filterByFormula=${encodeURIComponent(`AND({fecha}='${fecha}', {hora}='${hora}', {estado}='confirmada')`)}`;
    const reservasResp = await fetch(reservasURL, {
      headers: { Authorization: `Bearer ${process.env.AIRTABLE_API_KEY}` }
    });
    const reservasData = await reservasResp.json();
    const reservas = reservasData.records || [];

    // Filtrar mesas ocupadas
    const mesasOcupadas = reservas.map(r => r.fields.mesa?.[0]).filter(Boolean);

    // Encontrar una mesa libre
    const mesaLibre = mesas.find(m =>
      !mesasOcupadas.includes(m.id) &&
      m.fields.capacidad >= personas
    );

    // ✅ Respuesta clara al frontend
    if (mesaLibre) {
      return res.status(200).json({ disponible: true });
    } else {
      return res.status(200).json({ disponible: false });
    }

  } catch (error) {
    console.error("Error al verificar disponibilidad:", error);
    return res.status(500).json({ disponible: false, error: "Error interno" });
  }
}




// 5️⃣½ Enviar confirmación WhatsApp al cliente (Twilio)
import twilio from "twilio";
const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

async function enviarWhatsAppCliente({ telefono, nombre, restaurante, fecha, hora, personas, idReserva }) {
  try {
    const mensaje = `🍽 *${restaurante}*\n\n✅ *Tu reserva está confirmada*\n📅 ${fecha} - ${hora}\n👥 ${personas} personas\n🧍 ${nombre}\n🪪 ID: ${idReserva}\n\nSi necesitas modificar o cancelar, responde a este mensaje.`;
    
    await client.messages.create({
      from: process.env.TWILIO_WHATSAPP_FROM,
      to: `whatsapp:${telefono}`, // formato internacional, ej: +34600123456
      body: mensaje
    });

    console.log("✅ WhatsApp enviado al cliente:", telefono);
  } catch (err) {
    console.error("❌ Error al enviar WhatsApp:", err);
  }
}




if (telefonoCliente) {
  await enviarWhatsAppCliente({
    telefono: telefonoCliente,
    nombre,
    restaurante: R.nombre,
    fecha,
    hora,
    personas,
    idReserva
  });
}




    // 1️⃣ Cargar datos del restaurante
    const restResp = await fetch(
      `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/Restaurantes?filterByFormula=${encodeURIComponent(`{id}=${Number(restaurante_id)}`)}`,
      { headers: { Authorization: `Bearer ${process.env.AIRTABLE_API_KEY}` } }
    );
    const restData = await restResp.json();
    if (!restData.records?.length)
      return res.json({ reply: "Restaurante no encontrado." });

    const R = restData.records[0].fields;
    const horario_reservas = safeJSON(R.horario_reservas, {});
    const dias_cierre = safeJSON(R.dias_cierre, []);
    const cierres_especiales = safeJSON(R.cierres_especiales, []);
  const intervalo = Number(R.intervalo_minutos || 15);
  const dia = diaSemanaES(fecha);

    // 2️⃣ Validar día y hora
    if (dias_cierre.includes(dia))
      return res.json({ reply: `El restaurante cierra los ${dia}s.` });
    if (cierres_especiales.includes(fecha))
      return res.json({ reply: `El restaurante estará cerrado el ${fecha}.` });
    const rangosDia = horario_reservas[dia];
    if (!horaEnRangos(hora, rangosDia))
      return res.json({ reply: `Hora fuera del horario del ${dia}.` });

    // 2️⃣½ Asignar mesa automáticamente
    const mesasResp = await fetch(
      `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/Mesas?filterByFormula=${encodeURIComponent(`{Restaurante}='${R.nombre}'`)}`,
      { headers: { Authorization: `Bearer ${process.env.AIRTABLE_API_KEY}` } }
    );
    const mesasData = await mesasResp.json();
    const mesaLibre = mesasData.records.find(
      (m) => Number(m.fields.capacidad) >= Number(personas) && m.fields.estado?.toLowerCase() === "libre"
    );
    if (!mesaLibre)
      return res.json({ reply: `No hay mesas disponibles para ${personas} personas.` });

    // Marcar mesa como reservada
    await fetch(
      `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/Mesas/${mesaLibre.id}`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${process.env.AIRTABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ fields: { estado: "reservada" } }),
      }
    );

    // 3️⃣ Generar ID
    const idReserva = generarIdReserva(R.nombre, fecha);

    // 4️⃣ Registrar reserva
    const nuevaReserva = {
      fields: {
        id_reserva: idReserva,
        restaurante: [restData.records[0].id],
        mesa: [mesaLibre.id],
        fecha,
        hora,
        personas: Number(personas),
        nombre_completo: nombre,
        email,
    telefono, // 📱 nuevo campo
        mensaje,
        estado: "confirmada",
      },
    };
    await fetch(
      `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/Reservas`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.AIRTABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(nuevaReserva),
      }
    );

    // 5️⃣ Correo
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

// Enviar WhatsApp de confirmación si hay teléfono
if (telefono) {
  await enviarWhatsAppCliente({
    telefono,
    nombre,
    restaurante: R.nombre,
    fecha,
    hora,
    personas,
    idReserva
  });
}

✅ Con esto:
El teléfono llega desde el front
Se guarda en Airtable
Se usa para enviar el WhatsApp
Todo el flujo queda automatizado


    // 6️⃣ Respuesta
    return res.status(200).json({
      reply: `✅ Reserva confirmada en ${R.nombre} para ${personas} personas el ${fecha} a las ${hora}.
🪑 Mesa: ${mesaLibre.fields.nombre}
🪪 ID: ${idReserva}
📧 Correo de confirmación enviado a ${email}.`,
    });
  } catch (err) {
    console.error("Error:", err);
    return res.status(500).json({ reply: "Error interno del servidor." });
  }
}
