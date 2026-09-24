const test = require("node:test");
const assert = require("node:assert/strict");
const { crearAlmacenRetenciones, desdeEntorno, LEER, CAS } = require("../lib/retenciones-mesas");

// Emula solo GET/TIME y compare-and-set del servidor, no las decisiones de
// negocio. Estas se ejecutan en el módulo real con instancias independientes.
function servidor() {
  const documentos = new Map();
  let reloj = Date.parse("2026-09-24T10:00:00Z");
  let fallo = false;
  const ejecutar = async ([cmd, script, n, clave, previo, nuevo, limite]) => {
    if (fallo) throw new Error("red interrumpida");
    assert.equal(cmd, "EVAL"); assert.equal(n, 1);
    if (script === LEER) return [documentos.get(clave) || "", Math.floor(reloj / 1000), (reloj % 1000) * 1000];
    assert.equal(script, CAS);
    if (reloj >= limite || (documentos.get(clave) || "") !== previo) return 0;
    documentos.set(clave, nuevo); return 1;
  };
  return { instancia: () => crearAlmacenRetenciones({ ejecutar }),
    avanzar: ms => { reloj += ms; }, fallar: () => { fallo = true; }, documentos };
}
const datos = { fecha: "2026-10-01", hora: "14:00", duracion: 90, personas: 4, zona: "terraza" };
const mesa = [{ ids: ["mesa1"], nombre: "Terraza" }];

test("dos servidores: solo uno retiene la última mesa", async () => {
  const s = servidor();
  const resultados = await Promise.all([s.instancia().adquirir("sol", datos, mesa), s.instancia().adquirir("sol", datos, mesa)]);
  assert.equal(resultados.filter(Boolean).length, 1);
});

test("elige otra mesa cuando la primera está retenida", async () => {
  const a = servidor().instancia();
  await a.adquirir("sol", datos, mesa);
  assert.deepEqual((await a.adquirir("sol", datos, [...mesa, { ids: ["mesa2"] }])).asignacion.ids, ["mesa2"]);
});

test("combinaciones completas, intervalos solapados y frontera exacta", async () => {
  const a = servidor().instancia();
  await a.adquirir("sol", datos, [{ ids: ["mesa1", "mesa2"] }]);
  assert.equal(await a.adquirir("sol", { ...datos, hora: "15:00" }, [{ ids: ["mesa2"] }]), null);
  assert.ok(await a.adquirir("sol", { ...datos, hora: "15:30" }, mesa));
  assert.ok(await a.adquirir("luna", datos, mesa));
});

test("solapamiento al cruzar medianoche", async () => {
  const a = servidor().instancia();
  await a.adquirir("sol", { ...datos, hora: "23:30" }, mesa);
  assert.equal(await a.adquirir("sol", { ...datos, fecha: "2026-10-02", hora: "00:15" }, mesa), null);
});

test("caduca tras tres minutos y no se puede confirmar tarde", async () => {
  const s = servidor(), a = s.instancia();
  const r = await a.adquirir("sol", datos, mesa);
  s.avanzar(180000);
  await assert.rejects(a.iniciar("sol", r.token, datos), { codigo: "caducada" });
  assert.ok(await a.adquirir("sol", datos, mesa));
});

test("la petición no puede cambiar fecha, personas o zona de una retención", async () => {
  const a = servidor().instancia(), r = await a.adquirir("sol", datos, mesa);
  for (const cambio of [{ hora: "15:00" }, { personas: 2 }, { zona: "interior" }]) {
    await assert.rejects(a.iniciar("sol", r.token, { ...datos, ...cambio }), { codigo: "caducada" });
  }
  await assert.rejects(a.iniciar("luna", r.token, datos), { codigo: "caducada" });
});

test("doble confirmación: solo una instancia puede iniciar la escritura", async () => {
  const s = servidor(), a = s.instancia(), r = await a.adquirir("sol", datos, mesa);
  const resultados = await Promise.allSettled([a.iniciar("sol", r.token, datos), s.instancia().iniciar("sol", r.token, datos)]);
  assert.equal(resultados.filter(r => r.status === "fulfilled").length, 1);
  assert.equal(resultados.find(r => r.status === "rejected").reason.codigo, "en_curso");
});

