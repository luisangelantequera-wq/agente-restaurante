# Envío correlacionado de WhatsApp en Preview

Etapa preparada el 1 de octubre de 2026. El módulo no está conectado a una API de envío ni al programador. No se han activado banderas, enviado mensajes reales o modificado producción.

## Comportamiento

- Comprueba que la reserva está confirmada, es futura en Europe/Madrid, tiene consentimiento y un fallo de correo que permite pasar a WhatsApp.
- Comprueba nuevamente la reserva en Airtable antes de inicializar el contacto y después de adquirir el control exclusivo de envío.
- Un control Redis por reserva impide que dos solicitudes simultáneas envíen el mismo mensaje. Conserva el plazo original de siete días; no lo renueva al guardar el resultado.
- Una respuesta aceptada del proveedor se vincula con la reserva y su huella privada. Aceptación no significa entrega: la entrega requiere el callback firmado.
- Ante un timeout, rechazo o resultado ambiguo no reintenta automáticamente. Si el proveedor aceptó y se guardó su SID, `recuperar` puede restaurar el seguimiento sin enviar otro mensaje.
- Los registros operativos Redis omiten teléfono, correo y contenido del mensaje.

## Activación

`desdeEntorno` exige `VERCEL_ENV=preview` y las cinco banderas a `1`: `CONTACTIA_WHATSAPP_CONFIRMACION_HABILITADA`, `CONTACTIA_WHATSAPP_LECTURA_RESERVA_HABILITADA`, `CONTACTIA_WHATSAPP_CONTACTO_REDIS_HABILITADO`, `CONTACTIA_WHATSAPP_CALLBACK_HABILITADO` y `CONTACTIA_WHATSAPP_ENVIO_CORRELACIONADO_HABILITADO`. También exige la configuración previa del lector, Redis, plantilla aprobada y callback HTTPS. Esta etapa no cambia esas variables.

## Validación y límites

420 pruebas locales pasan. La prueba integrada simula lector de reservas, Redis y proveedor: envío único, registro del SID y callback firmado que resuelve el contacto. Incluye concurrencia, fallos de persistencia, recuperación sin reenvío, cambios de reserva y reservas pasadas. No acredita entrega real de Twilio ni acceso externo al callback de Vercel.

El control contra duplicados caduca a los siete días. Tras su caducidad no garantiza impedir un nuevo intento; un futuro invocador debe conservar un historial duradero o limitar la ventana de envío. No debe conectar este módulo a un barrido recurrente sin resolverlo.

La última lectura de Airtable y la petición al proveedor no son una transacción; una modificación posterior a la lectura sigue siendo una carrera posible. Si el callback llega antes de guardar el SID, se necesita recuperación explícita: no se presupone que Twilio lo reintentará. Si fallan tanto la persistencia del resultado como la del seguimiento, queda pendiente revisión manual.

Quedan pendientes el invocador controlado, comprobar que Twilio puede acceder al callback con la protección actual de Preview, y mostrar el seguimiento en el centro de conversaciones antes de una prueba real autorizada.
