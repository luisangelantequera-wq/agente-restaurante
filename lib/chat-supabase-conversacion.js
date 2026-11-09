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
 function emailValido(texto){return texto.length<=254&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(texto)&&!/(?:^\.|\.@|\.\.)/.test(texto);}
 function correoDictado(texto){
  let s=String(texto).trim().toLowerCase().replace(/^[«"“]+|[»"”]+$/g,'')
   .replace(/^(?:(?:mi|el)\s+)?(?:correo(?:\s+electrónico|\s+electronico)?|e-?mail)(?:\s+es\s*[:,-]?\s*|\s*:\s*)/i,'')
   .replace(/^(?:(?:se\s+)?lo\s+voy\s+a\s+deletrear|voy\s+a\s+deletrearlo|se\s+lo\s+deletreo)\s*[:,.-]?\s*/i,'')
   .replace(/^es\s+/,'').replace(/[, ]+por\s+favor[.!]?$/,'').replace(/[.,;!?]+$/,'')
   .replace(/[,;]\s*(?:s[ií]|correcto|de acuerdo|gracias)\s*$/,'');
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
  // Los días y las horas digitales nunca son cantidades de comensales.
  const limpio=texto.replace(/\b\d{1,2}\/\d{1,2}\/\d{4}\b/g,' ')
   .replace(/\b\d{1,2}\s+de\s+(?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)(?:\s+de\s+\d{4})?\b/gi,' ')
   .replace(/\b\d{1,2}:\d{2}\b/g,' ');
  const n=E.normalizarEntrada(limpio),p=E.analizarPersonas(limpio.replace(/\bcomensales?\b/gi,'personas'));
  if(p.estado==='ambiguo')return p;
  const candidatos=p.estado==='seguro'?[p.valor]:[];
  // El rango anunciado admite también «100 personas» y «seremos 1000».
  for(const patron of [/\b(\d{1,4})\s+(?:personas?|comensales?)\b/g,/\b(?:somos|seremos)\s+(\d{1,4})\b/g,
   /\b(?:para|pa)\s+(\d{1,4})(?!\s+(?:de|por)\s+la\s+(?:manana|tarde|noche))\b/g]){
   for(const m of n.matchAll(patron))candidatos.push(Number(m[1]));
  }
  const numero='(?:\\d{1,4}|una|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce)';
  const alternativa=n.match(new RegExp('\\b(?:para|pa|somos|seremos)\\s+('+numero+')\\s+o\\s+('+numero+')\\b'));
  if(alternativa)for(const valor of alternativa.slice(1))candidatos.push(E.extraerPersonas(valor)??Number(valor));
  const valores=[...new Set(candidatos)];
  if(valores.length>1)return {estado:'ambiguo',valor:null};
  if(valores.length===1)return {estado:'seguro',valor:valores[0]};
  // El contexto de la pregunta permite «Dos.» sin añadir una palabra al cliente.
  const valor=/^\d{1,4}$/.test(n)?Number(n):/^(?:una|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce)$/.test(n)?E.extraerPersonas(n):null;
  return Number.isInteger(valor)?{estado:'seguro',valor}:p;
 }
 function horaReserva(texto,breve=false){
  // Fuera de la pregunta de hora exigir un marcador: «dos o tres personas»
  // no debe aportar una hora al buscar alternativas numéricas.
  // «Somos dos o tres» contiene alternativas de comensales, no de hora.
  // Retirarlas antes de que el analizador de horas separe por «o».
  const cantidad='(?:\\d{1,4}|una|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce)';
  const alternativasPersonas=new RegExp('\\b(?:somos|seremos|para|pa)\\s+'+cantidad+'(?:\\s+o\\s+'+cantidad+')+(?:\\s+(?:personas?|comensales?))?\\b(?![.:]\\d)','gi');
  const limpio=texto.replace(alternativasPersonas,' ');
  if(!breve&&!/:|\b(?:a\s+(?:eso\s+de\s+)?|sobre\s+|hacia\s+|para\s+)las?\b|\bhoras?\b|\b(?:de|por)\s+la\s+(?:mañana|manana|tarde|noche|madrugada)\b/i.test(limpio))return {estado:'ausente',valor:null};
  const h=E.analizarHora(limpio);
  if(h.estado==='ambiguo')return h;
  const valor=h.valor||(breve?E.extraerHora(limpio,true):null);
  // El intérprete histórico ya aplica el contexto de restaurante:
  // «a las dos» -> 14:00; «dos de la mañana» o «02:00» -> 02:00.
  return valor?{estado:'seguro',valor}:{estado:'ausente',valor:null};
 }
 const preguntas={fecha:'¿Qué día desea reservar?',personas:'¿Para cuántas personas?',hora:'¿A qué hora desea reservar?',
  nombre:'¿A nombre de quién hacemos la reserva?',email:'¿Cuál es su correo electrónico?',telefono:'¿Cuál es su teléfono?',whatsapp_autorizado:'Si falla el correo, ¿autoriza que le enviemos la confirmación por WhatsApp a este teléfono?',observaciones:'¿Desea añadir alguna observación? Escriba «ninguna» si no necesita añadir nada.'};
 function crear({config,pedir,decir,uuid=()=>crypto.randomUUID(),ahora=()=>new Date(),estadoInicial=null,cierrePorVoz=false,consentimientoWhatsApp=false}){
  let paso='fecha',ocupado=false,correccion=false,pendiente=null,incierto=false,calendario=null,correoPendiente=null,fallosCorreo=0,ofertaWhatsappAutoriza=false,permisoWhatsappPendiente=false;const datos={};
  if(estadoInicial){const e=JSON.parse(JSON.stringify(estadoInicial));paso=e.paso;correccion=e.correccion;pendiente=e.pendiente?Object.freeze(e.pendiente):null;incierto=e.incierto;calendario=e.calendario;correoPendiente=e.correoPendiente;fallosCorreo=e.fallosCorreo||0;ofertaWhatsappAutoriza=e.ofertaWhatsappAutoriza===true;permisoWhatsappPendiente=e.permisoWhatsappPendiente===true;Object.assign(datos,e.datos);}
  const norm=E.normalizarEntrada;
  function hoy(){const p=new Intl.DateTimeFormat('en-CA',{timeZone:config.zonaHoraria,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(ahora());
   const v=t=>Number(p.find(x=>x.type===t).value);return new Date(v('year'),v('month')-1,v('day'),12);}
  function zona(){return config.zonas.find(z=>z.id===datos.zona_id)?.nombre||'';}
  function resumen(contacto=false,voz=false){
   const fecha=new Intl.DateTimeFormat('es-ES',{timeZone:'UTC',weekday:'long',day:'numeric',month:'long',year:'numeric'}).format(new Date(datos.fecha+'T12:00:00Z'));
   const [h,m]=datos.hora.split(':').map(Number);
   const horas=['cero','una','dos','tres','cuatro','cinco','seis','siete','ocho','nueve','diez','once','doce','trece','catorce','quince','dieciséis','diecisiete','dieciocho','diecinueve','veinte','veintiuna','veintidós','veintitrés'];
   const hora=voz?`${horas[h]} ${h===1?'hora':'horas'}`+(m?` y ${m} ${m===1?'minuto':'minutos'}`:''):datos.hora;
   const ubicacion=cierrePorVoz&&config.zonas.length===1&&config.zonas[0].id===datos.zona_id?'':`, en ${zona()}`;
   const telefonoVoz=String(datos.telefono||'').replace(/^\+34(?=[6-9]\d{8}$)/,'');
   if(voz&&cierrePorVoz&&contacto)return `${fecha}, ${datos.personas} personas, a las ${hora}${ubicacion}. A nombre de ${datos.nombre}. Teléfono: ${telefonoVoz}.`+(datos.correo_no_comprendido?' Confirmación por WhatsApp.':'')+(datos.observaciones?` Observaciones: ${datos.observaciones}.`:'');
   return `${fecha}, ${datos.personas} personas, a las ${hora}${ubicacion}.`+(contacto?` A nombre de ${datos.nombre}. Correo: ${datos.email}. Teléfono: ${datos.telefono}. Observaciones: ${datos.observaciones||'ninguna'}.`:'');
  }
  function preguntar(campo){paso=campo;
   if(campo==='whatsapp_autorizado'&&datos.correo_no_comprendido){decir('¿Autoriza que le enviemos la confirmación de su reserva por WhatsApp a este teléfono?');return;}
   decir(campo==='zona_id'?`¿En qué zona prefiere la mesa? ${config.zonas.map(z=>z.nombre).join(', ')}.`:(cierrePorVoz&&campo==='observaciones'?'¿Alguna observación?':preguntas[campo]));}
  function ofrecerWhatsApp(){paso='ofrecer_whatsapp';ofertaWhatsappAutoriza=true;decir('No consigo entender bien el correo. ¿Autoriza que le enviemos la confirmación por WhatsApp al teléfono que nos indique?');}
  function falloCorreo(){
   fallosCorreo++;correoPendiente=null;
   if(cierrePorVoz&&consentimientoWhatsApp&&fallosCorreo>=2){ofrecerWhatsApp();return;}
   preguntar('email');decir('Puede decir arroba y punto, o deletrearlo despacio.');
  }
  function confirmarTelefono(){paso='confirmar_telefono';const tel=String(datos.telefono).replace(/^\+34(?=[6-9]\d{8}$)/,'');decir('He entendido el teléfono '+[...tel].join(', ')+'. ¿Es correcto?');}
  function confirmarCorreo({retomar=false,deletrear=false}={}){
   const inicio=retomar?'Retomamos la reserva. El correo es ':'He entendido: ';
   const fin=cierrePorVoz?' ¿Es correcto?':' ¿Es correcto? Indique «Sí» o «No».';
   decir(inicio+correoPendiente+'.'+fin,{voz:inicio+leerCorreo(correoPendiente,deletrear)+'.'+fin});
  }
  function confirmar(){paso=datos.observaciones!==undefined?'final':'resumen';const fin=cierrePorVoz?' ¿Es correcto?':' ¿Son correctos los datos? Indique «Sí» o «No».';decir(resumen(paso==='final')+fin,{voz:resumen(paso==='final',true)+fin});}
  async function avanzar(campo){
   if(correccion){
    if(campo==='telefono'&&datos.correo_no_comprendido){confirmarTelefono();return;}
    if(campo==='telefono'&&consentimientoWhatsApp&&datos.whatsapp_autorizado===undefined){preguntar('whatsapp_autorizado');return;}
    correccion=false;confirmar();return;
   }
   if(['fecha','personas','hora','zona_id'].includes(campo)){
    for(const siguiente of (cierrePorVoz?['fecha','hora','personas']:['fecha','personas','hora']))if(datos[siguiente]===undefined){preguntar(siguiente);return;}
    if(!datos.zona_id){
     if(config.zonas.length===1){datos.zona_id=config.zonas[0].id;if(!cierrePorVoz)decir(`Reservaremos en ${zona()}, la única zona abierta.`);}
     else {preguntar('zona_id');return;}
    }
    if(cierrePorVoz){if(await disponible())preguntar('nombre');}
    else confirmar();
   }else if(campo==='nombre')preguntar('email');else if(campo==='email')preguntar('telefono');
   else if(campo==='telefono'&&datos.correo_no_comprendido)confirmarTelefono();
   else if(campo==='telefono')preguntar(consentimientoWhatsApp&&datos.whatsapp_autorizado===undefined?'whatsapp_autorizado':'observaciones');
   else if(campo==='whatsapp_autorizado')preguntar('observaciones');else confirmar();
  }
  function guardarComplementos(texto,campo){
   if(correccion||!['fecha','personas','hora','zona_id'].includes(campo))return;
   // Solo señales explícitas fuera del campo preguntado; nunca convertir el
   // número de un día o de una hora en comensales.
   if(campo!=='personas'&&/\b(?:personas?|comensales?|somos|seremos|para|pa)\b/i.test(texto)){
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
    if(paso==='ofrecer_whatsapp'){
     if(!ofertaWhatsappAutoriza){ofrecerWhatsApp();return;}
     const n=norm(texto);
     if(/^(?:si(?: por favor)?|si (?:lo )?autorizo|(?:lo )?autorizo)$/.test(n)){
      datos.email='';datos.correo_no_comprendido=true;delete datos.whatsapp_autorizado;permisoWhatsappPendiente=true;correoPendiente=null;
      preguntar('telefono');return;
     }
     if(/^(?:no(?: gracias)?|solo por correo)$/.test(n)){fallosCorreo=0;preguntar('email');return;}
     decir('¿Autoriza el envío de la confirmación por WhatsApp? Diga «Sí» o «No».');return;
    }
    if(paso==='confirmar_telefono'){
     const r=E.interpretarValidacionDatos(texto);
     if(r==='si'){
      if(permisoWhatsappPendiente){permisoWhatsappPendiente=false;datos.whatsapp_autorizado=true;await avanzar('whatsapp_autorizado');}
      else preguntar('whatsapp_autorizado');
      return;
     }
     if(r==='no'){preguntar('telefono');return;}
     decir('Diga «Sí» si el teléfono es correcto o «No» para repetirlo.');return;
    }
    // Una corrección explícita identifica el dato en este mismo turno, también
    // mientras se pregunta por el permiso o las observaciones. No interpretar
    // las cifras de la frase: pedir el valor completo evita mezclar dos números.
    const nCorreccion=norm(texto);
    const camposCorreccion=[['fecha',/\b(?:fecha|dia)\b/],['hora',/\bhora\b/],['personas',/\bpersonas?\b/],['zona_id',/\bzona\b/],['nombre',/\bnombre\b/],['email',/\b(?:correo|email)\b/],['telefono',/\btelefono\b/],['observaciones',/\bobservaciones?\b/],['whatsapp_autorizado',/\b(?:whatsapp|autorizacion)\b/]];
    const pideCorreccion=/\b(?:cambiar|cambio|cambie|modificar|corregir|corrige|equivoque|equivocado|equivocada|incorrecto|incorrecta)\b|\bno (?:es|era|esta|son|eran|estan) (?:el |la |los |las )?(?:correct[oa]s?|bien)\b/.test(nCorreccion);
    if(pideCorreccion&&['resumen','final','corregir','whatsapp_autorizado','observaciones'].includes(paso)){
     const campos=camposCorreccion.filter(([c,re])=>datos[c]!==undefined&&re.test(nCorreccion));
     if(campos.length===1&&(['resumen','final','corregir'].includes(paso)||campos[0][0]==='telefono')){correccion=['resumen','final','corregir'].includes(paso);correoPendiente=null;preguntar(campos[0][0]);return;}
     if(campos.length>1){paso='corregir';decir('¿Qué dato desea cambiar primero?');return;}
    }
    const eligeCampo=paso==='corregir'&&/^(?:(?:el|la|mi) )?(?:fecha|dia|hora|personas|zona|nombre|correo(?: electronico)?|email|telefono|observaciones|whatsapp|autorizacion)$/.test(norm(texto));
    if(I.esConsulta(texto)&&!eligeCampo){
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
     if(respuesta==='si'){datos.email=correoPendiente;delete datos.correo_no_comprendido;fallosCorreo=0;correoPendiente=null;await avanzar('email');return;}
     if(respuesta==='no'){falloCorreo();return;}
     const nuevo=correoDictado(texto);
     if(nuevo){correoPendiente=nuevo;confirmarCorreo();}
     else decir('Indique «Sí» si el correo es correcto, «No» para repetirlo, o diga el correo completo de nuevo.');
     return;
    }
    if(paso==='corregir'){
     const n=norm(texto);const campos=[['fecha',/fecha|dia/],['hora',/hora/],['personas',/persona/],['zona_id',/zona/],['nombre',/nombre/],['email',/correo|email/],['telefono',/telefono/],['observaciones',/observaci/],['whatsapp_autorizado',/whatsapp|autorizacion/]];
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
    if(campo==='whatsapp_autorizado'){
     const n=norm(texto);
     if(/^(?:si(?: por favor)?|si (?:lo )?autorizo|(?:lo )?autorizo)$/.test(n))valor=true;
     else if(/^(?:no(?: gracias)?|no (?:lo )?autorizo|solo por correo)$/.test(n))valor=false;
     else {decir('¿Autoriza el WhatsApp de respaldo? Diga «Sí» o «No».');return;}
     if(datos.correo_no_comprendido&&!valor){delete datos.correo_no_comprendido;delete datos.whatsapp_autorizado;delete datos.email;fallosCorreo=0;correccion=false;decir('No enviaremos WhatsApp. Necesitamos recoger el correo para la confirmación.');preguntar('email');return;}
     datos.whatsapp_autorizado=valor;await avanzar(campo);return;
    }
    guardarComplementos(texto,campo);
    if(campo==='fecha'){
     const f=F.analizarFecha(texto,hoy());if(f.estado!=='seguro'){decir('No he podido identificar el día. ¿Puede indicarme el día y el mes?');return;}
     const r=await pedir('supabase_web_fecha',{fecha:f.valor});if(!r.fecha_admitida){decir('El restaurante está cerrado para reservas ese día. ¿Qué otro día prefiere?');return;}
     calendario={fecha:f.valor,horario:r.horario};
     valor=f.valor;if(!cierrePorVoz)decir(`El horario de reservas de ese día es de ${r.horario.join(' y de ').replaceAll('-',' a ')}.`);
    }else if(campo==='personas'){
     const p=personasReserva(texto);
     if(p.estado!=='seguro'||!Number.isInteger(p.valor)||p.valor<1||p.valor>1000){decir('¿Para cuántas personas exactamente?');return;}valor=p.valor;
    }else if(campo==='hora'){
     // Si el cliente adelanta los comensales, conservarlos sin convertirlos
     // en una hora. La hora se pregunta por separado.
     if(cierrePorVoz&&datos.personas!==undefined&&horaReserva(texto).estado==='ausente'&&/\b(?:para|personas?|comensales?|somos|seremos)\b/i.test(texto)){preguntar('hora');return;}
     const h=horaReserva(texto,true);
     if(h.estado!=='seguro'){decir('Indique una hora sin ambigüedad, como 14:00 o «dos de la tarde».');return;}valor=h.valor;
    }else if(campo==='zona_id'){
     const z=config.zonas.find(z=>norm(z.nombre)===norm(texto.replace(/^(en\s+)?(la\s+zona\s+)?/i,'')));
     if(!z){preguntar('zona_id');return;}valor=z.id;
    }else if(campo==='nombre'){valor=nombreCliente(texto);if(!valor||valor.length>200){decir('Necesito el nombre de la persona para la reserva.');return;}if(!cierrePorVoz)decir('A nombre de '+valor+'.');}
    else if(campo==='email'){
     if(canal==='voz'){
      valor=correoDictado(texto);
      if(!valor){falloCorreo();return;}
      correoPendiente=valor;paso='confirmar_email';confirmarCorreo();return;
     }
     valor=texto.toLowerCase();if(!emailValido(valor)){decir('Revise el correo electrónico.');return;}
    }
    else if(campo==='telefono'){valor=E.normalizarTelefono(texto);if(!E.telefonoValido(valor)||!/^\+?[0-9 ()-]{7,40}$/.test(valor)){decir('Indique el teléfono con sus cifras, por ejemplo 600000000.');return;}}
    else if(campo==='observaciones')valor=/^(ningun[ao]?|no|nada)$/i.test(norm(texto))?'':texto;
    if(campo==='telefono'&&datos.telefono!==valor)delete datos.whatsapp_autorizado;
    datos[campo]=valor;await avanzar(campo);
   }catch(error){
    let mensaje=error.message||'No se pudo consultar el servicio. Inténtelo de nuevo.';
    if(error.codigo==='FUERA_HORARIO'&&calendario?.fecha===datos.fecha&&calendario.horario.length){
     mensaje=`Nuestro horario de apertura ese día es de ${calendario.horario.join(' y de ').replaceAll('-',' a ')}. ¿A qué otra hora desea reservar?`;
     correccion=!cierrePorVoz||datos.observaciones!==undefined;paso='hora';
    }
    decir(mensaje);
   }
   finally{ocupado=false;}
  }
  return {enviar,iniciar(){decir(`Bienvenido a ${config.nombre}. Vamos a hacer una reserva de prueba.`);preguntar('fecha');},
   estado:()=>({paso,ocupado,pendiente:pendiente?{...pendiente}:null}),
   exportar:()=>JSON.parse(JSON.stringify({paso,correccion,pendiente,incierto,calendario,correoPendiente,fallosCorreo,ofertaWhatsappAutoriza,permisoWhatsappPendiente,datos})),
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
