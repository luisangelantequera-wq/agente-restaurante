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

`lib/confirmacion-whatsapp.js` prepara un borrador en español desde una reserva confirmada y el plan de contacto pendiente. Exige evidencia de consentimiento, datos completos y fallo de correo admitido por el plan existente. Conserva la reserva sin pedir reconfirmación. Incluye restaurante, fecha con día de semana, hora, personas, zona y localizador; no copia nombre, correo, teléfono ni observaciones.

Es una función pura sin conexión al programador ni envío. `listo` significa contenido preparado, nunca enviado: `envio_habilitado` permanece false. Los idiomas inglés y francés quedan pendientes de sus propias plantillas. El ejemplo ficticio está visible en `/prueba-whatsapp.html`.

Propuesta de plantilla de utilidad `contactia_confirmacion_correo_fallido_v1` (es):

> No hemos podido entregarle el correo de confirmación. Su reserva en {{1}} está confirmada para el {{2}}, a las {{3}}, para {{4}} personas, en {{5}}. Localizador: {{6}}. No necesita volver a confirmar. Gracias por reservar con nosotros.

Variables: 1 restaurante, 2 fecha completa, 3 hora, 4 personas, 5 zona, 6 localizador. La categoría y aprobación final corresponden al proveedor.

La cuenta Try out WhatsApp actual solo permite plantillas predefinidas, no contenido personalizado ni ContentVariables. Fuente: https://www.twilio.com/docs/usage/trials/try-out-whatsapp (comprobada 28/09/2026).

Pendiente antes de activar: cuenta con funciones completas, remitente registrado y plantilla aprobada; adaptador a registros reales y verificación de vigencia/destinatario/autorización; bloqueo atómico por reserva y versión; persistir SID sin duplicar ante resultado ambiguo; verificar firmas de callbacks, correlacionar SID y tratar delivered/read frente a queued/sent; reconciliación limitada de resultados; traducciones y prueba integral. No reutilizar el ContentSid ficticio como confirmación. No reactivar Apps Script todavía.
