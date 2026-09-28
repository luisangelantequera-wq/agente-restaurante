"use strict";
const acceso = document.getElementById("acceso"), prueba = document.getElementById("prueba"), resultado = document.getElementById("resultado"), enviar = document.getElementById("enviar");
async function solicitar(datos) {
  const r = await fetch("/api/centro-conversaciones", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(datos) });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error || "No se pudo completar la solicitud.");
  return d;
}
async function configurar() {
  const d = await solicitar({ accion: "whatsapp_prueba_config" });
  acceso.hidden = true; prueba.hidden = false; enviar.disabled = !d.preparado;
  document.getElementById("config").textContent = d.preparado ? `Destino configurado: ${d.destino}` : `Faltan variables o su formato no es válido: ${d.faltan.join(", ")}. Guárdelas en Preview y vuelva a desplegar.`;
}
acceso.addEventListener("submit", async e => {
  e.preventDefault(); resultado.textContent = "Comprobando acceso…";
  try { await solicitar({ accion: "iniciar_sesion", clave: document.getElementById("clave").value }); document.getElementById("clave").value = ""; await configurar(); resultado.textContent = ""; }
  catch (e) { resultado.textContent = e.message; }
});
enviar.addEventListener("click", async () => {
  if (!window.confirm("¿Enviar ahora la plantilla de prueba al móvil configurado?")) return;
  enviar.disabled = true; resultado.textContent = "Enviando…";
  try { const d = await solicitar({ accion: "whatsapp_prueba_enviar", confirmar: true }); resultado.textContent = `${d.mensaje} Referencia: ${d.sid}`; }
  catch (e) { resultado.textContent = `${e.message} No se reintentará automáticamente.`; }
});
document.getElementById("salir").addEventListener("click", async () => {
  try { await solicitar({ accion: "cerrar_sesion" }); prueba.hidden = true; acceso.hidden = false; resultado.textContent = "Sesión cerrada."; }
  catch (e) { resultado.textContent = e.message; }
});
configurar().catch(() => {});
