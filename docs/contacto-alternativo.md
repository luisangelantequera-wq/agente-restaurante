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

Actualmente no existe captura de autorización para WhatsApp, por lo que los envíos nuevos guardan `whatsapp_autorizado: false`. Dar un móvil no marca esa autorización. Hasta implementar su captura, el plan salta ese canal y muestra llamada pendiente de integración; no llama.

`prepararContacto` calcula el plan. `siguienteAccion` propone el siguiente paso y, cuando se declara disponible el proveedor de llamadas, calcula una hora permitida y separada del intento anterior. El futuro ejecutor deberá pasar el límite de contacto apropiado para esa reserva, autenticar eventos del proveedor y persistir transiciones de forma atómica antes de habilitar llamadas reales.

`registrarEvento` es una función interna, no un endpoint público. Los intentos aumentan únicamente al registrar `llamada_iniciada`, nunca por un tick del programador. Mientras falta el resultado de una llamada no se propone otra. Las notificaciones repetidas no duplican el contador. Un buzón de voz no debe clasificarse como cliente contactado. El futuro adaptador deberá distinguir entrega de WhatsApp de mera aceptación, verificar identidad/resultado de la conversación y asignar IDs únicos a eventos auténticos.

No hay envío de WhatsApp, llamada, corrección de email ni aviso final real al restaurante en esta fase. `pendiente` o `pendiente_integracion` no significan enviado. El aviso habitual de nueva reserva al restaurante sigue su circuito existente.

## Datos y pruebas

El plan guarda estados, contador, fechas, política e IDs de eventos; no copia nombre, email ni teléfono al centro o a Redis. El emisor futuro consultará los datos de contacto solo cuando necesite efectuar la comunicación.

Pruebas simuladas: WhatsApp entregado/fallido, tres llamadas sin respuesta, contacto conseguido, eventos duplicados/tardíos, teléfono inválido, horario de Madrid y separación, plazo agotado, reserva cancelada, políticas aisladas por restaurante y ausencia de acciones de cancelación. Se prueba también la persistencia del plan desde el sexto fallo de correo y desde un rebote. Sin llamadas a Airtable ni proveedores reales.
