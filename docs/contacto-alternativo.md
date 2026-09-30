# Contacto alternativo tras un fallo de correo

Estado a 28/09/2026: lógica y visualización en Preview; proveedores de WhatsApp, llamadas salientes y aviso final al restaurante sin conectar. El activador de Apps Script sigue eliminado. No se han modificado campos ni registros en Airtable para implementar esta fase.

## Política acordada

La reserva ya confirmada mantiene su validez aunque no se consiga contactar. Un teléfono que no responde no acredita una reserva falsa. Si el correo falla, se prevé WhatsApp con autorización registrada; si no está autorizado o falla, hasta tres llamadas. Si todas fallan o el teléfono es inválido, se deja pendiente avisar al restaurante.

Dos resoluciones admitidas: `mantener` (predeterminada) o `revisar_restaurante`. Ambas conservan la reserva y exigen aviso al restaurante al agotar contactos. La segunda registra que falta su decisión, sin ejecutar ninguna cancelación. No se implementa aquí el modelo de reconfirmación previa/caducidad, que necesita un flujo diferente y aceptación anterior del cliente. Una configuración de cancelación o reconfirmación desconocida se marca pendiente y se aplica mantener.

## Configuración por restaurante

Variable opcional de Vercel, exclusiva de Preview: `CONTACTIA_POLITICAS_CONTACTO`. JSON indexado por el identificador del registro del restaurante, no por su nombre. No contiene datos de clientes. Ejemplo ficticio:

```json
{
  "recRestauranteEjemplo": {
    "resolucion": "revisar_restaurante",
    "desde": "10:00",
    "hasta": "20:00",
    "intervalo_minutos": 120
  }
}
```

Sin variable se aplica mantener, máximo tres llamadas, 10:00–20:00 Europe/Madrid y separación mínima de dos horas. Son valores iniciales que deberá acordar el restaurante. El intervalo admite entre 60 y 1440 minutos; el horario debe estar dentro del mismo día. No se permite aumentar el máximo de tres. La política se copia en el seguimiento de cada nueva reserva: cambios futuros no alteran retroactivamente el criterio guardado.

La interfaz del centro muestra etapa pendiente, número de llamadas efectivamente registradas y política. Este paso no añade un editor de políticas al panel del restaurante.

## Qué activa el plan

- Correo devuelto o entrega fallida acreditada por el proveedor.
- Ausencia de destinatario.
- Seis intentos de envío agotados o fin de la ventana segura de 23 horas tras fallos temporales/respuestas desconocidas.

Correo aceptado, demora, falta de credenciales, rechazo genérico del proveedor, supresión, queja o cambio de contenido no prueban que el cliente sea inalcanzable: no disparan la secuencia. Los problemas técnicos conservan su incidencia para revisión. Un último intento todavía en curso tampoco prepara llamadas.

En los envíos nuevos, la falta de destinatario, el agotamiento de intentos y el rebote generan metadatos de contacto dentro de `aviso_cliente_detalle`, sin nuevos campos ni nuevas consultas. La expiración temporal de un aviso histórico puede mostrarse como plan derivado en el centro al consultar sus datos. No hay un barrido para recuperar históricos ni un nuevo sondeo periódico de esta etapa.

## WhatsApp y llamadas

La captura de autorización está implementada pero desactivada por defecto (véase abajo). Dar un móvil no marca esa autorización. Mientras esté desactivada, los envíos nuevos guardan `whatsapp_autorizado: false` y el plan salta a llamada pendiente de integración; no llama.

`prepararContacto` calcula el plan. `siguienteAccion` propone el siguiente paso y, cuando se declara disponible el proveedor de llamadas, calcula una hora permitida y separada del intento anterior. El futuro ejecutor deberá pasar el límite de contacto apropiado para esa reserva, autenticar eventos del proveedor y persistir transiciones de forma atómica antes de habilitar llamadas reales.

