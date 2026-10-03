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

Esta versión incorpora envío manual autenticado. El alta de reservas y el programador no llaman al emisor de WhatsApp automáticamente. Producción no expone estas acciones.

Pendientes: prueba real con reserva en Preview, integración automática después de validarla, plantillas aprobadas en inglés/francés, logo por restaurante mediante plantilla multimedia independiente y onboarding empresarial de restaurantes.

## Verificación

54 pruebas específicas superadas: prueba vinculada a reserva, emisor correlacionado, prueba manual ficticia, revisión de lectura, recepción firmada, consentimiento y adaptador de Twilio. El flujo real vinculado requiere la prueba del usuario descrita arriba.
