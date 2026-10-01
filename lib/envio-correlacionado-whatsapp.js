"use strict";
const { huellaReserva, crearLector } = require('./reserva-resultado-whatsapp');
const { prepararContacto } = require('./contacto-alternativo');
const { preparar } = require('./confirmacion-whatsapp');
const { prepararPeticion, enviarPreparado } = require('./proveedor-confirmacion-whatsapp');
const { crearControl } = require('./control-envio-whatsapp');
const { crearDestino } = require('./destino-contacto-whatsapp');
const { crearSeguimiento } = require('./seguimiento-whatsapp');
const { desdeEntorno: colaDesdeEntorno } = require('./cola-avisos');
const BANDERAS = ['CONTACTIA_WHATSAPP_CONFIRMACION_HABILITADA', 'CONTACTIA_WHATSAPP_LECTURA_RESERVA_HABILITADA',
  'CONTACTIA_WHATSAPP_CONTACTO_REDIS_HABILITADO', 'CONTACTIA_WHATSAPP_CALLBACK_HABILITADO',
  'CONTACTIA_WHATSAPP_ENVIO_CORRELACIONADO_HABILITADO'];
const habilitado = env => env.VERCEL_ENV === 'preview' && BANDERAS.every(k => env[k] === '1');
const vigente = (r, id, huella) => r?.id === id && r.estado === 'confirmada' && r.whatsapp_autorizado === true && r.huella === huella;
const elegible = (r, id, huella) => vigente(r, id, huella) && r.whatsapp_contacto_pendiente === true;
function fechaFutura(f, ahora) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    hourCycle: 'h23' }).formatToParts(new Date(ahora)).map(x => [x.type, x.value]));
  return `${f.fecha} ${f.hora}` > `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}
function crearEmisor({ control, destino, almacen, leerReserva, enviar = enviarPreparado,
  entorno = () => process.env, ahora = () => Date.now() }) {
  if (typeof control?.reclamar !== 'function' || typeof control?.leer !== 'function' ||
      typeof control?.guardarResultado !== 'function' || typeof destino?.registrar !== 'function' ||
      typeof destino?.leer !== 'function' || typeof almacen?.registrar !== 'function' ||
      typeof almacen?.leer !== 'function' || typeof leerReserva !== 'function' || typeof enviar !== 'function')
    throw Error('Emisor no configurado');
  async function correlacionar(sid, reservaId, huella) {
    const r = await almacen.registrar({ sid, reservaId, huella });
    if (r.creado) return true;
    const existente = await almacen.leer(sid);
    return existente?.sid === sid && existente.reserva_id === reservaId && existente.huella === huella;
  }
  return {
    async enviar({ registro, restaurante }) {
      const env = entorno();
      const bloquear = motivo => ({ estado: 'bloqueado', motivo });
      if (!habilitado(env)) return bloquear('canal_desactivado');
      let intento;
      try {
        const huella = huellaReserva(registro, env), f = registro?.fields;
        if (!huella || restaurante?.id !== f.restaurante[0]) return bloquear('reserva_no_elegible');
        if (!fechaFutura(f, ahora())) return bloquear('reserva_pasada');
        const detalle = prepararContacto(JSON.parse(f.aviso_cliente_detalle));
        const borrador = preparar({ reserva: { estado: f.estado, restaurante: restaurante.nombre,
          fecha: f.fecha, hora: f.hora, personas: f.personas, zona: detalle.zona, localizador: f.id_reserva }, aviso: detalle });
        const peticion = prepararPeticion({ borrador, telefonoCliente: f.telefono, env });
        if (!peticion.listo) return bloquear(peticion.motivo);
        if (!elegible(await leerReserva(registro.id), registro.id, huella)) return bloquear('reserva_no_vigente');
        // El registro operativo se inicializa antes de llamar a Twilio.
        await destino.registrar({ reservaId: registro.id, huella, detalle });
        const actual = await destino.leer(registro.id);
        if (!actual || actual.reserva_id !== registro.id || actual.huella !== huella ||
            actual.detalle.contacto.fase !== 'whatsapp_pendiente') return bloquear('contacto_no_correlacionado');
        const reclamo = await control.reclamar({ reservaId: registro.id, huella });
        if (!reclamo.creado) return bloquear('envio_ya_reclamado');
        intento = reclamo.registro;
        // Revalidación final tras adquirir el control exclusivo.
        if (!elegible(await leerReserva(registro.id), registro.id, huella) || !fechaFutura(f, ahora())) {
          await control.guardarResultado(intento, { estado: 'bloqueado' });
          return bloquear('reserva_no_vigente');
        }
        let resultado;
        try { resultado = await enviar(peticion); } catch { resultado = { estado: 'desconocido' }; }
        if (!['aceptado', 'rechazado', 'desconocido'].includes(resultado?.estado) ||
            (resultado.estado === 'aceptado' && !/^(SM|MM)[a-f0-9]{32}$/i.test(resultado.sid || '')))
          resultado = { estado: 'desconocido' };
        let persistido = false;
        try { persistido = await control.guardarResultado(intento, resultado); } catch {}
        if (resultado.estado !== 'aceptado') return { estado: resultado.estado, reintento_automatico: false,
          seguimiento_pendiente: !persistido };
        let correlacionado = false;
        try { correlacionado = await correlacionar(resultado.sid, registro.id, huella); } catch {}
        return { estado: 'aceptado', entrega_confirmada: false, correlacionado,
          seguimiento_pendiente: !persistido || !correlacionado, reintento_automatico: false };
      } catch { return { estado: 'bloqueado', motivo: 'servicio_no_disponible', reintento_automatico: false,
        revision_pendiente: Boolean(intento) }; }
    },
    async recuperar(reservaId) {
      if (!habilitado(entorno())) return { completado: false, motivo: 'canal_desactivado' };
      try {
        const intento = await control.leer(reservaId);
        if (intento?.estado !== 'aceptado') return { completado: false, motivo: 'resultado_sin_sid' };
        if (!vigente(await leerReserva(reservaId), reservaId, intento.huella))
          return { completado: false, motivo: 'reserva_no_vigente' };
        const contacto = await destino.leer(reservaId);
        if (!contacto || contacto.reserva_id !== reservaId || contacto.huella !== intento.huella)
          return { completado: false, motivo: 'contacto_no_correlacionado' };
        return { completado: await correlacionar(intento.sid, reservaId, intento.huella), mensajes_enviados: 0 };
      } catch { return { completado: false, motivo: 'servicio_no_disponible' }; }
    }
  };
}
function desdeEntorno(env = process.env, fetchImpl = global.fetch) {
  if (!habilitado(env)) throw Error('Envío correlacionado desactivado');
  const { redis, prefijo } = colaDesdeEntorno(env, fetchImpl);
  return crearEmisor({ control: crearControl({ redis, prefijo }), destino: crearDestino({ redis, prefijo }),
    almacen: crearSeguimiento({ redis, prefijo }), leerReserva: crearLector({ env, fetchImpl }),
    enviar: peticion => enviarPreparado(peticion, fetchImpl), entorno: () => env });
}
module.exports = { crearEmisor, desdeEntorno, BANDERAS };
