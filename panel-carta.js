'use strict';
(function(){
  const m=window.ContactiaCarta,$=id=>document.getElementById(id),raiz=$('seccion-carta'),id=Number(new URLSearchParams(location.search).get('restaurante')||1);
  let estado=null,carta=m.vacia(),revision='',ocupado=false,cargada=false,sucio=false,urlPdf='';
  const escapar=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const nuevoId=()=>crypto.randomUUID();
  function cambiar(){raiz.querySelectorAll('[data-aviso-plato]').forEach(el=>el.hidden=true);$('carta-aviso-guardado').hidden=true;$('carta-error').textContent='';sucio=true;$('carta-estado').textContent='Hay cambios sin guardar en el borrador.';resumen();}
  function resumen(){
    const platos=m.platos(carta),pendientes=platos.filter(p=>!p.revisado).length;
    $('carta-resumen').textContent=`${carta.categorias.length} categorías · ${platos.length} platos y bebidas · ${pendientes} pendientes de revisión`;
    $('carta-publicacion').textContent=estado?.publicada?`Carta publicada: ${new Intl.DateTimeFormat('es-ES',{dateStyle:'medium',timeStyle:'short'}).format(new Date(estado.publicada_en))}. ${carta.fuente.nombre?'Borrador de '+carta.fuente.nombre+'.':''}`:'Aún no hay una carta publicada. El asistente no utiliza el borrador.';
    $('carta-retirar').hidden=!estado?.publicada;
    $('carta-ayuda-publicar').textContent=!platos.length?'Añada al menos un plato o bebida y revise sus datos antes de publicar.':pendientes?`Faltan ${pendientes} platos o bebidas por revisar. Guardar el borrador no los marca como revisados. Cuando haya comprobado nombres, precios y condiciones, pulse «Confirmar revisión de todos los platos». Seleccione los alérgenos conocidos dentro de cada plato.`:'Los platos están marcados como revisados. Ya puede guardar y publicar. Los alérgenos pendientes se comunicarán como información sin confirmar.';
  }
  async function solicitar(accion,extra={}){
    const r=await fetch('/api/restaurante',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({accion:'carta_'+accion,restaurante_id:id,revision,...extra})});
    let d;try{d=await r.json();}catch{throw new Error('El servidor no pudo completar la operación. Si importaba un PDF, pruebe con un documento más pequeño.');}
    if(!r.ok||!d.ok)throw new Error(d.error||'No se pudo completar la operación.');return d;
  }
  function avisoImportacion(texto,tipo='progreso'){const caja=$('carta-aviso-importacion');caja.textContent=texto;caja.dataset.estado=tipo;caja.hidden=false;caja.scrollIntoView?.({block:'nearest',behavior:'smooth'});}
  function bloquear(valor){ocupado=valor;raiz.querySelectorAll('button,input,select,textarea').forEach(el=>{el.disabled=valor;});if(!valor&&!cargada)$('carta-importar').disabled=true;}
  function alergenos(p,campo){return `<fieldset class="carta-alergenos"><legend>${campo==='alergenos'?'Contiene':'Posibles trazas declaradas'}</legend>${m.ALERGENOS.map(a=>`<label><input type="checkbox" data-lista="${campo}" value="${a.id}" ${p[campo].includes(a.id)?'checked':''}><span aria-hidden="true">${a.icono}</span> ${escapar(a.nombre)}</label>`).join('')}</fieldset>`;}
  const detallePlato=p=>`${p.precio?p.precio+' € '+p.unidad:'Precio a consultar'} · ${p.disponible?'Disponible':'Agotado'} · ${p.revisado?'Revisado':'Pendiente'}`;
  function textoAlergenos(p){const nombres=lista=>lista.map(id=>m.ALERGENOS.find(a=>a.id===id)?.nombre||'').filter(Boolean).join(', ');return [nombres(p.alergenos),p.trazas.length?'Trazas: '+nombres(p.trazas):''].filter(Boolean).join(' · ')+(p.alergenos.length||p.trazas.length?(!p.alergenos_confirmados?' (pendientes de revisión)':''):'');}
  function actualizarResumen(nodo,p){nodo.querySelector('[data-titulo-plato]').textContent=p.nombre;nodo.querySelector('[data-resumen-plato]').textContent=detallePlato(p);nodo.querySelector('[data-resumen-alergenos]').textContent=textoAlergenos(p);}
  function campo(nombre,titulo,valor,max=500){return `<label>${titulo}<input data-campo="${nombre}" maxlength="${max}" value="${escapar(valor)}" ${nombre==='precio'?'inputmode="decimal"':''}></label>`;}
  function pintar(){
    resumen();$('carta-avisos').innerHTML=carta.avisos.map(a=>`<li>${escapar(a)}</li>`).join('');
    $('carta-categorias').innerHTML=carta.categorias.length?carta.categorias.map((cat,indice)=>`<section class="tarjeta carta-categoria" data-categoria="${cat.id}">
      <div class="carta-categoria-cabecera"><label><span class="carta-categoria-titulo">${indice+1}. Nombre de la categoría</span><input data-categoria-campo="nombre" value="${escapar(cat.nombre)}" maxlength="100"></label><div class="carta-botones"><button type="button" data-orden="-1" class="boton-secundario" aria-label="Subir categoría">↑</button><button type="button" data-orden="1" class="boton-secundario" aria-label="Bajar categoría">↓</button><button type="button" data-borrar-categoria class="boton-secundario">Eliminar categoría</button></div></div>
      <label>Condiciones de esta categoría<textarea data-categoria-campo="notas" rows="2" maxlength="1200">${escapar(cat.notas)}</textarea></label>
      <div class="carta-platos">${cat.platos.map(p=>`<details class="carta-plato" data-plato="${p.id}"><summary><strong data-titulo-plato>${escapar(p.nombre)}</strong><span class="carta-linea-precio"><span data-resumen-plato>${escapar(detallePlato(p))}</span><span data-resumen-alergenos>${escapar(textoAlergenos(p))}</span></span></summary><div class="carta-plato-editor">
        <div class="carta-campos">${campo('nombre','Nombre',p.nombre,180)}${campo('precio','Precio (€), vacío si es a consultar',p.precio,8)}${campo('unidad','Unidad: por persona, unidad, botella…',p.unidad,100)}<label>Mover a categoría<select data-mover>${carta.categorias.map(c=>`<option value="${c.id}" ${c.id===cat.id?'selected':''}>${escapar(c.nombre)}</option>`).join('')}</select></label></div>
        <label>Descripción<textarea data-campo="descripcion" rows="2" maxlength="700">${escapar(p.descripcion)}</textarea></label>
        <div class="carta-marcas"><label><input type="checkbox" data-campo="disponible" ${p.disponible?'checked':''}> Disponible</label></div>
        <div class="carta-botones carta-acciones-plato"><button type="button" data-guardar-plato title="Guardar los cambios del borrador">Guardar</button><button type="button" data-borrar-plato class="boton-secundario">Eliminar plato</button></div>
        <p data-aviso-plato class="carta-aviso-plato" role="status" aria-live="polite" hidden></p>
        ${alergenos(p,'alergenos')}${alergenos(p,'trazas')}
        <label>Detalle de alérgenos, ingredientes concretos o contacto cruzado<textarea data-campo="nota_alergenos" maxlength="500" rows="1">${escapar(p.nota_alergenos)}</textarea></label>
        <p class="nota-formulario">${p.pagina?'Página '+p.pagina+' del PDF. ':''}Seleccione los alérgenos y trazas que conoce del plato. La información importada sin revisar o una selección vacía se tratará como pendiente; no significa que esté libre de alérgenos.</p>
      </div></details>`).join('')}</div><button type="button" data-anadir-plato class="boton-secundario">+ Añadir plato o bebida</button></section>`).join(''):'<div class="tarjeta carta-vacia"><h3>Su carta empieza aquí</h3><p>Importe el PDF del restaurante o añada una categoría para introducir platos y bebidas manualmente.</p></div>';
  }
  function aceptar(d){estado=d.estado;revision=d.revision;carta=structuredClone(estado.borrador);cargada=true;sucio=false;pintar();$('carta-lector').textContent=d.importacion_disponible?'Al importar, el documento se envía al lector de OpenAI para preparar el borrador. La lectura puede tardar hasta unos minutos.':'La lectura automática del PDF está pendiente de activación en este Sandbox. Puede preparar y guardar la carta manualmente.';}
  async function cargar(){if(ocupado)return;if(sucio&&!confirm('Hay cambios sin guardar. ¿Volver a cargar la última versión guardada?'))return;bloquear(true);$('carta-error').textContent='';$('carta-estado').textContent='Cargando carta…';try{aceptar(await solicitar('consultar'));$('carta-estado').textContent='Carta cargada.';}catch(e){$('carta-error').textContent=e.message;$('carta-estado').textContent='';}finally{bloquear(false);}}
  function avisoGuardado(texto,tipo,platoId){const caja=platoId?raiz.querySelector(`[data-plato="${platoId}"] [data-aviso-plato]`):$('carta-aviso-guardado');caja.textContent=texto;caja.dataset.estado=tipo;caja.hidden=false;if(tipo==='error')caja.scrollIntoView?.({block:'nearest',behavior:'smooth'});}
  async function guardar(publicar=false,platoId=''){if(ocupado||!cargada)return;$('carta-error').textContent='';$('carta-aviso-guardado').hidden=true;try{
    const pendientes=m.platos(carta).filter(p=>!p.revisado).length;
    if(publicar&&pendientes)throw new Error(`Faltan ${pendientes} platos o bebidas por revisar. Compruebe sus datos y pulse «Confirmar revisión de todos los platos» antes de publicar.`);
    const datos=m.validar(carta,publicar);
    if(publicar){const cambios=m.diferencias(estado.publicada||m.vacia(),datos);if(!confirm(`El asistente utilizará esta carta. Cambios respecto a la publicada: ${cambios.nuevos} nuevos, ${cambios.cambiados} modificados y ${cambios.eliminados} eliminados. ¿Guardar y publicar?`))return;}
    const abiertos=[...raiz.querySelectorAll('[data-plato][open]')].map(el=>el.dataset.plato);
    bloquear(true);const d=await solicitar(publicar?'publicar':'guardar',{datos,confirmar_publicacion:publicar});aceptar(d);
    abiertos.forEach(id=>{const nodo=raiz.querySelector(`[data-plato="${id}"]`);if(nodo)nodo.open=true;});
    $('carta-estado').textContent=publicar?'Carta guardada y publicada.':'Borrador guardado. La carta publicada no ha cambiado.';
    $('carta-sincronizar').hidden=!(d.memoria?.activada&&!d.memoria.sincronizada);if(d.aviso)$('carta-error').textContent=d.aviso;
    avisoGuardado(d.aviso||$('carta-estado').textContent,d.aviso?'error':'terminado',platoId);
  }catch(e){$('carta-error').textContent=e.message;avisoGuardado(e.message,'error',platoId);}finally{bloquear(false);}}
  function encontrar(el){const cat=carta.categorias.find(c=>c.id===el.closest('[data-categoria]')?.dataset.categoria);return {cat,p:cat?.platos.find(p=>p.id===el.closest('[data-plato]')?.dataset.plato)};}
  $('carta-categorias').addEventListener('input',evento=>{
    const el=evento.target,{cat,p}=encontrar(el);if(!cat)return;
    if(el.dataset.categoriaCampo){cat[el.dataset.categoriaCampo]=el.value;cat.platos.forEach(x=>{x.revisado=false;const nodo=$('carta-categorias').querySelector(`[data-plato="${x.id}"]`);if(nodo)actualizarResumen(nodo,x);});}
    else if(p&&el.dataset.campo){p[el.dataset.campo]=el.type==='checkbox'?el.checked:el.value;if(!['revisado','alergenos_confirmados'].includes(el.dataset.campo))p.revisado=false;
      if(['nombre','descripcion'].includes(el.dataset.campo))p.alergenos_confirmados=false;
    }else if(p&&el.dataset.lista){p[el.dataset.lista]=[...el.closest('fieldset').querySelectorAll('input:checked')].map(x=>x.value);p.alergenos_confirmados=p.alergenos.length>0||p.trazas.length>0;p.revisado=false;}
    if(p)actualizarResumen(el.closest('[data-plato]'),p);
    cambiar();
  });
  $('carta-categorias').addEventListener('change',evento=>{
    const el=evento.target;if(!el.hasAttribute('data-mover'))return;const {cat,p}=encontrar(el),destino=carta.categorias.find(c=>c.id===el.value);if(!p||!destino||destino===cat)return;cat.platos=cat.platos.filter(x=>x!==p);p.revisado=false;destino.platos.push(p);cambiar();pintar();
  });
  $('carta-categorias').addEventListener('click',evento=>{
    const el=evento.target.closest('button');if(!el)return;const {cat,p}=encontrar(el);if(!cat)return;
    if(el.hasAttribute('data-guardar-plato')){if(p)void guardar(false,p.id);return;}
    if(el.hasAttribute('data-anadir-plato')){cat.platos.push({id:nuevoId(),nombre:'Nuevo plato '+(cat.platos.length+1),descripcion:'',precio:'',unidad:'',disponible:true,revisado:false,alergenos:[],trazas:[],alergenos_confirmados:false,nota_alergenos:'',pagina:0});}
    else if(el.hasAttribute('data-borrar-plato')){if(!confirm('¿Eliminar este plato del borrador?'))return;cat.platos=cat.platos.filter(x=>x!==p);}
    else if(el.hasAttribute('data-borrar-categoria')){if(!confirm('¿Eliminar esta categoría y sus platos del borrador?'))return;carta.categorias=carta.categorias.filter(x=>x!==cat);}
    else if(el.dataset.orden){const i=carta.categorias.indexOf(cat),j=i+Number(el.dataset.orden);if(j<0||j>=carta.categorias.length)return;[carta.categorias[i],carta.categorias[j]]=[carta.categorias[j],carta.categorias[i]];}
    else return;cambiar();pintar();
  });
  $('carta-categoria').addEventListener('click',()=>{if(!cargada||ocupado)return;carta.categorias.push({id:nuevoId(),nombre:'Nueva categoría '+(carta.categorias.length+1),notas:'',platos:[]});cambiar();pintar();});
  function confirmarRevision(){if(!cargada||ocupado||!m.platos(carta).length)return;if(!confirm('Confirma que ha revisado los nombres, descripciones, precios, unidades y condiciones de todos los platos. Esto no confirma los alérgenos. ¿Marcar los platos revisados?'))return;carta.categorias.forEach(c=>c.platos.forEach(p=>p.revisado=true));cambiar();pintar();}
  $('carta-revisar').addEventListener('click',confirmarRevision);$('carta-revisar-final').addEventListener('click',confirmarRevision);
  $('carta-form').addEventListener('submit',e=>{e.preventDefault();void guardar();});$('carta-publicar').addEventListener('click',()=>guardar(true));$('carta-recargar').addEventListener('click',cargar);
  $('carta-pdf').addEventListener('change',()=>{if(urlPdf)URL.revokeObjectURL(urlPdf);urlPdf='';const file=$('carta-pdf').files[0];$('carta-ver-pdf').hidden=!file;if(file){urlPdf=URL.createObjectURL(file);$('carta-ver-pdf').href=urlPdf;}});
  $('carta-importar').addEventListener('click',async()=>{if(ocupado||!cargada)return;$('carta-error').textContent='';const file=$('carta-pdf').files[0];if(!file){avisoImportacion('Seleccione el documento PDF.','error');return;}if(file.size>2500000||!file.name.toLowerCase().endsWith('.pdf')){avisoImportacion('Seleccione un PDF de hasta 2,5 MB.','error');return;}
    if((sucio||m.platos(carta).length)&&!confirm('La importación preparará un nuevo borrador y sustituirá el que está editando si lo acepta. La carta publicada se conserva. ¿Leer este PDF?'))return;
    bloquear(true);$('carta-importar').textContent='Importando…';avisoImportacion('Estamos importando la carta, puede tardar hasta 3 minutos.');$('carta-estado').textContent='';
    try{const base64=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(new Error('No se pudo abrir el archivo.'));reader.readAsDataURL(file);});
      const d=await solicitar('importar',{nombre_archivo:file.name,pdf_base64:base64});const c=d.cambios;if(confirm(`Borrador preparado: ${d.carta.categorias.length} categorías y ${m.platos(d.carta).length} platos/bebidas. Respecto al guardado: ${c.nuevos} nuevos, ${c.cambiados} modificados, ${c.eliminados} eliminados. ¿Cargarlo en el editor para revisarlo?`)){carta=d.carta;revision=d.revision;cambiar();pintar();$('carta-estado').textContent='PDF convertido en borrador. Revise los platos y guarde; todavía no está publicado.';}else $('carta-estado').textContent='Importación descartada. Su borrador anterior se conserva.';avisoImportacion($('carta-estado').textContent,'terminado');
    }catch(e){avisoImportacion(e.message,'error');$('carta-estado').textContent='No se ha sustituido su carta.';}finally{$('carta-importar').textContent='Importar PDF';bloquear(false);}
  });
  $('carta-sincronizar').addEventListener('click',async()=>{if(ocupado)return;bloquear(true);try{const d=await solicitar('sincronizar');$('carta-sincronizar').hidden=!(d.memoria?.activada&&!d.memoria.sincronizada);$('carta-estado').textContent=d.aviso||'Respuestas de la carta actualizadas.';$('carta-error').textContent=d.aviso||'';}catch(e){$('carta-error').textContent=e.message;}finally{bloquear(false);}});
  $('carta-retirar').addEventListener('click',async()=>{if(ocupado||!confirm('¿Retirar la carta de las respuestas del asistente? Su borrador guardado se conserva.'))return;if(sucio&&!confirm('Hay cambios locales sin guardar que se perderán al recargar el borrador. ¿Continuar?'))return;bloquear(true);try{const d=await solicitar('retirar',{confirmar_publicacion:true});aceptar(d);$('carta-estado').textContent='Carta retirada de publicación.';$('carta-sincronizar').hidden=!(d.memoria?.activada&&!d.memoria.sincronizada);$('carta-error').textContent=d.aviso||'';}catch(e){$('carta-error').textContent=e.message;}finally{bloquear(false);}});
  function cargarSiVisible(){if(!raiz.hidden&&!$('contenido').hidden&&!cargada&&!ocupado)void cargar();}
  window.addEventListener('contactia:vista',cargarSiVisible);window.addEventListener('contactia:panel-abierto',cargarSiVisible);cargarSiVisible();
  window.addEventListener('beforeunload',e=>{if(sucio||ocupado){e.preventDefault();e.returnValue='';}});
})();
