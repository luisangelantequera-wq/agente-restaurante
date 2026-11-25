'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');
const leer = nombre => fs.readFileSync(require.resolve('../'+nombre),'utf8');

test('el menú deja la vista activa a ancho completo y conserva una edición al volver a Ajustes', async t => {
  const { window } = new JSDOM(leer('acceso-restaurante.html'),{runScripts:'outside-only'});
  t.after(()=>window.close());
  const $ = id => window.document.getElementById(id);
  window.matchMedia = () => ({matches:true});
  window.HTMLDialogElement.prototype.showModal = function () { this.open=true; };
  window.HTMLDialogElement.prototype.close = function () { this.open=false; };
  const recuperaciones = [];
  const consultasEquipo = [];
  let gestionarEquipo=true;
  window.confirm=()=>true;
  window.fetch = async (_url,{body}) => {
    const {accion,email,usuario_id} = JSON.parse(body);
    if (accion==='supabase_correo_recuperar') recuperaciones.push(email);
    if (accion==='supabase_equipo') consultasEquipo.push(usuario_id);
    const respuesta = accion==='supabase_estado' ? {usuario:{email:'prueba@example.org'},restaurantes:[{id:81,nombre:'Restaurante de prueba'}],puede_recuperar_clave:true} :
      accion==='supabase_correo_estado' ? {habilitado:true} :
      accion==='supabase_correo_recuperar' ? {mensaje:'Solicitud recibida.'} :
      accion==='supabase_equipo' ? {personas:usuario_id?[]:[{id:'prueba',email:'equipo@example.org',rol:'empleado',puede_retirar:true}]} :
      accion==='supabase_configuracion' ? {
        restaurante:{id:81,nombre:'Restaurante de prueba',direccion:'Calle de prueba, 12',zona_horaria:'Europe/Madrid',duracion_reserva_minutos:90,antelacion_minima_reserva_minutos:30,
          intervalo_minutos:15,horario_reservas:{},dias_cierre:[],cierres_especiales:[],horarios_version:0},
        zonas:[{id:'i',nombre:'Interior',estado:'activo'}],
        mesas:[{id:'m',zona_id:'i',nombre:'Mesa 1',min_personas:1,capacidad:4,estado:'libre'}],
        reservas:[],puede_editar_datos:true,puede_gestionar_contacto:true,puede_gestionar_equipo:gestionarEquipo
      } : {contacto:{contacto_nombre:'Responsable',contacto_telefono:'',contacto_email:''},version:'a'.repeat(32)};
    return {ok:true,json:async()=>({ok:true,...respuesta})};
  };
  for (const archivo of ['lib/ajustes-restaurante.js','panel-datos-supabase.js','panel-contacto-supabase.js','panel-avisos-supabase.js','panel-llamadas-supabase.js','panel-horarios-supabase.js','equipo-restaurante.js','acceso-restaurante.js','acceso-correo-restaurante.js']) window.eval(leer(archivo));
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal($('vista-reservas').hidden,false);
  assert.equal($('menu-restaurante').querySelector('[aria-current="page"]').dataset.seccion,'reservas');
  assert.equal($('menu-restaurante').querySelector('[data-seccion="inicio"]'),null);
  assert.equal($('titulo-panel').closest('#cabecera-panel'),$('cabecera-panel'));
  assert.equal($('salir').closest('#cabecera-panel'),$('cabecera-panel'));
  assert.equal($('titulo-panel').textContent,'Restaurante de prueba');
  assert.equal($('titulo-panel').nextElementSibling,$('direccion-panel'));
  assert.equal($('direccion-panel').textContent,'Calle de prueba, 12');
  assert.equal($('direccion-panel').hidden,false);
  assert.equal($('selector-restaurante').hidden,true);
  assert.equal($('menu-restaurante').hidden,true);
  $('plegar-menu').click();
  const ir = s => window.document.querySelector('[data-seccion="'+s+'"]').click();
  ir('mesas');
  $('plegar-menu').click();
  assert.equal($('vista-mesas').hidden,false);
  assert.equal($('plegar-menu').getAttribute('aria-expanded'),'false');
  assert.match($('contenido-mesas').textContent,/Mesa 1/);
  $('plegar-menu').click();
  ir('ajustes');
  const nombre = $('dato-81-nombre');
  nombre.value='Edición sin guardar';
  ir('reservas');
  assert.equal($('vista-ajustes').hidden,true);
  ir('ajustes');
  assert.equal($('dato-81-nombre').value,'Edición sin guardar');
  const contacto = $('contenido-ajustes').querySelector('.editor-contacto');
  contacto.open=true;
  await new Promise(resolve=>setTimeout(resolve,15));
  assert.equal(contacto.querySelector('input').value,'Responsable');
  assert.deepEqual(consultasEquipo,[]);
  ir('equipo');
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal($('nav-equipo').hidden,false,$('mensaje').textContent);
  $('contenido-equipo').querySelector('[aria-label="Retirar acceso a equipo@example.org"]').click();
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(consultasEquipo,[undefined,'prueba']);
  assert.doesNotMatch($('contenido-equipo').textContent,/equipo@example.org/);
  gestionarEquipo=false;
  $('actualizar').click();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal($('nav-equipo').hidden,true);
  assert.equal($('vista-equipo').hidden,true);
  ir('cuenta');
  assert.equal($('vista-cuenta').hidden,false);
  assert.equal($('correo-cuenta').textContent,'prueba@example.org');
  $('cambiar-clave-cuenta').click();
  assert.equal($('email-recuperacion').readOnly,true);
  $('pedir-enlace').dispatchEvent(new window.Event('submit',{cancelable:true}));
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(recuperaciones,['prueba@example.org']);
  $('cerrar-correo-acceso').click();
  $('salir-cuenta').click();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal($('acceso').hidden,false);
  assert.equal($('correo-cuenta').textContent,'');
  assert.equal($('direccion-panel').hidden,true);
  $('olvido-clave').click();
  assert.equal($('email-recuperacion').readOnly,false);
});
