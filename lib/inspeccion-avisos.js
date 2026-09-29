"use strict";
const { campos } = require("./avisos-programados");
const { proximaRevision } = require("./cola-avisos");
async function inspeccionar({ cola, leer, ahora = Date.now() }) {
  const trabajos = await cola.vencidos();
  if (!trabajos.length) return { modo: "solo_lectura", vencidos: 0, vigentes: 0, desactualizados: 0, consultas_airtable: 0 };
  const registros = await leer("RESERVAS", campos,
    `OR(${trabajos.map(t => `RECORD_ID()='${t.id}'`).join(",")})`);
  const hoy = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid" }).format(new Date(ahora));
  const vigentes = trabajos.filter(t => {
    const f = registros.find(r => r.id === t.id)?.fields;
    if (f?.estado !== "confirmada" || f.anonimizada || f.fecha < hoy) return false;
    try { const siguiente = proximaRevision(JSON.parse(f.aviso_cliente_detalle || "{}"), ahora);
      return siguiente != null && siguiente <= ahora; }
    catch { return false; }
  }).length;
  return { modo: "solo_lectura", vencidos: trabajos.length, vigentes,
    desactualizados: trabajos.length - vigentes, consultas_airtable: 1 };
}
module.exports = { inspeccionar };
