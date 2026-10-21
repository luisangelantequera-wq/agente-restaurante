"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { crearTokenSesion, COOKIE_SESION } = require("../lib/sesion-restaurante");
const handler = require("../lib/zonas-panel");

const KEYS = ["VERCEL_ENV","VERCEL_GIT_COMMIT_REF","CONTACTIA_CREAR_ZONAS",
  "AIRTABLE_BASE_ID","CONTACTIA_SANDBOX_BASE_ID","AIRTABLE_API_KEY",
  "PANEL_SESSION_SECRET","CONTACTIA_MEDIR_AIRTABLE"];
const ENV = {
  VERCEL_ENV:"preview",VERCEL_GIT_COMMIT_REF:"corregir-bateria-pruebas",
  CONTACTIA_CREAR_ZONAS:"1",
  AIRTABLE_BASE_ID:"app12345678901234",CONTACTIA_SANDBOX_BASE_ID:"app12345678901234",
  AIRTABLE_API_KEY:"solo-fixture",PANEL_SESSION_SECRET:"s".repeat(64),
  CONTACTIA_MEDIR_AIRTABLE:"false"
};
const RECORD="rec12345678901234";
function solicitud(nombre="Patio",sesion=true,origen="https://panel.example") {
  return {method:"POST",headers:{host:"panel.example",origin:origen,
    "content-type":"application/json",
    cookie:sesion?COOKIE_SESION+"="+crearTokenSesion(1):""},
    body:{accion:"zonas_crear",restaurante_id:1,nombre_zona:nombre}};
}
function respuesta() {
  return {statusCode:0,body:null,setHeader(){},end(raw){this.body=JSON.parse(raw);}};
}
function mock(preexistentes=[]) {
  const llamadas=[];let creada=null;
  return {llamadas,creada:()=>creada,fetch:async(url,opts={})=>{
    const u=new URL(url),tabla=u.pathname.split("/")[3];
    const metodo=opts.method||"GET";llamadas.push({tabla,metodo});
    assert.equal(u.origin,"https://api.airtable.com");
    assert.equal(u.pathname.split("/")[2],ENV.AIRTABLE_BASE_ID);
    if(tabla==="RESTAURANTES"&&metodo==="GET") return {
      ok:true,status:200,text:async()=>JSON.stringify({records:[{id:RECORD,
        fields:{id:1,estado:"activo"}}]})};
    if(tabla==="ZONA"&&metodo==="GET")return {
      ok:true,status:200,text:async()=>JSON.stringify({records:preexistentes})};
    if(tabla==="ZONA"&&metodo==="POST"){
      const body=JSON.parse(opts.body);assert.equal(body.records.length,1);
      const fields=body.records[0].fields;
      assert.deepEqual(Object.keys(fields).sort(),["estado","id_zona","nombre","restaurante"]);
      assert.equal(fields.estado,"inactivo");
      assert.deepEqual(fields.restaurante,[RECORD]);
      creada=fields;
      return{ok:true,status:200,text:async()=>JSON.stringify({records:[{
        id:"rec09876543210987",fields
      }]})};
    }
    throw new Error("Llamada inesperada: "+tabla+" "+metodo);
  }};
}
async function entorno(run){
  const old=Object.fromEntries(KEYS.map(k=>[k,process.env[k]]));
  const anterior=global.fetch;Object.assign(process.env,ENV);
  const red=mock();global.fetch=red.fetch;
  try{return await run(red)}finally{
    global.fetch=anterior;
    for(const [k,v] of Object.entries(old)) {
      if(v===undefined)delete process.env[k];else process.env[k]=v;
    }
  }
}
async function llamar(req){const res=respuesta();await handler(req,res);return res;}
test("sin activar la opción el alta no consulta Airtable",async()=>
  entorno(async red=>{
    process.env.CONTACTIA_CREAR_ZONAS="0";
    const out=await llamar(solicitud());
    assert.equal(out.statusCode,503);
    assert.equal(red.llamadas.length,0);
  })
);
test("origen cruzado o sesión inválida no leen ni escriben",async()=>
  entorno(async red=>{
    assert.equal((await llamar(solicitud("Patio",true,"https://otro.example"))).statusCode,403);
    assert.equal((await llamar(solicitud("Patio",false))).statusCode,401);
    assert.equal(red.llamadas.length,0);
  })
);
test("nombre inválido se rechaza antes de acceder a Airtable",async()=>
  entorno(async red=>{
    for(const s of [""," ","x","<script>","x".repeat(61)]){
      assert.equal((await llamar(solicitud(s))).statusCode,400);
    }
    assert.equal(red.llamadas.length,0);
  })
);
test("crear una zona hace dos GET y un POST; se publica inactiva",async()=>
  entorno(async red=>{
    const out=await llamar(solicitud("Patio"));
    assert.equal(out.statusCode,201);
    assert.equal(out.body.zona.nombre,"Patio");
    assert.equal(out.body.zona.estado,"inactivo");
    assert.deepEqual(red.llamadas,[{tabla:"RESTAURANTES",metodo:"GET"},
      {tabla:"ZONA",metodo:"GET"},{tabla:"ZONA",metodo:"POST"}]);
    assert.match(red.creada().id_zona,/^CONTACTIA-[0-9A-F]{16}$/);
    assert.deepEqual(red.creada().restaurante,[RECORD]);
  })
);
test("nombre duplicado normalizado bloquea el POST",async()=>
  entorno(async _red=>{
    const red=mock([{id:"recOtraZona000001",fields:{
      restaurante:[RECORD],nombre:"Salón Principal",estado:"inactivo"
    }}]);
    global.fetch=red.fetch;
    const out=await llamar(solicitud("salon  principal"));
    assert.equal(out.statusCode,409);
    assert.equal(red.llamadas.length,2);
    assert.equal(red.llamadas.some(l=>l.metodo==="POST"),false);
  })
);
test("nunca se activa el alta en producción o en otra rama",async()=>
  entorno(async red=>{
    process.env.VERCEL_ENV="production";
    assert.equal((await llamar(solicitud())).statusCode,503);
    process.env.VERCEL_ENV="preview";process.env.VERCEL_GIT_COMMIT_REF="otra-rama";
    assert.equal((await llamar(solicitud())).statusCode,503);
    assert.equal(red.llamadas.length,0);
  })
);
