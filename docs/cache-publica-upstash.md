# Fase 1: caché de información pública en Upstash (Preview)

## Objetivo

Evitar consultas repetidas a Airtable **entre diferentes visitantes** para información pública y poco cambiante. Esta mejora complementa, pero no sustituye, la optimización anterior que elimina consultas duplicadas *dentro* de una petición.

## Alcance aplicado

Se ha añadido `lib/cache-publica.js` y se utiliza únicamente en estas rutas:

- `GET /api/restaurante-publico?slug=...`: almacena la **ficha pública normalizada** (id, nombre, slug y nombres de zonas activas), no el registro original de Airtable. Los indicadores de consentimiento/funcionalidades basados en variables de entorno se calculan nuevamente en cada respuesta.
- `POST /api/informacion-restaurante`: almacena solo **id, nombre, teléfono y estado del negocio**, previamente seleccionados de la respuesta de Airtable; el conocimiento del restaurante se sigue consultando cada vez para evitar respuestas desactualizadas.

**Todavía no se guarda en esta caché el horario completo del motor de reservas ni el estado de las mesas.** Esos datos deberán incorporarse de forma separada, después de diseñar invalidaciones seguras.

## Seguridad

- **Nunca guardar** `RESERVAS`, `MESAS` como disponibilidad, `CONVERSACIONES`, datos de clientes, tokens de confirmación, bloqueos de Upstash, preguntas de clientes o contenido privado.
- Cada tipo de caché tiene una lista estricta de campos permitidos y un validador de contenido. Ni datos de Airtable no normalizados ni cabeceras con credenciales se guardan en Redis.
- Cada entrada dura **60 segundos**. Una modificación hecha directamente en Airtable puede tardar **hasta 60 segundos** en verse en la ficha pública o el teléfono de información; para cambios urgentes se debe esperar ese plazo o planificar invalidación inmediata con autenticación.
- Las claves se separan por **base de Airtable, rama Git, categoría y restaurante** usando un hash.
- `SET EX 60 NX` evita que dos solicitudes concurrentes reemplacen su entrada mutuamente.
- No se cachean errores de API, fallos 429, registros ausentes ni datos inválidos.
- Si Upstash falla, se intenta consultar Airtable normalmente, sin devolver información inventada. Si Airtable falla, se devuelve el error habitual.
- El código de `api/chat.js`, las comprobaciones finales de reservas y las retenciones **no se modifican** en esta fase.

## Activación

La caché está **desactivada por defecto**. Solo funciona si, en la rama de Preview correspondiente, están las variables:

- `VERCEL_ENV=preview` (establecida automáticamente por Vercel)
- `VERCEL_GIT_COMMIT_REF` (rama establecida automáticamente)
- `CONTACTIA_CACHE_PUBLICA=1` (activación expresa)
- `AIRTABLE_BASE_ID` apuntando a una base de pruebas adecuada
- `AIRTABLE_API_KEY` para las consultas habituales
- `KV_REST_API_URL` y `KV_REST_API_TOKEN` para Upstash

Por diseño **no se activa en producción**, incluso si se define la bandera. No reutiliza datos entre distintos restaurantes, bases o ramas.

## Ahorro potencial (no medición real)

Ejemplo en un único intervalo de 60 segundos, sin cambios de datos:

- 100 visitantes solicitan la ficha pública de Restaurante Sol.
- Antes: hasta 100 lecturas de RESTAURANTES y 100 de ZONA, según la paginación.
- Ahora: normalmente una lectura de cada tabla después del primer fallo de caché; las visitas siguientes obtienen la copia en Upstash.
- Cada visita hace una operación ligera de lectura de Upstash y el primer fallo puede requerir una escritura adicional. Las solicitudes concurrentes iniciales aún pueden disparar más de una lectura a Airtable.
- Las verificaciones de disponibilidad y las confirmaciones **siguen utilizando sus propias consultas**, por lo que no se debe extrapolar ese ahorro a todo Contactia.

## Validaciones

- 10 pruebas unitarias: activación, expiración, cambios directos de Airtable, aislamiento de claves, 429, errores de Redis, rechazo de contenido inválido y datos personales.
- 3 pruebas de las rutas públicas con ambas APIs ficticias, incluida comprobación de actualización después de caducar.
- Estas 13 pruebas pasaron en un entorno JavaScript de simulación; queda pendiente ejecutar `npm test` completo con Node y realizar pruebas reales cuando se recupere el límite de Airtable.

## Trabajo posterior

1. Medir llamadas reales antes y después con el contador Airtable.
2. Añadir un mecanismo autenticado de **invalidación inmediata** al modificar información desde un panel propio.
3. Evaluar por separado si se puede cachear un pequeño subconjunto de los horarios para **consultas orientativas**, sin reutilizarlo jamás al confirmar una reserva.
4. Evaluar el coste y la latencia añadidos por Upstash frente al ahorro en Airtable.

## Rama

`cache-publica-upstash`, basada en `optimizar-configuracion-solicitud`, sin cambios sobre `main`, `prototipo-voz` ni `prueba-livekit-cartesia`.
