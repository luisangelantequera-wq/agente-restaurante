'use strict';
(function(root,factory){
 if(typeof module==='object'&&module.exports)module.exports=factory(require('./fecha-conversacional'),require('./entrada-conversacional'),require('./informacion-publica-respuestas'));
 else root.ContactiaChatSupabase=factory(root.ContactiaFechas,root.ContactiaEntrada,root.ContactiaInformacion);
})(typeof window==='undefined'?globalThis:window,function(F,E,I){
 const preguntas={fecha:'¿Qué día desea reservar?',personas:'¿Para cuántas personas?',hora:'¿A qué hora desea reservar? Puede indicar 14:00 o «dos de la tarde».',
  nombre:'¿A nombre de quién hacemos la reserva?',email:'¿Cuál es su correo electrónico?',telefono:'¿Cuál es su teléfono?',observaciones:'¿Desea añadir alguna observación? Escriba «ninguna» si no necesita añadir nada.'};
 function crear({config,pedir,decir,uuid=()=>crypto.randomUUID(),ahora=()=>new Date()}){
  let paso='fecha',ocupado=false,correccion=false,pendiente=null,incierto=false,calendario=null;const datos={};
  const norm=E.normalizarEntrada;
  function hoy(){const p=new Intl.DateTimeFormat('en-CA',{timeZone:config.zonaHoraria,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(ahora());
   const v=t=>Number(p.find(x=>x.type===t).value);return new Date(v('year'),v('month')-1,v('day'),12);}
  function zona(){return config.zonas.find(z=>z.id===datos.zona_id)?.nombre||'';}
  function resumen(contacto=false){
   const fecha=new Intl.DateTimeFormat('es-ES',{timeZone:'UTC',weekday:'long',day:'numeric',month:'long',year:'numeric'}).format(new Date(datos.fecha+'T12:00:00Z'));
   return `${fecha}, ${datos.personas} personas, a las ${datos.hora}, en ${zona()}.`+(contacto?` A nombre de ${datos.nombre}. Correo: ${datos.email}. Teléfono: ${datos.telefono}. Observaciones: ${datos.observaciones||'ninguna'}.`:'');
  }
  function preguntar(campo){paso=campo;decir(campo==='zona_id'?`¿En qué zona prefiere la mesa? ${config.zonas.map(z=>z.nombre).join(', ')}.`:preguntas[campo]);}
  function confirmar(){paso=datos.observaciones!==undefined?'final':'resumen';decir(resumen(paso==='final')+' ¿Son correctos los datos? Indique «Sí» o «No».');}
  function avanzar(campo){
   if(correccion){correccion=false;confirmar();return;}
   if(campo==='fecha')preguntar('personas');
   else if(campo==='personas')preguntar('hora');
   else if(campo==='hora'){
    if(config.zonas.length===1){datos.zona_id=config.zonas[0].id;decir(`Reservaremos en ${zona()}, la única zona abierta.`);confirmar();}else preguntar('zona_id');
   }else if(campo==='zona_id')confirmar();
   else if(campo==='nombre')preguntar('email');else if(campo==='email')preguntar('telefono');
   else if(campo==='telefono')preguntar('observaciones');else confirmar();
  }
  async function disponible(){const r=await pedir('supabase_web_disponibilidad',{fecha:datos.fecha,hora:datos.hora,personas:datos.personas,zona_id:datos.zona_id});
   if(!r.disponible){paso='corregir';decir('No quedan mesas para esos datos. ¿Qué desea cambiar: fecha, hora, personas o zona?');return false;}return true;}
  async function enviar(texto){
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
     else decir('Retomamos la reserva. '+(preguntas[paso]||`¿En qué zona prefiere la mesa? ${config.zonas.map(z=>z.nombre).join(', ')}.`));
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
     if(!await disponible())return;
     if(paso==='resumen'){decir('Hay disponibilidad en este momento. La mesa se asignará al confirmar la reserva.');preguntar('nombre');}
     else {pendiente=Object.freeze({...datos,peticion_id:uuid()});paso='pendiente';decir('Complete la verificación de seguridad y pulse «Verificar y confirmar» para registrar su reserva de prueba.');}
     return;
    }
    const campo=paso;let valor=texto;
    if(campo==='fecha'){
     const f=F.analizarFecha(texto,hoy());if(f.estado!=='seguro'){decir('No he podido identificar un único día. Indique una fecha, por ejemplo «28 de octubre».');return;}
     const r=await pedir('supabase_web_fecha',{fecha:f.valor});if(!r.fecha_admitida){decir('El restaurante está cerrado para reservas ese día. ¿Qué otro día prefiere?');return;}
     calendario={fecha:f.valor,horario:r.horario};
     valor=f.valor;decir(`El horario de reservas de ese día es de ${r.horario.join(' y de ').replaceAll('-',' a ')}.`);
    }else if(campo==='personas'){
     const p=E.analizarPersonas(/^\d+$/.test(texto)?`${texto} personas`:texto);
     if(p.estado!=='seguro'||!Number.isInteger(p.valor)||p.valor<1||p.valor>1000){decir('Indique un único número de personas, entre 1 y 1000.');return;}valor=p.valor;
    }else if(campo==='hora'){
     const h=E.analizarHora(texto);
     const explicita=/:|mañana|tarde|noche|madrugada|mediod[ií]a|medianoche|\b(?:1[3-9]|2[0-3])\b|trece|catorce|quince|diecis[eé]is|diecisiete|dieciocho|diecinueve|veinte|veinti/.test(texto.toLowerCase());
     if(h.estado!=='seguro'||!explicita){decir('Indique una hora sin ambigüedad, como 14:00 o «dos de la tarde».');return;}valor=h.valor;
    }else if(campo==='zona_id'){
     const z=config.zonas.find(z=>norm(z.nombre)===norm(texto.replace(/^(en\s+)?(la\s+zona\s+)?/i,'')));
     if(!z){preguntar('zona_id');return;}valor=z.id;
    }else if(campo==='nombre'){valor=E.normalizarNombreCliente(texto);if(!valor||valor.length>200){decir('Indique un nombre de hasta 200 caracteres.');return;}}
    else if(campo==='email'){valor=texto.toLowerCase();if(valor.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(valor)){decir('Revise el correo electrónico.');return;}}
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
   async confirmar(reservar){if(ocupado||paso!=='pendiente')return;ocupado=true;
    try{const r=await reservar({...pendiente});paso='terminado';decir(`${r.mensaje} Referencia: ${r.referencia}`);}
    catch(error){
     // Solo un rechazo explícito anterior a la escritura permite editar. Un 5xx o fallo de red conserva UUID y datos.
     if(!incierto&&[400,403,409,422,429].includes(error.status)){pendiente=null;paso='corregir';decir(error.message+' Puede corregir un dato y volver a confirmar.');}
     else {incierto=true;decir('No se pudo comprobar el resultado. Reintente con «Verificar y confirmar»: conservamos la misma solicitud para evitar duplicados.');}
    }finally{ocupado=false;}
   }};
 }
 return {crear};
});
