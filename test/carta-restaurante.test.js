'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const m=require('../lib/carta-restaurante');
const {PDFDocument}=require('pdf-lib');
const {validarPdf,importar}=require('../lib/importar-carta');
function carta(){return {...m.vacia(),categorias:[{id:'arroz',nombre:'Arroces',notas:'Mínimo 2 personas. Preparación 40–50 minutos.',platos:[{id:'paella',nombre:'Paella valenciana',descripcion:'Arroz de la casa',precio:'23.50',unidad:'por persona',disponible:true,revisado:true,alergenos:['moluscos'],trazas:['gluten'],alergenos_confirmados:false,nota_alergenos:'Símbolo sin leyenda',pagina:1}]}]};}
async function pdf(paginas=1){const doc=await PDFDocument.create();for(let i=0;i<paginas;i++)doc.addPage();return Buffer.from(await doc.save()).toString('base64');}
test('publicación requiere revisión y mantiene precios, unidades y condiciones',()=>{
 const c=carta();c.categorias[0].platos[0].revisado=false;assert.throws(()=>m.validar(c,true),/Revise/);
 c.categorias[0].platos[0].revisado=true;const validada=m.validar(c,true);assert.equal(validada.categorias[0].platos[0].precio,'23,50');
 assert.match(m.responder(validada,'cuánto cuesta la paella valenciana'),/23,50 € por persona/);
 assert.match(m.responder(validada,'cuánto cuesta la paella valenciana'),/Mínimo 2/);
 assert.throws(()=>m.validar({...c,categorias:[...c.categorias,...c.categorias]}),/categor/);
 c.categorias[0].platos[0].precio='23 euros';assert.throws(()=>m.validar(c),/Precio/);
});
test('alérgenos pendientes nunca llegan a respuestas públicas como confirmados',()=>{
 const c=carta(),p=m.publica(c);assert.deepEqual(p.categorias[0].platos[0].alergenos,[]);assert.equal(p.categorias[0].platos[0].nota_alergenos,'');
 assert.match(m.responder(p,'la paella valenciana lleva gluten?'),/pendiente de confirmar/);
 assert.match(m.responder(p,'soy alérgico, qué puedo comer'),/qué plato/i);
 const plato=c.categorias[0].platos[0];plato.alergenos_confirmados=true;
 assert.match(m.responder(m.publica(c),'la paella valenciana tiene leche?'),/Moluscos/);
 assert.match(m.responder(m.publica(c),'la paella valenciana tiene leche?'),/Cereales con gluten/);
 plato.alergenos=[];plato.trazas=[];const respuesta=m.responder(m.publica(c),'la paella valenciana tiene leche?');assert.match(respuesta,/no ha declarado/);assert.match(respuesta,/contacto cruzado/);assert.doesNotMatch(respuesta,/sin alérgenos|seguro|apto/i);
});
test('no confunde el nombre de un plato con una consulta de alergia y distingue opciones',()=>{
 const c=carta();const p=c.categorias[0].platos[0];p.nombre='Huevos rotos';assert.match(m.responder(c,'cuánto cuestan los huevos rotos'),/23.50/);
 p.nombre='Paella valenciana';c.categorias[0].platos.push({...p,id:'marinera',nombre:'Paella marinera'});
 assert.match(m.responder(c,'tenéis paella'),/Cuál le interesa/);assert.match(m.responder(c,'qué arroces tenéis'),/Mínimo 2/);
 assert.equal(m.responder(c,'hay aparcamiento'),null);assert.equal(m.responder(null,'qué carta tenéis'),null);
});
test('reimportación compara cambios sin depender de identificadores y sin mutar el publicado',()=>{
 const a=carta(),b=structuredClone(a);b.categorias[0].platos[0].id='otro';assert.deepEqual(m.diferencias(a,b),{nuevos:0,cambiados:0,eliminados:0});
 b.categorias[0].platos[0].precio='25';assert.equal(m.diferencias(a,b).cambiados,1);assert.equal(a.categorias[0].platos[0].precio,'23.50');
});
test('PDF: valida páginas, tamaño, base64 y contenido real antes de enviarlo',async()=>{
 assert.equal((await validarPdf(await pdf(5))).paginas,5);await assert.rejects(validarPdf(await pdf(13)),/1 y 12/);
 await assert.rejects(validarPdf(Buffer.from('esto no es un PDF').toString('base64')),/PDF válido/);
 await assert.rejects(validarPdf('AAAA!'),/PDF/);await assert.rejects(validarPdf('A'.repeat(3400000)),/2,5/);
 let llamadas=0;await assert.rejects(importar({base64:await pdf(),env:{},fetchImpl:()=>{llamadas++;}}),/no está activada/);assert.equal(llamadas,0);
});
test('importador usa PDF visual, esquema estricto y fuerza revisión de platos y alérgenos',async()=>{
 const datos={avisos:['Iconos sin leyenda'],categorias:[{nombre:'Arroces',notas:'Mínimo 2 personas',platos:[{nombre:'Paella',descripcion:'',precio:'23,50',unidad:'por persona',pagina:1,alergenos:[],trazas:[],nota_alergenos:'Pendiente',revisado:true,alergenos_confirmados:true}]}]};
 const c=await importar({base64:await pdf(),nombre:'carta.pdf',env:{OPENAI_API_KEY:'simulada'},fetchImpl:async(url,opts)=>{
  assert.equal(url,'https://api.openai.com/v1/responses');const b=JSON.parse(opts.body);assert.equal(b.store,false);assert.equal(b.text.format.strict,true);assert.match(b.input[0].content[0].file_data,/^data:application\/pdf;base64,/);assert.equal(b.tools,undefined);
  return {ok:true,json:async()=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(datos)}]}]})};
 }});assert.equal(c.fuente.paginas,1);assert.equal(c.categorias[0].platos[0].revisado,false);assert.equal(c.categorias[0].platos[0].alergenos_confirmados,false);assert.throws(()=>m.validar(c,true),/Revise/);
});
test('importador rechaza salidas incompletas, negativas y fallos del proveedor sin devolver un borrador',async()=>{
 const base64=await pdf();for(const respuesta of [{status:'incomplete',output:[]},{status:'completed',output:[{type:'message',content:[{type:'refusal'}]}]},{status:'completed',output:[{type:'message',content:[{type:'output_text',text:'no JSON'}]}]}]){
  await assert.rejects(importar({base64,env:{OPENAI_API_KEY:'simulada'},fetchImpl:async()=>({ok:true,json:async()=>respuesta})}));
 }
 await assert.rejects(importar({base64,env:{OPENAI_API_KEY:'simulada'},fetchImpl:async()=>({ok:false,status:429})}),/límite/);
});
