"use strict";
const { CAMPOS, huellaReserva } = require('./reserva-resultado-whatsapp');
const { prepararContacto } = require('./contacto-alternativo');
const { preparar } = require('./confirmacion-whatsapp');
const { prepararPeticion } = require('./proveedor-confirmacion-whatsapp');
const { LECTURA } = require('./revision-envio-whatsapp');
const { desdeEntorno: conexionRedis } = require('./cola-avisos');
const { crearControl } = require('./control-envio-whatsapp');
const { crearDestino } = require('./destino-contacto-whatsapp');
const { crearSeguimiento } = require('./seguimiento-whatsapp');
const REFERENCIA = /^rec[a-zA-Z0-9]{1,29}$/;
const LOCALIZADOR = /^[A-Z0-9-]{5,80}$/;
const permitir = env => env.VERCEL_ENV === 'preview' && LECTURA.every(k => env[k] === '1');
function futura(fields, ahora) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('es-ES', {timeZone:'Europe/Madrid',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(ahora)).map(x=>[x.type,x.value]));
  return `${fields.fecha} ${fields.hora}` > `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}
function crearLectorDetalle(env, fetchImpl) {
  async function leer(tabla, formula, campos) {
    if (!env.AIRTABLE_API_KEY || !/^app[a-zA-Z0-9]+$/.test(env.AIRTABLE_BASE_ID || '')) throw Error('Lectura no configurada');
    const parametros = new URLSearchParams({filterByFormula:formula,maxRecords:'2',pageSize:'2'});
    campos.forEach(c=>parametros.append('fields[]',c));
    const r = await fetchImpl(`https://api.airtable.com/v0/${env.AIRTABLE_BASE_ID}/${tabla}?${parametros}`, {
      method:'GET',redirect:'error',signal:AbortSignal.timeout(5000),headers:{Authorization:`Bearer ${env.AIRTABLE_API_KEY}`}
    });
    if (!r.ok) throw Error('Lectura no disponible');
    const d = await r.json();
    if (!Array.isArray(d.records) || d.offset || d.records.length > 1) throw Error('Lectura ambigua');
    return d.records[0] || null;
  }
  return {
    reserva: localizador => leer('RESERVAS', `{id_reserva}='${localizador}'`, [...CAMPOS, 'aviso_cliente_estado']),
    restaurante: id => leer('RESTAURANTES', `RECORD_ID()='${id}'`, [])
  };
}
async function ejecutar(cuerpo, { env = process.env, fetchImpl = global.fetch, lector,
  revisar, emisor, conexion, ahora = () => Date.now() } = {}) {
  if (!permitir(env)) return {status:404,error:'Prueba de reservas no habilitada en este entorno.'};
  const acciones = ['whatsapp_reserva_revisar','whatsapp_reserva_enviar','whatsapp_reserva_estado','whatsapp_reserva_diagnostico'];
  const localizador = String(cuerpo.localizador || '').trim().toUpperCase();
  if (!acciones.includes(cuerpo.accion) || !LOCALIZADOR.test(localizador)) return {status:400,error:'Indique un localizador válido.'};
  if (cuerpo.accion === 'whatsapp_reserva_enviar' && (cuerpo.confirmar !== true || !/^[a-f0-9]{64}$/.test(cuerpo.huella || '')))
    return {status:400,error:'Revise la reserva y confirme el envío manual.'};
  const bloqueado = motivo => ({status:200,ok:true,listo:false,motivo,mensajes_enviados:0});
  try {
    const fuente = lector || crearLectorDetalle(env, fetchImpl);
    const registro = await fuente.reserva(localizador);
    if (!registro) return bloqueado('reserva_no_encontrada');
    if (registro.fields?.id_reserva !== localizador || !REFERENCIA.test(registro.id || '')) return bloqueado('reserva_no_valida');
    if (cuerpo.accion === 'whatsapp_reserva_diagnostico') {
      const detalle = JSON.parse(registro.fields.aviso_cliente_detalle || '{}');
      const c = conexion || conexionRedis(env, fetchImpl);
      const [pausa, ttl, ultima, puntuacion] = await Promise.all([
        c.redis(['GET', `${c.prefijo}:pausa`]), c.redis(['TTL', `${c.prefijo}:pausa`]),
        c.redis(['GET', `${c.prefijo}:ejecucion:ultima`]), c.redis(['ZSCORE', `${c.prefijo}:cola`, registro.id])
      ]);
      const fecha = v => typeof v === 'string' && Number.isFinite(Date.parse(v)) ? new Date(v).toISOString() : null;
      const estados = ['pendiente','aceptado','entregado','demorado','rechazado'];
      const motivos = ['preparado','configuracion','sin_destinatario','aceptado_proveedor','entregado_servidor',
        'entrega_demorada','correo_rebotado','entrega_fallida','correo_suprimido','queja_destinatario',
        'fallo_temporal','respuesta_desconocida','rechazado_proveedor','contenido_cambiado'];
      let ultimo = {}; try { ultimo = JSON.parse(ultima || '{}') || {}; } catch {}
      const avisosProgramador = ['Consulta de correo no configurada.',
        'La clave de Resend no permite consultar entregas. Revise sus permisos.',
        'No se pudo consultar el estado en Resend. Se conserva el estado anterior.',
        'Comprobación pendiente; se conserva el estado anterior.'];
      const programado = puntuacion !== null && puntuacion !== undefined && Number.isFinite(Number(puntuacion)) && Number(puntuacion) > 0;
      return {status:200,ok:true,modo:'solo_lectura',mensajes_enviados:0,escrituras:0,
        correo_estado:estados.includes(detalle.estado) ? detalle.estado : 'desconocido',
        correo_estado_campo:estados.includes(registro.fields.aviso_cliente_estado) ? registro.fields.aviso_cliente_estado : 'desconocido',
        correo_motivo:motivos.includes(detalle.motivo) ? detalle.motivo : 'desconocido',
        id_correo_registrado:/^[a-f0-9-]{36}$/i.test(detalle.id_envio || ''),
        correo_iniciado:fecha(detalle.iniciado),correo_comprobado:fecha(detalle.comprobado),
        comprobaciones:Number.isInteger(detalle.comprobaciones) ? detalle.comprobaciones : 0,
        cola_pausada:Boolean(pausa),pausa_segundos:Number.isInteger(ttl) && ttl > 0 ? ttl : null,
        programado,proxima_ejecucion:programado ? new Date(Number(puntuacion)).toISOString() : null,
        ultima_ejecucion:fecha(ultimo.fecha),
        ultimo_aviso:avisosProgramador.includes(ultimo.aviso) ? ultimo.aviso : null,
        ultimo_comprobados:Number.isInteger(ultimo.comprobados) && ultimo.comprobados >= 0 ? ultimo.comprobados : null};
    }
    const huella = huellaReserva(registro, env), f = registro.fields;
    if (!huella) return bloqueado('reserva_sin_autorizacion_o_no_confirmada');
    // Durante la prueba solo se admite el móvil fijo de pruebas, nunca un contacto aportado por el navegador.
    if (!/^whatsapp:\+[1-9]\d{7,14}$/.test(env.TWILIO_WHATSAPP_TEST_TO || '') ||
        `whatsapp:${f.telefono}` !== env.TWILIO_WHATSAPP_TEST_TO) return bloqueado('telefono_distinto_del_movil_de_pruebas');
    if (cuerpo.accion === 'whatsapp_reserva_estado') {
      const c = conexion || conexionRedis(env, fetchImpl);
      const intento = await crearControl(c).leer(registro.id);
      if (!intento) return {status:200,ok:true,estado:'sin_intento',entrega_confirmada:false};
      if (intento.huella !== huella) return bloqueado('reserva_cambiada');
      if (intento.estado !== 'aceptado') return {status:200,ok:true,estado:intento.estado,entrega_confirmada:false,reintento_automatico:false};
      const seguimiento = await crearSeguimiento(c).leer(intento.sid);
      const contacto = await crearDestino(c).leer(registro.id);
      if (!seguimiento || seguimiento.sid !== intento.sid || seguimiento.reserva_id !== registro.id || seguimiento.huella !== huella)
        return {status:200,ok:true,estado:'seguimiento_pendiente',entrega_confirmada:false};
      return {status:200,ok:true,estado:seguimiento.estado,entrega_confirmada:['delivered','read'].includes(seguimiento.estado),
        contacto_resuelto: contacto?.huella === huella && contacto.detalle?.contacto?.resultado === 'whatsapp_entregado'};
    }
    if (!futura(f, ahora())) return bloqueado('reserva_pasada');
    const aviso = prepararContacto(JSON.parse(f.aviso_cliente_detalle), ahora());
    const restaurante = await fuente.restaurante(f.restaurante[0]);
    if (!restaurante || restaurante.id !== f.restaurante[0]) return bloqueado('restaurante_no_encontrado');
    const nombreRestaurante = ['nombre_restaurante','nombre','restaurante'].map(k => restaurante.fields?.[k]).find(v => typeof v === 'string' && v.trim());
    const borrador = preparar({reserva:{estado:f.estado,restaurante:nombreRestaurante,fecha:f.fecha,hora:f.hora,
      personas:f.personas,zona:aviso.zona,localizador:f.id_reserva},aviso,ahora:ahora()});
    if (!borrador.listo) return bloqueado(borrador.motivo);
    const peticion = prepararPeticion({borrador,telefonoCliente:f.telefono,env});
    if (!peticion.listo) return bloqueado(peticion.motivo);
    const revision = await (revisar || (id => require('./revision-envio-whatsapp').revisar(id,{env})))(registro.id);
    if (revision.estado !== 'candidato') return bloqueado(revision.motivo);
    if (cuerpo.accion === 'whatsapp_reserva_revisar') return {status:200,ok:true,listo:true,huella,localizador,
      destino:`•••• ${f.telefono.slice(-4)}`,texto:borrador.texto,
      envio_habilitado:env.CONTACTIA_WHATSAPP_ENVIO_CORRELACIONADO_HABILITADO === '1' && env.CONTACTIA_WHATSAPP_CALLBACK_HABILITADO === '1'};
    if (cuerpo.huella !== huella) return bloqueado('reserva_cambiada_vuelva_a_revisar');
    if (env.CONTACTIA_WHATSAPP_ENVIO_CORRELACIONADO_HABILITADO !== '1' || env.CONTACTIA_WHATSAPP_CALLBACK_HABILITADO !== '1') return bloqueado('canal_desactivado');
    const servicio = emisor || require('./envio-correlacionado-whatsapp').desdeEntorno(env,fetchImpl);
    const resultado = await servicio.enviar({registro,restaurante:{id:restaurante.id,nombre:nombreRestaurante}});
    return {status:200,ok:true,...resultado};
  } catch { return {status:503,error:'No se pudo comprobar la reserva o completar la operación. No repita un envío sin revisar su seguimiento.'}; }
}
module.exports = {ejecutar, crearLectorDetalle};
