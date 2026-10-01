# Recepción Twilio en Preview: ruta preparada y apagada

409 pruebas locales superadas.

/api/whatsapp-resultado se sirve mediante la función existente api/centro-conversaciones.js y un rewrite anterior a la ruta genérica. El proyecto conserva 12 funciones, límite del plan Hobby para esta estructura.

La función compartida desactiva bodyParser. El centro conserva la lectura JSON con límite de 16 KiB; su inicio de sesión sobre un cuerpo fragmentado está probado. La nueva ruta conserva el formulario original, limita bytes/tiempo y UTF-8, valida firma y todos los parámetros antes de componer servicios, y usa una URL fiable de configuración en vez de Host.

La preparación del envío requiere TWILIO_WHATSAPP_STATUS_CALLBACK_URL HTTPS, ruta /api/whatsapp-resultado, sin credenciales, fragmento ni query. Añade ese valor como StatusCallback.

Para atender callbacks hacen falta VERCEL_ENV=preview y las cuatro banderas a 1: CONTACTIA_WHATSAPP_CONFIRMACION_HABILITADA, CONTACTIA_WHATSAPP_LECTURA_RESERVA_HABILITADA, CONTACTIA_WHATSAPP_CONTACTO_REDIS_HABILITADO y CONTACTIA_WHATSAPP_CALLBACK_HABILITADO. No se han cambiado variables remotas ni activado envíos.

Redis real ya fue comprobado en el diagnóstico aislado 8Xr36Sk6sXan9zPPsZ31mYpBb71b: alta sin sustitución, una escritura simultánea, huella/versiones, TTL sin prórroga y caducidad. Se eliminaron claves ficticias; cero consultas a Airtable y cero mensajes.

Pendiente antes de activar: inicializar contacto correlacionado antes del envío y registrar el SID; revalidar vigencia y consentimiento; controlar respuestas inciertas sin reenvío; proyectar estado Redis en el centro; probar Twilio de extremo a extremo. La protección SSO de Preview puede impedir callbacks: no se ha desactivado ni añadido un bypass. Será necesario un mecanismo autorizado y compatible con firma Twilio antes de la prueba real.
