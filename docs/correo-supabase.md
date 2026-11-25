# Confirmación por correo en Supabase (Preview)

El chat y el formulario comparten el envío de confirmación a través de Resend, después de confirmar la transacción de reserva. El correo incluye nombre, restaurante, fecha y hora local, personas, zona, referencia y el enlace privado de gestión. Lleva el asunto «Contactia · Confirmación de reserva de PRUEBA» y avisa de que no corresponde a un restaurante real.

## Activación limitada

Solo en Preview y rama `migracion-supabase-fase-1`:

- `CONTACTIA_SUPABASE_EMAIL_ENABLED=1` activa el envío; ausente o cualquier otro valor lo desactiva.
- `CONTACTIA_SUPABASE_EMAIL_ALLOWLIST`: de 1 a 10 direcciones de prueba, separadas por comas. Se compara con el correo guardado en Supabase. No hay envío a otras direcciones, ni sustitución automática de destinatarios.
- `EMAIL_FROM`: remitente del dominio verificado en Resend, por ejemplo `Contactia <reservas@contactia.net>`.
- `RESEND_API_KEY`: clave existente de Resend para Preview; nunca se devuelve al navegador.
- `CONTACTIA_PUBLIC_HOSTNAME`: hostname estable de la Preview usado para construir el enlace; no procede del navegador.

Las variables deben limitarse a esa rama. Empezar con el interruptor apagado; habilitar una dirección acordada con el usuario antes de la prueba real. Esta ampliación no activa WhatsApp ni envía avisos al modificar o cancelar. La protección de Vercel sigue vigente: por ahora el destinatario del correo necesita acceso a la Preview para abrir el enlace.

## Registro e idempotencia

`preparar_correo_reserva_web` toma datos de la reserva y reclama el envío en una transacción con bloqueo de fila. La tabla privada `correos_reserva_web` tiene RLS, no permite acceso a `anon` ni `authenticated`, y guarda una instantánea del contenido, estado, intento, contador e ID del proveedor. El token del enlace no se almacena en esta tabla: se conserva solo su hash y se reconstruye en el servidor.

Un segundo proceso durante 30 segundos recibe «pendiente». Cada reclamación tiene un UUID distinto; una respuesta antigua no sobrescribe el intento actual. La clave de Resend es `supabase-confirmacion-v1/<UUID de reserva>`. La instantánea y la plantilla v1 permanecen estables en los reintentos. Mantener esa plantilla sin cambios mientras existan intentos pendientes; futuras versiones necesitan una estrategia explícita de migración.

Los reintentos se limitan a 6 y a 23 horas, por debajo de las 24 horas de idempotencia de Resend. Se detienen si cambia el inicio, el correo o la clave que deriva el enlace, o si la reserva está cancelada/iniciada. Un envío ya aceptado no se repite. Se comprueba otra vez la lista autorizada antes de llamar al proveedor.

La pantalla diferencia reserva confirmada de correo aceptado; «aceptado» no significa entregado. Fallos de red y errores temporales quedan pendientes, los rechazos definitivos quedan registrados y los conflictos de idempotencia pasan a revisión. Un fallo del correo nunca convierte una reserva confirmada en un error de creación. No se registran cuerpos, enlaces ni claves en logs.

Esta fase intenta un envío al confirmar. Un reintento de la misma creación puede retomar un pendiente con la misma clave. La ampliación `seguimiento-avisos-supabase.md` incorpora consulta manual de entrega, botón de reintento seguro y preparación del canal alternativo desde el panel; no hay barridos automáticos ni webhooks públicos nuevos. Si el navegador no recibe resultado, conservar la misma petición, como en el flujo de reservas existente.

Validación: `npm test` (724 pruebas) y `npm run test:supabase` (10 suites SQL). `10_correo_confirmacion.sql` crea datos ficticios y finaliza con ROLLBACK. Los ensayos automáticos no envían correos reales. La comprobación final pendiente es crear una reserva con una dirección autorizada, recibir el correo y abrir su enlace privado.
