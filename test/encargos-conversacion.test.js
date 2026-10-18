'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {crearSimuladorConversacion}=require('./soporte/simulador-conversacion');
const grupo={id:'arroces',nombre:'Arroces',platos:['Arroz del señoret','Arroz negro'],dias:['lunes','martes','miércoles','jueves','viernes','sábado','domingo'],minimo:2,antelacion_horas:1,pregunta:'Si va a pedir algún arroz, indique cuál.',activo:true};
async function empezar(opciones=[grupo]){const s=await crearSimuladorConversacion({respuestas:{verificar:[{ok:true,momento_valido:true},{ok:true,disponible:true,encargos_disponibles:opciones}]}});for(const t of ['quiero reservar mañana','4','14:00','interior','sí','Luis Prueba','cliente@example.com'])await s.enviar(t);const r=await s.enviar('612345678');return {s,r};}
test('reserva pregunta por el arroz, recoge comensales, lo incluye en el resumen y lo envía al servidor',async()=>{
 const {s,r}=await empezar();assert.equal(r.paso,'encargo_plato');assert.match(r.respuesta,/Arroz del señoret/);
 assert.equal((await s.enviar('Arroz del señoret')).paso,'encargo_personas');assert.equal((await s.enviar('1')).paso,'encargo_personas');assert.equal((await s.enviar('4')).paso,'observaciones');
 const resumen=await s.enviar('no');assert.equal(resumen.paso,'confirmacion');assert.match(resumen.respuesta,/Encargo: Arroz del señoret: 4 personas/);
 await s.enviar('sí, confirmo la reserva');const alta=s.solicitudes.find(x=>x.accion==='reservar');assert.deepEqual(alta.encargos,[{grupo_id:'arroces',plato:'Arroz del señoret',personas:4}]);
});
test('no gracias continúa la reserva sin encargo ni obligación de pedir comida',async()=>{
 const {s,r}=await empezar();assert.equal(r.paso,'encargo_plato');assert.equal((await s.enviar('no gracias')).paso,'observaciones');await s.enviar('no');await s.enviar('sí, confirmo la reserva');assert.equal(s.solicitudes.find(x=>x.accion==='reservar').encargos,undefined);
});
test('sin platos elegibles conserva el flujo normal de reservas',async()=>{const {r}=await empezar([]);assert.equal(r.paso,'observaciones');assert.doesNotMatch(r.respuesta,/arroces|encargo/i);});
