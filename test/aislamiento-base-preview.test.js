"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {crearFetchMedido}=require("../lib/contador-airtable");

const BASE="appNFqY50AnEiDdPq";
const PRINCIPAL="appI5U8eaG976ExdD";
const entorno={
  VERCEL_ENV:"preview",
  VERCEL_GIT_COMMIT_REF:"corregir-bateria-pruebas",
  CONTACTIA_SANDBOX_BASE_ID:BASE,
  AIRTABLE_BASE_ID:BASE,
  CONTACTIA_MEDIR_AIRTABLE:"false"
};
const url=id=>`https://api.airtable.com/v0/${id}/RESTAURANTES`;

test("rama sandbox permite únicamente la base asignada; no contacta otra",async()=>{
 let llamadas=0;
 const fetchImpl=async()=>{llamadas++;return {ok:true,status:200};};
 const seguro=crearFetchMedido("configuracion",{env:entorno,fetchImpl,registrarLog:()=>{}});
 await seguro(url(BASE));
 assert.equal(llamadas,1);
 await assert.rejects(()=>seguro(url(PRINCIPAL)),/fuera de la base aislada/);
 assert.equal(llamadas,1,"ninguna petición a la base principal");
});

test("sandbox incompleto o variable alterada bloquea la operación antes de usar la red",async()=>{
 let llamadas=0;
 const fetchImpl=async()=>{llamadas++;return {ok:true,status:200};};
 for(const env of [
   {...entorno,CONTACTIA_SANDBOX_BASE_ID:undefined},
   {...entorno,AIRTABLE_BASE_ID:PRINCIPAL},
   {...entorno,CONTACTIA_SANDBOX_BASE_ID:"invalido"},
 ]) {
   const seguro=crearFetchMedido("configuracion",{env,fetchImpl,registrarLog:()=>{}});
   await assert.rejects(()=>seguro(url(PRINCIPAL)),/Sandbox Airtable no configurado/);
 }
 assert.equal(llamadas,0);
});

test("otros entornos conservan el funcionamiento anterior",async()=>{
 let llamadas=0;
 const fetchImpl=async()=>{llamadas++;return {ok:true,status:200};};
 const normal=crearFetchMedido("configuracion",{
   env:{...entorno,VERCEL_GIT_COMMIT_REF:"otra-rama"},
   fetchImpl,registrarLog:()=>{}
 });
 await normal(url(PRINCIPAL));
 assert.equal(llamadas,1);
});
