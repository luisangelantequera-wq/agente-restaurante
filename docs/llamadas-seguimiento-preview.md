# Llamadas de seguimiento en Preview

Actualizado el 6 de octubre de 2026. Exclusivo de Preview, rama `prototipo-voz`, y del móvil fijo `TWILIO_VOICE_TEST_TO`. Primera llamada manual; los reintentos se activan expresamente después de una llamada sin confirmación. No se llama a otras reservas ni se activan tareas históricas al desplegar.

## Prueba manual y reintentos

En `prueba-llamadas.html`, revisar la reserva y realizar el primer intento manual. Si termina sin pulsar 1, revisar de nuevo y pulsar «Activar los reintentos pendientes». Este botón no llama inmediatamente: habilita los intentos restantes hasta un máximo de tres en total. El mismo programador de Apps Script, `comprobarAvisosContactia`, ejecuta los reintentos vencidos. Debe estar instalado y ejecutándose periódicamente; sin él no se realizan llamadas automáticas.

Se conservan dos horas entre inicios de llamadas y el horario 10:00–20:00 de Europe/Madrid. Una llamada fuera de horario pasa al siguiente intervalo permitido. La página muestra la siguiente fecha. Si el primer intento fue a las 19:12, el segundo será a partir de las 10:00 del día siguiente y el tercero a partir de las 12:00, siempre que la reserva siga vigente y no haya expirado la ventana de prueba de 24 horas desde el inicio del aviso de correo. Las llamadas reales pueden demorarse hasta la siguiente ejecución del programador.

La tecla 1, acreditada mediante petición firmada de Twilio, resuelve el contacto y detiene los siguientes intentos. Contestar, un buzón de voz o un estado `completed` no acreditan recepción. Después de tres llamadas sin confirmación se conserva la reserva y se marca el contacto sin resolver, con revisión/aviso al restaurante pendiente; no se envía todavía un aviso al restaurante.

## Control y persistencia

La cola Redis contiene referencias UUID y fechas; no teléfonos ni textos. Cada reserva conserva una única raíz de seguimiento y hasta tres intentos con UUID y CallSid propios. Los reintentos se reclaman con CAS antes del POST a Twilio; las respuestas inciertas o interrupciones conservan el bloqueo y requieren revisión. Una repetición del programador no duplica un POST. Se comprueban reserva, teléfono autorizado y huella antes de cada envío y al descolgar. Cambiar/cancelar/anonimizar la reserva, entregar el correo o expirar el plazo impide el siguiente intento. Las notificaciones tardías de intentos previos no reabren un contacto resuelto; una confirmación firmada tardía resuelve la raíz actual.

La reserva debe estar confirmada y ser futura, el correo rechazado por rebote/fallo de entrega, y constar una negativa explícita a WhatsApp o un fallo de WhatsApp firmado, correlacionado y aplicado al contacto. El móvil de voz no necesita coincidir con el móvil de prueba de WhatsApp. No se modifica la configuración de WhatsApp.

La locución termina con «Para indicar que ha recibido este aviso, pulse 1». Tras pulsar 1 dice «Gracias por confirmar su reserva». La hora se locuta como «15 horas» o «15 horas y 30 minutos».

## Verificación

Pruebas de la primera llamada, dos reintentos, límite de tres, concurrencia, horario/nocturnidad, confirmación en segundo intento, callbacks tardíos, cancelación, cambio de móvil, entrega de correo, vencimiento y timeout. Validación real: primer intento con tecla 1 resuelto; nueva reserva descolgada sin tecla 1 queda `sin_confirmacion`, una llamada. Los dos reintentos reales quedan pendientes de activar y observar.

## Requisitos y configuración

