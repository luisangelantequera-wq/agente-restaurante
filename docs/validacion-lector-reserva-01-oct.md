# Validación del lector de reserva — 01/10/2026

Se ejecutó el lector real `lib/reserva-resultado-whatsapp.js` mediante `scripts/comprobar-lector-reserva-preview.js` en Vercel Preview, sobre un registro ya anonimizado de la base de pruebas. No se crearon ni modificaron reservas.

## Evidencia

El primer intento con installCommand (commit d6e6843da0ae2839db946ceca9e02e18749f83b6) no ejecutó la prueba, según la captura de Deploy Logs. Su estado READY no acredita lectura. Esa configuración fue retirada.

La ejecución obligatoria posterior usó buildCommand `node scripts/comprobar-lector-reserva-preview.js && node -e "process.exit(42)"`, commit 1f9e5a93e2ff3378b5a0d0fc8c7fbb30e6ba7a15, despliegue dpl_3yJe7XQEnqxiwh1vooXFUtoeCPHL. Vercel confirmó BUILD_UTILS_SPAWN_42 y salida 42 del comando completo. Por la condición &&, esto acredita que el script de lectura terminó con éxito antes de la salida deliberada. Esta salida impidió publicar el despliegue diagnóstico.

La configuración original se restauró en b152846ff8dfaa1f46ce6f26787c9bef83783636; el despliegue dpl_EwkSrUV1wU26UHq5VKT3jcXodGs4 terminó READY.

## Alcance comprobado

- Entorno Preview y base de pruebas fijados antes de consultar.
- Un GET de RESERVAS filtrado por RECORD_ID; máximo una llamada de fetch.
- Reserva encontrada, salida estado anonimizada, whatsapp_autorizado false y huella null.
- La salida del lector contiene solo id, estado, autorización y huella.
- Cero escrituras y cero comunicaciones; no se importa ningún emisor.
- Banderas activadas únicamente en una copia local del entorno del script, sin cambiar variables de Vercel ni process.env.
- Cuatro comprobaciones locales previas: resultado anonimizado, rechazo de Production, rechazo de base diferente y un único intento ante 429.

La selección del registro mediante el conector de Airtable fue una operación separada y anterior; no forma parte de la única consulta del lector. No se ha medido el consumo total del workspace ni validado la cuota del token de Contactia a partir del conector.

## Pendiente

Esta prueba no valida una huella de reserva confirmada con consentimiento vigente ni un envío/callback real de Twilio. Tampoco prueba cambios concurrentes con datos reales. Esos casos permanecen cubiertos por pruebas simuladas. WhatsApp, llamadas, el programador y Production no se activaron ni modificaron. El script no se ejecuta en despliegues normales y no se importa desde rutas.
