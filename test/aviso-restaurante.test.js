const test=require('node:test'),assert=require('node:assert/strict');
const {prepararAviso}=require('../lib/aviso-restaurante');
const llamadas=require('../lib/llamada-seguimiento');
const {prepararContacto,registrarEvento}=require('../lib/contacto-alternativo');
const env={CONTACTIA_AVISOS_SECRET:'x'.repeat(40)}, ahora=Date.parse('2026-10-06T12:00:00Z');
function caso() {
 const d={estado:'rechazado',motivo:'correo_rebotado',iniciado:'2026-10-06T10:00:00Z',whatsapp_autorizado:false,zona:'INTERIOR'};
 const registro={id:'recPrueba',fields:{estado:'confirmada',restaurante:['recSol'],id_reserva:'SOL-20261008-PRUEBA',fecha:'2026-10-08',hora:'15:00',personas:2,telefono:'+34622222222',email:'privado@example.com',aviso_cliente_detalle:JSON.stringify(d)}};
 let contacto=prepararContacto(d,ahora).contacto;
 for(let n=1;n<=3;n++) {contacto=registrarEvento(contacto,{id:'inicio'+n,tipo:'llamada_iniciada'},ahora);contacto=registrarEvento(contacto,{id:'fin'+n,tipo:'llamada_sin_respuesta'},ahora);}
 return {registro,seguimiento:{reserva_id:registro.id,huella:llamadas.huella(registro,env),contacto}};
}
test('tres llamadas sin recepción preparan aviso sin contactos personales ni cambios de reserva',()=>{
 const {registro,seguimiento}=caso(), antes=JSON.stringify({registro,seguimiento});
 const d=prepararAviso(registro,seguimiento,{env,ahora});assert.equal(d.estado,'pendiente_envio');
 assert.match(d.resumen,/Llamadas: 03\/03 = Reserva confirmada = Revisión del restaurante pendiente/);
 assert.match(d.texto,/8 de octubre de 2026, a las 15:00, para 2 personas, en INTERIOR/);
 assert.match(d.texto,/Correo devuelto/);assert.match(d.texto,/WhatsApp no utilizado: el cliente no lo autorizó/);
 assert.doesNotMatch(d.texto,/privado@example.com|34622222222/);assert.equal(JSON.stringify({registro,seguimiento}),antes);
});
test('no prepara aviso para pendientes, resueltos, avisos enviados o seguimiento de otra reserva',()=>{
 for(const cambio of [{fase:'llamada_pendiente'},{fase:'llamada_en_curso'},{fase:'resuelto'},{aviso_restaurante:'enviado'}]) {
  const {registro,seguimiento}=caso();Object.assign(seguimiento.contacto,cambio);assert.equal(prepararAviso(registro,seguimiento,{env,ahora}),null);
 }
 const {registro,seguimiento}=caso();seguimiento.reserva_id='recOtra';assert.equal(prepararAviso(registro,seguimiento,{env,ahora}),null);
});
test('cancelación, anonimización, modificación, entrega o reserva pasada invalidan el aviso',()=>{
 for(const cambio of [{estado:'cancelada'},{anonimizada:true},{hora:'16:00'},{telefono:'+34699999999'},{aviso_cliente_detalle:'{"estado":"entregado"}'}]) {
  const {registro,seguimiento}=caso();Object.assign(registro.fields,cambio);assert.equal(prepararAviso(registro,seguimiento,{env,ahora}),null);
 }
 const {registro,seguimiento}=caso();assert.equal(prepararAviso(registro,seguimiento,{env,ahora:Date.parse('2026-10-08T14:00:00Z')}),null);
});
test('cierre por plazo con menos de tres llamadas no afirma que agotó tres intentos',()=>{
 const {registro,seguimiento}=caso();seguimiento.contacto.intentos_llamada=1;
 const d=prepararAviso(registro,seguimiento,{env,ahora});assert.match(d.texto,/plazo de seguimiento ha finalizado/);assert.match(d.texto,/01\/03/);assert.doesNotMatch(d.texto,/agotado las tres/);
});
test('Centro ofrece el aviso bajo sesión sin enviar, escribir ni consultar proveedores',async()=>{
 const api=require('../api/centro-conversaciones'), lectura=require('../lib/revision-retenciones');
 const {crearTokenSesionContactia,COOKIE_SESION_CONTACTIA}=require('../lib/sesion-contactia');
 const original={...process.env}, originalLeer=lectura.leerAirtable, originalServicio=llamadas.servicio, originalFetch=global.fetch;
 const {registro,seguimiento}=caso();let lecturas=0;
 try {
  Object.assign(process.env,{VERCEL_ENV:'preview',VERCEL_GIT_COMMIT_REF:'prototipo-voz',CONTACTIA_LLAMADAS_PRUEBA_HABILITADAS:'1',CONTACTIA_CENTRO_SECRET:'s'.repeat(40),CONTACTIA_AVISOS_SECRET:env.CONTACTIA_AVISOS_SECRET,
   TWILIO_VOICE_FROM:'+34611111111',TWILIO_VOICE_TEST_TO:'+34622222222',TWILIO_ACCOUNT_SID:'AC'+'a'.repeat(32),TWILIO_AUTH_TOKEN:'b'.repeat(32)});
  lectura.leerAirtable=async tabla=>{assert.equal(tabla,'RESERVAS');lecturas++;return [registro];};
  llamadas.servicio=()=>({almacen:()=>({porReserva:async()=>seguimiento})});global.fetch=async()=>{throw Error('No debe usar la red');};
  async function listar(cookie='') {const res={setHeader(){},end(s){this.d=JSON.parse(s);}};await api({method:'POST',headers:{'content-type':'application/json',cookie},body:{accion:'listar_avisos'}},res);return res;}
  assert.equal((await listar()).statusCode,401);assert.equal(lecturas,0);
  const r=await listar(`${COOKIE_SESION_CONTACTIA}=${crearTokenSesionContactia()}`);assert.equal(r.statusCode,200);assert.equal(lecturas,1);
  assert.equal(r.d.avisos[0].aviso_restaurante.estado,'pendiente_envio');assert.match(r.d.avisos[0].contacto,/03\/03/);
  assert.equal(registro.fields.estado,'confirmada');
 } finally {lectura.leerAirtable=originalLeer;llamadas.servicio=originalServicio;global.fetch=originalFetch;for(const k of Object.keys(process.env))if(!(k in original))delete process.env[k];Object.assign(process.env,original);}
});