test("un guardado incierto no caduca ni puede liberarlo el navegador", async () => {
  const s = servidor(), a = s.instancia(), r = await a.adquirir("sol", datos, mesa);
  await a.iniciar("sol", r.token, datos);
  s.avanzar(3600000);
  assert.equal(await a.liberar("sol", r.token), false);
  assert.equal(await a.adquirir("sol", datos, mesa), null);
});

test("confirmada sigue bloqueando aunque Airtable aún no aparezca en una lectura", async () => {
  const s = servidor(), a = s.instancia(), r = await a.adquirir("sol", datos, mesa);
  await a.iniciar("sol", r.token, datos);
  await a.finalizar("sol", r.token, "recReserva");
  await a.finalizar("sol", r.token, "recReserva");
  s.avanzar(180001);
  assert.equal(await a.adquirir("sol", datos, mesa), null);
  assert.equal(await a.descartar("sol", r.token), false);
  await assert.rejects(a.finalizar("sol", r.token, "recOtra"), { codigo: "estado" });
});

test("abandono libera únicamente su propia oferta", async () => {
  const a = servidor().instancia(), r = await a.adquirir("sol", datos, mesa);
  assert.equal(await a.liberar("sol", "a".repeat(48)), false);
  assert.equal(await a.liberar("luna", r.token), false);
  assert.equal(await a.adquirir("sol", datos, mesa), null);
  assert.equal(await a.liberar("sol", r.token), true);
  assert.ok(await a.adquirir("sol", datos, mesa));
});

test("modificación conserva bloqueo anterior hasta finalizar y después lo sustituye", async () => {
  const a = servidor().instancia(), r = await a.adquirir("sol", datos, mesa);
  await a.iniciar("sol", r.token, datos); await a.finalizar("sol", r.token, "recReserva");
  const nuevos = { ...datos, hora: "17:00" };
  const cambio = await a.adquirir("sol", nuevos, mesa, { registro: "recReserva" });
  await a.iniciar("sol", cambio.token, nuevos);
  assert.equal(await a.adquirir("sol", datos, mesa), null);
  await a.finalizar("sol", cambio.token, "recReserva");
  assert.ok(await a.adquirir("sol", datos, mesa));
  assert.equal(await a.adquirir("sol", nuevos, mesa), null);
});

test("no almacena el token en claro ni datos personales", async () => {
  const s = servidor(), a = s.instancia();
  const r = await a.adquirir("sol", { ...datos, nombre: "PRIVADO", email: "PRIVADO" }, mesa);
  const persistido = [...s.documentos.values()].join("");
  assert.ok(!persistido.includes(r.token)); assert.ok(!persistido.includes("PRIVADO"));
});

test("errores de Redis nunca se convierten en disponibilidad", async () => {
  const s = servidor(), a = s.instancia(); s.fallar();
  await assert.rejects(a.adquirir("sol", datos, mesa));
});

test("integración desactivada por defecto y prohibida fuera de Preview", () => {
  assert.equal(desdeEntorno({}), null);
  assert.throws(() => desdeEntorno({ CONTACTIA_RETENCIONES: "1", VERCEL_ENV: "production" }), { codigo: "configuracion" });
  assert.throws(() => desdeEntorno({ CONTACTIA_RETENCIONES: "1", VERCEL_ENV: "preview" }), { codigo: "configuracion" });
});

test("adaptador REST usa token de escritura y oculta errores del proveedor", async () => {
  let llamada;
  const a = desdeEntorno({ CONTACTIA_RETENCIONES: "1", VERCEL_ENV: "preview", KV_REST_API_URL: "https://prueba.upstash.io", KV_REST_API_TOKEN: "secreto" }, async (url, opciones) => {
    llamada = { url, opciones }; return { ok: false };
  });
  await assert.rejects(a.adquirir("sol", datos, mesa), error => error.codigo === "servicio" && !error.message.includes("secreto"));
  assert.equal(llamada.opciones.headers.Authorization, "Bearer secreto");
  assert.equal(llamada.opciones.redirect, "error");
});
