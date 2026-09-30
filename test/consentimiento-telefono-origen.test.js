const test=require('node:test'), assert=require('node:assert/strict');
const {preparar,evidencia,interpretarRespuesta,diagnosticoOrigen}=require('../lib/consentimiento-telefono-origen');
const env={VERCEL_ENV:'preview',CONTACTIA_CONSENTIMIENTO_TELEFONO_ORIGEN:'1'};
const contexto={canal:'telefonia',origenValidado:true,callSid:'CA'+'1'.repeat(32),telefonoOrigen:'+34600000000',telefonoFacilitado:'611 111 111',idioma:'es'};
test('pregunta acordada solo para un origen autenticado distinto del facilitado',()=>{
 assert.equal(preparar(contexto,env).pregunta,'¿Nos autoriza a guardar el número desde el que llama para intentar contactar con usted si hubiera cualquier incidencia con su reserva?');
 for(const cambio of [{canal:'web'},{origenValidado:false},{callSid:undefined},{telefonoOrigen:'anonymous'},{telefonoOrigen:'unknown'},{telefonoOrigen:'600000000'},{telefonoFacilitado:'600 000 000'},{telefonoFacilitado:'+34 600000000'},{telefonoFacilitado:''},{idioma:'de'}])
  assert.equal(preparar({...contexto,...cambio},env).preguntar,false);
 assert.equal(preparar(contexto,{}).preguntar,false);
 assert.equal(preparar(contexto,{...env,VERCEL_ENV:'production'}).preguntar,false);
});
test('sin sí explícito no devuelve el número; autorización separada de WhatsApp',()=>{
 for(const valor of [undefined,null,'si','true',1]) assert.equal(evidencia(contexto,valor,env),null);
 const negativa=evidencia(contexto,false,env,0);
 assert.equal(negativa.consentimiento_telefono_origen.autorizado,false);
 assert.equal(JSON.stringify(negativa).includes(contexto.telefonoOrigen),false);
 const positiva=evidencia(contexto,true,env,0);
 assert.equal(positiva.telefono_alternativo,contexto.telefonoOrigen);
 assert.equal(positiva.numero_verificado,false);
 assert.equal(positiva.consentimiento_telefono_origen.registrado,'1970-01-01T00:00:00.000Z');
 assert.equal(Object.hasOwn(positiva,'whatsapp_autorizado'),false);
 assert.equal(evidencia({...contexto,canal:'web'},true,env),null);
});
test('sí, no y ambigüedad en los tres idiomas sin confirmar por una respuesta ajena',()=>{
 for(const [idioma,si,no] of [['es','Sí, sí.','No, gracias.'],['en','Yes please','No thank you'],['fr','Oui merci','Non merci']]) {
  assert.equal(preparar({...contexto,idioma},env).idioma,idioma);
  assert.equal(interpretarRespuesta(si,idioma),true);
  assert.equal(interpretarRespuesta(no,idioma),false);
 }
 for(const texto of ['quizás','sí pero no','confirmo la reserva','si falla el correo','']) assert.equal(interpretarRespuesta(texto),null);
 assert.equal(interpretarRespuesta('oui','de'),null);
});
test('número oculto queda como indicador sin teléfono, distinto de no disponible',()=>{
 const oculto={...contexto,telefonoOrigen:'anonymous'};
 assert.deepEqual(diagnosticoOrigen(oculto),{telefono_origen_estado:'oculto'});
 assert.equal(preparar(oculto,env).preguntar,false);
 assert.equal(evidencia(oculto,true,env),null);
 for(const telefonoOrigen of ['unknown','',undefined,'sip:cliente@example.com'])
  assert.deepEqual(diagnosticoOrigen({...contexto,telefonoOrigen}),{telefono_origen_estado:'no_disponible'});
 assert.deepEqual(diagnosticoOrigen(contexto),{telefono_origen_estado:'disponible'});
 assert.equal(JSON.stringify(diagnosticoOrigen(contexto)).includes(contexto.telefonoOrigen),false);
 assert.equal(diagnosticoOrigen({...oculto,origenValidado:false}),null);
 assert.equal(diagnosticoOrigen({...oculto,canal:'web'}),null);
});
