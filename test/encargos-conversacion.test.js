'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {crearSimuladorConversacion}=require('./soporte/simulador-conversacion');
const grupo={id:'arroces',nombre:'Arroces',platos:['Arroz del señoret','Arroz negro'],dias:['lunes','martes','miércoles','jueves','viernes','sábado','domingo'],minimo:2,antelacion_horas:1,pregunta:'Si va a pedir algún arroz, indique cuál.',activo:true};
async function empezar(opciones=[grupo],abrirLista=true){const s=await crearSimuladorConversacion({respuestas:{verificar:[{ok:true,momento_valido:true},{ok:true,disponible:true,encargos_disponibles:opciones}]}});let r;for(const t of ['quiero reservar mañana','4','14:00','interior','sí'])r=await s.enviar(t);if(abrirLista&&r.paso==='encargo_interes')r=await s.enviar('sí');return {s,r};}
async function contacto(s){let r;for(const t of ['Luis Prueba','cliente@example.com','612345678'])r=await s.enviar(t);assert.equal(r.paso,'observaciones');return r;}
test('reserva pregunta por el arroz, recoge comensales, lo incluye en el resumen y lo envía al servidor',async()=>{
 const {s,r}=await empezar();assert.equal(r.paso,'encargo_plato');assert.match(r.respuesta,/Arroz del señoret/);
 assert.equal((await s.enviar('Arroz del señoret')).paso,'encargo_personas');assert.equal((await s.enviar('1')).paso,'encargo_personas');assert.equal((await s.enviar('4')).paso,'nombre');await contacto(s);
 const resumen=await s.enviar('no');assert.equal(resumen.paso,'confirmacion');assert.match(resumen.respuesta,/Encargo: Arroz del señoret: 4 personas/);
 await s.enviar('sí, confirmo la reserva');const alta=s.solicitudes.find(x=>x.accion==='reservar');assert.deepEqual(alta.encargos,[{grupo_id:'arroces',plato:'Arroz del señoret',personas:4}]);
});
test('no gracias continúa la reserva sin encargo ni obligación de pedir comida',async()=>{
 const {s,r}=await empezar();assert.equal(r.paso,'encargo_plato');assert.equal((await s.enviar('no gracias')).paso,'nombre');await contacto(s);await s.enviar('no');await s.enviar('sí, confirmo la reserva');assert.equal(s.solicitudes.find(x=>x.accion==='reservar').encargos,undefined);
});
test('sin platos elegibles conserva el flujo normal de reservas',async()=>{const {r}=await empezar([]);assert.equal(r.paso,'nombre');assert.doesNotMatch(r.respuesta,/arroces|encargo/i);});

test('pregunta por varios grupos antes del nombre y omite el mínimo de una persona y usa el singular de hora',async()=>{
 const cocido={...grupo,id:'cocidos',nombre:'Legumbres',platos:['Cocido'],minimo:1};
 const {s,r}=await empezar([grupo,cocido]);assert.equal(r.paso,'encargo_plato');assert.doesNotMatch(r.respuesta,/nombre|correo|teléfono/);
 const siguiente=await s.enviar('no gracias');assert.equal(siguiente.paso,'encargo_plato');assert.match(siguiente.respuesta,/Cocido/);assert.doesNotMatch(siguiente.respuesta,/Mínimo|1 persona/);assert.match(siguiente.respuesta,/con 1 hora de antelación/);
 const nombre=await s.enviar('no gracias');assert.equal(nombre.paso,'nombre');assert.match(nombre.respuesta,/nombre/);await contacto(s);
});

test('un solo plato pregunta directamente, acepta sí y no ofrece repetir el mismo plato',async()=>{
 const {s,r}=await empezar([{...grupo,nombre:'Legumbres',platos:['Cocido'],minimo:1}]);
 assert.match(r.respuesta,/¿Va a tomar Cocido\?/);assert.doesNotMatch(r.respuesta,/Opciones|Legumbres|1\. Cocido|mínimo/i);
 const cantidad=await s.enviar('sí');assert.equal(cantidad.paso,'encargo_personas');assert.doesNotMatch(cantidad.respuesta,/mínimo/i);
 const nombre=await s.enviar('2');assert.equal(nombre.paso,'nombre');await contacto(s);assert.match((await s.enviar('no')).respuesta,/Cocido: 2 personas/);
});
test('varios platos se ofrecen sin números y se elige el plato por su nombre distintivo',async()=>{
 const {s,r}=await empezar([{...grupo,pregunta:'',platos:['Arroz a banda','Arroz con bogavante','Paella de Marisco','Paella Valenciana','Arroz Negro'],antelacion_horas:2}]);
 assert.match(r.respuesta,/Tenemos Arroz a banda, Arroz con bogavante, Paella de Marisco, Paella Valenciana y Arroz Negro/);
 assert.match(r.respuesta,/para un mínimo de 2 personas, siempre que se reserve con 2 horas de antelación/);
 assert.doesNotMatch(r.respuesta,/Opciones|1\. Arroz/);
 const cantidad=await s.enviar('queremos el de bogavante');assert.equal(cantidad.paso,'encargo_personas');assert.match(cantidad.respuesta,/Arroz con bogavante/);
 assert.equal((await s.enviar('4')).paso,'nombre');
});

