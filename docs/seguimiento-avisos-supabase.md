# Confirmaciones y seguimiento en Supabase

La sección «Avisos y confirmaciones» del panel agrupa consulta de entregas, reintentos seguros de correo y aviso alternativo por WhatsApp. Es una ampliación de Preview en la rama `migracion-supabase-fase-1`. No consulta Airtable ni utiliza los trabajos Redis del circuito anterior.

## Reutilización

- `estado-avisos.EVENTOS`: traducción de los resultados de Resend a los estados operativos existentes.
- `correo-supabase.enviarConfirmacion`: mismo envío, plantilla v1, instantánea, clave de idempotencia, máximo de 6 intentos y ventana de 23 horas.
- `confirmacion-whatsapp.preparar`: misma plantilla aprobada y reglas de fallo elegible y autorización.
- `proveedor-confirmacion-whatsapp.prepararPeticion/enviarPreparado`: mismo adaptador de Twilio, con validación de plantilla y una sola petición por intento.
- `resultado-whatsapp`: mismos estados de progreso, entrega y fallo.
- `entrada-conversacional.normalizarTelefono`: normalización del teléfono aportado en la reserva.

La nueva capa adapta estas piezas a PostgreSQL, a los UUID de las reservas y a la sesión del panel. Los módulos anteriores conservan su comportamiento y sus rutas. No se envían avisos al cambiar o cancelar reservas en esta fase.

## Uso del panel

La lista se carga al abrir la sección y muestra los últimos 50 avisos del restaurante. «Actualizar avisos» solo lee Supabase. «Comprobar correo» consulta Resend; «Comprobar hasta 3 entregas» consulta hasta tres envíos aceptados o demorados. No hay temporizadores, barridos, cron nuevos ni consultas al dejar la página abierta. Se limita cada revisión del mismo aviso a una cada 30 segundos. Un error de permisos de Resend se muestra sin cambiar el estado de entrega.

Se distingue aceptación de entrega. Abrir o hacer clic en el correo no se utiliza como prueba de entrega. Una demora no revierte una entrega ya acreditada; un rebote, queja o supresión se conservan como incidencias. Los cuerpos, direcciones y enlaces que Resend devuelve no se guardan ni se devuelven al panel: solo se persiste el resultado operativo.

Los IDs de Resend se validan como identificadores hexadecimales con formato UUID, incluidas las versiones nuevas como UUID v7; no se aplica la restricción de versión de nuestros identificadores de formulario. La respuesta debe conservar exactamente el ID solicitado. Los mensajes de espera entre revisiones, operación en curso y estado no elegible se muestran por separado.

«Reintentar correo» requiere confirmación del operador, reutiliza el envío existente y conserva su enlace. Se bloquea si la reserva cambió, está cancelada o iniciada, venció la ventana, se agotaron los intentos o hay un envío en curso. No se crea una reserva nueva. Si cambia la clave del servidor que deriva el token, el caso requiere revisión.

## WhatsApp

El circuito está implementado y permanece desactivado hasta configurar un teléfono de prueba autorizado. `CONTACTIA_SUPABASE_WHATSAPP_ENABLED=1` y `CONTACTIA_SUPABASE_WHATSAPP_ALLOWLIST` (teléfonos E.164 separados por comas) controlan exclusivamente este circuito de Supabase. Requiere las credenciales de Twilio existentes y `TWILIO_WHATSAPP_CONFIRMACION_CONTENT_SID`, la plantilla propia aprobada. No usa la plantilla de demostración.

Cuando se habilita, chat y formulario muestran una casilla opcional sin marcar: «Autorizo que me envíen por WhatsApp la confirmación si falla el correo». La respuesta, fecha y versión se guardan en la misma transacción que la reserva y el enlace; reintentar la reserva no permite cambiar la autorización. Las reservas anteriores conservan autorización falsa. El panel no permite autorizar en nombre del cliente.

Solo se prepara WhatsApp para un rebote o fallo de entrega de correo confirmado, con autorización y reserva confirmada futura. Una queja, una supresión, una dirección fuera de la lista de correo o un simple error técnico no habilitan ese envío. «Preparar WhatsApp» muestra el texto y un teléfono oculto salvo sus cuatro últimas cifras. Enviar exige confirmación desde esa previsualización, canal habilitado y teléfono en la lista de pruebas. Un cambio de fecha, teléfono u otros datos después de preparar obliga a preparar de nuevo.

La reclamación se guarda antes de llamar a Twilio. Un mensaje aceptado se correlaciona por SID; una respuesta incierta o un proceso interrumpido no permiten reenviar automáticamente. Los casos inciertos sin SID requieren revisión manual. «Comprobar WhatsApp» consulta la API autenticada de Twilio y verifica tanto SID como cuenta. No se usa el callback anterior de Airtable: se elimina `StatusCallback` de esta petición. No se modifica ni desactiva la protección de Vercel. La plantilla aprobada contiene resumen y localizador; no se añade un enlace privado a una plantilla que no lo contempla.

## Acceso y persistencia

El panel usa `Auth.getUser()` para validar la sesión. El UUID de usuario procede de esa validación; nunca del cuerpo del navegador. Las RPC de avisos son `SECURITY INVOKER`, exclusivas de `service_role`, y comprueban dentro de PostgreSQL que ese usuario tiene una pertenencia activa al restaurante. Los empleados solo consultan la lista; propietario y encargado pueden actuar. No se conceden accesos directos a tablas privadas ni RPC de servicio a `anon` o `authenticated`.

Las tablas privadas tienen RLS. Cada operación bloquea sus filas, tiene un UUID y una concesión temporal; un resultado antiguo no sobrescribe otra operación. El listado público omite correo completo, teléfono, cuerpos, claves y hashes de gestión. La reserva se mantiene aunque fallen todos los avisos. No se hacen llamadas telefónicas desde este bloque.

Validación: pruebas JavaScript, suite SQL `11_seguimiento_avisos.sql` con ROLLBACK, y comprobación de la interfaz con respuestas simuladas. La integración de correo y enlace ya se probó con `oemvideo@gmail.com`. La siguiente comprobación de usuario consiste únicamente en consultar la entrega de ese correo desde el panel, sin crear reservas nuevas. El envío real de WhatsApp aún no se ha validado sobre este circuito de Supabase.
