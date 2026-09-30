"use strict";
const crypto=require('node:crypto');
const hash='c6f202f77e1e848ed1f649fc698ebadbf887e7c462d98ca109743d9abcbadb77',vence=1790781505753;
let ejecucion;
module.exports=async(req,res)=>{
 res.setHeader('Cache-Control','no-store');
 if(process.env.VERCEL_ENV!=='preview'||Date.now()>vence)return res.status(404).json({error:'No disponible'});
 const token=req.query?.token;
 if(typeof token!=='string'||token.length!==64||crypto.createHash('sha256').update(token).digest('hex')!==hash)return res.status(401).json({error:'No autorizado'});
 if(req.method!=='GET')return res.status(405).json({error:'Método no permitido'});
 try{
  const {redis,prefijo}=require('../lib/cola-avisos').desdeEntorno();
  const key=prefijo+':diagnostico-temporal:c6f202f77e1e848ed1f649fc698ebadbf887e7c462d98ca109743d9abcbadb77';
  const previa=await redis(['GET',key]);
  if(previa && previa!=='en_curso')return res.status(200).json(JSON.parse(previa));
  if(previa||await redis(['SET',key,'en_curso','NX','EX',1200])!=='OK')return res.status(409).json({error:'En curso'});
  const resultado=await require('../scripts/comprobar-whatsapp-redis').comprobar();
  await redis(['SET',key,JSON.stringify(resultado),'EX',1200]);
  return res.status(200).json(resultado);
 }catch{return res.status(503).json({error:'Comprobación no superada'});}
};
