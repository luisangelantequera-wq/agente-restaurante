(function(root,factory){
 if(typeof module==='object'&&module.exports)module.exports=factory(require('./ajustes-restaurante'),require('./conocimiento-restaurante'));
 else root.ContactiaInformacion=factory(root.ContactiaAjustes,root.ContactiaConocimiento);
})(typeof window==='undefined'?globalThis:window,function(A,C){
 'use strict';
 function redactarGastronomia(texto,pregunta){
  const q=C.normalizarTextoConocimiento(pregunta);let transformadas=0;const platos=[];
  const frases=texto.split(/\n+/).map(linea=>{
   const original=linea.trim();
   const m=original.match(/^(?:(?:el|los)\s+)?(lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bados?|domingos?)(?:\s*[:–—-]\s*|\s+)(.+)$/i);
   if(!m)return original;
   let plato=m[2].replace(/[.]$/,'').trim();const n=C.normalizarTextoConocimiento(plato);
   // Solo redactar apuntes breves afirmativos. Las frases ya escritas y sus
   // condiciones o negaciones se conservan tal como las definió el restaurante.
   if(/\b(no|sin|excepto|cerrado|cerrados|agotado|agotados|tenemos|servimos|hay|ofrecemos|preparamos|puede|debe|necesita|disponible|disponibles|segun|desde|hasta)\b/.test(n))return original;
   const dia=A.DIAS.find(d=>C.normalizarTextoConocimiento(d)===C.normalizarTextoConocimiento(m[1]).replace(/^(sabados|domingos)$/,s=>s.slice(0,-1)));
   if(!dia)return original;
   platos.push(n);transformadas++;
   plato=plato.replace(/\s+m[ií]nimo\s+(\d+)\s+personas?$/i,', para un mínimo de $1 personas');
   return `Los ${['sábado','domingo'].includes(dia)?dia+'s':dia} tenemos ${plato}.`;
  });
  const preguntaDirecta=/^(?:teneis|tienen|hay|servis|sirven|preparais|preparan|ofreceis|ofrecen)\b/.test(q);
  const fechaExplicita=/\b(hoy|manana|pasado|lunes|martes|miercoles|jueves|viernes|sabado|sabados|domingo|domingos)\b|\d/.test(q);
  const coincide=platos.some(p=>q.split(' ').some(t=>t.length>2&&p.split(' ').includes(t)&&!['tenemos','para','personas','minimo'].includes(t)));
  const respuesta=frases.join(' ');
  return preguntaDirecta&&!fechaExplicita&&coincide&&transformadas===frases.length?`Sí, ${respuesta[0].toLowerCase()}${respuesta.slice(1)}`:respuesta;
 }
 function esConsulta(pregunta){
  const n=C.normalizarTextoConocimiento(pregunta);
  const tema=/\b(direccion|ubicacion|llegar|telefono|telefonos|contactar|contacto|llamar|web|pagina|aparcamiento|aparcar|parking|transporte|metro|autobus|accesibilidad|accesible|escalones|movilidad|mascotas?|perros?|animales|tronas?|bebes?|ninos|infantil|grupos?|celebraciones|cumpleanos|eventos|pagos?|pagar|tarjeta|efectivo|bizum|gastronomia|especialidades|menu|menus|platos|comidas|cocido|paella|arroces|encargos?|encargar|alergenos|alergias?|intolerancia|gluten|lactosa|vegetariano|vegano)\b|silla de ruedas/.test(n);
  const contacto=/\bdonde (?:estais|estan|esta)|\bcomo llegar/.test(n);
  const ingredientes=/\b(ingredientes|trazas|celiaco|halal|kosher|leche|huevos?|cacahuetes|soja|sesamo|sulfitos|mostaza|apio|altramuces|moluscos|crustaceos)\b/.test(n);
  const platosPorDia=/\bque (?:teneis|tienen|hay|servis|preparais|preparan)\b/.test(n)&&A.DIAS.some(d=>new RegExp('\\b'+C.normalizarTextoConocimiento(d)+'\\b').test(n));
  return (A.esPreguntaHorario(pregunta)||tema||contacto||ingredientes||platosPorDia) && (C.esPreguntaInformativa(pregunta)||/^(?:el |la |los |las )?(?:horarios?|telefono|direccion|web|menu|gastronomia|especialidades)$/.test(n));
 }
 function responder(campos,pregunta,ahora=new Date()){
  const datos=A.normalizarPublico(campos),n=C.normalizarTextoConocimiento(pregunta);
  const contacto=campos.telefono_publico?` Puede contactar con el restaurante en el ${campos.telefono_publico}.`:'';
  if(/alerg|intoler|celiac|gluten|lactosa|trazas|ingredientes|vegetarian|vegan|halal|kosher|\b(leche|huevos?|cacahuetes|soja|sesamo|sulfitos|mostaza|apio|altramuces|moluscos|crustaceos)\b/.test(n))
   return 'Para confirmar los ingredientes, alérgenos o la adaptación de un plato, consulte directamente con el restaurante.'+contacto;
  if(/\b(telefono|telefonos|contactar|contacto|llamar)\b/.test(n))return campos.telefono_publico?`El teléfono del restaurante es ${campos.telefono_publico}.`:'Todavía no dispongo del teléfono del restaurante.';
  const gastro=A.responderGastronomia(datos,pregunta);if(gastro)return redactarGastronomia(gastro,pregunta);
  if(A.esPreguntaHorario(pregunta))return A.describirHorario(campos,pregunta,ahora,campos.zona_horaria||'Europe/Madrid');
  const habitual=C.seleccionarConocimiento(pregunta,A.registrosPublicos(datos));if(habitual)return habitual.respuesta;
  return 'Todavía no dispongo de esa información.'+contacto;
 }
 return {esConsulta,responder};
});
