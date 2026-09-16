const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const chat = require("../api/chat");


const script = fs.readFileSync(
  path.join(__dirname, "..", "script.js"),
  "utf8"
);
const api = fs.readFileSync(
  path.join(__dirname, "..", "api", "chat.js"),
  "utf8"
);


test("ofrece enviar el contacto solo cuando hace falta una organización especial", () => {
  assert.match(
    script,
    /requiere_contacto_restaurante[\s\S]{0,160}ofrecerContactoEspecial\(data\)/
  );
  assert.match(
    script,
    /¿Desea que le envíe por correo el número de teléfono y el [\s\S]{0,80}horario de reservas\?/
  );
});


test("el flujo valida el correo y solicita al servidor un mensaje de contacto", () => {
  assert.match(script, /paso === "contacto_especial_email"/);
  assert.match(script, /accion: "enviar_contacto_restaurante"/);
  assert.match(api, /"enviar_contacto_restaurante"/);
  assert.match(api, /enviarCorreoContactoRestaurante/);
  assert.match(
    script,
    /Muchas gracias por llamar y perdone las molestias\./
  );
});


test("la voz omite el prefijo español del enlace telefónico", () => {
  assert.match(script, /digitos\.startsWith\("34"\)/);
  assert.match(script, /digitos\.slice\(2\)/);
  assert.match(script, /numero\.split\(""\)\.join\(", "\)/);
});


test("envía el teléfono y el horario sin exigir datos de una reserva", async () => {
  const fetchOriginal = global.fetch;
  const apiKeyOriginal = process.env.AIRTABLE_API_KEY;
  const baseOriginal = process.env.AIRTABLE_BASE_ID;
  const resendOriginal = process.env.RESEND_API_KEY;
  let correo;

  process.env.AIRTABLE_API_KEY = "airtable-prueba";
  process.env.AIRTABLE_BASE_ID = "appPrueba";
  process.env.RESEND_API_KEY = "resend-prueba";
  global.fetch = async (url, opciones = {}) => {
    if (String(url).includes("api.airtable.com")) {
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          records: [{
            id: "recRestaurantePrueba",
            fields: {
              nombre: "Restaurante Sol",
              telefono1: "+34912345678",
              horario_reservas: JSON.stringify({
                martes: ["13:30-16:00"]
              }),
              dias_cierre: JSON.stringify(["lunes"])
            }
          }]
        })
      };
    }

    correo = JSON.parse(opciones.body);
    return { ok: true, status: 200, text: async () => "{}" };
  };

  const req = {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: {
      accion: "enviar_contacto_restaurante",
      restaurante_id: 1,
      email: "cliente@example.com"
    }
  };
  const res = {
    statusCode: 0,
    setHeader() {},
    end(cuerpo) {
      this.cuerpo = cuerpo;
    }
  };

  try {
    await chat(req, res);
    const respuesta = JSON.parse(res.cuerpo);

    assert.equal(res.statusCode, 200);
    assert.equal(respuesta.correo_enviado, true);
    assert.deepEqual(correo.to, ["cliente@example.com"]);
    assert.match(correo.text, /Teléfono: \+34912345678/);
    assert.match(correo.text, /Lunes: cerrado/);
    assert.match(correo.text, /Martes: 13:30-16:00/);
  } finally {
    global.fetch = fetchOriginal;
    for (const [nombre, valor] of [
      ["AIRTABLE_API_KEY", apiKeyOriginal],
      ["AIRTABLE_BASE_ID", baseOriginal],
      ["RESEND_API_KEY", resendOriginal]
    ]) {
      if (valor === undefined) {
        delete process.env[nombre];
      } else {
        process.env[nombre] = valor;
      }
    }
  }
});
