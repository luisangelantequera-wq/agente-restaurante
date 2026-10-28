'use strict';
window.ContactiaDatosPanel={crear(r,puedeEditar,guardar){
 const A=window.ContactiaAjustes,raiz=document.createElement('details');raiz.className='editor-horarios editor-datos';
 const titulo=document.createElement('summary');titulo.textContent='Datos públicos e información del restaurante';
 const nota=document.createElement('p');nota.className='nota';nota.textContent='El chat utilizará estos textos para responder consultas. Deje en blanco los datos que todavía no quiera publicar.';
 const form=document.createElement('form'),grid=document.createElement('div');grid.className='campos-datos';
 const controles={},publico=A.normalizarPublico(r),temas={};let version=r.datos_version,guardando=false;
 function campo(id,nombre,valor,tipo,max,area=false){
  const label=document.createElement('label');label.textContent=nombre;
  const input=document.createElement(area?'textarea':'input');input.id=`dato-${r.id}-${id}`;input.name=id;input.maxLength=max;input.value=valor||'';input.disabled=!puedeEditar;
  if(area)input.rows=3;else input.type=tipo;
  if(id==='nombre')input.required=true;
  label.htmlFor=input.id;label.append(input);return{label,input};
 }
 for(const [id,nombre,tipo,max] of [['nombre','Nombre público','text',200],['telefono_publico','Teléfono público','tel',40],['direccion','Dirección','text',300],['web','Página web','url',300]]){
  const c=campo(id,nombre,r[id],tipo,max);controles[id]=c.input;grid.append(c.label);
 }
 const informacion=document.createElement('div');informacion.className='campos-datos';
 A.TEMAS.forEach(t=>{const c=campo(t.id,t.titulo,publico.informacion[t.id],'text',1000,true);temas[t.id]=c.input;
  if(t.id==='gastronomia')c.input.placeholder='Una información por línea: miércoles cocido, jueves paella mínimo 2 personas…';informacion.append(c.label);});
 const aviso=document.createElement('p');aviso.className='nota';aviso.textContent='Describa servicios y especialidades. La carta y los encargos de platos se gestionarán por separado.';
 const estado=document.createElement('p');estado.setAttribute('role','status');estado.setAttribute('aria-live','polite');
 const boton=document.createElement('button');boton.type='submit';boton.textContent='Guardar datos e información';boton.disabled=!puedeEditar;
 form.append(grid,informacion,aviso,estado,boton);raiz.append(titulo,nota,form);
 form.addEventListener('submit',async e=>{
  e.preventDefault();if(guardando||!puedeEditar)return;
  const datos=Object.fromEntries(Object.entries(controles).map(([k,c])=>[k,c.value]));datos.informacion=Object.fromEntries(Object.entries(temas).map(([k,c])=>[k,c.value]));
  try{A.validarPublico(datos);}catch(error){estado.textContent=error.message;return;}
  guardando=true;[...form.elements].forEach(c=>{c.disabled=true;});estado.textContent='Guardando información…';
  try{const resultado=await guardar({restaurante_id:r.id,version,datos});version=resultado.version;estado.textContent=resultado.mensaje;}
  catch(error){estado.textContent=error.message;}
  finally{guardando=false;[...form.elements].forEach(c=>{c.disabled=false;});}
 });
 return raiz;
}};
