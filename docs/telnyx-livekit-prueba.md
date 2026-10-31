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
- CONTACTIA_SIP_TRUNK_ID: ID exacto ST_... del inbound trunk de LiveKit.
- CONTACTIA_SIP_ENABLED: 1 para habilitar, 0 o ausente para deshabilitar.

Se conservan las variables existentes de Supabase/voz y LiveKit. La variable
CONTACTIA_TWILIO_BROWSER_WEBHOOK_URL se reutiliza únicamente para obtener el host
privado autorizado del motor; la entrada SIP no consulta Twilio ni necesita sus
credenciales. El worker conserva CONTACTIA_TELEFONO_MOTOR_URL como secreto de su
entorno, incluido el bypass de Vercel cuando corresponda. Nunca poner secretos en
Dispatch metadata ni en el repositorio. No necesita una clave nueva de Telnyx.

El worker espera un participante SIP y firma una petición a
/api/restaurante?canal=telefono_sip_inicio con el secreto LiveKit ya configurado.
El servidor exige firma y timestamp reciente, consulta participante y sala mediante
la API de LiveKit, comprueba kind SIP, trunk, número de destino y llamada activa,
y devuelve un acceso temporal y el estado cifrado para el motor compartido.
No confía en el teléfono de origen para autorizar ni lo copia al teléfono de reserva.
La vida máxima de tres minutos se calcula desde la creación de la sala y no se
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
