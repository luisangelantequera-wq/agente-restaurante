# Prueba manual de WhatsApp en Preview

Página `/prueba-whatsapp.html`, protegida por la sesión del centro de Contactia.
No consulta Airtable, crea reservas, activa consentimiento ni procesa avisos pendientes.
Usa la plantilla ficticia de Twilio, no una confirmación de reserva.

Variables de Preview (sin rama para compartir configuración de pruebas):
- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN` (secreto)
- `TWILIO_WHATSAPP_FROM` (`whatsapp:+` y número internacional)
- `TWILIO_WHATSAPP_CONTENT_SID`
- `TWILIO_WHATSAPP_TEST_TO` (móvil verificado de prueba, mismo formato)

Requiere las variables Redis existentes y CONTACTIA_CENTRO_SECRET. Después de modificar variables, desplegar de nuevo Preview. El destino nunca se acepta desde el navegador.
El botón requiere confirmación manual; Redis SET NX EX bloquea nuevos intentos durante 15 minutos, incluso ante error ambiguo. No hay reintentos ni consultas periódicas. No se registran credenciales, teléfonos ni contenido en Redis.

Una respuesta satisfactoria acredita aceptación por Twilio, no entrega. Verificar el móvil o la consola de Twilio. Ante resultado desconocido, comprobar antes de repetir.
No reactivar el activador de Apps Script ni automatismos de clientes con esta prueba.
