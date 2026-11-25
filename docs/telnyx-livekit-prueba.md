# Recepción SIP de Telnyx en Preview

Número de pruebas: +34918228086. Restaurante fijo: prueba-sol. La integración
solo funciona en Preview de migracion-supabase-fase-1; no habilita producción.

Telnyx: conexión FQDN al endpoint europeo de LiveKit,
`arhkpycb8oq.eu.sip.livekit.cloud`, registro A, puerto 5060; formato de destino
y origen +E.164; TCP; SIP Region Europe. Número asignado a la conexión.
LiveKit: inbound trunk con ese número y allowed addresses
`185.246.41.140,185.246.41.141` (señalización europea de Telnyx).

La regla Individual debe seleccionar exclusivamente ese trunk y usar el prefijo
`contactia-telefono-sol-`. Agente `contactia-cartesia-prueba`, deployment production
(del agente experimental), sin Dispatch metadata. Crear la regla solo después
de desplegar el worker adaptado y configurar la API.

Variables nuevas en Vercel, exclusivamente Preview/rama migracion-supabase-fase-1:
- CONTACTIA_SIP_WORKER_SECRET: clave aleatoria de al menos 32 caracteres, idéntica
  en Vercel y en los secretos del agente LiveKit. No usar LIVEKIT_API_SECRET: Cloud
  genera sus propias credenciales automáticas, diferentes de las del backend.
- CONTACTIA_SIP_TRUNK_ID: ID exacto ST_... del inbound trunk de LiveKit.
- CONTACTIA_SIP_ENABLED: 1 para habilitar, 0 o ausente para deshabilitar.

Se conservan las variables existentes de Supabase/voz y LiveKit. La variable
CONTACTIA_TWILIO_BROWSER_WEBHOOK_URL se reutiliza únicamente para obtener el host
privado autorizado del motor; la entrada SIP no consulta Twilio ni necesita sus
credenciales. El worker conserva CONTACTIA_TELEFONO_MOTOR_URL como secreto de su
entorno, incluido el bypass de Vercel cuando corresponda. Nunca poner secretos en
Dispatch metadata ni en el repositorio. No necesita una clave nueva de Telnyx.

El worker espera un participante SIP y firma una petición a
/api/restaurante?canal=telefono_sip_inicio con CONTACTIA_SIP_WORKER_SECRET.
El servidor exige firma y timestamp reciente, consulta participante y sala mediante
la API de LiveKit, comprueba kind SIP, trunk, número de destino y llamada activa,
y devuelve un acceso temporal y el estado cifrado para el motor compartido.
No confía en el teléfono de origen para autorizar ni lo copia al teléfono de reserva.
La vida máxima de cinco minutos se calcula desde la creación de la sala y no se
renueva al reiniciar el worker. Los inicios se limitan globalmente a cinco/minuto;
los turnos y reservas conservan sus límites existentes. Repetir el inicio para la
misma sala mantiene el identificador de operación de reserva.

No hay migraciones SQL nuevas. Las reservas siguen siendo de prueba y se conservan
las restricciones existentes de correo. El agente mantiene record=False; las
políticas y registros de los proveedores se administran aparte.

Comprobaciones sin red: inicio firmado del worker, respuesta vinculada a sala,
rechazo de identidades/trunks/números/estados incorrectos, flags de Preview,
expiración, inicio repetido, acceso al motor y bloqueo de snapshots de otras salas.
El SDK LiveKit y los servicios externos se representan con dobles; estas pruebas
no certifican audio ni conectividad telefónica reales. Tras configurar y desplegar,
hacer una llamada manual y revisar su resultado y coste; no hay llamadas automáticas.

Referencias oficiales consultadas el 31-10-2026:
- https://docs.livekit.io/telephony/start/providers/telnyx/
- https://docs.livekit.io/reference/telephony/sip-participant/
- https://docs.livekit.io/reference/server-sdk-js/classes/RoomServiceClient.html
- https://sip.telnyx.com/

El 01-11-2026 se amplía únicamente SIP a cinco minutos para completar la reserva.
El acceso firmado, el arranque del worker y el temporizador usan el mismo límite;
el estado cifrado del motor dura seis minutos y no se amplía. El conector Twilio
conserva sus tres minutos. Se verifica un turno a los cuatro minutos y la caducidad
tras los cinco; el inicio repetido no renueva el plazo original.

## Transferir al personal si no se puede confirmar una reserva

El worker SIP ofrece un único reintento de la misma operación de reserva. Si
sigue sin poder verificarla, ofrece la transferencia solo en el horario interno
de atención y si hay un destino configurado. Sin horario, fuera de horario o
si falla el traspaso, dicta el número público disponible. No se anuncia el
destino interno y no se crea una segunda reserva.

Para probarlo en Preview, aplicar primero la migración
`20261122223000_telefono_transferencia_restaurante.sql`, desplegar backend y
worker y completar la ficha interna del local de prueba. Confirmar que el
número público y el de transferencia llegan al personal, sin volver a Contactia.
La transferencia queda desactivada por defecto: habilitar SIP REFER en Telnyx y
poner `CONTACTIA_SIP_TRANSFER_ENABLED=1` en Vercel Preview para la prueba.
La comprobación manual usa una llamada en horario con un destino controlado y
distinto del móvil que llama. Solo en Preview, fijar temporalmente
`CONTACTIA_SIP_TRANSFER_TEST` con formato `+34<movil>@AAAA-MM-DDTHH:MM:SSZ`.
La marca se aplica solo a ese móvil y al inicio de llamadas dentro de los
30 minutos anteriores al vencimiento (UTC). Una sesión marcada simula el
fallo al guardar y al reintentar, sin crear reservas ni enviar avisos. Las
demás llamadas mantienen su flujo. Retirar la variable después de la prueba.
Durante la llamada usar datos ficticios, confirmar, decir «reintentar» y
aceptar el traspaso cuando se ofrezca; comprobar que ambos teléfonos quedan
conectados al contestar el móvil de destino.
El desvío de Telnyx cuando no conecta el SIP es independiente.

- https://docs.livekit.io/reference/telephony/sip-api/#transfersipparticipant
- https://docs.livekit.io/reference/telephony/troubleshooting/#call-transfer-issues
