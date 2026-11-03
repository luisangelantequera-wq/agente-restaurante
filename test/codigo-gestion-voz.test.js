'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const C=require('../lib/codigo-gestion-voz');
const env={CONTACTIA_SUPABASE_SERVER_KEY:'sb_secret_solo-ficticio-codigo-gestion'};
test('código agrupado conserva ceros iniciales y no se deriva de teléfono ni localizador público',()=>{
 assert.equal(C.formatear('001234'),'001 234');assert.equal(C.formatear('12345'),'');
 assert.equal(C.codigo(env,'prueba-sol','ABCDEF'),C.codigo(env,'prueba-sol','abcdef'));
 const c=C.codigo(env,'prueba-sol','peticion');assert.match(c,/^\d{6}$/);assert.equal(C.codigo(env,'prueba-sol','peticion'),c);
 assert.notEqual(C.codigo(env,'prueba-luna','peticion'),c);assert.notEqual(C.codigo({...env,CONTACTIA_SUPABASE_SERVER_KEY:'otra-clave-ficticia'},'prueba-sol','peticion'),c);
 assert.notEqual(C.codigoHash(env,'prueba-sol','+34600000000',c),C.codigoHash(env,'prueba-sol','+34600000001',c));
 assert.notEqual(C.codigoHash(env,'prueba-sol','+34600000000',c),C.codigoHash(env,'prueba-luna','+34600000000',c));
});
test('el correo muestra el código agrupado sin sustituir su enlace privado',()=>{
 const {crearMensaje}=require('../lib/correo-supabase');
 const m=crearMensaje({hostname:'preview.example',slug:'prueba-sol',email:'cliente@example.invalid',fecha:'2026-11-10',restaurante:'Sol',nombre:'Cliente ficticio',hora:'14:00',personas:2,zona:'INTERIOR',referencia:'PRUEBA-ficticia',remitente:'prueba@example.invalid'},'a'.repeat(64),'001234');
 assert.match(m.text,/Código de gestión: 001 234/);assert.match(m.html,/Código de gestión: 001 234/);assert.match(m.text,/gestion-prueba.html#restaurante=prueba-sol&token=/);
});
