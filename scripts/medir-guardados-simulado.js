"use strict";
// Coste de persistencia del historial con datos ficticios: cero peticiones de red.
const { crearGestor } = require("../lib/guardado-conversaciones");

async function contarGuardados({ incidencia = false, soloSaludo = false } = {}) {
  const turnos = soloSaludo ? [{ actor: "asistente", texto: "Bienvenido" }] :
    [{ actor: "cliente", texto: "Una reserva para dos, por favor" }];
  const envios = [];
  const gestor = crearGestor({
    preparar: estado => ({
      estado, turnos: turnos.map(t => ({ ...t })),
      numero_turnos: turnos.length, requiere_revision: incidencia
    }),
    enviar: async registro => {
      envios.push({ estado: registro.estado, requiere_revision: registro.requiere_revision });
      return { ok: true, status: 200 };
    },
    programarTemporizador: () => 1,
    cancelarTemporizador: () => {}
  });
  gestor.habilitar();
  gestor.programar();
  // Al registrar la primera incidencia, el módulo solicita guardar antes
  // del cierre. Vaciar microtareas para completar la escritura simulada.
  for (let i = 0; i < 6; i++) await Promise.resolve();
  await gestor.cerrar("cerrada");
  await gestor.cerrar("cerrada");
  return {
    tipo: soloSaludo ? "solo_saludo" : incidencia ? "con_incidencia" : "normal",
    escrituras_patch_simuladas: envios.length,
    estados: envios.map(e => e.estado)
  };
}

if (require.main === module) {
  (async () => {
    const escenarios = await Promise.all([
      contarGuardados(),
      contarGuardados({ incidencia: true }),
      contarGuardados({ soloSaludo: true })
    ]);
    process.stdout.write(JSON.stringify({
      origen: "simulacion_sin_red",
      escenarios
    }, null, 2) + "\n");
  })().catch(e => { console.error(e.message); process.exitCode = 1; });
}

module.exports = { contarGuardados };
