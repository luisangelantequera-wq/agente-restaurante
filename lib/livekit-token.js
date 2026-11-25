'use strict';
// Firma reutilizada de lib/livekit-prueba.js, rama prueba-livekit-cartesia.
const crypto=require('node:crypto');
const AGENT='contactia-cartesia-prueba';
function firmarToken({apiKey,apiSecret,room,identity,now=Math.floor(Date.now()/1000),ttl=360}){
 const header={alg:'HS256',typ:'JWT'};
 const payload={iss:apiKey,sub:identity,iat:now,nbf:now-10,exp:now+ttl,
  video:{roomJoin:true,room,canPublish:true,canPublishSources:['microphone'],canSubscribe:true,canPublishData:true},
  roomConfig:{agents:[{agentName:AGENT}]}};
 const encode=v=>Buffer.from(JSON.stringify(v)).toString('base64url');
 const base=encode(header)+'.'+encode(payload);
 return base+'.'+crypto.createHmac('sha256',apiSecret).update(base).digest('base64url');
}
module.exports={firmarToken,AGENT};
