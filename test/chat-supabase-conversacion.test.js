const test=require('node:test'),assert=require('node:assert/strict');
const {crear}=require('../lib/chat-supabase-conversacion');
const {correoDictado,nombreCliente}=require('../lib/chat-supabase-conversacion');
function escenario(opciones={}){
 const mensajes=[],llamadas=[];const chat=crear({config:{nombre:'Sol',zonaHoraria:'Europe/Madrid',zonas:[{id:'zona1',nombre:'INTERIOR'}],...opciones.config},
  ahora:()=>new Date('2026-10-23T22:30:00Z'),uuid:()=> '11111111-2222-4333-8444-555555555555',decir:t=>mensajes.push(t),
  pedir:async(a,d)=>{llamadas.push({a,d});return opciones.pedir?opciones.pedir(a,d):{fecha_admitida:true,horario:['13:00-16:00'],disponible:true};}});
 chat.iniciar();return {chat,mensajes,llamadas};
}
async function completar(chat){for(const t of ['mañana','2','dos de la tarde','si','Pepe','pepe@example.invalid','600000000','ninguna','si'])await chat.enviar(t);}
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
});
test('correo por voz exige confirmación, admite repetirlo y solo guarda el confirmado',async()=>{
 const {chat,mensajes,llamadas}=escenario();for(const t of ['mañana','2','14:00','si','A nombre de Juan'])await chat.enviar(t,{canal:'voz'});
 assert.ok(mensajes.includes('A nombre de Juan.'));assert.equal(chat.estado().paso,'email');
 await chat.enviar('primer correo incompleto',{canal:'voz'});assert.equal(chat.estado().paso,'email');
 await chat.enviar('juan arroba gmail punto com',{canal:'voz'});assert.equal(chat.estado().paso,'confirmar_email');assert.equal(chat.estado().pendiente,null);
 assert.match(mensajes.at(-1),/j, u, a, n, arroba, gmail punto com/);
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
 await s.chat.enviar('2');await s.chat.enviar('a las dos');assert.equal(s.chat.estado().paso,'hora');
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