`registrarEvento` es una función interna, no un endpoint público. Los intentos aumentan únicamente al registrar `llamada_iniciada`, nunca por un tick del programador. Mientras falta el resultado de una llamada no se propone otra. Las notificaciones repetidas no duplican el contador. Un buzón de voz no debe clasificarse como cliente contactado. El futuro adaptador deberá distinguir entrega de WhatsApp de mera aceptación, verificar identidad/resultado de la conversación y asignar IDs únicos a eventos auténticos.

No hay envío de WhatsApp, llamada, corrección de email ni aviso final real al restaurante en esta fase. `pendiente` o `pendiente_integracion` no significan enviado. El aviso habitual de nueva reserva al restaurante sigue su circuito existente.

## Datos y pruebas

El plan guarda estados, contador, fechas, política e IDs de eventos; no copia nombre, email ni teléfono al centro o a Redis. El emisor futuro consultará los datos de contacto solo cuando necesite efectuar la comunicación.

Pruebas simuladas: WhatsApp entregado/fallido, tres llamadas sin respuesta, contacto conseguido, eventos duplicados/tardíos, teléfono inválido, horario de Madrid y separación, plazo agotado, reserva cancelada, políticas aisladas por restaurante y ausencia de acciones de cancelación. Se prueba también la persistencia del plan desde el sexto fallo de correo y desde un rebote. Sin llamadas a Airtable ni proveedores reales.

## Consentimiento preparado (desactivado)
La variable de Preview CONTACTIA_CONSENTIMIENTO_WHATSAPP=1 permite ensayar
la pregunta después del móvil: «Si no podemos entregarle el correo, ¿autoriza
que le enviemos la confirmación por WhatsApp a este número?».
No activarla para clientes hasta conectar y verificar el proveedor.
La configuración pública expone únicamente el booleano; no añade consultas.
Sí o No permite continuar; una respuesta ambigua repite la pregunta.
El servidor exige booleano true y función activa, y guarda en el seguimiento
la versión de pregunta, finalidad, idioma y fecha del registro. No demuestra
titularidad del móvil ni sustituye la integración del proveedor.
El paso RES-09-W se trata como personal, sin habilitar grabación de audio.
Los clientes anteriores no adquieren autorización por tener teléfono.
La pregunta usa el mismo mecanismo de traducción de voz existente.

## Preparación del contenido (29/09/2026)

`lib/confirmacion-whatsapp.js` prepara borradores en español, inglés y francés desde una reserva confirmada y el plan de contacto pendiente. Exige evidencia de consentimiento, datos completos y fallo de correo admitido por el plan existente. Conserva la reserva sin pedir reconfirmación. Incluye restaurante, fecha con día de semana, hora, personas, zona y localizador; no copia nombre, correo, teléfono ni observaciones.

Es una función pura sin conexión al programador ni envío. `listo` significa contenido preparado, nunca enviado: `envio_habilitado` permanece false. Los tres idiomas tienen contenido preparado; sus plantillas todavía requieren aprobación para envío real. Los ejemplos ficticios están visibles en `/prueba-whatsapp.html`.

Propuesta de plantilla de utilidad `contactia_confirmacion_correo_fallido_v1` (es):

> No hemos podido entregarle el correo de confirmación. Su reserva en {{1}} está confirmada para el {{2}}, a las {{3}}, para {{4}} personas, en {{5}}. Localizador: {{6}}. No necesita volver a confirmar. Gracias por reservar con nosotros.

Variables: 1 restaurante, 2 fecha completa, 3 hora, 4 personas, 5 zona, 6 localizador. La categoría y aprobación final corresponden al proveedor.

La cuenta Try out WhatsApp actual solo permite plantillas predefinidas, no contenido personalizado ni ContentVariables. Fuente: https://www.twilio.com/docs/usage/trials/try-out-whatsapp (comprobada 28/09/2026).

Pendiente antes de activar: cuenta con funciones completas, remitente registrado y plantilla aprobada; adaptador a registros reales y verificación de vigencia/destinatario/autorización; bloqueo atómico por reserva y versión; persistir SID sin duplicar ante resultado ambiguo; verificar firmas de callbacks, correlacionar SID y tratar delivered/read frente a queued/sent; reconciliación limitada de resultados; plantillas aprobadas por idioma y prueba integral. No reutilizar el ContentSid ficticio como confirmación. No reactivar Apps Script todavía.