- Rama `prototipo-voz`, entorno Preview. Producción y otras ramas rechazan las acciones y el callback.
- `CONTACTIA_LLAMADAS_PRUEBA_HABILITADAS=1`, solo después de configurar el número.
- `TWILIO_VOICE_FROM`: número de origen con capacidad de voz en la cuenta Twilio (comprobar en Phone Numbers → Active numbers antes de activar; no se presupone que el emisor de WhatsApp permita voz).
- `TWILIO_VOICE_TEST_TO`: móvil autorizado de pruebas en formato internacional. Puede ser distinto del destino de WhatsApp; la reserva y todos los callbacks deben coincidir exactamente con este móvil.
- Credenciales Twilio y `CONTACTIA_AVISOS_SECRET` existentes. Se usa Redis con el prefijo de la base de Preview.
- El callback usa el alias fijo de Preview y reutiliza la opción existente de bypass de WhatsApp cuando está habilitada. Nunca toma Host de una solicitud ni imprime secretos.

No se graban audios ni transcripciones. El seguimiento en Redis dura siete días. El Centro combina el resultado de Redis con la reserva vigente; un cambio en los datos invalida el resultado anterior. El envío automático de avisos al restaurante y el inicio automático de la primera llamada tras un fallo de WhatsApp siguen pendientes.

## Aviso pendiente para el restaurante

El Centro prepara un aviso de revisión cuando el seguimiento vigente queda en `sin_contacto`, con resultado `no_se_ha_podido_contactar` y aviso al restaurante pendiente. Se comprueba la raíz de la reserva y su huella: cancelaciones, anonimización, cambios de datos, una recepción confirmada o una reserva pasada impiden mostrar el borrador. No se hacen consultas adicionales a proveedores ni se cambia Airtable.

El resumen usa «No se ha podido confirmar la recepción del aviso = Llamadas: 03/03 = Reserva confirmada = Revisión del restaurante pendiente». Si el cierre es por plazo y hubo menos intentos, se muestra el número real y no se afirma que se hayan agotado tres llamadas.

«Ver aviso al restaurante · pendiente de envío» ofrece asunto y texto con localizador, fecha, hora, personas, zona, motivo de fallo del correo, situación de WhatsApp y llamadas realizadas. La negativa del cliente a WhatsApp se identifica como falta de autorización, no como fallo del proveedor. El botón «Copiar aviso» copia el borrador sin enviarlo ni marcarlo como entregado. No incluye teléfono, correo del cliente, referencias de proveedor ni secretos; el restaurante debe consultar la ficha de la reserva. Falta configurar y validar el canal de envío al restaurante antes de automatizarlo.

## Conexión de WhatsApp con la revisión telefónica

Si hay autorización vigente de WhatsApp, `contacto-whatsapp-voz` contrasta tres registros: control de envío aceptado y SID, seguimiento del callback firmado y contacto operativo al que se aplicó el evento. La reserva, las tres referencias y la huella de WhatsApp deben coincidir. Un estado `failed` o `undelivered` con el evento `whatsapp_fallido` aplicado permite revisar e iniciar manualmente la primera llamada al móvil fijo de voz. La primera llamada no se programa automáticamente en esta fase. Después de una llamada sin tecla 1 pueden activarse los dos reintentos existentes.

`delivered`/`read` con evento aplicado resuelve el contacto y bloquea las llamadas; el Centro y la consulta de resultado identifican WhatsApp como canal de resolución. Aceptación o envío sin entrega, falta de correlación, autorización retirada, cambio de datos/mensaje, Redis inaccesible y resultados inciertos quedan pendientes de revisión. Resultados firmados contradictorios conservan el estado anterior y añaden una marca de revisión que impide habilitar voz. Las revisiones y el programador consultan esta evidencia antes de cada llamada/reintento, y el callback de voz también la revalida.

El aviso al restaurante distingue la negativa a WhatsApp del fallo de entrega confirmado. Esta conexión no consulta Twilio, no cambia la configuración de los móviles de prueba y no envía WhatsApp adicionales. Para validar el recorrido real completo, la reserva debe tener el móvil fijo de voz y debe existir un envío de WhatsApp fallido acreditado para ese mismo móvil; cambiar el teléfono después del envío invalida la correlación. La huella telefónica incorpora la huella de autorización/contenido de WhatsApp únicamente para reservas autorizadas. Las reservas de prueba con negativa a WhatsApp conservan su huella y sus reintentos ya activados.
