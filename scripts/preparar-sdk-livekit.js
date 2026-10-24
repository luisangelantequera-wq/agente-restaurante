'use strict';
// Servir desde el mismo origen la versión fijada en package-lock.json.
const fs=require('node:fs'),path=require('node:path');
const dist=path.dirname(require.resolve('livekit-client'));
const destino=path.join(__dirname,'..','vendor');
fs.mkdirSync(destino,{recursive:true});
fs.copyFileSync(path.join(dist,'livekit-client.umd.js'),path.join(destino,'livekit-client.umd.js'));
fs.copyFileSync(path.join(dist,'..','LICENSE'),path.join(destino,'livekit-client-LICENSE'));
