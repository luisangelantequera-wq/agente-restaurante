# Avisos de confirmación — Preview

La reserva y la notificación tienen estados separados. Un problema con el correo no cambia `RESERVAS.estado`, las mesas ni la retención confirmada.

Campos en la base de pruebas: `aviso_cliente_estado` (pendiente/aceptado), `aviso_cliente_detalle` (JSON operativo: intentos, motivo, fecha, identificador Resend; sin contactos ni contenido del mensaje). Se inicializan al crear la fila pendiente; así una interrupción antes del envío también deja seguimiento si la reserva termina confirmada.

Al enviar la confirmación del cliente se realizan hasta tres intentos inmediatos, con timeout de 4 segundos y esperas breves. Los tres usan exactamente el mismo cuerpo y `Idempotency-Key: confirmacion/<base>/<registro>`. Resend conserva esa clave 24 horas (https://resend.com/changelog/idempotency-keys). Los rechazos permanentes no se repiten. `Retry-After` se respeta; si exige más de dos segundos, se detienen los intentos inmediatos y queda pendiente.

`aceptado` solo significa que Resend devolvió un identificador de envío, no que el buzón lo haya recibido. No hay todavía webhook de entregas/rebotes, cola de reintentos diferidos ni llamadas salientes. No se reenvían correos antiguos al desplegar ni por consultar el centro. Los avisos al restaurante y los de modificación/cancelación mantienen su comportamiento anterior.

Si falla el guardado del seguimiento tras la aceptación, no se repite el email. Puede quedar un estado pendiente desactualizado: habrá que contrastarlo con el proveedor antes de reenviar. La interfaz de Contactia no ofrece reenvío a ciegas.

El centro muestra únicamente avisos pendientes de reservas confirmadas y datos operativos. No requiere ni muestra nombre, correo o teléfono. Los registros históricos sin estos campos no se consideran automáticamente fallidos.

La funcionalidad está limitada a Preview. El único cambio externo necesario se ha realizado en la base de pruebas, no en la base de Producción.

## Consulta posterior del resultado

Se consulta `GET /emails/{id}` de Resend con la clave existente (debe permitir lectura). Referencia: https://resend.com/docs/api-reference/emails/retrieve-email . Solo se utiliza `last_event`; los contactos y el cuerpo que pueda devolver el proveedor no se guardan ni se muestran.

En Preview, cada consulta de disponibilidad comprueba como máximo un correo del restaurante. La actualización del centro comprueba como máximo tres. Se prioriza el que lleva más tiempo sin comprobarse, con intervalo mínimo de cinco minutos. No hay todavía ejecución periódica independiente de la actividad, ni webhooks.

Se registran `entregado` (al servidor receptor, no prueba de lectura humana), `demorado` o `rechazado`. Los rechazos se muestran como incidencias para contactar por otra vía, sin iniciar llamadas, SMS o reenvíos. Se revisan reservas confirmadas desde la fecha actual y con identificador de envío conocido. Sin identificador o con permisos insuficientes, no se infiere entrega ni rechazo. Un fallo al consultar conserva el estado anterior.

La consulta actualiza solo los campos `aviso_cliente_*`. No modifica reservas, mesas ni retenciones. La protección de la reserva no depende del resultado del aviso.
