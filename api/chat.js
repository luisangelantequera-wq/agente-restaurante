export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ reply: "Método no permitido" });
  }

  try {
    const body = req.body;
    const userMessage = body.message || "Hola";
    const history = Array.isArray(body.history) ? body.history : [];

    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
        "Referer": "https://tu-proyecto.vercel.app",
        "X-Title": "Agente Restaurante IA"
      },
      body: JSON.stringify({
        model: "openai/gpt-3.5-turbo",
        messages: [
          ...history,
          { role: "user", content: userMessage }
        ]
      }),
    });

    const data = await response.json();

    let reply = "No se recibió respuesta del modelo.";
    if (data?.choices?.[0]?.message?.content) {
      reply = data.choices[0].message.content;
    } else if (data?.error?.message) {
      reply = `Error del modelo: ${data.error.message}`;
    }

    return res.status(200).json({ reply });
  } catch (error) {
    console.error("Error en /api/chat:", error);
    return res.status(500).json({ reply: "Error en servidor: " + error.message });
  }
}
