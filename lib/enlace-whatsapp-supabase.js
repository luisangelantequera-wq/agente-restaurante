'use strict';

// Solo para plantillas con botón aprobado. El token no se guarda con el aviso
// ni se devuelve en la vista previa del panel.
function sufijoGestion(env, {slug, peticion_id}, hash) {
 if(!['prueba-sol','prueba-luna'].includes(slug) ||
    !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(peticion_id||'') ||
    !/^[a-z0-9.-]+$/.test(env.CONTACTIA_PUBLIC_HOSTNAME||'')) throw Error('Enlace no disponible');
 const {secretoGestion,hashGestion}=require('./reservas-web-supabase');
 const token=secretoGestion(env,slug,peticion_id);
 if(hashGestion(token)!==hash)throw Error('Enlace no disponible');
 return slug+'&token='+token;
}
module.exports={sufijoGestion};
