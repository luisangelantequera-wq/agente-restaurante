(function(raiz,fabrica){
  const api=fabrica(typeof module!=='undefined'&&module.exports?require('./lib/ajustes-restaurante'):raiz.ContactiaAjustes);
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  else raiz.ContactiaHorariosPanel=api;
})(typeof window!=='undefined'?window:null,function(A){
  'use strict';
  function leerConfiguracion(r) {
    const horario=Object.fromEntries(A.DIAS.map(d=>[d,A.validarRangos(r.dias_cierre.includes(d)?[]:(r.horario_reservas[d]||[]))]));
    const especiales=[...(r.horario_reservas._contactia?.especiales||[])];
    for(const fecha of r.cierres_especiales)if(!especiales.some(e=>e.fecha===fecha))especiales.push({fecha,rangos:[]});
    return {horario,especiales:A.validarEspeciales(especiales),antelacion:r.antelacion_minima_reserva_minutos,intervalo:r.intervalo_minutos};
  }
  function crear(r,puedeEditar,guardar) {
    const datos=leerConfiguracion(r), controles=[], dias=[], especiales=[];
    let guardando=false,version=r.horarios_version;
    const el=(tag,texto,clase)=>{const n=document.createElement(tag);if(texto)n.textContent=texto;if(clase)n.className=clase;return n;};
    const boton=(texto,accion)=>{const n=el('button',texto,'secundario');n.type='button';n.addEventListener('click',accion);return n;};
    const campo=(tipo,valor)=>{const n=el('input');n.type=tipo;if(valor!==undefined)n.value=valor;controles.push(n);return n;};
    const detalles=el('details',null,'editor-horarios'); detalles.append(el('summary','Horarios y cierres'));
    const form=el('form'); detalles.append(form);
    form.append(el('p',`Horas del restaurante: ${r.zona_horaria}. Hasta cuatro franjas por día, dentro del mismo día.`,'nota'));
    if(!puedeEditar)form.append(el('p','Puedes consultar estos ajustes. Para guardarlos necesitas el rol de propietario o encargado.','nota'));
    function grupo(rangos,titulo) {
      const conjunto=el('fieldset'); conjunto.append(el('legend',titulo));
      const cerrar=campo('checkbox');cerrar.checked=!rangos.length;
      const etiqueta=el('label',null,'opcion-horario');etiqueta.append(cerrar,document.createTextNode('Cerrado'));conjunto.append(etiqueta);
      const lista=el('div');conjunto.append(lista);const filas=[];
      function ajustar() {
        const deshabilitado=!puedeEditar||guardando||cerrar.checked;
        cerrar.disabled=!puedeEditar||guardando;
        for(const fila of filas)for(const c of fila.controles)c.disabled=deshabilitado;
        anadir.disabled=deshabilitado||filas.length>=4;
      }
      function franja(rango='') {
        const fila=el('div',null,'franja-horario');
        const desde=campo('time',rango.slice(0,5)),hasta=campo('time',rango.slice(6));desde.step=hasta.step='60';desde.required=hasta.required=true;
        const l1=el('label','Desde'),l2=el('label','Hasta');l1.append(desde);l2.append(hasta);
        const datosFila={fila,desde,hasta,controles:[desde,hasta]};
        const quitar=boton('Quitar franja',()=>{
          filas.splice(filas.indexOf(datosFila),1);fila.remove();if(!filas.length){cerrar.checked=true;franja();}ajustar();
        });datosFila.controles.push(quitar);fila.append(l1,l2,quitar);lista.append(fila);filas.push(datosFila);
      }
      const anadir=boton('Añadir franja',()=>{franja();ajustar();});conjunto.append(anadir);
      (rangos.length?rangos:['']).forEach(franja);cerrar.addEventListener('change',ajustar);ajustar();
      return {elemento:conjunto,ajustar,leer:()=>cerrar.checked?[]:A.validarRangos(filas.map(f=>`${f.desde.value}-${f.hasta.value}`),false)};
    }
    for(const dia of A.DIAS){const g=grupo(datos.horario[dia],dia[0].toUpperCase()+dia.slice(1));dias.push([dia,g]);form.append(g.elemento);}
    const reglas=el('div',null,'reglas-horario');
    const antelacion=campo('number',datos.antelacion);antelacion.min='0';antelacion.max='525600';antelacion.step='1';antelacion.required=true;
    const intervalo=campo('number',datos.intervalo);intervalo.min='1';intervalo.max='1440';intervalo.step='1';intervalo.required=true;
    const la=el('label','Antelación mínima (minutos)'),li=el('label','Intervalo entre horas de entrada (minutos)');la.append(antelacion);li.append(intervalo);reglas.append(la,li);form.append(reglas);
    form.append(el('h3','Fechas especiales'),el('p','Puedes cerrar un día concreto o darle otro horario. Una fecha concreta tiene prioridad sobre una regla anual y sobre el horario semanal.','nota'));
    const listaEspeciales=el('div');form.append(listaEspeciales);
    function agregarEspecial(e={fecha:'',rangos:[]}) {
      const caja=el('div',null,'fecha-especial'); const fecha=campo('date'),anual=campo('checkbox');anual.checked=/^\d{2}-\d{2}$/.test(e.fecha);
      if(anual.checked){const year=new Date().getFullYear();for(let i=0;i<5;i++){const f=`${year+i}-${e.fecha}`;if(A.fechaValida(f)){fecha.value=f;break;}}}else fecha.value=e.fecha;
      fecha.required=true; const lf=el('label','Fecha'),lr=el('label',null,'opcion-horario');lf.append(fecha);lr.append(anual,document.createTextNode('Repetir cada año (se guarda solo el día y mes)'));
      const grupoEspecial=grupo(e.rangos,'Horario de esta fecha');
      const entrada={caja,fecha,anual,grupo:grupoEspecial};
      const quitar=boton('Eliminar fecha especial',()=>{especiales.splice(especiales.indexOf(entrada),1);caja.remove();ajustar();});entrada.quitar=quitar;
      caja.append(lf,lr,grupoEspecial.elemento,quitar);listaEspeciales.append(caja);especiales.push(entrada);ajustar();
    }
    const nuevo=boton('Añadir fecha especial',()=>agregarEspecial());form.append(nuevo);
    form.append(el('p','Al guardar, las nuevas reglas se aplican a las reservas nuevas y a los cambios de fecha/hora. Las reservas existentes se conservan y no se envían avisos.','nota'));
    const estado=el('p');estado.setAttribute('role','status');estado.setAttribute('aria-live','polite');form.append(estado);
    const guardarBoton=el('button','Guardar horarios');guardarBoton.type='submit';form.append(guardarBoton);
    function ajustar(){
      controles.forEach(c=>{c.disabled=!puedeEditar||guardando;});
      dias.forEach(([,g])=>g.ajustar());especiales.forEach(e=>{e.grupo.ajustar();e.quitar.disabled=!puedeEditar||guardando;});
      nuevo.disabled=!puedeEditar||guardando||especiales.length>=100;guardarBoton.disabled=!puedeEditar||guardando;
    }
    datos.especiales.forEach(agregarEspecial);ajustar();
    form.addEventListener('submit',async evento=>{
      evento.preventDefault();if(guardando||!puedeEditar)return;
      let configuracion;
      try {
        configuracion={horario:Object.fromEntries(dias.map(([d,g])=>[d,g.leer()])),
          especiales:A.validarEspeciales(especiales.map(e=>({fecha:e.anual.checked?e.fecha.value.slice(5):e.fecha.value,rangos:e.grupo.leer()}))),
          antelacion:Number(antelacion.value),intervalo:Number(intervalo.value)};
      }catch(error){estado.textContent=error.message;return;}
      guardando=true;ajustar();estado.textContent='Guardando horarios…';
      try {
        const resultado=await guardar({restaurante_id:r.id,version,configuracion});version=resultado.version;
        estado.textContent=resultado.mensaje+(resultado.reservas_a_revisar?` Atención: ${resultado.reservas_a_revisar} reserva(s) futura(s) requieren revisión por las nuevas reglas.`:'');
      }catch(error){estado.textContent=error.message;}
      finally{guardando=false;ajustar();}
    });
    return detalles;
  }
  return {leerConfiguracion,crear};
});
