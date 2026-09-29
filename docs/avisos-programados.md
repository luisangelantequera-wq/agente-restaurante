# Comprobaciones y reintentos de avisos en Preview

El código no activa por sí solo el programador. Vercel Cron no ejecuta Preview. Se utiliza un activador de Google Apps Script cada cinco minutos. Producción devuelve 404 en este endpoint.

## Estado tras la corrección del 28/09/2026

El activador está eliminado por decisión de Luis. Esta corrección no lo reinstala. No reactivar mientras se revisa la cuota de Airtable. Las pruebas son locales, sin consumir la API real.

El diseño anterior consultaba Airtable dos veces en cada ejecución, incluso sin resultados: como mínimo 576 llamadas/día a intervalos de cinco minutos. Se sustituye por una cola Redis creada desde los envíos nuevos. No se hace una búsqueda inicial ni un barrido periódico de Airtable para rellenarla.

Los avisos anteriores a esta versión no se importan automáticamente. Deben revisarse expresamente cuando vuelva a estar disponible la cuota; no asumir que una cola vacía significa que no existen incidencias históricas en Airtable. No se elimina ni cambia ninguna de esas reservas.

## Activación (cuando se acuerde reanudar)

1. Generar una contraseña aleatoria de al menos 32 caracteres en un gestor de contraseñas. No enviarla por chat.
2. En Vercel, proyecto agente-restaurante → Settings → Environment Variables: añadir `CONTACTIA_AVISOS_SECRET`, Sensitive, únicamente Preview (rama prototipo-voz). Redesplegar esa rama para aplicar la variable.
3. En https://script.google.com crear un proyecto independiente llamado Contactia — Comprobaciones Preview. Copiar `scripts/google-avisos-programados.gs` en Code.gs.
4. Configuración del proyecto → Propiedades del script: añadir `CONTACTIA_AVISOS_SECRET` con exactamente el mismo valor.
5. En Vercel → Deployment Protection → Protection Bypass for Automation, crear un secreto (la pantalla exige exactamente 32 caracteres). Guardarlo en las propiedades de Apps Script como `VERCEL_AUTOMATION_BYPASS_SECRET`. Es distinto del secreto del endpoint. El script lo envía por cabecera, sin seguir redirecciones ni registrar credenciales.
6. Ejecutar `instalarComprobacionesContactia` y autorizar el acceso solicitado por Google. No requiere publicar una aplicación web. Primero hace una comprobación real; si falla no instala el activador.
   La versión actualizada tampoco instala ni retira activadores si la respuesta
   indica pausa de servicio o ejecución en curso. Antes de reanudar, actualizar
   el código del proyecto de comprobaciones con esta versión.
7. Verificar en Activadores que hay exactamente uno cada cinco minutos y en Ejecuciones dos ejecuciones correctas separadas por ese intervalo. Las ejecuciones muestran solo contadores. `ULTIMA_EJECUCION` registra el momento de respuesta del servidor, y un aviso produce ejecución fallida para no ocultar problemas de permisos.

Un 401 indica secreto incorrecto o despliegue sin la variable. Un 403/429 o HTML puede ser la protección de Vercel: no significa que haya funcionado. Revisar la configuración mediante los mecanismos oficiales; no desactivar la protección global. Un 503 indica configuración incompleta o servicio temporalmente inaccesible. Resend debe permitir consultar correos además de enviarlos. No afirmar que el sistema está activo hasta observar ejecuciones correctas.

## Comportamiento

