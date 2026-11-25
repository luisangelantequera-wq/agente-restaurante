'use strict';
const { DIAS, validarHorario } = require('./ajustes-restaurante');
function normalizarTelefono(valor) {
  if (typeof valor !== 'string' || !/^\+?[0-9 ().-]{7,40}$/.test(valor.trim())) return '';
  const limpio = valor.trim().replace(/[ ().-]/g, '').replace(/^00/, '+');
  const completo = /^\d{9}$/.test(limpio) ? '+34' + limpio : limpio;
  return /^\+[1-9][0-9]{7,14}$/.test(completo) ? completo : '';
}

function validarHorarioTelefonico(horario) {
  if (!horario || typeof horario !== 'object' || Array.isArray(horario) ||
      Object.keys(horario).some(dia => !DIAS.includes(dia))) {
    throw new Error('Horario de atención telefónica no válido.');
  }
  const completo = Object.fromEntries(DIAS.map(dia => [dia, Object.hasOwn(horario, dia) ? horario[dia] : []]));
  const valido = validarHorario({ horario: completo, cierres: [] }).horario;
  return Object.fromEntries(Object.entries(valido).filter(([, franjas]) => franjas.length));
}

function hayAtencionTelefonica(horario, zonaHoraria, ahora = new Date()) {
  if (!zonaHoraria || !horario) return false;
  try {
    const semanal = validarHorarioTelefonico(horario);
    const partes = new Intl.DateTimeFormat('es-ES', {
      timeZone: zonaHoraria, weekday: 'long', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    }).formatToParts(ahora);
    const { weekday, hour, minute } = Object.fromEntries(partes.map(p => [p.type, p.value]));
    const hora = hour + ':' + minute;
    return (semanal[weekday] || []).some(franja => franja.slice(0, 5) <= hora && hora < franja.slice(6));
  } catch {
    return false;
  }
}

module.exports = { validarHorarioTelefonico, hayAtencionTelefonica, normalizarTelefono };
