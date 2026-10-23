const test=require('node:test'),assert=require('node:assert/strict');
const {crear}=require('../lib/chat-supabase-conversacion');
function escenario(opciones={}){
 const mensajes=[],llamadas=[];const chat=crear({config:{nombre:'Sol',zonaHoraria:'Europe/Madrid',zonas:[{id:'zona1',nombre:'INTERIOR'}],...opciones.config},
  ahora:()=>new Date('2026-10-23T22:30:00Z'),uuid:()=> '11111111-2222-4333-8444-555555555555',decir:t=>mensajes.push(t),
  pedir:async(a,d)=>{llamadas.push({a,d});return opciones.pedir?opciones.pedir(a,d):{fecha_admitida:true,horario:['13:00-16:00'],disponible:true};}});
 chat.iniciar();return {chat,mensajes,llamadas};
}
async function completar(chat){for(const t of ['mañana','2','dos de la tarde','si','Pepe','pepe@example.invalid','600000000','ninguna','si'])await chat.enviar(t);}
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
