/* Modelo público compartido: carta estructurada y respuestas verificables. */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.ContactiaCarta = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';
  const ALERGENOS = [
    ['gluten','Cereales con gluten','🌾'],['crustaceos','Crustáceos','🦐'],['huevos','Huevos','🥚'],['pescado','Pescado','🐟'],
    ['cacahuetes','Cacahuetes','🥜'],['soja','Soja','🫘'],['leche','Leche','🥛'],['frutos_cascara','Frutos de cáscara','🌰'],
    ['apio','Apio','🌿'],['mostaza','Mostaza','◉'],['sesamo','Sésamo','◌'],['sulfitos','Sulfitos','SO₂'],['altramuces','Altramuces','🫘'],['moluscos','Moluscos','🦪']
  ].map(([id,nombre,icono])=>({id,nombre,icono}));
  const normalizar = s => String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
  function texto(s,max=500){if(typeof s!=='string'||s.length>max||/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(s))throw new Error('Revise la longitud y formato de los textos de la carta.');return s.trim();}
  function validarLista(a){if(!Array.isArray(a)||a.length>14||a.some(id=>!ALERGENOS.some(x=>x.id===id)))throw new Error('Alérgeno no válido.');return [...new Set(a)].sort();}
  function validar(carta, publicar=false){
    if(!carta||carta.version!==1||!Array.isArray(carta.categorias)||carta.categorias.length>30||!Array.isArray(carta.avisos)||carta.avisos.length>20)throw new Error('Formato de carta no válido.');
    let total=0;const ids=new Set(), nombres=new Set();
    const idValido=id=>{if(typeof id!=='string'||!/^[-a-zA-Z0-9_]{1,64}$/.test(id)||ids.has(id))throw new Error('Identificador repetido o no válido.');ids.add(id);return id;};
    const categorias=carta.categorias.map(c=>{
      const nombre=texto(c.nombre,100), clave=normalizar(nombre);
      if(!clave||nombres.has(clave)||!Array.isArray(c.platos))throw new Error('Revise las categorías de la carta.');nombres.add(clave);
      const nombresPlatos=new Set();
      return {id:idValido(c.id),nombre,notas:texto(c.notas,1200),platos:c.platos.map(p=>{
        total++;const nombre=texto(p.nombre,180),clave=normalizar(nombre);
        if(!clave||nombresPlatos.has(clave))throw new Error('Hay platos sin nombre o repetidos en una categoría.');nombresPlatos.add(clave);
        if(typeof p.precio!=='string'||(p.precio!==''&&!/^\d{1,5}(?:[.,]\d{1,2})?$/.test(p.precio)))throw new Error('Precio no válido. Use un número o déjelo vacío para consultar.');
        if(typeof p.disponible!=='boolean'||typeof p.revisado!=='boolean'||typeof p.alergenos_confirmados!=='boolean'||!Number.isInteger(p.pagina)||p.pagina<0||p.pagina>12)throw new Error('Revise los estados y la página del plato.');
        if(publicar&&!p.revisado)throw new Error('Revise y marque cada plato antes de publicar.');
        return {id:idValido(p.id),nombre,descripcion:texto(p.descripcion,700),precio:p.precio?p.precio.replace('.',','):'',unidad:texto(p.unidad,100),disponible:p.disponible,revisado:p.revisado,
          alergenos:validarLista(p.alergenos),trazas:validarLista(p.trazas),alergenos_confirmados:p.alergenos_confirmados,nota_alergenos:texto(p.nota_alergenos,500),pagina:p.pagina};
      })};
    });
    if(total>150)throw new Error('La primera versión admite hasta 150 platos o bebidas.');
    if(publicar&&!total)throw new Error('Añada al menos un plato antes de publicar.');
    const fuente=carta.fuente;
    if(!fuente||typeof fuente.sha256!=='string'||(fuente.sha256&&!/^[a-f0-9]{64}$/.test(fuente.sha256))||!Number.isInteger(fuente.paginas)||fuente.paginas<0||fuente.paginas>12)throw new Error('Origen de carta no válido.');
    const salida={version:1,fuente:{nombre:texto(fuente.nombre,120),sha256:fuente.sha256,paginas:fuente.paginas},avisos:carta.avisos.map(s=>texto(s,500)),categorias};
    if(JSON.stringify(salida).length>40000)throw new Error('La carta supera el tamaño admitido. Reduzca las descripciones.');
    return salida;
  }
  const vacia=()=>({version:1,fuente:{nombre:'',sha256:'',paginas:0},avisos:[],categorias:[]});
  function leer(campos){
    if(!campos.carta_json)return {version:1,borrador:vacia(),publicada:null,publicada_en:''};
    const o=JSON.parse(campos.carta_json);if(o.version!==1)throw new Error('Carta almacenada no válida.');
    return {version:1,borrador:validar(o.borrador),publicada:o.publicada?validar(o.publicada,true):null,publicada_en:texto(o.publicada_en,40)};
  }
  const platos=c=>c.categorias.flatMap(cat=>cat.platos.map(p=>({...p,categoria:cat.nombre,condiciones:cat.notas})));
  function diferencias(anterior,nueva){
    const mapa=c=>new Map(platos(c).map(p=>[normalizar(p.categoria+' '+p.nombre),JSON.stringify([p.descripcion,p.precio,p.unidad,p.disponible,p.alergenos,p.trazas,p.alergenos_confirmados,p.nota_alergenos,p.condiciones])]));
    const a=mapa(anterior),b=mapa(nueva);return {nuevos:[...b.keys()].filter(k=>!a.has(k)).length,eliminados:[...a.keys()].filter(k=>!b.has(k)).length,cambiados:[...b].filter(([k,v])=>a.has(k)&&a.get(k)!==v).length};
  }
  function publica(c){
    if(!c)return null;
    const limpia=validar(c,true);
    limpia.fuente={nombre:'',sha256:'',paginas:0};limpia.avisos=[];
    for(const cat of limpia.categorias)for(const p of cat.platos){p.pagina=0;if(!p.alergenos_confirmados){p.alergenos=[];p.trazas=[];p.nota_alergenos='';}}
    return limpia;
  }
  const esPreguntaCarta=q=>/\b(carta|menu|menus|platos?|bebidas?|vinos?|arroces|entrantes|postres|carnes?|pescados?|ensaladas?|mariscos?|paellas?|fideua|calamar|croquetas?|entrecot|tapas|comida|precio|precios|cuanto cuesta|cuanto vale|teneis|tienen|tiene|lleva|contiene|servis|ofreceis|alergenos?|gluten|lactosa|alergi[ao]|intolerancia|celiac[oa]|leche|huevo|huevos|frutos secos|cacahuetes|soja|sesamo|sulfitos|mostaza|apio|altramuces|moluscos|crustaceos|trazas)\b/.test(normalizar(q));
  const nombreAlergeno=id=>ALERGENOS.find(a=>a.id===id)?.nombre||id;
  function responder(c,pregunta){
    if(!c)return null;
    const q=normalizar(pregunta),todos=platos(c);
    const alergia=/alerg|intoler|gluten|lactosa|celiac|trazas/.test(q)||(/\b(lleva|llevan|contiene|contienen|tiene|tienen|sin)\b/.test(q)&&/\b(leche|huevos?|frutos secos|cacahuetes|soja|sesamo|sulfitos|mostaza|apio|altramuces|pescado|moluscos|crustaceos)\b/.test(q));
    const exactos=todos.filter(p=>q.includes(normalizar(p.nombre)));
    let candidatos=exactos;
    if(!candidatos.length){
      const vacias=new Set('teneis tienen cuanto cuesta vale precio plato platos comida carta hay de del el la los las con y por para un una es me puedo comer soy alergico alergica al'.split(' '));
      const tokens=q.split(' ').filter(t=>t.length>=3&&!vacias.has(t));
      candidatos=todos.filter(p=>{const nombre=normalizar(p.nombre).split(' ');return tokens.some(t=>nombre.includes(t));});
    } else {
      const largos=Math.max(...exactos.map(p=>normalizar(p.nombre).length));candidatos=exactos.filter(p=>normalizar(p.nombre).length===largos);
    }
    if(candidatos.length===1){
      const p=candidatos[0],lineas=[`${p.nombre}: ${p.precio?p.precio+' €'+(p.unidad?' '+p.unidad:''):'precio a consultar'}.${p.disponible?'':' Actualmente figura como agotado.'}`];
      if(alergia){
        if(!p.alergenos_confirmados)return `${p.nombre}: la información de alérgenos está pendiente de confirmar. Consulte directamente con el restaurante antes de elegir este plato.`;
        lineas.push(p.alergenos.length?'Alérgenos declarados por el restaurante: '+p.alergenos.map(nombreAlergeno).join(', ')+'.':'El restaurante no ha declarado alérgenos de la lista en este plato.');
        if(p.trazas.length)lineas.push('Posibles trazas declaradas: '+p.trazas.map(nombreAlergeno).join(', ')+'.');
        if(p.nota_alergenos)lineas.push(p.nota_alergenos);
        lineas.push('Si tiene una alergia o intolerancia, confirme con el restaurante la preparación y el posible contacto cruzado.');
      } else {if(p.descripcion)lineas.push(p.descripcion);if(p.condiciones)lineas.push(p.condiciones);}
      return lineas.join(' ').slice(0,1800);
    }
    if(alergia)return 'Para consultar alérgenos necesito saber qué plato le interesa. La ausencia de un icono no garantiza que sea adecuado para una alergia. ¿Qué plato desea consultar?';
    if(candidatos.length>1)return 'Tenemos estas opciones: '+candidatos.slice(0,5).map(p=>p.nombre+(p.precio?' ('+p.precio+' €'+(p.unidad?' '+p.unidad:'')+')':'')+(!p.disponible?' [agotado]':'')).join('; ')+'. ¿Cuál le interesa?';
    const cat=c.categorias.filter(x=>q.includes(normalizar(x.nombre)));
    if(cat.length===1)return `${cat[0].nombre}: `+cat[0].platos.slice(0,6).map(p=>`${p.nombre}${p.precio?' ('+p.precio+' €'+(p.unidad?' '+p.unidad:'')+')':''}${p.disponible?'':' [agotado]'}`).join('; ')+'. '+cat[0].notas+(cat[0].platos.length>6?' Hay más opciones. ¿Qué plato le interesa?':'');
    if(/\b(carta|menu|menus|platos|comida|bebidas)\b/.test(q))return 'Puede consultar estas categorías: '+c.categorias.slice(0,10).map(x=>x.nombre).join(', ')+'. ¿Qué categoría o plato le interesa?';
    return null;
  }
  return {ALERGENOS,normalizar,validar,vacia,leer,platos,diferencias,publica,esPreguntaCarta,responder};
});
