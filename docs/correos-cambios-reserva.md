# Correos de modificaciones y cancelaciones en Preview

Ámbito: llamadas y enlace privado de gestión de las reservas de prueba en
`migracion-supabase-fase-1`. Conserva el interruptor y la lista de destinatarios
permitidos del correo inicial. Los cambios realizados directamente desde el
panel del restaurante mantienen su comportamiento anterior sin avisos.

Cada operación nueva y confirmada guarda el cambio y su aviso en la misma
transacción mediante `gestionar_reserva_con_correo`. El envío no deshace una
reserva si Resend falla. No se generan avisos para rechazos, falta de
disponibilidad, operaciones sin cambios o reintentos de operaciones históricas.

El asunto y el contenido diferencian modificación y cancelación. La
modificación incluye los datos vigentes y el mismo código de gestión; la
cancelación deja claro que la reserva está cancelada y enlaza a su consulta,
sin ofrecer modificarla ni mostrar un código activo.

El estado se conserva en `contactia_privado.correos_gestion_reserva`. Solo el
servidor accede a la tabla y sus funciones. La reclamación exclusiva conserva
el destinatario, remitente, dominio y contenido del primer intento, con una
clave de Resend independiente por operación. Máximo seis intentos durante
23 horas; un aviso obsoleto, una dirección cambiada o un enlace revocado pasan
a revisión. Un correo aceptado no se reenvía y no equivale a entrega.

En el panel, abrir «Avisos y confirmaciones» y pulsar «Ver correos de cambios y
cancelaciones». La consulta es manual. Propietarios y encargados activos pueden
comprobar la entrega o reintentar un correo pendiente; no se muestran secretos
ni se hacen consultas periódicas. WhatsApp para modificaciones y cancelaciones
no está activado: requiere su texto o plantilla y revisar el alcance del
consentimiento. No se reutiliza la plantilla de confirmación inicial.

Validación local: `npm test` (932 pruebas) y `npm run test:supabase`. Los
proveedores están simulados; no se han enviado mensajes durante las pruebas.
Queda comprobar la entrega real después de una nueva modificación o cancelación
telefónica con una dirección habilitada. No se reenvían los avisos antiguos.
