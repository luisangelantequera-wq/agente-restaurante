'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const ruta=require('../api/restaurante'),publico=require('../api/informacion-restaurante');
const {crearTokenSesion,COOKIE_SESION}=require('../lib/sesion-restaurante');
const m=require('../lib/carta-restaurante');
const env={VERCEL_ENV:'preview',VERCEL_GIT_COMMIT_REF:'carta-pruebas',CONTACTIA_PANEL_V2:'1',CONTACTIA_CARTA_ACTIVA:'1',CONTACTIA_CACHE_PUBLICA:'1',AIRTABLE_BASE_ID:'appFicticia',AIRTABLE_API_KEY:'simulada',PANEL_SESSION_SECRET:'s'.repeat(64),KV_REST_API_URL:'https://carta.upstash.io',KV_REST_API_TOKEN:'token-ficticio-largo',CONTACTIA_MEDIR_AIRTABLE:'false',OPENAI_API_KEY:''};
function carta(){return {...m.vacia(),categorias:[{id:'cat',nombre:'Arroces',notas:'Mínimo 2 personas',platos:[{id:'paella',nombre:'Paella valenciana',descripcion:'',precio:'23,50',unidad:'por persona',disponible:true,revisado:true,alergenos:['gluten'],trazas:[],alergenos_confirmados:false,nota_alergenos:'Propuesta privada',pagina:0}]}]};}
const response=d=>({ok:true,status:200,text:async()=>JSON.stringify(d),json:async()=>d});
async function escenario(fn){
 const antes=Object.fromEntries(Object.keys(env).map(k=>[k,process.env[k]])),f=global.fetch;Object.assign(process.env,env);
 const estado={campos:{1:{id:1,nombre:'Sol',estado:'activo',telefono1:'910000001'},2:{id:2,nombre:'Luna',estado:'activo',telefono1:'910000002'}},redis:new Map(),lecturas:0,escrituras:0,caido:false};
 global.fetch=async(url,opts={})=>{if(String(url)===env.KV_REST_API_URL){if(estado.caido)throw Error('caído');const [cmd,key,value]=JSON.parse(opts.body);if(cmd==='GET')return response({result:estado.redis.get(key)||null});if(cmd==='SET'){estado.redis.set(key,value);return response({result:'OK'});}throw Error('Redis desconocido');}
  const u=new URL(url);assert.equal(u.hostname,'api.airtable.com');const tabla=u.pathname.split('/')[3];if(tabla==='CONOCIMIENTO_RESTAURANTE')return response({records:[]});assert.equal(tabla,'RESTAURANTES');
  if(opts.method==='PATCH'){estado.escrituras++;const fields=JSON.parse(opts.body).fields;assert.deepEqual(Object.keys(fields),['carta_json']);assert.equal(u.pathname.split('/').pop(),'recRestauranteSol');Object.assign(estado.campos[1],fields);return response({id:'recRestauranteSol',fields:estado.campos[1]});}
  estado.lecturas++;const id=Number((u.searchParams.get('filterByFormula')||'').match(/\d+/)?.[0]||1);return response({records:[{id:id===1?'recRestauranteSol':'recRestauranteLun',fields:estado.campos[id]}]});
 };
 const cookie=COOKIE_SESION+'='+encodeURIComponent(crearTokenSesion(1));
 const llamar=async(accion,extra={},cabeceras={})=>{const req={method:'POST',headers:{host:'carta.example',origin:'https://carta.example','content-type':'application/json',cookie,...cabeceras},body:{accion:'carta_'+accion,restaurante_id:1,...extra}};const res={setHeader(){},end(s){this.body=JSON.parse(s);}};await ruta(req,res);return res;};
 const preguntar=async(pregunta,id=1)=>{const res={setHeader(){},end(s){this.body=JSON.parse(s);}};await publico({method:'POST',headers:{host:'carta.example',origin:'https://carta.example','content-type':'application/json'},body:{restaurante_id:id,pregunta}},res);return res;};
 try{await fn({estado,llamar,preguntar,cookie});}finally{global.fetch=f;for(const[k,v]of Object.entries(antes)){if(v===undefined)delete process.env[k];else process.env[k]=v;}}
}
test('carta rechaza sesión ajena, falta de sesión, origen y producción antes de acceder a datos',()=>escenario(async({estado,llamar})=>{
 assert.equal((await llamar('consultar',{}, {cookie:''})).statusCode,401);
 assert.equal((await llamar('consultar',{restaurante_id:2})).statusCode,401);
 assert.equal((await llamar('consultar',{}, {origin:'https://otro.example'})).statusCode,403);
 process.env.VERCEL_ENV='production';assert.equal((await llamar('consultar')).statusCode,404);assert.equal(estado.lecturas,0);assert.equal(estado.escrituras,0);
}));
test('borrador privado, revisión obligatoria, publicación y aislamiento de restaurantes',()=>escenario(async({estado,llamar,preguntar})=>{
 const consulta=await llamar('consultar');assert.equal(consulta.statusCode,200);assert.equal(consulta.body.importacion_disponible,false);
 const datos=carta();datos.categorias[0].platos[0].revisado=false;
 const guardado=await llamar('guardar',{revision:consulta.body.revision,datos});assert.equal(guardado.statusCode,200);assert.equal(guardado.body.estado.publicada,null);assert.equal(estado.escrituras,1);
 assert.equal((await preguntar('cuánto cuesta la paella valenciana')).body.encontrada,false);
 assert.equal((await llamar('publicar',{revision:guardado.body.revision,datos,confirmar_publicacion:true})).statusCode,400);
 datos.categorias[0].platos[0].revisado=true;
 assert.equal((await llamar('publicar',{revision:guardado.body.revision,datos})).statusCode,400);
 const publicada=await llamar('publicar',{revision:guardado.body.revision,datos,confirmar_publicacion:true});assert.equal(publicada.statusCode,200);assert.equal(publicada.body.memoria.sincronizada,true);
 const respuesta=await preguntar('cuánto cuesta la paella valenciana');assert.equal(respuesta.statusCode,200);assert.match(respuesta.body.respuesta,/23,50 € por persona/);
 assert.match((await preguntar('la paella valenciana lleva gluten?')).body.respuesta,/pendiente de confirmar/);
 assert.equal((await preguntar('cuánto cuesta la paella valenciana',2)).body.encontrada,false);
 const cache=[...estado.redis.values()].join('');assert.doesNotMatch(cache,/Propuesta privada|api_key_restaurante/);
 datos.categorias[0].platos[0].precio='30';const nuevo=await llamar('guardar',{revision:publicada.body.revision,datos});assert.equal(nuevo.statusCode,200);
 assert.match((await preguntar('cuánto cuesta la paella valenciana')).body.respuesta,/23,50/);
 assert.equal((await llamar('guardar',{revision:consulta.body.revision,datos})).statusCode,409);
}));
test('fallo de memoria conserva el guardado y permite sincronizar y retirar sin modificar el borrador',()=>escenario(async({estado,llamar,preguntar})=>{
 const consulta=await llamar('consultar');estado.caido=true;
 const publicado=await llamar('publicar',{revision:consulta.body.revision,datos:carta(),confirmar_publicacion:true});assert.equal(publicado.statusCode,200);assert.equal(publicado.body.datos_guardados,true);assert.equal(publicado.body.memoria.sincronizada,false);assert.match(publicado.body.aviso,/pendiente/);
 estado.caido=false;const escrituras=estado.escrituras;assert.equal((await llamar('sincronizar')).body.memoria.sincronizada,true);assert.equal(estado.escrituras,escrituras);
 const retirada=await llamar('retirar',{revision:publicado.body.revision,confirmar_publicacion:true});assert.equal(retirada.body.estado.publicada,null);assert.equal(m.platos(retirada.body.estado.borrador).length,1);
 assert.equal((await preguntar('cuánto cuesta la paella valenciana')).body.encontrada,false);
}));
test('importación sin clave no envía el PDF ni cambia el guardado; límites previos se conservan',()=>escenario(async({estado,llamar})=>{
 const consulta=await llamar('consultar');const r=await llamar('importar',{revision:consulta.body.revision,pdf_base64:'dato'});assert.equal(r.statusCode,503);assert.equal(estado.escrituras,0);
 assert.equal((await llamar('consultar',{relleno:'x'.repeat(110000)})).statusCode,413);
 const res={setHeader(){},end(s){this.body=JSON.parse(s);}};await ruta({method:'POST',headers:{'content-type':'application/json'},body:{accion:'consultar',relleno:'x'.repeat(17000)}},res);assert.equal(res.statusCode,413);
}));