## Adaptador preparado, aislado (29/09/2026)

`lib/proveedor-confirmacion-whatsapp.js` forma `ContentSid` + `ContentVariables` para la API oficial de Twilio. Se ha comprobado con proveedor simulado: bloqueo sin reserva/consentimiento, producción, bandera apagada, número inválido y SID ficticio de Try out; una respuesta `queued` nunca significa entregado, y un timeout nunca dispara un segundo envío. No hay rutas que invoquen este adaptador, ni variable de activación definida en Vercel.

El futuro canal exige `CONTACTIA_WHATSAPP_CONFIRMACION_HABILITADA=1` solo en Preview y un SID propio distinto del de prueba en `TWILIO_WHATSAPP_CONFIRMACION_CONTENT_SID`. Configurar esos valores **solo después** de la aprobación de plantilla, remitente y circuito de resultados; estas variables por sí solas no conectan el ejecutor. La integración pendiente debe fijar identidad y teléfono al mismo registro confirmado, comparar la huella de reserva vigente, persistir una exclusión atómica por reserva+versión antes de enviar, correlacionar SID y firmar callbacks, y gobernar la recuperación de estados inciertos sin duplicados. No reutilizar el botón manual para clientes.

Referencia: https://www.twilio.com/docs/content/send-templates-created-with-the-content-template-builder

## Cola de comprobaciones (29/09/2026)

La entrada vencida de Redis solo hace una búsqueda acotada por ID en Airtable. Si el seguimiento leído ya indica una fecha de revisión futura, la entrada se mueve a esa fecha con comparación de versión y no llama a Resend ni reenvía. Los estados terminales salen de la cola. El estado del proveedor también respeta el calendario escalonado (15 minutos, 1 hora, 6 horas y 12 horas) y el máximo de cuatro consultas. Las ejecuciones con cola vacía no leen Airtable. El activador de Apps Script sigue eliminado y no se reactiva con este cambio.

## Borradores en inglés y francés (29/09/2026)

La preparación pura usa el idioma guardado en el seguimiento (`es`, `en` o
`fr`), y formatea la fecha con día de semana en ese idioma. El nombre del
restaurante, la zona configurada y el localizador permanecen fieles a la
reserva. Un idioma distinto se bloquea; no se sustituye automáticamente por
español. Todos los borradores mantienen `envio_habilitado: false`.

Propuestas de contenido, con las mismas seis variables de la plantilla española:

- Inglés: We could not deliver your confirmation email. Your reservation at {{1}} is confirmed for {{2}}, at {{3}}, for {{4}} guests, in the {{5}} area. Booking reference: {{6}}. You do not need to confirm again. Thank you for booking with us.
- Francés: Nous n’avons pas pu vous faire parvenir l’e-mail de confirmation. Votre réservation au restaurant {{1}} est confirmée pour le {{2}}, à {{3}}, pour {{4}} personnes, dans la zone {{5}}. Référence de réservation : {{6}}. Vous n’avez pas besoin de confirmer à nouveau. Merci d’avoir réservé chez nous.

El adaptador aislado selecciona ahora el ContentSid según el idioma del borrador:

| Idioma | Variable de plantilla |
|---|---|
| Español | `TWILIO_WHATSAPP_CONFIRMACION_CONTENT_SID` |
| Inglés | `TWILIO_WHATSAPP_CONFIRMACION_CONTENT_SID_EN` |
| Francés | `TWILIO_WHATSAPP_CONFIRMACION_CONTENT_SID_FR` |

Si falta la plantilla del idioma, el adaptador bloquea la petición sin recurrir
al SID español. También bloquea un SID inválido o el del mensaje de prueba,
incluso si se escribe con distinta capitalización. Un idioma no admitido se
rechaza. Las pruebas usan SIDs ficticios y un proveedor simulado.

