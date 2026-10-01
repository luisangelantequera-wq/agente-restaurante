# Destino operativo de WhatsApp en Redis

El consumidor dispone de un adaptador Redis con alta SET NX, actualización atómica por comparación del registro completo (incluidas versión y huella) y retención de siete días sin prórroga. Guarda únicamente el estado operativo y los eventos; excluye teléfono, correo, mensaje y evidencia del consentimiento.

La composición desdeEntorno conecta el lector Airtable, el seguimiento por SID y este destino usando el mismo Redis de Preview. Requiere VERCEL_ENV=preview y las tres banderas CONTACTIA_WHATSAPP_CONFIRMACION_HABILITADA, CONTACTIA_WHATSAPP_LECTURA_RESERVA_HABILITADA y CONTACTIA_WHATSAPP_CONTACTO_REDIS_HABILITADO a 1. No se han cambiado variables remotas ni añadido rutas públicas.

Validación local: 397 pruebas pasan. Incluye concurrencia, protección de versión/huella, caducidad, recuperación tras interrupción y errores de servicio.

Diagnóstico real preparado: scripts/comprobar-destino-whatsapp-redis.js. Usa un prefijo aleatorio y datos ficticios, elimina sus claves al terminar y no consulta Airtable ni envía mensajes. NO ejecutado en Redis real en esta etapa.

Pendientes antes de activar: ejecutar diagnóstico real en Preview; inicializar el contacto correlacionado antes del envío y registrar el SID; conservar cuerpo original en una ruta autenticada por firma Twilio; añadir StatusCallback al envío; integrar la lectura del estado Redis con la vista del centro y futuras decisiones operativas. El adaptador no escribe aviso_cliente_detalle en Airtable ni sustituye el seguimiento visible allí. No se permite reemplazar un contacto existente silenciosamente: una reserva modificada requiere tratamiento explícito antes de un nuevo envío.
