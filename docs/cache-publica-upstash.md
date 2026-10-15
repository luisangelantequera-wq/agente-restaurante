# Fase 1 revisada: caché solo para datos estables y zonas SIEMPRE al día

## Decisión de producto

El propietario señala que 60 segundos es innecesariamente poco para datos como nombre y teléfono, pero demasiado para cerrar una terraza cuando llueve. La propuesta separa datos por **riesgo de obsolescencia** y no únicamente por frecuencia de cambio.

| Datos | Política |
|---|---|
| Nombre, slug e identificador público del establecimiento | Caché Upstash de **24 horas**, con posibilidad de invalidación manual posterior |
| Teléfonos de contacto del negocio | Caché Upstash de **24 horas** |
| Dirección | Candidata a 24 horas; **aún no añadida** porque las rutas existentes no incluyen un campo de dirección confirmado |
| Zonas activas/inactivas, terraza cerrada, horarios y cierres | **Sin caché compartida**; consultar cuando es necesaria la configuración actual |
| Estado abierto/cerrado del restaurante | **No guardarlo en caché operativa**; la acción de reserva consulta Airtable |
| Mesas operativas, capacidades, reservas y bloqueos | Sin caché compartida para decisiones de reserva; lecturas frescas y verificación final de conflictos |

La optimización previa de configuración **dentro de una sola petición** (`optimizar-configuracion-solicitud`) se conserva, pues no afecta a peticiones posteriores.

## Qué se ha cambiado

- `lib/cache-publica.js`: TTL de **86400 segundos (24 horas)** solo para tipos públicos permitidos; namespace nuevo `contactia:cache-publica:v2` para no reutilizar entradas del experimento anterior.
- `GET /api/restaurante-publico?slug=...`: la caché ahora contiene exclusivamente los campos `id`, `nombre`, `slug_publico` y el identificador técnico `restaurante_record_id`. **No guarda las zonas.** En **cada petición** obtiene la lista de zonas activas desde Airtable después de leer la identidad del restaurante desde la memoria. Si la terraza se desactiva, una nueva solicitud mostrará la zona cerrada sin esperar 24 horas ni 60 segundos.
- `POST /api/informacion-restaurante`: únicamente cachea nombre y teléfonos del negocio, sin guardar el estado operativo. Las preguntas y el conocimiento siguen consultándose como antes. Un cierre total del restaurante debe validarse durante la reserva, no inferirse de esta caché de contacto.
- `api/chat.js` se mantiene sin cambios en esta fase: **las verificaciones de disponibilidad y los intentos de reserva consultan la configuración operativa actual**, incluidas zonas y mesas; la confirmación sigue sus protecciones de retención.

## Garantías y límites

- Una terraza cerrada en Airtable antes de una **nueva comprobación** ya no puede reaparecer por una copia de 24 horas. Una llamada iniciada antes del cambio deberá volver a verificar disponibilidad al solicitar y confirmar la reserva.
- **No se garantiza técnicamente una latencia de 5 segundos:** el guardado en Airtable y la siguiente solicitud pueden tener demora o error. El sistema debe rechazar o no confirmar cuando no puede verificar en vivo.
- La identidad pública cacheada puede tardar hasta **24 horas** en reflejar un cambio hecho directamente en Airtable. Como excepción, si se desactiva completamente el establecimiento, la página pública podría seguir mostrando su identidad hasta que caduque la caché, pero el motor de reservas consulta su estado actual y no debe aceptar la reserva. Antes de activar la caché en clientes reales hay que diseñar una invalidación administrativa para cambios urgentes.
- Con esta política, las visitas a la ficha pública **siguen consumiendo lecturas de ZONA**. Es un gasto deliberado para reflejar cierres de forma inmediata. No presentar ya el ahorro ficticio de '100 visitantes sin ninguna lectura de zonas'.
- No se memoriza ningún dato personal, credencial, reserva, estado de ocupación ni bloqueo en esta caché. Las respuestas 429 no se cachean; si Upstash falla, se consulta Airtable.

## Ahorro esperado

La lectura de identidad pública `RESTAURANTES` y la de contacto público dejan de repetirse por visitante durante 24 horas (tras la primera carga, si la memoria está disponible); cada consulta de zonas necesarias para la web o el proceso de reserva permanece viva.

La mayor parte de las lecturas críticas de disponibilidad se optimizaron **dentro de la petición** sin caché entre clientes. Esta mejora NO significa ahorrar el 99% de todo Airtable y requiere medir con el contador real.

## Activación

- **Desactivada por defecto**. Solo puede ejecutarse en Preview con `CONTACTIA_CACHE_PUBLICA=1`.
- Requiere además `AIRTABLE_BASE_ID`, `AIRTABLE_API_KEY`, `KV_REST_API_URL`, `KV_REST_API_TOKEN` y variables de rama establecidas por Vercel.
- No se activa con estos cambios en `main`, `prototipo-voz` ni `prueba-livekit-cartesia`; tampoco se activa en Production incluso aunque se declarase el flag.
- Antes de usarlo para clientes reales: crear un **botón autenticado de actualización de datos estables** que borre las copias del restaurante cuando el encargado los cambie desde el panel de Contactia. Las modificaciones directas en Airtable sin aviso solo se reflejarán al caducar las 24 horas.

## Pruebas

- 10 pruebas unitarias de caché: TTL 24h, aislamiento por rama y base, 429, fallos de Upstash y validación del contenido.
- 3 pruebas de rutas públicas con Airtable y Redis simulados: cierre de zona y reapertura sin esperar el TTL, persistencia del nombre durante 24 horas y actualización tras la expiración, teléfono de negocio con TTL 24h y recuperación de falla de Redis.
- Las pruebas pasan en entorno de JavaScript simulado. Falta aún `npm test` integral y la prueba real cuando se recupere la cuota de Airtable.

## Rama

`cache-publica-upstash` (PR de borrador #8), construida sobre `optimizar-configuracion-solicitud`. No fusionar a producción sin revisión.
