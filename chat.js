// === PRUEBA BÁSICA CONTACTIA ===
// (solo para verificar CommonJS en Vercel)

module.exports = async (req, res) => {
  try {
    // Forzamos tipo de respuesta JSON
    res.setHeader("Content-Type", "application/json");

    if (req.method !== "POST") {
      res.statusCode = 405;
      return res.end(JSON.stringify({ ok: false, error: "Método no permitido" }));
    }

    // Procesar el body
    let body = "";
    req.on("data", chunk => (body += chunk.toString()));
    await new Promise(resolve => req.on("end", resolve));

    const data = JSON.parse(body || "{}");
    const name = data.name || "usuario desconocido";

    console.log("📩 Petición recibida:", data);

    // Respuesta básica
    res.statusCode = 200;
    return res.end(JSON.stringify({
      ok: true,
      message: `Hola ${name}, el endpoint /api/chat funciona correctamente 🚀`
    }));

  } catch (err) {
    console.error("❌ Error general:", err);
    res.statusCode = 500;
    res.end(JSON.stringify({ ok: false, error: err.message }));
  }
};
