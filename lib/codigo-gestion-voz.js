'use strict';
const crypto=require('node:crypto');
const {normalizarTelefono}=require('./entrada-conversacional');
function telefono(valor){const n=normalizarTelefono(valor).replace(/[ ()-]/g,'');return /^\+[1-9]\d{7,14}$/.test(n)?n:'';}
function hmac(env,texto){return crypto.createHmac('sha256',env.CONTACTIA_SUPABASE_SERVER_KEY).update(texto).digest('hex');}
function codigo(env,slug,peticion,contador=0){
 peticion=String(peticion).toLowerCase();
 // HMAC pseudorrandom, estable al reintentar. Rechazo para evitar sesgo modular.
 for(let i=0;;i++){const n=parseInt(hmac(env,`contactia:codigo:v1:${slug}:${peticion}:${contador}:${i}`).slice(0,8),16);if(n<4294000000)return String(n%1000000).padStart(6,'0');}
}
function telefonoHash(env,slug,tel){return hmac(env,`contactia:telefono-gestion:v1:${slug}:${tel}`);}
function codigoHash(env,slug,tel,c){return hmac(env,`contactia:codigo-gestion:v1:${slug}:${tel}:${c}`);}
function formatear(c){return /^\d{6}$/.test(c)?c.slice(0,3)+' '+c.slice(3):'';}
async function registrar({cliente,env,body,hash}){
 const tel=telefono(body.telefono);if(!tel)throw Error('Teléfono de gestión no válido');
 const candidatos=Array.from({length:16},(_,contador)=>({contador,hash:codigoHash(env,body.slug,tel,codigo(env,body.slug,body.peticion_id,contador))}));
 const r=await cliente.rpc('registrar_codigo_gestion_voz',{p_slug:body.slug,p_peticion:body.peticion_id,p_enlace:hash,p_telefono:telefonoHash(env,body.slug,tel),p_candidatos:candidatos});
 if(r.error||!Number.isInteger(r.data?.contador)||r.data.contador<0||r.data.contador>15)throw Error('No se pudo preparar el código de gestión');
}
function paraAviso(env,datos){return Number.isInteger(datos?.gestion_contador)&&datos.gestion_contador>=0&&datos.gestion_contador<16&&datos.slug&&datos.peticion_id?codigo(env,datos.slug,datos.peticion_id,datos.gestion_contador):'';}
module.exports={codigo,formatear,telefono,telefonoHash,codigoHash,registrar,paraAviso};
