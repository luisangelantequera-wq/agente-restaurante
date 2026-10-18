'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const chat=require('../api/chat'),panel=require('../api/restaurante'),ajustes=require('../lib/ajustes-panel'),modelo=require('../lib/encargos-restaurante'),visto=require('../lib/encargos-panel');
const {crearTokenSesion,COOKIE_SESION}=require('../lib/sesion-restaurante');
const REST='recRestauranteSol',RID='recReservaEncarg1',ZONA='recZonaInterior01',MESA='recMesaInterior01';
const grupo=()=>({id:'arroz',nombre:'Arroces',platos:['Arroz del señoret','Arroz negro'],dias:[...modelo.DIAS],minimo:2,antelacion_horas:1,pregunta:'',activo:true});
const env={VERCEL_ENV:'preview',CONTACTIA_PANEL_V2:'1',CONTACTIA_CACHE_PUBLICA:'0',CONTACTIA_MEDIR_AIRTABLE:'false',AIRTABLE_BASE_ID:'appEnsayoEncargos',AIRTABLE_API_KEY:'simulada',PANEL_SESSION_SECRET:'s'.repeat(64),KV_REST_API_URL:'',KV_REST_API_TOKEN:'',RESEND_API_KEY:''};
const respuesta=d=>({ok:true,status:200,text:async()=>JSON.stringify(d),json:async()=>d});
async function escenario(fn){const anterior=Object.fromEntries(Object.keys(env).map(k=>[k,process.env[k]])),f=global.fetch;Object.assign(process.env,env);const fecha=new Date(Date.now()+7*86400000).toISOString().slice(0,10),r={id:REST,fields:{id:1,nombre:'Sol',estado:'activo',email:'owner@example.com',prefijo_reserva:'SOL',duracion_reserva_minutos:90,intervalo_minutos:15,antelacion_minima_reserva_minutos:30,horario_reservas:JSON.stringify(Object.fromEntries(modelo.DIAS.map(d=>[d,['12:00-16:00']]))),informacion_publica:JSON.stringify({mascotas:'Solo terraza',encargos:[grupo()]})}},e={restaurante:r,reservas:[],writes:[],reads:[],correos:[]};
 global.fetch=async(url,opts={})=>{const u=new URL(url),parts=u.pathname.split('/'),tabla=parts[3],id=parts[4];if(u.hostname==='api.resend.com'){e.correos.push(JSON.parse(opts.body));return respuesta({id:'correo-encargo'});}e.reads.push(tabla);
 if(tabla==='RESTAURANTES'){if(opts.method==='PATCH'){const fields=JSON.parse(opts.body).fields;Object.assign(r.fields,fields);e.writes.push({tabla,fields});return respuesta(r);}return respuesta({records:[r]});}
 if(tabla==='ZONA')return respuesta({records:[{id:ZONA,fields:{nombre:'INTERIOR',estado:'activo',restaurante:[REST]}}]});
 if(tabla==='MESAS')return respuesta({records:[{id:MESA,fields:{id:1,nombre_mesa:'Mesa 1',capacidad:4,estado:'disponible',restaurante:[REST],zona:[ZONA]}}]});
 if(tabla==='COMBINACIONES_MESAS')return respuesta({records:[]});
 if(tabla==='LISTA_ESPERA')return respuesta({records:[]});
 if(tabla==='AUDITORIA')return respuesta({records:[]});
 if(tabla==='RESERVAS'){
  if(opts.method==='POST'){const fields=JSON.parse(opts.body).fields;const rec={id:RID,fields};e.reservas.push(rec);e.writes.push({tabla,fields});return respuesta(rec);}
  if(opts.method==='PATCH'){const rec=e.reservas.find(r=>r.id===id);assert.ok(rec);const fields=JSON.parse(opts.body).fields;Object.assign(rec.fields,fields);e.writes.push({tabla,fields});return respuesta(rec);}
  if(id)return respuesta(e.reservas.find(r=>r.id===id));
  return respuesta({records:e.reservas});
 }
 throw Error('Red no prevista: '+url);
 };
 const cookie=COOKIE_SESION+'='+crearTokenSesion(1);
 async function llamar(handler,body,cabeceras={}){const res={setHeader(){},end(raw){this.body=JSON.parse(raw)}};await handler({method:'POST',headers:{host:'panel.example',origin:'https://panel.example','content-type':'application/json',cookie,...cabeceras},body},res);return {status:res.statusCode,...res.body};}
 try{await fn({e,fecha,cookie,llamar});}finally{global.fetch=f;for(const[k,v]of Object.entries(anterior))if(v===undefined)delete process.env[k];else process.env[k]=v;}
}
test('encargos: opciones de disponibilidad se calculan sin otra lectura de restaurante',()=>escenario(async({e,fecha,llamar})=>{
 const r=await llamar(chat,{accion:'verificar',restaurante_id:1,fecha,hora:'14:00',personas:4,zona_preferida:'INTERIOR'});assert.equal(r.status,200);assert.equal(r.disponible,true);assert.deepEqual(r.encargos_disponibles[0].platos,grupo().platos);assert.equal(e.reads.filter(x=>x==='RESTAURANTES').length,1);
}));
test('encargos: rechaza pedidos manipulados, día y antelación antes de crear una reserva',()=>escenario(async({e,fecha,llamar})=>{
 const body={accion:'reservar',restaurante_id:1,fecha,hora:'14:00',personas:4,zona_preferida:'INTERIOR',nombre:'Cliente prueba',email:'cliente@example.com',telefono:'612345678',encargos:[{grupo_id:'arroz',plato:'Arroz negro',personas:1}]};
 let r=await llamar(chat,body);assert.equal(r.status,400);assert.equal(r.encargos_error,true);assert.equal(e.writes.length,0);
 body.encargos[0].personas=2;e.restaurante.fields.informacion_publica=JSON.stringify({encargos:[{...grupo(),antelacion_horas:8760}]});r=await llamar(chat,body);assert.equal(r.encargos_error,true);assert.equal(r.encargos_disponibles.length,0);assert.equal(e.writes.length,0);
}));
test('encargos: guarda platos separados de las observaciones y los muestra en el portal sin marcarlos vistos',()=>escenario(async({e,fecha,llamar})=>{
 process.env.RESEND_API_KEY='simulada';
 const r=await llamar(chat,{accion:'reservar',restaurante_id:1,fecha,hora:'14:00',personas:4,zona_preferida:'INTERIOR',nombre:'Cliente prueba',email:'cliente@example.com',telefono:'612345678',mensaje:'Cumpleaños',encargos:[{grupo_id:'arroz',plato:'Arroz del señoret',personas:4}]});
 assert.equal(r.status,200);assert.equal(r.reservado,true);const rec=e.reservas[0],encargo=modelo.leerReserva(rec.fields.encargo_json);assert.equal(encargo.items[0].personas,4);assert.equal(encargo.visto,false);assert.match(rec.fields.mensaje,/Cumpleaños/);assert.ok(e.correos.length>=2);assert.ok(e.correos.every(c=>c.html.includes('Arroz del señoret')));
 const p=await llamar(panel,{accion:'cargar',restaurante_id:1,fecha,hora_mesas:'14:00'});assert.equal(p.status,200);assert.equal(p.reservas[0].encargo.items[0].plato,'Arroz del señoret');assert.match(p.reservas[0].encargo_revision,/^[a-f0-9]{64}$/);
}));
test('encargos: visto requiere sesión, origen, propietario y revisión actual; solo escribe el campo de encargo',()=>escenario(async({e,fecha,llamar})=>{
 const encargo=modelo.validarSeleccion([{grupo_id:'arroz',plato:'Arroz negro',personas:2}],[grupo()],fecha,'14:00',4);e.reservas.push({id:RID,fields:{restaurante:[REST],fecha,hora:'14:00',estado:'confirmada',personas:4,encargo_json:JSON.stringify(encargo)}});
 const b={accion:'encargo_visto',restaurante_id:1,reserva_id:RID,revision:visto.revision(encargo)};
 assert.equal((await llamar(panel,b,{cookie:''})).status,401);assert.equal((await llamar(panel,b,{origin:'https://otro.example'})).status,403);assert.equal(e.writes.length,0);
 assert.equal((await llamar(panel,{...b,revision:'a'.repeat(64)})).status,409);
 e.reservas[0].fields.restaurante=['recRestauranteLun'];assert.equal((await llamar(panel,b)).status,404);e.reservas[0].fields.restaurante=[REST];
 const r=await llamar(panel,b);assert.equal(r.status,200);assert.equal(r.encargo.visto,true);assert.ok(r.encargo.visto_en);assert.deepEqual(Object.keys(e.writes.at(-1).fields),['encargo_json']);
}));
test('encargos: cambiar información general conserva reglas y desactivar un grupo retira sus opciones',()=>escenario(async({e,llamar})=>{
 const base={accion:'ajustes_consultar',restaurante_id:1,seccion:'publico'};const c=await llamar(ajustes,base);const d=c.datos;d.informacion.mascotas='No admitimos mascotas';
 assert.equal((await llamar(ajustes,{...base,accion:'ajustes_guardar',revision:c.revision,datos:d})).status,200);assert.equal(modelo.leer(e.restaurante.fields).length,1);
 const g=await llamar(ajustes,{...base,seccion:'gastronomia'});g.datos.encargos[0].activo=false;assert.equal((await llamar(ajustes,{...base,seccion:'gastronomia',accion:'ajustes_guardar',revision:g.revision,datos:g.datos})).status,200);assert.equal(modelo.leer(e.restaurante.fields)[0].activo,false);
}));
