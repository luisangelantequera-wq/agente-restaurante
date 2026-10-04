# WhatsApp vinculado a reservas en Preview

## Validación realizada el 3 de octubre de 2026

El usuario confirmó recepción del mensaje de la plantilla española y la página confirmó entrega mediante callback firmado. El rechazo 20003 se debía a `Primary compliance profile is not approved`; el perfil principal Individual de Trust Hub quedó Approved. No se incluyen credenciales ni identificadores de mensajes en este documento.

## Prueba manual de una reserva

Ruta: `/prueba-whatsapp.html`, sesión del centro de Contactia. Las acciones `whatsapp_reserva_revisar`, `whatsapp_reserva_enviar` y `whatsapp_reserva_estado` se atienden después de validar la sesión y exclusivamente en Preview.

1. Mantener las cuatro banderas de lectura, contacto, confirmación y callback activas.
2. En Preview de `prototipo-voz`, configurar `CONTACTIA_CONSENTIMIENTO_WHATSAPP=1` para recoger autorización explícita y `CONTACTIA_WHATSAPP_ENVIO_CORRELACIONADO_HABILITADO=1` para el envío manual vinculado. Desplegar después de guardar las variables.
3. Crear una reserva futura de pruebas en Restaurante Sol con el teléfono que coincide con `TWILIO_WHATSAPP_TEST_TO`, y autorizar WhatsApp cuando lo pregunte la conversación.
4. Para probar el fallo de correo sin contactar a un tercero, Resend ofrece `bounced@resend.dev`: https://resend.com/changelog/sending-test-emails . Utilizarlo como email de la reserva. El correo de resumen al restaurante sigue su flujo habitual.
5. Esperar a que Contactia registre el rebote mediante su comprobación de avisos. No sustituir manualmente el estado del correo ni inventar evidencia de consentimiento. El botón de revisión no consulta Resend ni modifica reservas.
6. Introducir el localizador en «WhatsApp de una reserva» y revisar sin enviar. Solo si es elegible se muestra el texto calculado de la reserva y se habilita el envío.
7. Enviar una vez y comprobar la entrega de esa misma reserva. `aceptado` o `accepted` no acreditan entrega. `delivered`/`read` en el seguimiento firmado acreditan entrega; el estado operativo de contacto debe quedar resuelto.

## Controles

- Solo móvil fijo de pruebas: jamás usa un destino o variables enviados por el navegador.
- Reserva confirmada, no anonimizada, futura, con autorización fechada para `confirmacion_si_falla_correo` y fallo elegible del correo.
- Revisión de lectura sin escrituras. Huella del mensaje revisado se vuelve a comprobar en el envío.
- El emisor existente revalida reserva y correo antes y después del reclamo exclusivo en Redis, y correlaciona el SID con reserva y huella.
- Un intento previo bloquea el reenvío, incluso si Twilio rechaza o la respuesta se pierde. El control tiene la retención existente de siete días; no representa deduplicación permanente.
- Callback firmado revalida la reserva y actualiza el contacto operativo en Redis. No modifica la reserva de Airtable ni lanza llamadas.
- La consulta de estado exige SID, reserva y huella coincidentes y no muestra teléfonos completos, correo ni secretos.

## Límites pendientes

El envío manual autenticado quedó validado el 4 de octubre: correo rebotado, WhatsApp recibido y entrega confirmada por callback firmado. Producción no expone estas acciones.

Pendientes: prueba real del envío automático en Preview, plantillas aprobadas en inglés/francés, logo por restaurante mediante plantilla multimedia independiente y onboarding empresarial de restaurantes.

## Verificación

54 pruebas específicas superadas: prueba vinculada a reserva, emisor correlacionado, prueba manual ficticia, revisión de lectura, recepción firmada, consentimiento y adaptador de Twilio. El flujo real vinculado requiere la prueba del usuario descrita arriba.

## Diagnóstico del programador

El botón «Comprobar correo y programador (sin enviar)» consulta solo el detalle operativo de la reserva y cuatro comandos Redis de lectura: pausa, TTL de pausa, última ejecución y fecha de la reserva en la cola. También consulta Resend si hay una referencia válida, sin guardar ni exponer el contenido de su respuesta. No reprograma, no libera pausas y no envía avisos. Muestra fechas en Europe/Madrid y omite identificadores de correo, contactos y secretos.

## Envío automático de Preview

Activación explícita: `CONTACTIA_WHATSAPP_AUTOMATICO_HABILITADO=1`, exclusivamente en Preview de `prototipo-voz`, además de las cinco banderas existentes. El programador de Apps Script sigue atendiendo la cola existente; no se añade un Cron de Vercel.

Cuando la consulta a Resend acredita `bounced` o `failed`, el programador guarda una tarea operativa en `aviso_cliente_detalle` junto con el fallo del correo. Solo se prepara para una reserva futura, confirmada, con autorización y teléfono idéntico a `TWILIO_WHATSAPP_TEST_TO`. No actúa ante falta de configuración, quejas, supresión ni una entrega de correo acreditada.

La cola conserva esa tarea hasta ejecutar el paso de WhatsApp. Una interrupción después de enviar recupera la correlación del SID mediante el control exclusivo existente y nunca repite el mensaje. Rechazos, resultados desconocidos e intentos previos sin resultado quedan en `revision`; no se reenvían automáticamente. Las tareas caducan a las 24 horas del inicio del aviso, antes de la caducidad del control de duplicados de siete días. No se escanean ni recuperan reservas históricas.

Prueba real pendiente: crear una nueva reserva futura con `bounced@resend.dev`, móvil fijo de pruebas y consentimiento; esperar la primera comprobación de correo (15 minutos más el intervalo del programador), sin pulsar envío manual. Comprobar recepción y entrega firmada mediante «Comprobar entrega de esta reserva».

Verificación del cambio: 78 pruebas superadas, incluido endpoint del programador → consulta de rebote → tarea persistida → envío único → correlación; interrupciones antes/después del envío, bloqueo de otros móviles, reservas canceladas, falta de consentimiento y respuestas inciertas.

Activación registrada el 4 de octubre de 2026: la variable automática queda configurada en Preview para `prototipo-voz`. El despliegue posterior incorpora esta configuración; la recepción real de una reserva nueva sigue pendiente de la prueba descrita arriba.