- Primero consulta únicamente Redis. Cola vacía o avisos aún no vencidos: cero llamadas a Airtable y cero a Resend. No se cambia la reserva para registrar que no había trabajo. Esto no elimina el consumo de las reservas normales, del listado del centro ni de otros procesos.
- Cola con trabajo vencido: una lectura de Airtable para un máximo de cinco IDs, compartida entre comprobaciones y reintentos. Solo los reintentos necesitan lecturas adicionales del registro y restaurante para reconstruir el correo de forma segura.
- Las referencias llevan versión: la limpieza de una ejecución antigua no borra trabajos añadidos de nuevo durante la consulta. Redis no disponible: falla sin usar un barrido de Airtable como alternativa.
- Error de Airtable: pausa global del programador durante seis horas, o 24 horas ante HTTP 429. Los trabajos se conservan. No supone que la cuota se haya recuperado al terminar la pausa: mantener eliminado el activador mientras exista el bloqueo conocido.
- Comprobaciones de entrega: esperas de 15 minutos, una hora, seis horas y doce horas; máximo cuatro comprobaciones y ventana de 24 horas. Entregado/rechazado: retirar de la cola. Un problema del proveedor aplaza el trabajo seis horas. Puede haber incidencias posteriores a la ventana que esta consulta acotada no detecte.
- Se elimina el sondeo de Resend durante la consulta de disponibilidad y al abrir el centro; el centro lista los estados guardados en Airtable.
- Hasta tres consultas de estado y dos reintentos de correos por ejecución. El bloqueo distribuido evita solapamientos entre programadores. Las llamadas tienen tiempo limitado.
- Consulta solo estados del proveedor: aceptado no equivale a entregado ni a leído. Nunca cancela reservas ni modifica mesas.
- Cada confirmación nueva conserva huella SHA-256 del cuerpo, idioma, zona, huella de observaciones, fecha inicial, contador y próxima fecha de intento. No añade direcciones, nombres ni contenido del correo al seguimiento.
- Hasta tres intentos inmediatos y como máximo seis intentos totales. Los posteriores esperan al menos cinco minutos; después del cuarto esperan quince, después del quinto sesenta. Se respeta Retry-After. Cada intento se anota antes de enviar.
- Se reconstruye desde la reserva vigente y se compara la huella exacta; la clave de idempotencia es la misma del primer envío. Un cambio de contenido, remitente, plantilla o URL bloquea el reintento. Solo reservas confirmadas, no anonimizadas y con fecha vigente. Se vuelve a leer la reserva justo antes de preparar el envío; no existe transacción compartida con Airtable, por lo que una modificación concurrente en ese último instante sigue siendo un límite.
- No reenvía correos aceptados, devueltos, suprimidos o con rechazo permanente. No recupera automáticamente avisos históricos sin huella. Corta a las 23 horas desde el inicio, antes de la caducidad de idempotencia del proveedor (24 horas).
- Los casos no recuperables quedan visibles en el centro para contacto por otra vía; este cambio no realiza llamadas telefónicas ni resuelve retenciones ambiguas.
- En Redis queda una marca operativa de la última ejecución con trabajo durante siete días, sin datos personales. Las pruebas automatizadas usan servicios simulados.

## Desactivar

Ejecutar `detenerComprobacionesContactia` en Apps Script. Para revocar acceso, eliminar o rotar el secreto en ambos sitios y redesplegar Preview. No afecta al envío normal de confirmaciones.

Referencias: https://developers.google.com/apps-script/guides/triggers/installable y https://resend.com/docs/dashboard/emails/idempotency-keys .

## Validación integrada del 28/09/2026

Pruebas con reloj y servicios simulados, sin llamadas reales: tres fallos inmediatos dejan el aviso en la cola; antes del vencimiento no se consulta Airtable; después el endpoint real reconstruye y reintenta el mismo correo; una comprobación posterior registra la entrega y retira la referencia. La ejecución siguiente vuelve a consumir cero llamadas a Airtable. Se verifica que todos los campos de la reserva ajenos al seguimiento conservan exactamente su valor.

Se cubren tanto respuestas HTTP 503 como respuestas perdidas después de la aceptación. El proveedor simulado conserva la clave de idempotencia y acredita una sola aceptación para los cuatro intentos. Esto verifica el contrato del cliente con el proveedor, no constituye una prueba de entrega real en Resend. El activador continúa eliminado.
