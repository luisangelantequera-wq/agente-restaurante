# Recuperación de operaciones inciertas (Preview)

La disponibilidad revisa automáticamente las altas que quedaron `guardando` en Redis. No requiere que nadie abra el centro. No es un cron: sin nuevas consultas de disponibilidad no se ejecuta esta recuperación. La revisión administrativa permite consultar el mismo resultado a demanda.

Antes de crear una reserva de cliente, el servidor vincula su localizador único a la retención. No persiste nombres, correos, teléfonos ni tokens de gestión en ese registro operativo.

El servicio lee de Airtable solo los campos operativos y comprueba localizador único, restaurante, fecha, hora, personas, duración y mesas exactas:

- `confirmada`: convierte el guardado incierto en retención confirmada; mantiene la mesa protegida.
- `rechazada_conflicto`: retira únicamente la protección de esa alta. Ese estado es terminal en el trabajador de confirmación; después solo descarta su retención y responde, sin volver a escribir la reserva.
- Ausente, duplicada, pendiente, datos diferentes, modificación o registro antiguo sin vínculo: mantiene el bloqueo. La ausencia de fila no es prueba suficiente para repetir el POST o liberar la mesa.

La sustitución usa la versión exacta leída de Redis y CAS, evitando aplicar una resolución si otro trabajador ha finalizado mientras se consultaba Airtable. No se modifican registros de Airtable ni se envían correos. No garantiza la recuperación autónoma de todos los fallos: las operaciones sin evidencia definitiva requieren investigación técnica; no existe un desbloqueo por tiempo ni un botón para forzarlo.

El centro, protegido por su sesión administrativa y disponible solo en Preview, muestra operaciones pendientes y las resueltas por este mecanismo. Conserva resultado, fecha y origen (`automatico`/`contactia`) en Redis hasta la limpieza posterior a la fecha de servicio; no es un histórico permanente. Las reservas normales ya finalizadas no se muestran como incidencias.

No se debe activar en Producción sin revisar su configuración e integraciones. Escritores externos a Contactia no participan en sus retenciones.
