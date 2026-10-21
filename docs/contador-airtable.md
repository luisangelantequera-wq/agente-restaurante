# Contador de llamadas API a Airtable (Contactia)

## Objetivo
Medir el número de peticiones **reales** de Contactia a la API pública de Airtable, para localizar el consumo evitable. No hace consultas adicionales a Airtable.

## Funcionamiento
- Solo está activo en **Vercel Preview**. No modifica Production.
- Cada petición instrumentada se contabiliza una vez: función, operación permitida, tabla, método GET/POST/PATCH/DELETE, resultado correcto/error/429.
- Los contadores agregados se guardan en **Upstash KV**, con claves por rama de Vercel y mes natural de **Madrid**; se retienen hasta 100 días tras la última escritura.
- Nunca registra nombres de clientes, correos, teléfonos, mensajes, IDs de reservas, fórmulas de búsqueda, cabeceras ni cuerpo de peticiones. Tampoco guarda la URL completa.
- Si Upstash no funciona, la operación de Airtable sigue igual, sin reintentos ni efectos secundarios adicionales. Los recuentos pueden quedar incompletos durante esas incidencias.
- Hay una sola llamada adicional a **Upstash** por cada petición medida a Airtable, con un tiempo máximo de 1 segundo por intento de medición. Si el incremento falla, se registra aviso genérico en los logs. Hay un coste de Upstash que debe medirse también.

## Cómo verlo
Abra `/centro-contactia.html` en la Preview de la misma rama, acceda con la clave administrativa y pulse **Ver consumo Airtable**. Esto ejecuta una única lectura de Upstash y no llama a Airtable. Muestra total del mes, errores 429 y desglose por función, operación, tabla y método.

## Requisitos
Variables de entorno (en la **rama de prueba**): `VERCEL_ENV=preview` (Vercel), `VERCEL_GIT_COMMIT_REF` (Vercel), `AIRTABLE_BASE_ID`, `KV_REST_API_URL` y `KV_REST_API_TOKEN`. No es necesario duplicar ni mostrar credenciales en código ni documentación. Puede desactivarse la medición con `CONTACTIA_MEDIR_AIRTABLE=false`.

**Importante:** en Vercel las variables asignadas exclusivamente a otra rama no se heredan necesariamente. Verifique las asignaciones de Preview antes de confiar en el contador.

## Límites
Este dato mide **únicamente la rama instrumentada** y únicamente desde que esté desplegada y habilitada. No recupera consumos históricos ni detecta peticiones de Apps Script, otros despliegues, las integraciones de terceros o accesos directos. Tampoco mide toda la cuota de un workspace, que puede incluir varias bases. El periodo del contador es mes natural de Madrid, no una reproducción del ciclo de facturación de Airtable.

## Seguridad y verificación
No integrar en `main` sin revisar pruebas. `test/contador-airtable.test.js` incluye pruebas de categorización, URL sin datos personales, seguridad de producción, 429, errores de red, bloqueo de Upstash y lectura manual.

## Instrumentación
- `api/chat.js`: acciones de reservas y disponibilidad.
- `api/restaurante.js`: consultas del panel de agenda, mesas, zonas y lista de espera; se registran como `panel` y no se hacen peticiones nuevas a Airtable.
- `api/restaurante-publico.js` y `api/informacion-restaurante.js`: configuración.
- `api/conversaciones.js` y `api/centro-conversaciones.js`: conversaciones.
- `api/backup.js` y `api/restauracion.js`: copias/restauración.
- `api/privacidad.js`: anonimización.
- `lib/auditoria.js`: auditoría.
- `lib/revision-retenciones.js`: desbloqueos/retenciones.
- `lib/endpoint-avisos-programados.js`: avisos.
- `lib/prueba-reserva-whatsapp.js`: avisos WhatsApp.

Si se añaden otras rutas que accedan directamente a la API de Airtable, deberán instrumentarse expresamente. El contador no intercepta la actividad de herramientas externas.
