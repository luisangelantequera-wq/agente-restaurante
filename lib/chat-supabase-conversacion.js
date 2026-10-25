'use strict';
(function(root,factory){
 if(typeof module==='object'&&module.exports)module.exports=factory(require('./fecha-conversacional'),require('./entrada-conversacional'),require('./informacion-publica-respuestas'));
 else root.ContactiaChatSupabase=factory(root.ContactiaFechas,root.ContactiaEntrada,root.ContactiaInformacion);
})(typeof window==='undefined'?globalThis:window,function(F,E,I){
 // Solo se aplica al campo de contacto esperado; nunca a turnos de reserva.
 function nombreCliente(texto){
  const limpio=String(texto).trim().replace(/^[«"“]+|[»"”]+$/g,'')
   .replace(/^(?:pues\s+|sí[, ]+|si[, ]+)?(?:(?:la\s+reserva\s+)?(?:sería|seria|es)\s+)?a\s+nombre\s+de\s*[:,]?\s*/i,'')
   .replace(/^me\s+llamo\s+/i,'')
   .replace(/[, ]+por\s+favor[.!]?$/i,'');
  const nombre=E.normalizarNombreCliente(limpio);
  // Una confirmación repetida no es un nombre. Tampoco guardar un correo
  // o un teléfono si el cliente se adelantó a la siguiente pregunta.
  if(E.interpretarValidacionDatos(nombre)||/^(?:no (?:lo )?s[eé]|no recuerdo|un momento|espera)$/i.test(nombre)||/\barroba\b/i.test(nombre))return '';
  return /^[\p{L}][\p{L}\p{M}\s.'’\-]*$/u.test(nombre)?nombre:'';
 }
 function emailValido(texto){return texto.length<=254&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(texto);}
 function correoDictado(texto){
  let s=String(texto).trim().toLowerCase().replace(/^[«"“]+|[»"”]+$/g,'')
   .replace(/^(?:(?:mi|el)\s+)?(?:correo(?:\s+electrónico|\s+electronico)?|e-?mail)(?:\s+es\s*[:,-]?\s*|\s*:\s*)/i,'')
   .replace(/^es\s+/,'').replace(/[, ]+por\s+favor[.!]?$/,'').replace(/[.,;!?]+$/,'');
  if(/[\x00-\x1f\x7f]/.test(s))return null;
  // Si el transcriptor ya entregó la dirección escrita, no reinterpretar
  // palabras del usuario como números (por ejemplo, uno@example.invalid).
  if(emailValido(s)&&/^[a-z0-9.!#$%&'*+\/=?^_`{|}~-]+@[a-z0-9.-]+$/.test(s))return s;
  // La transcripción añade tildes ortográficas a palabras como «vídeo».
  // Solo producir un candidato: siempre debe confirmarlo el cliente.
  s=s.replace(/[áéíóúü]/g,c=>({'á':'a','é':'e','í':'i','ó':'o','ú':'u','ü':'u'}[c]));
  s=s.replace(/\b(?:guion|guión)\s+bajo\b/g,'_').replace(/\b(?:guion|guión)\b/g,'-')
   .replace(/\barroba\b/g,'@').replace(/\bpunto\b/g,'.');
  if((s.match(/@/g)||[]).length!==1)return null;
  // Deletreo español explícito y dígitos. No adivinar ni corregir dominios.
  const letras={be:'b',uve:'v',ce:'c',de:'d',efe:'f',ge:'g',hache:'h',jota:'j',ka:'k',ele:'l',eme:'m',ene:'n',eñe:'ñ',pe:'p',cu:'q',erre:'r',ese:'s',te:'t',equis:'x',zeta:'z',cero:'0',uno:'1',dos:'2',tres:'3',cuatro:'4',cinco:'5',seis:'6',siete:'7',ocho:'8',nueve:'9'};
  const unir=parte=>parte.trim().replace(/\b(?:doble\s+uve|uve\s+doble)\b/g,'w').replace(/\bi\s+griega\b/g,'y')
   .split(/[\s,;]+/).map(t=>letras[t]||t).join('');
  s=s.split('@').map(unir).join('@');
  return emailValido(s)&&/^[a-z0-9.!#$%&'*+\/=?^_`{|}~-]+@[a-z0-9.-]+$/.test(s)?s:null;
 }
 function leerCorreo(email,deletrear=false){
  const [usuario,dominio]=email.split('@');
  const simbolos={'.':'punto','_':'guion bajo','-':'guion','+':'más'};
  const local=deletrear?[...usuario].map(c=>simbolos[c]||c).join(', '):usuario.replace(/[._+\-]/g,c=>' '+simbolos[c]+' ');
  return local+', arroba, '+dominio.replaceAll('.',' punto ').replaceAll('-',' guion ');
 }
 function personasReserva(texto){
  const n=E.normalizarEntrada(texto),p=E.analizarPersonas(texto.replace(/\bcomensales?\b/gi,'personas'));
  if(p.estado!=='ausente')return p;
  // El contexto de la pregunta permite «Dos.» sin añadir una palabra al cliente.
  const numero=/^\d{1,4}$/.test(n)?Number(n):E.extraerPersonas(n);
  return Number.isInteger(numero)?{estado:'seguro',valor:numero}:p;
 }
 function horaReserva(texto,breve=false){
  // Fuera de la pregunta de hora exigir un marcador: «dos o tres personas»
  // no debe aportar una hora al buscar alternativas numéricas.
  if(!breve&&!/:|\b(?:a|sobre|hacia|para)\s+las?\b|\bhoras?\b|\b(?:de|por)\s+la\s+(?:mañana|manana|tarde|noche|madrugada)\b/i.test(texto))return {estado:'ausente',valor:null};
  const h=E.analizarHora(texto);
  if(h.estado==='ambiguo')return h;
  const valor=h.valor||(breve?E.extraerHora(texto,true):null);
  // El intérprete histórico ya aplica el contexto de restaurante:
  // «a las dos» -> 14:00; «dos de la mañana» o «02:00» -> 02:00.
  return valor?{estado:'seguro',valor}:{estado:'ausente',valor:null};
 }
 const preguntas={fecha:'¿Qué día desea reservar?',personas:'¿Para cuántas personas?',hora:'¿A qué hora desea reservar?',
  nombre:'¿A nombre de quién hacemos la reserva?',email:'¿Cuál es su correo electrónico?',telefono:'¿Cuál es su teléfono?',observaciones:'¿Desea añadir alguna observación? Escriba «ninguna» si no necesita añadir nada.'};
 function crear({config,pedir,decir,uuid=()=>crypto.randomUUID(),ahora=()=>new Date(),estadoInicial=null,cierrePorVoz=false}){
  let paso='fecha',ocupado=false,correccion=false,pendiente=null,incierto=false,calendario=null,correoPendiente=null;const datos={};
  if(estadoInicial){const e=JSON.parse(JSON.stringify(estadoInicial));paso=e.paso;correccion=e.correccion;pendiente=e.pendiente?Object.freeze(e.pendiente):null;incierto=e.incierto;calendario=e.calendario;correoPendiente=e.correoPendiente;Object.assign(datos,e.datos);}
  const norm=E.normalizarEntrada;
  function hoy(){const p=new Intl.DateTimeFormat('en-CA',{timeZone:config.zonaHoraria,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(ahora());
   const v=t=>Number(p.find(x=>x.type===t).value);return new Date(v('year'),v('month')-1,v('day'),12);}
  function zona(){return config.zonas.find(z=>z.id===datos.zona_id)?.nombre||'';}
  function resumen(contacto=false,voz=false){
   const fecha=new Intl.DateTimeFormat('es-ES',{timeZone:'UTC',weekday:'long',day:'numeric',month:'long',year:'numeric'}).format(new Date(datos.fecha+'T12:00:00Z'));
   const [h,m]=datos.hora.split(':').map(Number);
   const horas=['cero','una','dos','tres','cuatro','cinco','seis','siete','ocho','nueve','diez','once','doce','trece','catorce','quince','dieciséis','diecisiete','dieciocho','diecinueve','veinte','veintiuna','veintidós','veintitrés'];
   const hora=voz?`${horas[h]} ${h===1?'hora':'horas'}`+(m?` y ${m} ${m===1?'minuto':'minutos'}`:''):datos.hora;
   return `${fecha}, ${datos.personas} personas, a las ${hora}, en ${zona()}.`+(contacto?` A nombre de ${datos.nombre}. Correo: ${datos.email}. Teléfono: ${datos.telefono}. Observaciones: ${datos.observaciones||'ninguna'}.`:'');
  }
  function preguntar(campo){paso=campo;decir(campo==='zona_id'?`¿En qué zona prefiere la mesa? ${config.zonas.map(z=>z.nombre).join(', ')}.`:(cierrePorVoz&&campo==='observaciones'?'¿Desea añadir alguna observación? Diga «ninguna» si no necesita añadir nada.':preguntas[campo]));}
  function confirmarCorreo({retomar=false,deletrear=false}={}){
   const inicio=retomar?'Retomamos la reserva. El correo es ':'He entendido: ';
   const fin=' ¿Es correcto? Indique «Sí» o «No».';
   decir(inicio+correoPendiente+'.'+fin,{voz:inicio+leerCorreo(correoPendiente,deletrear)+'.'+fin});
  }
  function confirmar(){paso=datos.observaciones!==undefined?'final':'resumen';const fin=' ¿Son correctos los datos? Indique «Sí» o «No».';decir(resumen(paso==='final')+fin,{voz:resumen(paso==='final',true)+fin});}
  function avanzar(campo){
   if(correccion){correccion=false;confirmar();return;}
   if(['fecha','personas','hora','zona_id'].includes(campo)){
    for(const siguiente of ['fecha','personas','hora'])if(datos[siguiente]===undefined){preguntar(siguiente);return;}
    if(!datos.zona_id){
     if(config.zonas.length===1){datos.zona_id=config.zonas[0].id;decir(`Reservaremos en ${zona()}, la única zona abierta.`);}
     else {preguntar('zona_id');return;}
    }
    confirmar();
   }else if(campo==='nombre')preguntar('email');else if(campo==='email')preguntar('telefono');
   else if(campo==='telefono')preguntar('observaciones');else confirmar();
  }
  function guardarComplementos(texto,campo){
   if(correccion||!['fecha','personas','hora','zona_id'].includes(campo))return;
   // Solo señales explícitas fuera del campo preguntado; nunca convertir el
   // número de un día o de una hora en comensales.
   if(campo!=='personas'&&/\b(?:personas?|comensales?|somos|seremos)\b/i.test(texto)){
    const p=personasReserva(texto);if(p.estado==='seguro'&&p.valor>=1&&p.valor<=1000)datos.personas=p.valor;
   }
   if(campo!=='hora'){const h=horaReserva(texto);if(h.estado==='seguro')datos.hora=h.valor;}
   if(campo!=='zona_id'){
    const n=' '+norm(texto)+' ',zonas=config.zonas.filter(z=>n.includes(' en '+norm(z.nombre)+' '));
    if(zonas.length===1)datos.zona_id=zonas[0].id;
   }
  }
  async function disponible(){const r=await pedir('supabase_web_disponibilidad',{fecha:datos.fecha,hora:datos.hora,personas:datos.personas,zona_id:datos.zona_id});
   if(!r.disponible){paso='corregir';decir('No quedan mesas para esos datos. ¿Qué desea cambiar: fecha, hora, personas o zona?');return false;}return true;}
  async function enviar(texto,{canal='texto'}={}){
   if(ocupado||paso==='terminado')return;
   ocupado=true;
   try{
    texto=String(texto).trim();if(!texto||texto.length>4000||/[\x00-\x1f\x7f]/.test(texto)){decir('Introduzca una respuesta válida de una sola línea.');return;}
    if(paso==='pendiente'){decir('El resultado está pendiente. Pulse «Verificar y confirmar» para reintentar la misma solicitud.');return;}
    if(I.esConsulta(texto)){
     const r=await pedir('supabase_web_informacion',{pregunta:texto});
     if(typeof r.respuesta!=='string')throw Error('No se pudo consultar esa información.');
     decir(r.respuesta);
     if(paso==='resumen'||paso==='final')decir('Retomamos la reserva. Indique «Sí» si los datos del resumen son correctos o «No» para corregirlos.');
     else if(paso==='corregir')decir('Retomamos la reserva. ¿Qué dato desea cambiar?');
     else if(paso==='confirmar_email')confirmarCorreo({retomar:true});
     else decir('Retomamos la reserva. '+(preguntas[paso]||`¿En qué zona prefiere la mesa? ${config.zonas.map(z=>z.nombre).join(', ')}.`));
     return;
    }
    if(paso==='confirmar_email'){
     if(/^(?:(?:puede|puedes)\s+)?(?:deletrea(?:lo|rlo|r)?|deletree(?:lo)?|letra (?:a|por) letra|repit[ae](?:lo)? por letras)$/.test(norm(texto))){confirmarCorreo({deletrear:true});return;}
     const respuesta=E.interpretarValidacionDatos(texto);
     if(respuesta==='si'){datos.email=correoPendiente;correoPendiente=null;avanzar('email');return;}
     if(respuesta==='no'){correoPendiente=null;preguntar('email');decir('Puede decir arroba, punto y guion bajo, o deletrearlo despacio.');return;}
     const nuevo=correoDictado(texto);
     if(nuevo){correoPendiente=nuevo;confirmarCorreo();}
     else decir('Indique «Sí» si el correo es correcto, «No» para repetirlo, o diga el correo completo de nuevo.');
     return;
    }
    if(paso==='corregir'){
     const n=norm(texto);const campos=[['fecha',/fecha|dia/],['hora',/hora/],['personas',/persona/],['zona_id',/zona/],['nombre',/nombre/],['email',/correo|email/],['telefono',/telefono/],['observaciones',/observaci/]];
     const campo=campos.filter(([c,re])=>re.test(n)&&datos[c]!==undefined);
     if(campo.length!==1){decir('Indique un dato que desea cambiar: fecha, hora, personas, zona, nombre, correo, teléfono u observaciones.');return;}
     correccion=true;preguntar(campo[0][0]);return;
    }
    if(paso==='resumen'||paso==='final'){
     const respuesta=E.interpretarValidacionDatos(texto);
     if(respuesta==='no'){paso='corregir';decir('¿Qué dato desea cambiar?');return;}
     if(respuesta!=='si'){decir('Indique «Sí» para confirmar estos datos o «No» para corregirlos.');return;}
     // En voz, el cierre usa la transacción de escritura también al repetir
     // un sí cuya respuesta se perdió: una consulta previa podría ver la mesa
     // recién ocupada por esa misma solicitud y bloquear su recuperación.
     if((paso!=='final'||!cierrePorVoz)&&!await disponible())return;
     if(paso==='resumen'){decir('Hay disponibilidad en este momento. La mesa se asignará al confirmar la reserva.');preguntar('nombre');}
     else {pendiente=Object.freeze({...datos,peticion_id:uuid()});paso='pendiente';decir(cierrePorVoz?'Un momento, voy a registrar su reserva.':'Complete la verificación de seguridad y pulse «Verificar y confirmar» para registrar su reserva de prueba.');}
     return;
    }
    const campo=paso;let valor=texto;
    guardarComplementos(texto,campo);
    if(campo==='fecha'){
     const f=F.analizarFecha(texto,hoy());if(f.estado!=='seguro'){decir('No he podido identificar un único día. Indique una fecha, por ejemplo «28 de octubre».');return;}
     const r=await pedir('supabase_web_fecha',{fecha:f.valor});if(!r.fecha_admitida){decir('El restaurante está cerrado para reservas ese día. ¿Qué otro día prefiere?');return;}
     calendario={fecha:f.valor,horario:r.horario};
     valor=f.valor;decir(`El horario de reservas de ese día es de ${r.horario.join(' y de ').replaceAll('-',' a ')}.`);
    }else if(campo==='personas'){
     const p=personasReserva(texto);
     if(p.estado!=='seguro'||!Number.isInteger(p.valor)||p.valor<1||p.valor>1000){decir('Indique un único número de personas, entre 1 y 1000.');return;}valor=p.valor;
    }else if(campo==='hora'){
     const h=horaReserva(texto,true);
     if(h.estado!=='seguro'){decir('Indique una hora sin ambigüedad, como 14:00 o «dos de la tarde».');return;}valor=h.valor;
    }else if(campo==='zona_id'){
     const z=config.zonas.find(z=>norm(z.nombre)===norm(texto.replace(/^(en\s+)?(la\s+zona\s+)?/i,'')));
     if(!z){preguntar('zona_id');return;}valor=z.id;
    }else if(campo==='nombre'){valor=nombreCliente(texto);if(!valor||valor.length>200){decir('Necesito el nombre de la persona para la reserva. Puede decir, por ejemplo, «A nombre de Juan».');return;}decir('A nombre de '+valor+'.');}
    else if(campo==='email'){
     if(canal==='voz'){
      valor=correoDictado(texto);
      if(!valor){decir('No he podido identificar un único correo completo. Dígalo usando arroba y punto. Si hace falta, deletree la parte anterior a la arroba; también puede detener la llamada y escribirlo.');return;}
      correoPendiente=valor;paso='confirmar_email';confirmarCorreo();return;
     }
     valor=texto.toLowerCase();if(!emailValido(valor)){decir('Revise el correo electrónico.');return;}
    }
    else if(campo==='telefono'){valor=E.normalizarTelefono(texto);if(!E.telefonoValido(valor)||!/^\+?[0-9 ()-]{7,40}$/.test(valor)){decir('Indique el teléfono con sus cifras, por ejemplo 600000000.');return;}}
    else if(campo==='observaciones')valor=/^(ningun[ao]?|no|nada)$/i.test(norm(texto))?'':texto;
    datos[campo]=valor;avanzar(campo);
   }catch(error){
    let mensaje=error.message||'No se pudo consultar el servicio. Inténtelo de nuevo.';
    if(error.codigo==='FUERA_HORARIO'&&calendario?.fecha===datos.fecha&&calendario.horario.length){
     mensaje=`Nuestro horario de apertura ese día es de ${calendario.horario.join(' y de ').replaceAll('-',' a ')}. ¿A qué otra hora desea reservar?`;
     correccion=true;paso='hora';
    }
    decir(mensaje);
   }
   finally{ocupado=false;}
  }
  return {enviar,iniciar(){decir(`Bienvenido a ${config.nombre}. Vamos a hacer una reserva de prueba.`);preguntar('fecha');},
   estado:()=>({paso,ocupado,pendiente:pendiente?{...pendiente}:null}),
   exportar:()=>JSON.parse(JSON.stringify({paso,correccion,pendiente,incierto,calendario,correoPendiente,datos})),
   async confirmar(reservar){if(ocupado||paso!=='pendiente')return;ocupado=true;
    try{const r=await reservar({...pendiente});paso='terminado';decir(`${r.mensaje} Referencia: ${r.referencia}`);}
    catch(error){
     // Solo un rechazo explícito anterior a la escritura permite editar. Un 5xx o fallo de red conserva UUID y datos.
     if(!incierto&&[400,403,409,422,429].includes(error.status)){pendiente=null;paso='corregir';decir(error.message+' Puede corregir un dato y volver a confirmar.');}
     else {incierto=true;decir(cierrePorVoz?'No he podido comprobar el resultado. Diga «reintentar» para comprobar la misma solicitud sin duplicarla.':'No se pudo comprobar el resultado. Reintente con «Verificar y confirmar»: conservamos la misma solicitud para evitar duplicados.');}
    }finally{ocupado=false;}
   }};
 }
 return {crear,correoDictado,nombreCliente};
});
