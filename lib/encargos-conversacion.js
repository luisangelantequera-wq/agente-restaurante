(function(root,factory){const api=factory();if(typeof module!=='undefined'&&module.exports)module.exports=api;if(root)root.ContactiaEncargosConversacion=api;})(typeof window!=='undefined'?window:null,function(){
'use strict';
function crear({modelo,entrada,datos,decir,paso}){
 let grupos=[],items=[],clave='',respondido=false,indice=0,pendiente=null,continuar=()=>{},preguntaActual='';
 const preguntar=(estado,texto)=>{paso(estado);preguntaActual=texto;decir(texto);};
 const usados=g=>items.filter(p=>p.grupo_id===g.id).reduce((n,p)=>n+p.personas,0);
 function ofrecer(soloRepetir=false){
  if(indice>=grupos.length){respondido=true;continuar();return;}
  const g=grupos[indice],unico=g.platos.length===1;
  const lista=g.platos.length===2?g.platos.join(' y '):g.platos.slice(0,-1).join(', ')+' y '+g.platos[g.platos.length-1];
  const inicio=unico?`¿Va a tomar ${g.platos[0]}?`:(g.pregunta||`Si desea algún plato de ${g.nombre}, indique cuál va a pedir.`)+` Tenemos ${lista}.`;
  const minimo=g.minimo>1?` para un mínimo de ${g.minimo} personas`:'';
  const texto=inicio+` Puede pedirlo${minimo}, siempre que se reserve con ${g.antelacion_horas} ${g.antelacion_horas===1?'hora':'horas'} de antelación. Puede responder «${unico?'Sí» o «No, gracias':'No, gracias'}».`;
  if(soloRepetir)decir(texto);else preguntar('encargo_plato',texto);
 }
 function siguiente(){indice++;pendiente=null;ofrecer();}
 function cantidad(valor){const g=grupos[indice],n=Number(valor),total=datos().personas,restantes=total-usados(g);
  if(Number.isInteger(n)&&n>total){preguntar('encargo_personas',`Ha indicado ${n} personas, pero la reserva es para ${total}. ¿Puede indicarlo de nuevo?`);return;}
  if(Number.isInteger(n)&&n>restantes){preguntar('encargo_personas',`Ya hemos anotado ${usados(g)} personas para otros platos de ${g.nombre} y quedan ${restantes} por asignar. ¿Puede indicarlo de nuevo?`);return;}
  if(!Number.isInteger(n)||n<1){preguntar('encargo_personas',`¿Cuántas personas tomarán ${pendiente}?`);return;}
  if(n<g.minimo){preguntar('encargo_personas',`El mínimo para ${pendiente} es de ${g.minimo} personas. ¿Puede indicarlo de nuevo?`);return;}
  items.push({grupo_id:g.id,plato:pendiente,personas:n});pendiente=null;decir(`Anotado: ${modelo.resumen([items[items.length-1]])}.`);if(g.platos.some(p=>!items.some(i=>i.grupo_id===g.id&&i.plato===p))&&datos().personas-usados(g)>=g.minimo)preguntar('encargo_otro',`¿Desea añadir otro plato de ${g.nombre} para los demás comensales? Indique «Sí» o «No».`);else siguiente();
 }
 return {
  configurar(opciones,nuevaClave){const cs=JSON.stringify([nuevaClave,opciones||[]]);if(cs!==clave){if(items.length)decir('Al cambiar los datos o condiciones de la reserva, revisaremos de nuevo los platos por encargo.');grupos=modelo.validarGrupos(opciones||[]);items=[];respondido=false;clave=cs;}},
  comenzar(callback){continuar=callback;if(respondido||!grupos.length){respondido=true;continuar();}else{indice=0;items=[];ofrecer();}},
  procesar(texto,estado){if(!estado.startsWith('encargo_'))return false;const q=modelo.normalizar(texto),binaria=entrada.interpretarRespuestaBinaria(texto);const g=grupos[indice];if(!g)return false;
   const pideLista=/^(?:(?:me|nos) )?(?:(?:puedes?|podrias?|podria|pueden|podrian) )?(?:repetir|repites?|repita|repitan|volver a decir) (?:los |las |la )?(?:platos(?: de [a-z ]+)?|opciones|lista|arroces|arroz)(?: por favor)?$/.test(q);
   if(pideLista){ofrecer(true);if(estado!=='encargo_plato'&&preguntaActual)decir(preguntaActual);return true;}
   if(/^(?:(?:me |nos )?(?:lo )?(?:puedes?|podrias?|podria|pueden|podrian) (?:volver a )?(?:repetir|decir(?:lo)? (?:de nuevo|otra vez))|(?:me |nos )?(?:lo )?(?:repites?|repite|repita|repitan|repetir)(?:melo|noslo|lo)?|(?:puedes?|podrias?|podria) repetir(?:melo|noslo|lo)?)(?: (?:por favor|otra vez|de nuevo))?$/.test(q)){if(preguntaActual)decir(preguntaActual);return true;}
   if(estado==='encargo_otro'){if(binaria==='si')ofrecer();else if(binaria==='no')siguiente();else preguntar('encargo_otro','¿Desea otro plato de este grupo? Indique «Sí» o «No».');return true;}
   if(estado==='encargo_personas'){const n=q==='todos'||q==='todas'?datos().personas-usados(g):(entrada.analizarPersonas(texto).valor||entrada.extraerPersonas(texto));cantidad(n);return true;}
   if(binaria==='no'||/^(ninguno|ninguna|nada|sin encargo)$/.test(q)){siguiente();return true;}
   if(/[¿?]/.test(texto))return false;
   const plato=g.platos.length===1&&binaria==='si'?g.platos[0]:modelo.elegir(texto,g);if(!plato){ofrecer();return true;}
   if(items.some(p=>p.grupo_id===g.id&&p.plato===plato)){decir('Ese plato ya está anotado. Elija otro de las opciones o responda «No, gracias».');return true;}
   pendiente=plato;const analisis=entrada.analizarPersonas(texto);if(/\bpara\b/.test(q)&&analisis.valor)cantidad(analisis.valor);else preguntar('encargo_personas',`¿Cuántas personas tomarán ${plato}?`);return true;
  },
  repetir(){if(preguntaActual)decir(preguntaActual);},
  seleccion(){return items.map(p=>({...p}));},
  resumen(){return modelo.resumen(items);},
  limpiar(){grupos=[];items=[];clave='';respondido=false;pendiente=null;preguntaActual='';}
 };
}
return {crear};
});
