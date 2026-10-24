'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {responder,esConsulta}=require('../lib/informacion-publica-respuestas');
const {crear}=require('../lib/chat-supabase-conversacion');
const {crearHandler:crearWeb}=require('../lib/reservas-web-supabase');
const {crearHandler:crearAcceso}=require('../lib/acceso-supabase');
const campos={nombre:'Sol',telefono_publico:'910000000',direccion:'Calle de prueba 1',web:'https://ejemplo.invalid',zona_horaria:'Europe/Madrid',
 informacion_publica:{mascotas:'Admitimos perros en la terraza.',infancia:'Disponemos de tronas.',gastronomia:'Miércoles cocido.\nJueves paella mínimo 2 personas.'},
 horario_reservas:{martes:['13:00-16:00'],miércoles:['13:00-16:00'],jueves:['13:00-16:00']},dias_cierre:['lunes','viernes','sábado','domingo'],cierres_especiales:['2026-10-27']};
test('distingue consultas informativas de los datos y correcciones de una reserva',()=>{
 for(const q of ['¿Dónde estáis?','¿Tenéis tronas?','¿Admitís perros?','¿Qué horario tenéis mañana?','¿Cuál es el teléfono?','¿Qué tenéis los jueves?','¿Tiene leche la paella?'])assert.equal(esConsulta(q),true,q);
 for(const q of ['mañana','2','14:00','hora','fecha','personas','zona','correo','Pepe','ninguna','sí','no','quiero cambiar la hora'])assert.equal(esConsulta(q),false,q);
});
test('reutiliza dirección, teléfono, respuestas habituales y gastronomía sin inventar datos',()=>{
 assert.match(responder(campos,'¿Dónde estáis?'),/Calle de prueba 1/);
 assert.match(responder(campos,'¿Cuál es el teléfono?'),/910000000/);
 assert.match(responder(campos,'¿Admitís perros?'),/terraza/);
 assert.match(responder(campos,'¿Tenéis tronas?'),/tronas/);
 assert.equal(responder(campos,'¿Qué tenéis los jueves?'),'Jueves paella mínimo 2 personas.');
 assert.match(responder({...campos,direccion:''},'¿Dónde estáis?'),/Todavía no dispongo/);
 for(const q of ['¿Tiene gluten la paella?','¿Lleva leche el cocido?','¿Tenéis menú vegano?'])assert.match(responder(campos,q),/consulte directamente/);
});
test('consulta horario efectivo y cierres de la fecha elegida',()=>{
 assert.match(responder(campos,'¿Abrís el 27 de octubre de 2026?',new Date('2026-10-24T12:00:00Z')),/cerrado/);
 assert.match(responder(campos,'¿Qué horario tenéis el 28 de octubre de 2026?',new Date('2026-10-24T12:00:00Z')),/13:00 a 16:00/);
});
test('preguntar información durante la reserva conserva el paso y los datos',async()=>{
 const mensajes=[],llamadas=[];const chat=crear({config:{nombre:'Sol',zonaHoraria:'Europe/Madrid',zonas:[{id:'zona',nombre:'INTERIOR'}]},
  decir:t=>mensajes.push(t),ahora:()=>new Date('2026-10-24T12:00:00Z'),
  pedir:async(a,d)=>{llamadas.push({a,d});return a==='supabase_web_informacion'?{respuesta:responder(campos,d.pregunta)}:{fecha_admitida:true,horario:['13:00-16:00'],disponible:true};}});
 chat.iniciar();await chat.enviar('¿Dónde estáis?');assert.equal(chat.estado().paso,'fecha');assert.match(mensajes.at(-1),/Qué día/);
 await chat.enviar('28 de octubre');await chat.enviar('2');await chat.enviar('¿Tenéis tronas?');assert.equal(chat.estado().paso,'hora');
 await chat.enviar('14:00');assert.equal(chat.estado().paso,'resumen');await chat.enviar('¿Admitís perros?');assert.equal(chat.estado().paso,'resumen');
 await chat.enviar('si');assert.equal(chat.estado().paso,'nombre');
 assert.equal(llamadas.filter(l=>l.a==='supabase_web_informacion').length,3);
 assert.equal(llamadas.find(l=>l.a==='supabase_web_disponibilidad').d.personas,2);
});
const entorno={VERCEL_ENV:'preview',VERCEL_GIT_COMMIT_REF:'migracion-supabase-fase-1',CONTACTIA_WEB_SUPABASE_ENABLED:'1',VERCEL_URL:'preview.example',CONTACTIA_SUPABASE_SERVER_KEY:'sb_secret_clave-solo-servidor',TURNSTILE_SECRET_KEY:'secret',TURNSTILE_SITE_KEY:'site'};
const req={method:'POST',headers:{host:'preview.example',origin:'https://preview.example','content-type':'application/json','x-forwarded-for':'192.0.2.1'}};
function res(){return{setHeader(){},end(s){this.body=JSON.parse(s);}};}
test('API informativa usa cuota de lectura y solo devuelve la respuesta',async()=>{
 const llamadas=[],r=res();
 const c={rpc:async(n,a)=>{llamadas.push({n,a});return{data:true};},from:()=>({select(s){llamadas.push({select:s});return this;},eq(){return this;},maybeSingle:async()=>({data:{...campos,email_privado:'secreto',clave:'secreto'}})})};
 await crearWeb({env:entorno,clientFactory:()=>c,turnstile:()=>assert.fail('no usar Turnstile para leer')})(req,r,{accion:'supabase_web_informacion',slug:'prueba-sol',pregunta:'¿Cuál es el teléfono?'});
 assert.equal(r.statusCode,200);assert.deepEqual(r.body,{ok:true,respuesta:'El teléfono del restaurante es 910000000.'});
 assert.equal(llamadas[0].a.p_accion,'lectura');assert.ok(!llamadas[1].select.includes('email_privado'));
});
test('API rechaza campos de escritura o preguntas desmesuradas antes de consultar',async()=>{
 for(const extra of [{pregunta:'x'.repeat(501)},{nombre:'otro'},{pregunta:'texto\nseparado'}]){
  const r=res();await crearWeb({env:entorno,clientFactory:()=>assert.fail('no consultar')})(req,r,{accion:'supabase_web_informacion',slug:'prueba-sol',pregunta:'¿Teléfono?',...extra});assert.equal(r.statusCode,400);
 }
});
test('guardado valida los campos y usa la sesión del panel para la RPC',async()=>{
 const llamadas=[],r=res(),datos={nombre:'Sol',telefono_publico:'910000000',direccion:campos.direccion,web:campos.web,informacion:campos.informacion_publica};
 const c={auth:{getUser:async()=>({data:{user:{id:'usuario'}}})},rpc:async(n,a)=>{llamadas.push({n,a});return{data:{version:1,cambiado:true}};}};
 await crearAcceso({env:entorno,clienteFactory:()=>c})(req,r,{accion:'supabase_guardar_datos',restaurante_id:1,version:0,datos});
 assert.equal(r.statusCode,200);assert.equal(llamadas[0].n,'guardar_datos_restaurante_panel');assert.equal(llamadas[0].a.p_datos.informacion.mascotas,campos.informacion_publica.mascotas);
 for(const cambio of [{nombre:''},{telefono_publico:'clave'},{web:'javascript:alert(1)'},{informacion:{privado:'x'}}]){
  const salida=res();await crearAcceso({env:entorno,clienteFactory:()=>({...c,rpc:()=>assert.fail('no guardar')})})(req,salida,{accion:'supabase_guardar_datos',restaurante_id:1,version:0,datos:{...datos,...cambio}});assert.equal(salida.statusCode,400);
 }
});
test('un conflicto de edición no sobrescribe ni anuncia un guardado',async()=>{
 const r=res();await crearAcceso({env:entorno,clienteFactory:()=>({auth:{getUser:async()=>({data:{user:{id:'usuario'}}})},rpc:async()=>({error:{code:'40001',message:'interno privado'}})})})(req,r,
  {accion:'supabase_guardar_datos',restaurante_id:1,version:0,datos:{nombre:'Sol',telefono_publico:'',direccion:'',web:'',informacion:{}}});
 assert.equal(r.statusCode,409);assert.match(r.body.error,/Otra persona/);assert.ok(!r.body.error.includes('privado'));
});
