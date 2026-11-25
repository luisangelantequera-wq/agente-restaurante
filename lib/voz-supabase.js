'use strict';
const crypto=require('node:crypto');
const {firmarToken}=require('./livekit-token');
function configurada(env){
 return env.VERCEL_ENV==='preview' && env.VERCEL_GIT_COMMIT_REF==='migracion-supabase-fase-1' &&
  env.CONTACTIA_SUPABASE_VOICE_ENABLED==='1' && typeof env.LIVEKIT_API_KEY==='string' && env.LIVEKIT_API_KEY.length>=5 &&
  typeof env.LIVEKIT_API_SECRET==='string' && env.LIVEKIT_API_SECRET.length>=20 &&
  typeof env.LIVEKIT_URL==='string' && /^wss:\/\/[a-z0-9-]+(?:\.[a-z0-9-]+)*\.livekit\.cloud\/?$/.test(env.LIVEKIT_URL);
}
function sesion(env,slug,peticion){
 if(!configurada(env)||slug!=='prueba-sol')throw Error('Voz de prueba no disponible.');
 const huella=crypto.createHmac('sha256',env.LIVEKIT_API_SECRET).update(`contactia:supabase:voz:v1:${slug}:${peticion}`).digest('hex');
 const room='contactia-supabase-'+huella.slice(0,32),identity='navegador-'+huella.slice(32,48);
 return{url:env.LIVEKIT_URL,token:firmarToken({apiKey:env.LIVEKIT_API_KEY,apiSecret:env.LIVEKIT_API_SECRET,room,identity}),room};
}
module.exports={configurada,sesion};
