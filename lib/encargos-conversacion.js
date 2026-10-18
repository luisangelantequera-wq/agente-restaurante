(function(root,factory){const api=factory();if(typeof module!=='undefined'&&module.exports)module.exports=api;if(root)root.ContactiaEncargosConversacion=api;})(typeof window!=='undefined'?window:null,function(){
'use strict';
function crear({modelo,entrada,datos,decir,paso}){
 let grupos=[],items=[],clave='',respondido=false,indice=0,pendiente=null,continuar=()=>{},preguntaActual='';
 const preguntar=(estado,texto)=>{paso(estado);preguntaActual=texto;decir(texto);};
 const usados=g=>items.filter(p=>p.grupo_id===g.id).reduce((n,p)=>n+p.personas,0);
 function ofrecer(){if(indice>=grupos.length){respondido=true;continuar();return;}const g=grupos[indice];preguntar('encargo_plato',(g.pregunta||`Si desea algún plato de ${g.nombre}, indique cuál va a pedir.`)+` Opciones: ${g.platos.map((p,i)=>`${i+1}. ${p}`).join('; ')}. Mínimo ${g.minimo} personas por plato, con ${g.antelacion_horas} horas de antelación. Puede responder «No, gracias».`);}
 function siguiente(){indice++;pendiente=null;ofrecer();}
 function cantidad(valor){const g=grupos[indice],n=Number(valor),restantes=datos().personas-usados(g);if(!Number.isInteger(n)||n<g.minimo||n>restantes){preguntar('encargo_personas',`Para ${pendiente}, indique entre ${g.minimo} y ${restantes} personas.`);return;}
  items.push({grupo_id:g.id,plato:pendiente,personas:n});pendiente=null;decir(`Anotado: ${modelo.resumen([items[items.length-1]])}.`);if(datos().personas-usados(g)>=g.minimo)preguntar('encargo_otro',`¿Desea añadir otro plato de ${g.nombre} para los demás comensales? Indique «Sí» o «No».`);else siguiente();
 }
 return {
  configurar(opciones,nuevaClave){const cs=JSON.stringify([nuevaClave,opciones||[]]);if(cs!==clave){if(items.length)decir('Al cambiar los datos o condiciones de la reserva, revisaremos de nuevo los platos por encargo.');grupos=modelo.validarGrupos(opciones||[]);items=[];respondido=false;clave=cs;}},
  comenzar(callback){continuar=callback;if(respondido||!grupos.length){respondido=true;continuar();}else{indice=0;items=[];ofrecer();}},
  procesar(texto,estado){if(!estado.startsWith('encargo_'))return false;const q=modelo.normalizar(texto),binaria=entrada.interpretarRespuestaBinaria(texto);const g=grupos[indice];if(!g)return false;
   if(estado==='encargo_otro'){if(binaria==='si')ofrecer();else if(binaria==='no')siguiente();else preguntar('encargo_otro','¿Desea otro plato de este grupo? Indique «Sí» o «No».');return true;}
   if(estado==='encargo_personas'){const n=q==='todos'||q==='todas'?datos().personas-usados(g):(entrada.analizarPersonas(texto).valor||entrada.extraerPersonas(texto));cantidad(n);return true;}
   if(binaria==='no'||/^(ninguno|ninguna|nada|sin encargo)$/.test(q)){siguiente();return true;}
   if(/[¿?]/.test(texto))return false;
   const plato=modelo.elegir(texto,g);if(!plato){ofrecer();return true;}
   if(items.some(p=>p.grupo_id===g.id&&p.plato===plato)){decir('Ese plato ya está anotado. Elija otro de las opciones o responda «No, gracias».');return true;}
   pendiente=plato;const analisis=entrada.analizarPersonas(texto);if(/\bpara\b/.test(q)&&analisis.valor)cantidad(analisis.valor);else preguntar('encargo_personas',`¿Para cuántas personas desea ${plato}? Mínimo ${g.minimo}, hasta ${datos().personas-usados(g)} personas.`);return true;
  },
  repetir(){if(preguntaActual)decir(preguntaActual);},
  seleccion(){return items.map(p=>({...p}));},
  resumen(){return modelo.resumen(items);},
  limpiar(){grupos=[];items=[];clave='';respondido=false;pendiente=null;preguntaActual='';}
 };
}
return {crear};
});
