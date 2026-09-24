# Comprobaciones y reintentos de avisos en Preview

El código no activa por sí solo el programador. Vercel Cron no ejecuta Preview. Se utiliza un activador de Google Apps Script cada cinco minutos. Producción devuelve 404 en este endpoint.

## Activación (una vez)

1. Generar una contraseña aleatoria de al menos 32 caracteres en un gestor de contraseñas. No enviarla por chat.
2. En Vercel, proyecto agente-restaurante → Settings → Environment Variables: añadir `CONTACTIA_AVISOS_SECRET`, Sensitive, únicamente Preview (rama prototipo-voz). Redesplegar esa rama para aplicar la variable.
3. En https://script.google.com crear un proyecto independiente llamado Contactia — Comprobaciones Preview. Copiar `scripts/google-avisos-programados.gs` en Code.gs.
4. Configuración del proyecto → Propiedades del script: añadir `CONTACTIA_AVISOS_SECRET` con exactamente el mismo valor.
5. Ejecutar `instalarComprobacionesContactia` y autorizar el acceso solicitado por Google. No requiere publicar una aplicación web. Primero hace una comprobación real; si falla no instala el activador.
6. Verificar en Activadores que hay exactamente uno cada cinco minutos y en Ejecuciones dos ejecuciones correctas separadas por ese intervalo. Las ejecuciones muestran solo contadores. `ULTIMA_EJECUCION` registra el momento de respuesta del servidor, y un aviso produce ejecución fallida para no ocultar problemas de permisos.

Un 401 indica secreto incorrecto o despliegue sin la variable. Un 403/429 o HTML puede ser la protección de Vercel: no significa que haya funcionado. Revisar la configuración mediante los mecanismos oficiales; no desactivar la protección global. Un 503 indica configuración incompleta o servicio temporalmente inaccesible. Resend debe permitir consultar correos además de enviarlos. No afirmar que el sistema está activo hasta observar ejecuciones correctas.

## Comportamiento

- Hasta tres consultas de estado y dos reintentos de correos por ejecución. El bloqueo distribuido evita solapamientos entre programadores. Las llamadas tienen tiempo limitado.
- Consulta solo estados del proveedor: aceptado no equivale a entregado ni a leído. Nunca cancela reservas ni modifica mesas.
- Cada confirmación nueva conserva huella SHA-256 del cuerpo, idioma, zona, huella de observaciones, fecha inicial, contador y próxima fecha de intento. No añade direcciones, nombres ni contenido del correo al seguimiento.
- Hasta tres intentos inmediatos y como máximo seis intentos totales. Los posteriores esperan al menos cinco minutos; después del cuarto esperan quince, después del quinto sesenta. Se respeta Retry-After. Cada intento se anota antes de enviar.
- Se reconstruye desde la reserva vigente y se compara la huella exacta; la clave de idempotencia es la misma del primer envío. Un cambio de contenido, remitente, plantilla o URL bloquea el reintento. Solo reservas confirmadas, no anonimizadas y con fecha vigente. Se vuelve a leer la reserva justo antes de preparar el envío; no existe transacción compartida con Airtable, por lo que una modificación concurrente en ese último instante sigue siendo un límite.
- No reenvía correos aceptados, devueltos, suprimidos o con rechazo permanente. No recupera automáticamente avisos históricos sin huella. Corta a las 23 horas desde el inicio, antes de la caducidad de idempotencia del proveedor (24 horas).
- Los casos no recuperables quedan visibles en el centro para contacto por otra vía; este cambio no realiza llamadas telefónicas ni resuelve retenciones ambiguas.
- En Redis queda una marca operativa de la última ejecución durante siete días, sin datos personales. Las pruebas automatizadas usan servicios simulados.

## Desactivar

Ejecutar `detenerComprobacionesContactia` en Apps Script. Para revocar acceso, eliminar o rotar el secreto en ambos sitios y redesplegar Preview. No afecta al envío normal de confirmaciones.

Referencias: https://developers.google.com/apps-script/guides/triggers/installable y https://resend.com/docs/dashboard/emails/idempotency-keys .
