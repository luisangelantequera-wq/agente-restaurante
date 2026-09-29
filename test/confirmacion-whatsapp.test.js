const test=require('node:test'), assert=require('node:assert/strict');
const {preparar}=require('../lib/confirmacion-whatsapp');
const reserva={estado:'confirmada',restaurante:'Restaurante Sol',fecha:'2026-10-02',hora:'15:00',personas:4,zona:'TERRAZA',localizador:'SOL-EJEMPLO-0001',nombre:'No incluir',email:'no-incluir@example.com',telefono:'+34600000000'};
const aviso={estado:'rechazado',motivo:'correo_rebotado',whatsapp_autorizado:true,idioma:'es',consentimiento_whatsapp:{autorizado:true,finalidad:'confirmacion_si_falla_correo',registrado:'2026-09-29T12:00:00Z'}};
test('prepara confirmación con día de semana sin pedir reconfirmar ni copiar contacto',()=>{
 const r=preparar({reserva,aviso});assert.equal(r.listo,true);assert.equal(r.envio_habilitado,false);assert.match(r.texto,/viernes/);assert.match(r.texto,/No necesita volver a confirmar/);
 for(const k of ['nombre','email','telefono'])assert.ok(!JSON.stringify(r).includes(reserva[k]));
});
test('correo entregado, aceptado o en curso no genera WhatsApp',()=>{
 for(const a of [{estado:'entregado'},{estado:'aceptado'},{estado:'demorado'},{envio_en_curso:true},{motivo:'queja_destinatario'}])assert.equal(preparar({reserva,aviso:{...aviso,...a}}).listo,false);
});
test('requiere reserva confirmada y consentimiento explícito con evidencia',()=>{
 assert.equal(preparar({reserva:{...reserva,estado:'cancelada'},aviso}).listo,false);
 for(const a of [{whatsapp_autorizado:false},{consentimiento_whatsapp:null},{consentimiento_whatsapp:{autorizado:true}},{whatsapp_autorizado:'true'}])assert.equal(preparar({reserva,aviso:{...aviso,...a}}).listo,false);
});
test('rechaza datos inválidos, idiomas pendientes y contacto ya resuelto',()=>{
 for(const r of [{fecha:'2026-02-30'},{hora:'25:00'},{personas:0},{zona:''},{restaurante:'A\nB'}])assert.equal(preparar({reserva:{...reserva,...r},aviso}).listo,false);
 assert.equal(preparar({reserva,aviso:{...aviso,idioma:'fr'}}).motivo,'plantilla_idioma_pendiente');
 assert.equal(preparar({reserva,aviso:{...aviso,contacto:{fase:'resuelto'}}}).listo,false);
});
