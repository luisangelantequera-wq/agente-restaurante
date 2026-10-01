# Recepción de resultados de WhatsApp

Se compone el receptor firmado, el lector acotado de reservas, el seguimiento por SID y el consumidor de eventos con destino inyectado.

Validación local: 390 pruebas superadas, incluidos 53 casos de WhatsApp. Se simulan Airtable, Redis y el destino del seguimiento; no se envían mensajes ni se consumen consultas reales.

- queued/sent conservan el contacto pendiente.
- delivered/read resuelven el contacto y detienen las acciones posteriores.
- failed/undelivered dejan una llamada pendiente de integración, sin realizarla.
- Duplicados y estados atrasados no repiten la actualización.
- Firma falsa, cancelación, anonimización, cambio de teléfono/fecha o retirada de permiso bloquean la actualización.
- Error de cuota provoca una única consulta por invocación, sin reintento interno.
- Un fallo de guardado conserva el evento; la recuperación es idempotente.

La reserva mantiene su estado. No se añade ruta pública ni se activan WhatsApp o programadores. Pendiente: adaptador real del destino con comparación atómica de versión y huella, ruta que preserve el cuerpo original y prueba controlada con Twilio en Preview.
