(function(root,factory){
 if(typeof module==='object'&&module.exports)module.exports=factory(require('./ajustes-restaurante'),require('./conocimiento-restaurante'));
 else root.ContactiaInformacion=factory(root.ContactiaAjustes,root.ContactiaConocimiento);
})(typeof window==='undefined'?globalThis:window,function(A,C){
 'use strict';
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
  const gastro=A.responderGastronomia(datos,pregunta);if(gastro)return gastro;
  if(A.esPreguntaHorario(pregunta))return A.describirHorario(campos,pregunta,ahora,campos.zona_horaria||'Europe/Madrid');
  const habitual=C.seleccionarConocimiento(pregunta,A.registrosPublicos(datos));if(habitual)return habitual.respuesta;
  return 'Todavía no dispongo de esa información.'+contacto;
 }
 return {esConsulta,responder};
});
