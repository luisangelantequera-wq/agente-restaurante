"use strict";

// Adaptador de lectura preparado para la futura API del panel.
// No se conecta a ninguna ruta activa durante la fase 1.
// Usa el JWT del usuario: nunca service_role, que eludiría las RLS.
function crearLectorPanel({ url, publishableKey, fetchImpl = globalThis.fetch }) {
  const origen = new URL(url);
  if (origen.protocol !== 'https:' || origen.username || origen.password ||
      origen.pathname !== '/' || origen.search || origen.hash) {
    throw new Error('La URL de Supabase debe ser un origen HTTPS.');
  }
  if (typeof publishableKey !== 'string' || !publishableKey.trim() ||
      publishableKey.startsWith('sb_secret_')) {
    throw new Error('Configure una clave pública de Supabase.');
  }
  // Las claves anon antiguas son JWT; rechazar service_role explícitamente.
  if (!publishableKey.startsWith('sb_publishable_')) {
    try {
      const datos = JSON.parse(Buffer.from(publishableKey.split('.')[1], 'base64url'));
      if (datos.role !== 'anon') throw new Error();
    } catch {
      throw new Error('La clave debe ser publishable o anon.');
    }
  }

  return {
    async leerConfiguracion({ accessToken, restauranteId }) {
      if (typeof accessToken !== 'string' || !accessToken.trim() ||
          /\s/.test(accessToken) || accessToken === publishableKey ||
          !Number.isSafeInteger(restauranteId) || restauranteId <= 0) {
        throw new Error('Se requiere una sesión y un restaurante válidos.');
      }
      const headers = { apikey: publishableKey, Authorization: `Bearer ${accessToken}` };
      async function leer(tabla, select, filtro) {
        const destino = new URL(`/rest/v1/${tabla}`, origen);
        destino.search = new URLSearchParams({ select, ...filtro }).toString();
        const respuesta = await fetchImpl(destino.toString(), {
          headers, redirect: 'error', signal: AbortSignal.timeout(10000),
          cache: 'no-store'
        });
        if (!respuesta.ok) {
          // No propagar respuestas del proveedor, JWT ni claves a logs/clientes.
          throw new Error('No se pudo consultar la configuración autorizada.');
        }
        const filas = await respuesta.json();
        if (!Array.isArray(filas)) throw new Error('Respuesta de datos no válida.');
        return filas;
      }
      const restaurantes = await leer('restaurantes',
        'id,slug,nombre,zona_horaria,duracion_reserva_minutos,antelacion_minima_reserva_minutos',
        { id: `eq.${restauranteId}` });
      if (restaurantes.length !== 1) throw new Error('Restaurante no disponible para esta sesión.');
      const [zonas, mesas] = await Promise.all([
        leer('zonas', 'id,restaurante_id,nombre,estado', { restaurante_id: `eq.${restauranteId}` }),
        leer('mesas', 'id,restaurante_id,zona_id,nombre,capacidad,min_personas,estado',
          { restaurante_id: `eq.${restauranteId}` })
      ]);
      return { restaurante: restaurantes[0], zonas, mesas };
    }
  };
}

module.exports = { crearLectorPanel };
