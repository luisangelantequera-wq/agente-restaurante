const test=require('node:test'),assert=require('node:assert/strict');
const {crear}=require('../lib/chat-supabase-conversacion');
const {correoDictado,nombreCliente}=require('../lib/chat-supabase-conversacion');
function escenario(opciones={}){
 const mensajes=[],locuciones=[],llamadas=[];const chat=crear({config:{nombre:'Sol',zonaHoraria:'Europe/Madrid',zonas:[{id:'zona1',nombre:'INTERIOR'}],...opciones.config},
  ahora:()=>new Date('2026-10-23T22:30:00Z'),uuid:()=> '11111111-2222-4333-8444-555555555555',decir:(t,o)=>{mensajes.push(t);locuciones.push(o?.voz??t);},
  pedir:async(a,d)=>{llamadas.push({a,d});return opciones.pedir?opciones.pedir(a,d):{fecha_admitida:true,horario:['13:00-16:00'],disponible:true};}});
 chat.iniciar();return {chat,mensajes,locuciones,llamadas};
}
async function completar(chat){for(const t of ['mañana','2','dos de la tarde','si','Pepe','pepe@example.invalid','600000000','ninguna','si'])await chat.enviar(t);}
test('recorrido real: a las dos significa 14:00 y el correo se muestra completo y se lee naturalmente',async()=>{
 const {chat,mensajes,locuciones}=escenario();
 for(const t of ['Para el martes que viene.','Para dos.','A las dos.'])await chat.enviar(t,{canal:'voz'});
 assert.equal(chat.estado().paso,'resumen');assert.match(mensajes.at(-1),/a las 14:00/);
 for(const t of ['Sí.','Antonio.','Antonio García arroba Gmail punto com.'])await chat.enviar(t,{canal:'voz'});
 assert.equal(chat.estado().paso,'confirmar_email');assert.equal(chat.estado().pendiente,null);
 assert.match(mensajes.at(-1),/He entendido: antoniogarcia@gmail\.com/);
 assert.match(locuciones.at(-1),/antoniogarcia, arroba, gmail punto com/);assert.doesNotMatch(locuciones.at(-1),/a, n, t, o/);
 await chat.enviar('deletrealo',{canal:'voz'});assert.equal(chat.estado().paso,'confirmar_email');
 assert.match(mensajes.at(-1),/antoniogarcia@gmail\.com/);assert.match(locuciones.at(-1),/a, n, t, o, n, i, o, g, a, r, c, i, a/);
 await chat.enviar('Sí.',{canal:'voz'});assert.equal(chat.estado().paso,'telefono');
 for(const t of ['600000000','ninguna','si'])await chat.enviar(t,{canal:'voz'});
 assert.equal(chat.estado().pendiente.hora,'14:00');assert.equal(chat.estado().pendiente.nombre,'Antonio');assert.equal(chat.estado().pendiente.email,'antoniogarcia@gmail.com');
});
test('respuestas breves de personas reutilizan el intérprete anterior con puntuación de voz',async()=>{
 for(const [texto,n] of [['Dos.',2],['Tres',3],['Once.',11],['2.',2],['1000',1000]]){
  const {chat,mensajes}=escenario();await chat.enviar('El martes.');await chat.enviar(texto,{canal:'voz'});
  assert.equal(chat.estado().paso,'hora',texto);await chat.enviar('Catorce.');assert.equal(chat.estado().paso,'resumen');
  assert.match(mensajes.at(-1),new RegExp(', '+n+' personas,'));
 }
});
test('horas naturales usan el contexto de restaurante y respetan horas explícitas',async()=>{
 for(const [texto,hora] of [['Dos.','14:00'],['A las dos.','14:00'],['A las tres.','15:00'],['A las once.','23:00'],['02:00','02:00'],['Dos de la mañana.','02:00'],['Catorce.','14:00'],['Catorce horas.','14:00'],['Quince horas.','15:00'],['14.','14:00'],['A las dieciséis horas.','16:00']]){
  const {chat,mensajes}=escenario();await chat.enviar('Para el martes, y dos personas.');assert.equal(chat.estado().paso,'hora');
  await chat.enviar(texto,{canal:'voz'});assert.equal(chat.estado().paso,'resumen',texto);assert.ok(mensajes.at(-1).includes('a las '+hora));
  assert.ok(!mensajes.some(m=>m==='¿Para cuántas personas?'));
 }
 const {chat}=escenario();await chat.enviar('martes, dos personas');
 for(const texto of ['dos o tres','a las dos o a las tres','catorce o quince']){await chat.enviar(texto);assert.equal(chat.estado().paso,'hora');}
 await chat.enviar('Dos de la tarde.');assert.equal(chat.estado().paso,'resumen');
});
test('varios datos explícitos en un turno llegan al resumen sin preguntas repetidas ni escrituras',async()=>{
 const {chat,mensajes,llamadas}=escenario({config:{zonas:[{id:'zona1',nombre:'INTERIOR'},{id:'zona2',nombre:'TERRAZA'}]}});
 await chat.enviar('Para el martes, dos personas a las catorce horas en TERRAZA.',{canal:'voz'});
 assert.equal(chat.estado().paso,'resumen');assert.match(mensajes.at(-1),/2 personas, a las 14:00, en TERRAZA/);
 assert.deepEqual(llamadas.map(l=>l.a),['supabase_web_fecha']);
 assert.ok(!mensajes.includes('¿Para cuántas personas?'));assert.ok(!mensajes.includes('¿A qué hora desea reservar?'));
 await chat.enviar('Sí.');assert.equal(chat.estado().paso,'nombre');
 for(const t of ['José.','Oen vídeo arroba Gmail punto com.','Pepito arroba Gmail punto com.','Sí.','600000000','ninguna','si'])await chat.enviar(t,{canal:'voz'});
 assert.equal(chat.estado().pendiente.nombre,'José');assert.equal(chat.estado().pendiente.email,'pepito@gmail.com');
 assert.equal(chat.estado().pendiente.personas,2);assert.equal(chat.estado().pendiente.hora,'14:00');assert.equal(chat.estado().pendiente.zona_id,'zona2');
 assert.ok(!llamadas.some(l=>l.a==='supabase_web_reservar'));
});
test('fecha cerrada conserva personas y hora claras; un día numérico no se convierte en comensales',async()=>{
 const s=escenario({pedir:async(a,d)=>a==='supabase_web_fecha'?{fecha_admitida:d.fecha!=='2026-10-25',horario:['13:00-16:00']}:{disponible:true}});
 await s.chat.enviar('Mañana, para cuatro personas a las catorce horas.');assert.equal(s.chat.estado().paso,'fecha');
 await s.chat.enviar('El martes.');assert.equal(s.chat.estado().paso,'resumen');assert.match(s.mensajes.at(-1),/4 personas, a las 14:00/);
 const n=escenario();await n.chat.enviar('Para el 2/11/2026.');assert.equal(n.chat.estado().paso,'personas');
 const a=escenario();await a.chat.enviar('El martes para dos o tres personas.');assert.equal(a.chat.estado().paso,'personas');
 await a.chat.enviar('Dos.');assert.equal(a.chat.estado().paso,'hora');
});
test('un dato dicho antes del día se conserva y una corrección breve vuelve al resumen',async()=>{
 const {chat,mensajes}=escenario();await chat.enviar('Para dos personas.');assert.equal(chat.estado().paso,'fecha');
 await chat.enviar('El martes.');assert.equal(chat.estado().paso,'hora');await chat.enviar('Catorce horas.');
 await chat.enviar('no');await chat.enviar('personas');await chat.enviar('Tres.');assert.equal(chat.estado().paso,'resumen');
 assert.match(mensajes.at(-1),/3 personas, a las 14:00/);
});
test('contactos dictados convierten símbolos y deletreo sin adivinar dominios',()=>{
 assert.equal(correoDictado('Mi correo es oemvideo arroba gmail punto com.'),'oemvideo@gmail.com');
 assert.equal(correoDictado('o e eme uve i de e o arroba gmail punto com'),'oemvideo@gmail.com');
 assert.equal(correoDictado('juan punto garcia guion bajo dos arroba example punto invalid'),'juan.garcia_2@example.invalid');
 assert.equal(correoDictado('correo@example.invalid'),'correo@example.invalid');
 assert.equal(correoDictado('email@example.invalid'),'email@example.invalid');
 assert.equal(correoDictado('uno@example.invalid'),'uno@example.invalid');
 assert.equal(correoDictado('juan arroba gemail punto com'),'juan@gemail.com');
 assert.equal(correoDictado('uno arroba example punto invalid o dos arroba example punto invalid'),null);
 assert.equal(correoDictado('juan gmail punto com'),null);
 assert.equal(correoDictado('juan\narroba gmail punto com'),null);
 assert.equal(correoDictado('<juan> arroba gmail punto com'),null);
 assert.equal(correoDictado('a'.repeat(255)+'@example.invalid'),null);
});
test('nombre conserva apellidos y limpia las expresiones de la reserva',()=>{
 for(const t of ['A nombre de Juan','«A nombre de Juan.»','Pues a nombre de Juan, por favor','La reserva sería a nombre de Juan','Me llamo Juan'])assert.equal(nombreCliente(t),'Juan');
 assert.equal(nombreCliente('Mi nombre es María José García.'),'María José García');
 assert.equal(nombreCliente('Juan de la Cruz'),'Juan de la Cruz');
 assert.equal(nombreCliente('A nombre de.'),'');
 for(const t of ['Sí.','No.','Correcto','Vale','No lo sé','600000000','juan@example.invalid','Oen vídeo arroba Gmail punto com.'])assert.equal(nombreCliente(t),'');
 assert.equal(nombreCliente("María del Mar O'Neill"),"María del Mar O'Neill");
});
test('caso real: no guarda Sí como nombre y permite corregir Oen vídeo mediante deletreo confirmado',async()=>{
 const {chat,mensajes}=escenario();
 for(const t of ['El martes.','Para dos.','A las catorce horas.','Sí.'])await chat.enviar(t,{canal:'voz'});
 assert.equal(chat.estado().paso,'nombre');
 await chat.enviar('Sí.',{canal:'voz'});assert.equal(chat.estado().paso,'nombre');assert.match(mensajes.at(-1),/Necesito el nombre/);assert.ok(!mensajes.includes('A nombre de Sí.'));
 await chat.enviar('A nombre de Juan.',{canal:'voz'});assert.equal(chat.estado().paso,'email');
 await chat.enviar('Oen vídeo arroba Gmail punto com.',{canal:'voz'});assert.equal(chat.estado().paso,'confirmar_email');
 assert.match(mensajes.at(-1),/oenvideo@gmail\.com/);
 await chat.enviar('No.',{canal:'voz'});assert.equal(chat.estado().paso,'email');
 await chat.enviar('O, e, eme, uve, i, de, e, o, arroba Gmail punto com.',{canal:'voz'});assert.equal(chat.estado().paso,'confirmar_email');
 assert.match(mensajes.at(-1),/oemvideo@gmail\.com/);
 await chat.enviar('Sí.',{canal:'voz'});assert.equal(chat.estado().paso,'telefono');
 for(const t of ['600000000','ninguna','si'])await chat.enviar(t,{canal:'voz'});
 assert.equal(chat.estado().pendiente.nombre,'Juan');assert.equal(chat.estado().pendiente.email,'oemvideo@gmail.com');
});
test('correo dictado admite tildes y pausas de transcripción sin adivinar letras',()=>{
 assert.equal(correoDictado('Oen vídeo arroba Gmail punto com.'),'oenvideo@gmail.com');
 assert.equal(correoDictado('O, e, eme, vídeo, arroba Gmail punto com.'),'oemvideo@gmail.com');
 assert.equal(correoDictado('José punto pérez arroba example punto inválid'),'jose.perez@example.invalid');
});
test('correo por voz exige confirmación, admite repetirlo y solo guarda el confirmado',async()=>{
 const {chat,mensajes,llamadas}=escenario();for(const t of ['mañana','2','14:00','si','A nombre de Juan'])await chat.enviar(t,{canal:'voz'});
 assert.ok(mensajes.includes('A nombre de Juan.'));assert.equal(chat.estado().paso,'email');
 await chat.enviar('primer correo incompleto',{canal:'voz'});assert.equal(chat.estado().paso,'email');
 await chat.enviar('juan arroba gmail punto com',{canal:'voz'});assert.equal(chat.estado().paso,'confirmar_email');assert.equal(chat.estado().pendiente,null);
 assert.match(mensajes.at(-1),/juan@gmail\.com/);
 await chat.enviar('no',{canal:'voz'});assert.equal(chat.estado().paso,'email');
 await chat.enviar('juan guion bajo dos arroba example punto invalid',{canal:'voz'});
 await chat.enviar('teneis cocido',{canal:'voz'});assert.equal(chat.estado().paso,'confirmar_email');
 await chat.enviar('600000000',{canal:'voz'});assert.equal(chat.estado().paso,'confirmar_email');
 await chat.enviar('si',{canal:'voz'});assert.equal(chat.estado().paso,'telefono');
 for(const t of ['600000000','ninguna','si'])await chat.enviar(t,{canal:'voz'});
 assert.equal(chat.estado().pendiente.nombre,'Juan');assert.equal(chat.estado().pendiente.email,'juan_2@example.invalid');
 assert.equal(llamadas.filter(l=>l.a==='supabase_web_reservar').length,0);
});
test('corregir el correo por voz vuelve al resumen final y conserva el resto de datos',async()=>{
 const {chat}=escenario();for(const t of ['mañana','2','14:00','si','Juan','uno@example.invalid','600000000','ninguna','no','correo'])await chat.enviar(t);
 await chat.enviar('dos arroba example punto invalid',{canal:'voz'});assert.equal(chat.estado().paso,'confirmar_email');
 await chat.enviar('tres arroba example punto invalid',{canal:'voz'});assert.equal(chat.estado().paso,'confirmar_email');
 await chat.enviar('si',{canal:'voz'});assert.equal(chat.estado().paso,'final');await chat.enviar('si');
 assert.equal(chat.estado().pendiente.email,'3@example.invalid');assert.equal(chat.estado().pendiente.telefono,'+34600000000');assert.equal(chat.estado().pendiente.nombre,'Juan');
});
test('el texto mantiene el correo escrito y no interpreta dictado sin canal de voz',async()=>{
 const {chat}=escenario();for(const t of ['mañana','2','14:00','si','Juan'])await chat.enviar(t);
 await chat.enviar('juan arroba example punto invalid');assert.equal(chat.estado().paso,'email');
 await chat.enviar('juan@example.invalid');assert.equal(chat.estado().paso,'telefono');
});
test('flujo completo usa fecha local del restaurante, zona única y no escribe hasta confirmación humana',async()=>{
 const {chat,llamadas}=escenario();await completar(chat);assert.equal(chat.estado().paso,'pendiente');
 assert.equal(llamadas[0].d.fecha,'2026-10-25');assert.equal(llamadas.filter(l=>l.a==='supabase_web_disponibilidad').length,2);
 let payload;await chat.confirmar(async d=>{payload=d;return{mensaje:'Confirmada',referencia:'PRUEBA-id'};});
 assert.equal(payload.zona_id,'zona1');assert.equal(payload.hora,'14:00');assert.equal(payload.personas,2);assert.equal(payload.observaciones,'');assert.equal(chat.estado().paso,'terminado');
});
test('día cerrado, entradas ambiguas y rechazo explícito no avanzan ni escriben',async()=>{
 const {chat}=escenario({pedir:async()=>({fecha_admitida:false,horario:[]})});await chat.enviar('mañana');assert.equal(chat.estado().paso,'fecha');
 const s=escenario();await s.chat.enviar('mañana');await s.chat.enviar('dos o tres personas');assert.equal(s.chat.estado().paso,'personas');
 await s.chat.enviar('2');await s.chat.enviar('a las dos o a las tres');assert.equal(s.chat.estado().paso,'hora');
 await s.chat.enviar('14:00');await s.chat.enviar('si pero cambia la hora');assert.equal(s.chat.estado().paso,'corregir');
 await s.chat.enviar('hora');await s.chat.enviar('15:00');assert.equal(s.chat.estado().paso,'resumen');
});
test('sin disponibilidad pide una corrección antes de pedir los datos personales',async()=>{
 const {chat}=escenario({pedir:async()=>({fecha_admitida:true,horario:['13:00-16:00'],disponible:false})});
 for(const t of ['mañana','2','14:00','si'])await chat.enviar(t);assert.equal(chat.estado().paso,'corregir');
});
test('varias zonas exigen elegir una y las correcciones conservan los otros campos',async()=>{
 const {chat}=escenario({config:{zonas:[{id:'zona1',nombre:'INTERIOR'},{id:'zona2',nombre:'TERRAZA'}]}});
 for(const t of ['mañana','2','14:00'])await chat.enviar(t);assert.equal(chat.estado().paso,'zona_id');
 for(const t of ['terraza','si','Pepe','pepe@example.invalid','600000000','ninguna','no','hora','15:00','si'])await chat.enviar(t);
 assert.equal(chat.estado().pendiente.hora,'15:00');assert.equal(chat.estado().pendiente.nombre,'Pepe');assert.equal(chat.estado().pendiente.zona_id,'zona2');
});
test('resultado incierto congela datos e identidad de petición incluso si el siguiente intento recibe 403',async()=>{
 const {chat}=escenario();await completar(chat);const intentos=[];
 await chat.confirmar(async d=>{intentos.push(d);throw new Error('red');});await chat.enviar('no');assert.equal(chat.estado().paso,'pendiente');
 await chat.confirmar(async d=>{intentos.push(d);throw Object.assign(new Error('token'),{status:403});});assert.equal(chat.estado().paso,'pendiente');
 await chat.confirmar(async d=>{intentos.push(d);return{mensaje:'OK',referencia:'PRUEBA-id'};});assert.deepEqual(intentos[0],intentos[1]);assert.deepEqual(intentos[0],intentos[2]);
});
test('rechazo conocido sin envío anterior permite corregir sin dejar una solicitud pendiente',async()=>{
 const {chat}=escenario();await completar(chat);await chat.confirmar(async()=>{throw Object.assign(new Error('sin mesas'),{status:409});});
 assert.equal(chat.estado().paso,'corregir');assert.equal(chat.estado().pendiente,null);
});
test('hora fuera de turno recuerda todos los tramos de ese día y permite indicar otra hora directamente',async()=>{
 const {chat,mensajes,llamadas}=escenario({pedir:async(a,d)=>{
  if(a==='supabase_web_fecha')return{fecha_admitida:true,horario:['13:00-16:00','20:00-23:00']};
  if(d.hora==='12:00')throw Object.assign(new Error('El restaurante no admite reservas a esa hora o en esa fecha.'),{status:422,codigo:'FUERA_HORARIO'});
  return{disponible:true};
 }});
 for(const t of ['mañana','2','12:00','si'])await chat.enviar(t);
 assert.equal(mensajes.at(-1),'Nuestro horario de apertura ese día es de 13:00 a 16:00 y de 20:00 a 23:00. ¿A qué otra hora desea reservar?');
 assert.equal(chat.estado().paso,'hora');await chat.enviar('14:00');await chat.enviar('si');
 assert.equal(chat.estado().paso,'nombre');assert.equal(llamadas.filter(l=>l.a==='supabase_web_fecha').length,1);
});
