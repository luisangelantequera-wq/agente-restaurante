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
ni se hacen consultas periódicas. El respaldo de WhatsApp se prepara para la misma operación cuando no hubo correo
y el cliente autorizó el canal, o cuando la consulta manual de Resend confirma
un rebote o fallo de entrega. No se usa para quejas, supresiones ni correos
entregados. No hay sondeo periódico ni webhook nuevo: los fallos posteriores a
la aceptación de un correo se conocen al comprobar su entrega en este panel.

Requiere las dos plantillas de utilidad aprobadas y un interruptor exclusivo:
`TWILIO_WHATSAPP_MODIFICACION_CONTENT_SID`,
`TWILIO_WHATSAPP_CANCELACION_CONTENT_SID` y
`CONTACTIA_SUPABASE_WHATSAPP_GESTION_ENABLED=1`. Las plantillas deben ser distintas
entre sí y de la confirmación inicial. Hasta disponer de sus identificadores
reales y aprobación, el envío permanece bloqueado. Textos en
`lib/whatsapp-gestion-supabase.js`, constante `PLANTILLAS`.

La modificación lleva siete variables: restaurante, día, hora, personas, zona,
código de gestión (seis cifras, agrupadas 3 + 3) y referencia completa. Código y
referencia aparecen en párrafos separados al pie. Ambas plantillas terminan con
la frase fija «Mensaje automático de gestión de reservas.»: WhatsApp rechaza
una variable final incluso si va seguida de un punto. La cancelación lleva seis
variables y muestra la referencia aparte; no la presenta como código de gestión.

El permiso y el teléfono se comprueban de nuevo antes del envío. Una operación
incierta no se reenvía; los resultados se conservan por modificación o
cancelación y pueden consultarse manualmente en el mismo panel. No se aplican
los nuevos avisos a operaciones históricas.

Validación local: `npm test` (945 pruebas) y `npm run test:supabase`. Los
proveedores están simulados; no se han enviado mensajes durante las pruebas.
Queda comprobar la entrega real después de una nueva modificación o cancelación
telefónica con una dirección habilitada. No se reenvían los avisos antiguos.

Para dirigir al cliente a la web, crear tres plantillas Utility de tipo
Call to action con un botón URL dinámico. El cuerpo tiene seis variables; la
modificación web conserva el código de gestión, sin la referencia larga.
Añadir al botón la siguiente variable:

| Aviso | Variable del botón | Etiqueta | Configuración Preview |
|---|---|---|---|
| Confirmación ES | 7 | Gestionar mi reserva | `TWILIO_WHATSAPP_CONFIRMACION_WEB_CONTENT_SID` |
| Modificación | 7 | Gestionar mi reserva | `TWILIO_WHATSAPP_MODIFICACION_WEB_CONTENT_SID` |
| Cancelación | 7 | Consultar estado | `TWILIO_WHATSAPP_CANCELACION_WEB_CONTENT_SID` |

URL del botón: `https://<CONTACTIA_PUBLIC_HOSTNAME>/gestion-prueba.html#restaurante={{n}}`.
Como ejemplo ficticio para la variable, utilizar `prueba-sol&token=` seguido de
64 ceros. La aplicación reconstruye el mismo enlace privado que el correo,
comprueba su hash y pasa el sufijo solo al proveedor; no lo guarda con el aviso.
No configurar estos identificadores hasta que WhatsApp apruebe las plantillas.
