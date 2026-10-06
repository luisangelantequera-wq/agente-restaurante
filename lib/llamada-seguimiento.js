"use strict";
const crypto = require('node:crypto');
const { prepararContacto, siguienteAccion, registrarEvento } = require('./contacto-alternativo');
const { crearLectorDetalle } = require('./prueba-reserva-whatsapp');
const { HOST_PREVIEW } = require('./url-callback-whatsapp');
const TELEFONO = /^\+[1-9]\d{7,14}$/;
const SID = /^CA[a-f0-9]{32}$/i;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const TTL = 7 * 86400;
const CAS = `local t=redis.call('get',KEYS[1]); if t~=ARGV[1] then return 0 end
local ttl=redis.call('pttl',KEYS[1]); if ttl<=0 then return 0 end
redis.call('set',KEYS[1],ARGV[2],'PX',ttl); return 1`;
function turnos(s) { return s.turnos || [{intento:s.intento,sid:s.sid,numero:1}]; }
function horaLocutada(hora) {
  const [h,m]=hora.split(':').map(Number);
  return `${h} horas${m ? ` y ${m} ${m===1?'minuto':'minutos'}` : ''}`;
}
function habilitado(env) {
  return env.VERCEL_ENV === 'preview' && env.VERCEL_GIT_COMMIT_REF === 'prototipo-voz' &&
    env.CONTACTIA_LLAMADAS_PRUEBA_HABILITADAS === '1';
}
function errorConfiguracion(env) {
  if (!habilitado(env)) return 'Prueba de llamadas todavía desactivada.';
  if (!TELEFONO.test(env.TWILIO_VOICE_FROM || '')) return 'El número de origen de voz no está configurado en formato internacional.';
  if (!TELEFONO.test(env.TWILIO_VOICE_TEST_TO || '')) return 'El móvil de prueba de voz no está configurado en formato internacional.';
  if (!/^AC[a-f0-9]{32}$/i.test(env.TWILIO_ACCOUNT_SID || '')) return 'El identificador de la cuenta Twilio no está configurado correctamente.';
  if (!/^[a-f0-9]{32}$/i.test(env.TWILIO_AUTH_TOKEN || '')) return 'La credencial de Twilio no está configurada correctamente.';
  if ((env.CONTACTIA_AVISOS_SECRET || '').length < 32) return 'El secreto de seguimiento no está configurado correctamente.';
  return null;
}
function configuracion(env) { return errorConfiguracion(env) === null; }
function urlCallback(env, intento, etapa) {
  if (!UUID.test(intento) || !['mensaje','respuesta','estado'].includes(etapa)) throw Error('Callback no válido');
  const u = new URL(`https://${HOST_PREVIEW}/api/llamada-seguimiento`);
  u.searchParams.set('intento', intento); u.searchParams.set('etapa', etapa);
  if (env.CONTACTIA_WHATSAPP_CALLBACK_BYPASS_HABILITADO === '1') {
    const s = env.VERCEL_AUTOMATION_BYPASS_SECRET;
    if (typeof s !== 'string' || s.length < 32 || s.length > 512 || /\s/.test(s)) throw Error('Bypass no configurado');
    u.searchParams.set('x-vercel-protection-bypass', s);
  }
  return u.href;
}
function detalle(registro) { return JSON.parse(registro.fields.aviso_cliente_detalle || '{}'); }
function huella(registro, env) {
  const f = registro?.fields || {}, d = detalle(registro);
  return crypto.createHmac('sha256', env.CONTACTIA_AVISOS_SECRET).update(JSON.stringify([
    registro.id, f.estado, f.anonimizada, f.restaurante, f.id_reserva, f.fecha, f.hora, f.personas,
    f.telefono, d.zona, d.idioma || 'es', d.estado, d.motivo, d.iniciado, d.whatsapp_autorizado
  ])).digest('hex');
}
function validar(registro, env, ahora) {
  const f = registro?.fields || {};
  if (!/^rec[a-zA-Z0-9]+$/.test(registro?.id || '') || f.estado !== 'confirmada' || f.anonimizada ||
      !Array.isArray(f.restaurante) || f.restaurante.length !== 1 || !/^rec[a-zA-Z0-9]+$/.test(f.restaurante[0]) ||
      !/^[A-Z0-9-]{5,80}$/.test(f.id_reserva || '') || !/^\d{4}-\d{2}-\d{2}$/.test(f.fecha || '') ||
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(f.hora || '') || !Number.isInteger(f.personas) || f.personas < 1 || f.personas > 1000)
    return { listo:false, motivo:'reserva_no_valida' };
  const fecha = new Date(`${f.fecha}T12:00:00Z`);
  if (!Number.isFinite(+fecha) || fecha.toISOString().slice(0,10) !== f.fecha) return {listo:false,motivo:'fecha_no_valida'};
  const partes = Object.fromEntries(new Intl.DateTimeFormat('es-ES', {timeZone:'Europe/Madrid',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(ahora)).map(p=>[p.type,p.value]));
  if (`${f.fecha} ${f.hora}` <= `${partes.year}-${partes.month}-${partes.day} ${partes.hour}:${partes.minute}`) return {listo:false,motivo:'reserva_pasada'};
  if (f.telefono !== env.TWILIO_VOICE_TEST_TO) return {listo:false,motivo:'telefono_distinto_del_movil_de_pruebas'};
  const d = detalle(registro), inicio = Date.parse(d.iniciado);
  if (!Number.isFinite(inicio) || ahora < inicio || ahora-inicio >= 86400000) return {listo:false,motivo:'plazo_de_prueba_agotado'};
  if ((d.idioma || 'es') !== 'es') return {listo:false,motivo:'idioma_pendiente'};
  // Primera prueba: únicamente correo rebotado y negativa explícita a WhatsApp.
  if (d.estado !== 'rechazado' || !['correo_rebotado','entrega_fallida'].includes(d.motivo) || d.whatsapp_autorizado !== false)
    return {listo:false,motivo:'correo_o_autorizacion_no_elegibles'};
  const plan = prepararContacto(d, ahora).contacto;
  if (plan?.fase !== 'llamada_pendiente' || plan.intentos_llamada !== 0 || plan.politica.configuracion_pendiente)
    return {listo:false,motivo:'contacto_no_elegible'};
  const accion = siguienteAccion(plan, {ahora, llamadasDisponibles:true, limite:inicio+86400000});
  if (accion.accion !== 'llamada') return {listo:false,motivo:'fuera_del_plazo'};
  return {listo:true, plan, huella:huella(registro,env), proxima:accion.fecha,
    dentro_horario:Date.parse(accion.fecha) === ahora};
}
function crearAlmacen({redis,prefijo}) {
  const clave = id => `${prefijo}:llamada-prueba:${id}`;
  return {
    async leerCallback(id) {
      const r=await this.leer(id);
      return r?.raiz ? this.leer(r.raiz) : r;
    },
    async programar(s, fecha) {
      if(!UUID.test(s.intento)) throw Error('Seguimiento no válido');
      return fecha ? redis(['ZADD',`${prefijo}:llamadas-reintentos`,Date.parse(fecha),s.intento]) :
        redis(['ZREM',`${prefijo}:llamadas-reintentos`,s.intento]);
    },
    async vencidos(ahora=Date.now()) {
      const ids=await redis(['ZRANGEBYSCORE',`${prefijo}:llamadas-reintentos`,'-inf',ahora,'LIMIT',0,2]);
      if(!Array.isArray(ids) || ids.some(id=>!UUID.test(id))) throw Error('Cola de llamadas no válida');
      return ids;
    },
    async reemplazar(s,nuevo) {
      return await redis(['EVAL',CAS,1,clave(s.intento),JSON.stringify(s),JSON.stringify(nuevo)]) === 1;
    },
    async reclamarReintento(s, intento, ahora) {
      if(s.estado!=='sin_confirmacion' || !s.automatico || s.contacto.fase!=='llamada_pendiente' || s.contacto.intentos_llamada>=3) return false;
      if(await redis(['SET',clave(intento),JSON.stringify({raiz:s.intento}),'NX','EX',TTL])!=='OK') return false;
      const nuevo={...s,estado:'preparado',sid:null,actual_intento:intento,siguiente:null,
        turnos:[...turnos(s),{intento,sid:null,numero:s.contacto.intentos_llamada+1}],
        contacto:registrarEvento(s.contacto,{id:intento,tipo:'llamada_iniciada'},ahora)};
      return this.reemplazar(s,nuevo);
    },
    leer: async id => { const t=await redis(['GET',clave(id)]); return t ? JSON.parse(t) : null; },
    async reclamar(registro, intento, plan, hash, ahora) {
      // Este control no se libera después de errores o respuestas inciertas.
      const r=await redis(['SET',clave(registro.id),intento,'NX','EX',TTL]);
      if(r !== 'OK') return false;
      const valor={intento,reserva_id:registro.id,localizador:registro.fields.id_reserva,huella:hash,sid:null,
        estado:'preparado',contacto:registrarEvento(plan,{id:intento,tipo:'llamada_iniciada'},ahora)};
      if(await redis(['SET',clave(intento),JSON.stringify(valor),'NX','EX',TTL]) !== 'OK') throw Error('Seguimiento no guardado');
      return true;
    },
    async cambiar(id, modificar) {
      for(let n=0;n<4;n++) {
        const t=await redis(['GET',clave(id)]); if(!t) throw Error('Seguimiento no disponible');
        const r=JSON.parse(t), nuevo=modificar(r);
        if(await redis(['EVAL',CAS,1,clave(id),t,JSON.stringify(nuevo)]) === 1) return nuevo;
      }
      throw Error('Seguimiento en actualización');
    },
    async porReserva(id) { const intento=await redis(['GET',clave(id)]); return UUID.test(intento || '') ? this.leer(intento) : null; }
  };
}
function servicio({env=process.env,fetchImpl=global.fetch,lector,conexion,ahora=()=>Date.now()}={}) {
  const fuente=lector || crearLectorDetalle(env,fetchImpl);
  const almacen=()=>crearAlmacen(conexion || require('./cola-avisos').desdeEntorno(env,fetchImpl));
  async function revisar(localizador) {
    const registro=await fuente.reserva(localizador);
    if(!registro || registro.fields.id_reserva !== localizador) return {listo:false,motivo:'reserva_no_encontrada'};
    const revision=validar(registro,env,ahora()); if(!revision.listo) return revision;
    const restaurante=await fuente.restaurante(registro.fields.restaurante[0]);
    if(restaurante?.id !== registro.fields.restaurante[0]) return {listo:false,motivo:'restaurante_no_valido'};
    const nombre=['nombre_restaurante','nombre','restaurante'].map(k=>restaurante.fields[k]).find(x=>typeof x==='string' && x.trim());
    const zona=detalle(registro).zona;
    if(!nombre || nombre.length>100 || typeof zona!=='string' || !zona.trim() || zona.length>80) return {listo:false,motivo:'datos_incompletos'};
    const fecha=new Intl.DateTimeFormat('es-ES',{weekday:'long',day:'numeric',month:'long',year:'numeric',timeZone:'Europe/Madrid'}).format(new Date(`${registro.fields.fecha}T12:00:00Z`));
    const texto=`Le llamamos del sistema automático de reservas de ${nombre}. No hemos podido entregarle el correo de confirmación. Su reserva está confirmada para el ${fecha}, a las ${horaLocutada(registro.fields.hora)}, para ${registro.fields.personas} personas, en ${zona}. Para indicar que ha recibido este aviso, pulse 1.`;
    return {...revision,registro,texto};
  }
  async function enviar(a,raiz,intento,localizador,hash) {
    const actual=await revisar(localizador), guardado=await a.leer(raiz);
    if(!actual.listo || actual.huella!==hash || !actual.dentro_horario ||
       guardado.contacto.fase!=='llamada_en_curso' || (guardado.actual_intento || guardado.intento)!==intento)
      return {status:409,error:'La reserva o el seguimiento ha cambiado. No se inicia la llamada.'};
    const mensaje=urlCallback(env,intento,'mensaje'), estado=urlCallback(env,intento,'estado');
      let respuesta;
      try {
        respuesta=await fetchImpl(`https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Calls.json`,{
          method:'POST',redirect:'error',signal:AbortSignal.timeout(8000),
          headers:{Authorization:`Basic ${Buffer.from(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`).toString('base64')}`,'Content-Type':'application/x-www-form-urlencoded'},
          body:new URLSearchParams({To:env.TWILIO_VOICE_TEST_TO,From:env.TWILIO_VOICE_FROM,Url:mensaje,Method:'POST',
            StatusCallback:estado,StatusCallbackMethod:'POST',StatusCallbackEvent:'completed',Timeout:'25',TimeLimit:'90',Record:'false'}).toString()});
        const d=await respuesta.json();
        if(!respuesta.ok || !SID.test(d.sid || '') || d.account_sid!==env.TWILIO_ACCOUNT_SID) {
          await a.cambiar(raiz,s=>({...s,estado:s.sid ? s.estado : 'revision'}));
          return {status:200,ok:true,estado:'revision',codigo:Number.isInteger(d.code)?d.code:null};
        }
        await a.cambiar(raiz,s=>{
          const lista=turnos(s), t=lista.find(t=>t.intento===intento);
          if(!t || t.sid && t.sid!==d.sid) throw Error('SID no coincide');
          const activo=(s.actual_intento || s.intento)===intento;
          return {...s,turnos:lista.map(t=>t.intento===intento?{...t,sid:d.sid}:t),
            ...(activo?{sid:d.sid,estado:s.estado==='preparado'?'aceptado':s.estado}:{})};
        });
        return {status:200,ok:true,estado:'aceptado'};
      } catch { try { await a.cambiar(raiz,s=>({...s,estado:s.estado==='preparado'?'revision':s.estado})); } catch {} return {status:200,ok:true,estado:'revision',mensaje:'Respuesta incierta. Consulte el estado; no repita la llamada.'}; }
  }
  async function planificar(s) {
    const a=almacen();
    if(!s.automatico || s.estado!=='sin_confirmacion' || s.contacto.fase!=='llamada_pendiente') {
      await a.programar(s,null); return null;
    }
    const r=await revisar(s.localizador);
    if(!r.listo || r.huella!==s.huella) {await a.programar(s,null);return null;}
    const accion=siguienteAccion(s.contacto,{ahora:ahora(),llamadasDisponibles:true,limite:Date.parse(detalle(r.registro).iniciado)+86400000});
    if(accion.accion!=='llamada') {
      await a.cambiar(s.intento,t=>({...t,siguiente:null,contacto:registrarEvento(t.contacto,{id:`${s.intento}_agotado`,tipo:'plazo_contacto_agotado'},ahora())}));
      await a.programar(s,null); return null;
    }
    // The queue is an index only; the canonical record is rechecked before calling.
    await a.cambiar(s.intento,t=>({...t,siguiente:accion.fecha}));
    await a.programar(s,accion.fecha);return accion.fecha;
  }
  async function procesarReintentos() {
    if(!configuracion(env)) return {llamadas_reintentadas:0};
    const a=almacen(), ids=await a.vencidos(ahora());let realizadas=0;
    for(const id of ids) {
      const s=await a.leer(id);
      if(!s) {await a.programar({intento:id},null);continue;}
      if(!s.automatico || s.estado!=='sin_confirmacion' || s.contacto.fase!=='llamada_pendiente') {await a.programar(s,null);continue;}
      const r=await revisar(s.localizador);
      if(!r.listo || r.huella!==s.huella) {
        await a.cambiar(id,t=>({...t,estado:'detenido',siguiente:null,automatico:false}));await a.programar(s,null);continue;
      }
      const accion=siguienteAccion(s.contacto,{ahora:ahora(),llamadasDisponibles:true,limite:Date.parse(detalle(r.registro).iniciado)+86400000});
      if(accion.accion!=='llamada' || Date.parse(accion.fecha)>ahora()) {await planificar(s);continue;}
      // CAS reserves a new attempt before POST. An uncertain attempt is never retried.
      const intento=crypto.randomUUID();
      if(!await a.reclamarReintento(s,intento,ahora())) continue;
      await a.programar(s,null);
      const resultado=await enviar(a,id,intento,s.localizador,s.huella);
      if(resultado.estado==='aceptado') realizadas++;
    }
    return {llamadas_reintentadas:realizadas};
  }
  return {revisar,almacen,fuente,planificar,procesarReintentos,
    async ejecutar(cuerpo) {
      if(!habilitado(env)) return {status:404,error:'Prueba de llamadas todavía desactivada.'};
      const errorConfig=errorConfiguracion(env);
      if(errorConfig) return {status:503,error:errorConfig};
      const localizador=String(cuerpo.localizador || '').trim().toUpperCase();
      if(!/^[A-Z0-9-]{5,80}$/.test(localizador)) return {status:400,error:'Indique un localizador válido.'};
      const a=almacen();
      if(cuerpo.accion==='llamada_reserva_estado') {
        const r=await fuente.reserva(localizador); if(!r || r.fields.id_reserva!==localizador) return {status:404,error:'Reserva no encontrada.'};
        const s=await a.porReserva(r.id);
        const vigente=s && s.huella===huella(r,env);
        return {status:200,ok:true,estado:vigente ? s.estado : 'sin_seguimiento_vigente',
          contactado:Boolean(vigente && s.contacto.fase==='resuelto'),llamadas:vigente ? s.contacto.intentos_llamada : 0,
          automatico:Boolean(vigente && s.automatico),siguiente:vigente && s.estado==='sin_confirmacion' && s.automatico?s.siguiente:null};
      }
      const r=await revisar(localizador); if(!r.listo) return {status:200,ok:true,listo:false,motivo:r.motivo};
      const anterior=await a.porReserva(r.registro.id);
      if(cuerpo.accion==='llamada_reserva_reintentos') {
        if(cuerpo.confirmar!==true || cuerpo.huella!==r.huella || !anterior || anterior.huella!==r.huella ||
           anterior.estado!=='sin_confirmacion' || anterior.contacto.fase!=='llamada_pendiente' || anterior.contacto.intentos_llamada>=3)
          return {status:409,error:'Revise una llamada sin confirmación antes de activar los reintentos.'};
        const activado=await a.cambiar(anterior.intento,s=>s.estado==='sin_confirmacion' && s.contacto.fase==='llamada_pendiente'?{...s,automatico:true}:s);
        const siguiente=await planificar(activado);
        return {status:200,ok:true,automatico:activado.automatico,siguiente};
      }
      if(cuerpo.accion==='llamada_reserva_revisar') return {status:200,ok:true,listo:true,huella:r.huella,texto:r.texto,
        destino:`•••• ${env.TWILIO_VOICE_TEST_TO.slice(-4)}`,proxima:anterior ? (anterior.siguiente || siguienteAccion(anterior.contacto,{ahora:ahora(),llamadasDisponibles:true,limite:Date.parse(detalle(r.registro).iniciado)+86400000}).fecha || null) : r.proxima,puede_llamar:r.dentro_horario && !anterior,puede_reintentar:Boolean(anterior && anterior.huella===r.huella && !anterior.automatico && anterior.estado==='sin_confirmacion' && anterior.contacto.fase==='llamada_pendiente')};
      if(cuerpo.accion!=='llamada_reserva_iniciar' || cuerpo.confirmar!==true || cuerpo.huella!==r.huella)
        return {status:400,error:'Revise los datos y confirme la llamada.'};
      if(!r.dentro_horario) return {status:409,error:'Fuera del horario de llamadas. Revise la próxima hora permitida.'};
      const intento=crypto.randomUUID();
      if(!await a.reclamar(r.registro,intento,r.plan,r.huella,ahora())) return {status:409,error:'Ya hay un intento registrado. Consulte su estado.'};
      // Lectura después del reclamo; nunca se confía en los datos del navegador.
      const actual=await revisar(localizador);
      if(!actual.listo || actual.huella!==r.huella || !actual.dentro_horario) return {status:409,error:'La reserva ha cambiado. El intento queda bloqueado para revisión.'};
      return enviar(a,intento,intento,localizador,r.huella);
    }
  };
}
module.exports={servicio,habilitado,configuracion,urlCallback,validar,huella,crearAlmacen,CAS,SID,UUID,turnos,horaLocutada};