test('carta aparcada: sin activación explícita no accede al editor ni responde desde la carta publicada',()=>escenario(async({estado,llamar,preguntar})=>{
 process.env.CONTACTIA_CARTA_ACTIVA='0';
 estado.campos[1].carta_json=JSON.stringify({version:1,borrador:carta(),publicada:carta(),publicada_en:new Date().toISOString()});
 assert.equal((await llamar('consultar')).statusCode,404);assert.equal(estado.lecturas,0);
 assert.equal((await preguntar('cuánto cuesta la paella valenciana')).body.encontrada,false);
 assert.equal(estado.escrituras,0);
}));

test('carta disponible por defecto y compatible con información gastronómica independiente',()=>escenario(async({estado,llamar,preguntar})=>{
 delete process.env.CONTACTIA_CARTA_ACTIVA;
 estado.campos[1].carta_json=JSON.stringify({version:1,borrador:carta(),publicada:carta(),publicada_en:new Date().toISOString()});
 assert.equal((await llamar('consultar')).statusCode,200);
 assert.match((await preguntar('cuánto cuesta la paella valenciana')).body.respuesta,/23,50/);
 estado.campos[1].informacion_publica=JSON.stringify({gastronomia:'Los jueves tenemos paella, por encargo y para un mínimo de dos personas.'});estado.redis.clear();
 assert.equal((await preguntar('¿Tenéis paella?')).body.respuesta,'Los jueves tenemos paella, por encargo y para un mínimo de dos personas.');
}));
