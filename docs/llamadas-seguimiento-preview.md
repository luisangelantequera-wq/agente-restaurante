# Primera llamada de seguimiento en Preview

Implementación del 5 de octubre de 2026. Esta fase permite revisar una reserva e iniciar **una llamada manual** al móvil fijo de pruebas. No activa llamadas desde el programador ni reintentos automáticos. La política existente de tres llamadas, separación de dos horas y horario 10:00–20:00 se conserva; en esta primera prueba solo se permite un intento.

## Requisitos y configuración

- Rama `prototipo-voz`, entorno Preview. Producción y otras ramas rechazan las acciones y el callback.
- `CONTACTIA_LLAMADAS_PRUEBA_HABILITADAS=1`, solo después de configurar el número.
- `TWILIO_VOICE_FROM`: número de origen con capacidad de voz en la cuenta Twilio (comprobar en Phone Numbers → Active numbers antes de activar; no se presupone que el emisor de WhatsApp permita voz).
- `TWILIO_VOICE_TEST_TO`: móvil de pruebas en formato internacional; debe coincidir exactamente con el destino de WhatsApp quitando `whatsapp:`.
- Credenciales Twilio y `CONTACTIA_AVISOS_SECRET` existentes. Se usa Redis con el prefijo de la base de Preview.
- El callback usa el alias fijo de Preview y reutiliza la opción existente de bypass de WhatsApp cuando está habilitada. Nunca toma Host de una solicitud ni imprime secretos.

## Prueba real pendiente

1. Acceder a `/prueba-llamadas.html` con la sesión administrativa.
2. Usar una reserva confirmada, futura, de pruebas; correo rebotado y respuesta explícita «No» a WhatsApp. Debe haber iniciado el aviso hace menos de 24 horas. Por ahora solo español.
3. Revisar sin llamar. El navegador recibe el texto, destino enmascarado y una huella; no recibe el teléfono completo ni claves.
4. Dentro del horario permitido, pulsar «Llamar al móvil de pruebas» y confirmar. La reserva se relee tras adquirir el bloqueo.
5. Descolgar, escuchar los datos y pulsar 1. Esa tecla acusa recibo del aviso; no reconfirma ni cambia la reserva.
6. Consultar el resultado y actualizar avisos en el Centro. Una petición firmada de Twilio con la tecla 1 resuelve el contacto.

## Seguimiento

No se graban audios ni transcripciones. Redis conserva referencias, HMAC de la reserva, SID y plan de contacto por siete días; no almacena el texto de la locución ni teléfonos. Airtable conserva el estado de la reserva. El Centro combina el resultado de esta prueba en Redis con la reserva vigente; un cambio de datos invalida el resultado anterior.

`completed` por sí solo no acredita recepción: puede haber buzón de voz. Sin tecla 1, ocupado, no contesta o fallo quedan pendientes de revisión y no se reintentan. Una respuesta incierta o una interrupción después de iniciar también conserva el bloqueo de envío. Los callbacks revalidan cuenta, firma, SID, teléfonos y huella; al descolgar se releen los datos para evitar locutar una reserva cancelada o modificada. Duplicados y eventos fuera de orden no incrementan intentos ni reabren contactos resueltos.

No hay recuperación automática de reservas históricas ni llamadas a otros clientes. Antes de ampliar esta prueba hacen falta la validación real, gestión de reintentos y plazos, conciliación de resultados inciertos y conexión del resultado de WhatsApp con el seguimiento telefónico.

## Validaciones anteriores

El 5 de octubre el usuario acreditó en Preview: correo rebotado con WhatsApp automático entregado, correo entregado sin WhatsApp adicional y correo rebotado con negativa a WhatsApp sin ningún mensaje. El último caso aparece en el Centro como llamada pendiente y conserva la reserva.

El formato de avisos se actualiza a «Correo devuelto = contactar por otra vía = Intentos de correo: 01 = fecha = hora», con hora de Madrid. Los intentos de llamada se muestran por separado.