Cada valor deberá corresponder a la plantilla aprobada en su idioma; el formato
HX por sí solo no demuestra aprobación ni comprueba el idioma en Twilio.
Configurar esos valores solo después de la aprobación y de completar el circuito
de resultados descrito arriba. Esta ampliación no configura variables, registra
plantillas, conecta el programador ni envía mensajes.

## Resultados de WhatsApp preparados (30/09/2026)

`lib/resultado-whatsapp.js` interpreta avisos firmados de Twilio usando
`validateRequest` del SDK oficial. Es un módulo aislado, sin endpoint, consultas,
persistencia ni envío. Solo admite Preview con la bandera de confirmación activa.
La URL exacta procede de `TWILIO_WHATSAPP_STATUS_CALLBACK_URL`; nunca se deriva
de cabeceras Host. No se ha configurado esta variable ni un callback en Twilio.

Valida la firma con todos los parámetros, incluidos los futuros, y exige que
AccountSid y MessageSid correspondan a la cuenta y al seguimiento esperado.
Rechaza parámetros repetidos, estados desconocidos y cuerpos de más de 16 KiB.
No guarda ni devuelve los teléfonos recibidos en el aviso.

`accepted`, `queued`, `sending` y `sent` no acreditan entrega. `delivered` y
`read` proponen `whatsapp_entregado`; pasar de delivered a read no propone un
segundo evento. `failed` y `undelivered` proponen `whatsapp_fallido`. Los eventos
llevan un ID estable por SID y tipo. Los duplicados y estados atrasados no
proponen cambios; una entrega posterior a un fallo terminal exige revisión de
la discrepancia. Una reserva cancelada no recibe cambios de contacto.

El futuro endpoint deberá aceptar POST de formulario, buscar el seguimiento
por el SID registrado, verificar vigencia y autorización, y aplicar resultado
y evento en una misma operación atómica con comparación de versión. Este módulo
por sí solo no evita carreras de persistencia ni resuelve envíos cuyo SID no
llegó a registrarse. No conecta ni activa las llamadas. Quedan pendientes el
endpoint, la correlación persistente y la prueba integral de proveedor.

Referencias oficiales:
- https://www.twilio.com/docs/usage/webhooks/webhooks-security
- https://www.twilio.com/docs/messaging/guides/track-outbound-message-status

## Persistencia del resultado preparada (30/09/2026)

`lib/seguimiento-whatsapp.js` prepara un almacén exclusivo de Preview en Redis.
Guarda SID, referencia de reserva, huella de versión, estado, versión del
seguimiento, fecha y evento pendiente; no guarda nombre, correo, teléfono ni
texto del mensaje. Cada registro caduca a los siete días desde su creación;
las actualizaciones no alargan ese plazo. No se ha llamado al Redis real.

El alta usa SET NX y nunca sustituye un SID existente. Cada resultado validado
por `resultado-whatsapp` se aplica con una comparación y escritura en un script
Lua atómico: si otra ejecución cambió el registro o caducó, no se escribe.
El estado y el evento pendiente se guardan juntos. Un aviso read posterior a
delivered conserva el evento pendiente; su reconocimiento exige la misma
versión para evitar borrarlo desde una ejecución atrasada. Un fallo de Redis
se propaga como error, nunca se declara guardado.

Las pruebas utilizan Redis simulado para ejercitar carreras, duplicados,
reconocimiento atrasado, expiración, firma falsa y cancelación. Queda pendiente
validar el script Lua en Redis real antes de conectar el endpoint. Este módulo
no se importa desde rutas ni programadores, no registra SIDs reales y no activa
WhatsApp ni llamadas.

El futuro ejecutor debe registrar el SID al aceptar el envío y gestionar el
caso de callback recibido antes de registrar el SID. El futuro endpoint debe
verificar la firma antes de realizar búsquedas, leer la reserva vigente y
comparar su huella con la registrada; después llamar a procesar y releer ante
una versión cambiada. El consumidor debe aplicar el evento con su ID estable
de forma idempotente y reconocerlo solo después del éxito. El evento pendiente
no significa que el plan de contacto ya se haya actualizado. La retención de
siete días limita también el periodo de recuperación: un registro caducado
requiere revisión y no autoriza un reenvío.