test('repite la pregunta de platos o personas sin enviar la petición al servicio informativo',async()=>{
 const {s,r}=await empezar();const antes=s.solicitudes.length;
 for(const frase of ['me lo puedes repetir?','¿Puede repetirlo, por favor?','repítelo','me lo repites otra vez','¿Me repite los arroces?','puedes repetir los platos de arroz por favor']){const repetida=await s.enviar(frase);assert.equal(repetida.paso,'encargo_plato');assert.equal(repetida.respuesta,r.respuesta.split("\n\n").at(-1));assert.equal(s.solicitudes.length,antes);}
 const cantidad=await s.enviar('Arroz negro');assert.equal(cantidad.respuesta,'¿Cuántas personas tomarán Arroz negro?');
 const repetida=await s.enviar('me lo puedes repetir?');assert.equal(repetida.respuesta,cantidad.respuesta);assert.equal(s.solicitudes.length,antes);
 const lista=await s.enviar('¿Me repite los arroces?');assert.equal(lista.paso,'encargo_personas');assert.match(lista.respuesta,/Arroz del señoret y Arroz negro/);assert.match(lista.respuesta,/¿Cuántas personas tomarán Arroz negro\?/);assert.equal(s.solicitudes.length,antes);
 const exceso=await s.enviar('5');assert.equal(exceso.paso,'encargo_personas');assert.match(exceso.respuesta,/Ha indicado 5 personas, pero la reserva es para 4/);
 assert.equal((await s.enviar('4')).paso,'nombre');
});
test('al repartir entre platos controla las personas restantes sin cambiar el total de la reserva',async()=>{
 const {s}=await empezar();await s.enviar('Arroz negro');await s.enviar('2');await s.enviar('sí');await s.enviar('Arroz del señoret');
 const exceso=await s.enviar('3');assert.equal(exceso.paso,'encargo_personas');assert.match(exceso.respuesta,/quedan 2 por asignar/);assert.equal((await s.enviar('2')).paso,'nombre');
});

test('pregunta si pedirá arroz antes de enumerar y permite continuar sin escuchar la lista',async()=>{
 const {s,r}=await empezar([grupo],false);assert.equal(r.paso,'encargo_interes');assert.match(r.respuesta,/¿Va a pedir arroz\?/);assert.doesNotMatch(r.respuesta,/señoret|negro/);
 const repetir=await s.enviar('me lo puedes repetir?');assert.equal(repetir.paso,'encargo_interes');assert.doesNotMatch(repetir.respuesta,/señoret|negro/);
 assert.equal((await s.enviar('no')).paso,'nombre');await contacto(s);
});
test('tras sí enumera los arroces y permite decidir después contactando con el restaurante',async()=>{
 const {s}=await empezar([grupo],false);const lista=await s.enviar('sí');assert.equal(lista.paso,'encargo_plato');assert.match(lista.respuesta,/Arroz del señoret y Arroz negro/);
 assert.match(lista.respuesta,/Si no lo tiene decidido aún, puede solicitar el cambio posteriormente al restaurante y contestar ahora «No, gracias»/);assert.equal((await s.enviar('no gracias')).paso,'nombre');
});
test('acepta indicar directamente el plato o pedir la lista en la pregunta inicial',async()=>{
 const a=await empezar([grupo],false);assert.equal((await a.s.enviar('Arroz negro')).paso,'encargo_personas');
 const b=await empezar([grupo],false);const lista=await b.s.enviar('¿Me repite los arroces?');assert.equal(lista.paso,'encargo_plato');assert.match(lista.respuesta,/Arroz del señoret y Arroz negro/);
});
