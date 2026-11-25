'use strict';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
async function gestionar(cliente,restaurante,objetivo,{interno=false}={}) {
  const fallo=(status,mensaje)=>{throw Object.assign(Error(mensaje),{status});};
  if (!Number.isSafeInteger(restaurante)||restaurante<=0||
      (objetivo!==undefined&&(typeof objetivo!=='string'||!UUID.test(objetivo)))) {
    fallo(400,'La solicitud de equipo no es válida.');
  }
  const r=await cliente.rpc(interno?'equipo_restaurante_contactia':'equipo_restaurante_panel',{
    p_restaurante:restaurante,p_objetivo:objetivo??null
  });
  if (r.error?.code==='42501') fallo(403,objetivo?'No puedes retirar ese acceso o ya se ha retirado. Actualiza el equipo.':'No tienes permiso para consultar los accesos de este restaurante.');
  if (r.error?.code==='P0002') fallo(404,'No se ha encontrado el restaurante.');
  if (r.error||!Array.isArray(r.data?.personas)) fallo(503,'No se pudo completar la operación. Actualiza el equipo antes de reintentar.');
  return {personas:r.data.personas,...(objetivo?{mensaje:'Acceso retirado a este restaurante.'}:{})};
}
module.exports={gestionar};
