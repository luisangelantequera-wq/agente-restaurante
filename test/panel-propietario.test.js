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
  window.fetch = async (_url,{body}) => {
    const {accion} = JSON.parse(body);
    const respuesta = accion==='supabase_estado' ? {usuario:{email:'prueba@example.org'},restaurantes:[{id:81,nombre:'Restaurante de prueba'}]} :
      accion==='supabase_configuracion' ? {
        restaurante:{id:81,nombre:'Restaurante de prueba',zona_horaria:'Europe/Madrid',duracion_reserva_minutos:90,antelacion_minima_reserva_minutos:30},
        zonas:[{id:'i',nombre:'Interior',estado:'activo'}],
        mesas:[{id:'m',zona_id:'i',nombre:'Mesa 1',min_personas:1,capacidad:4,estado:'libre'}],
        reservas:[],puede_editar_datos:true,puede_gestionar_contacto:true
      } : {contacto:{contacto_nombre:'Responsable',contacto_telefono:'',contacto_email:''},version:'a'.repeat(32)};
    return {ok:true,json:async()=>({ok:true,...respuesta})};
  };
  for (const archivo of ['lib/ajustes-restaurante.js','panel-datos-supabase.js','panel-contacto-supabase.js','panel-avisos-supabase.js','panel-llamadas-supabase.js','panel-horarios-supabase.js','acceso-restaurante.js']) window.eval(leer(archivo));
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal($('vista-reservas').hidden,false);
  assert.equal($('menu-restaurante').querySelector('[aria-current="page"]').dataset.seccion,'reservas');
  assert.equal($('menu-restaurante').querySelector('[data-seccion="inicio"]'),null);
  assert.equal($('titulo-panel').closest('#configuracion'),$('configuracion'));
  assert.equal($('titulo-panel').textContent,'Restaurante de prueba');
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
});
