# Gestión privada de reservas en Supabase (desarrollo)

El chat y el formulario muestran un enlace «Consultar, cambiar o cancelar mi reserva» al confirmar una reserva nueva. Las pruebas anteriores a este cambio no reciben enlace automáticamente. Ruta: `gestion-prueba.html#restaurante=prueba-sol&token=…` (también Luna). Se mantiene la protección de Vercel de la Preview. El envío de confirmaciones por correo está preparado con interruptor y lista de direcciones de prueba; véase `correo-supabase.md`. Los cambios y cancelaciones no envían avisos. WhatsApp sigue desactivado.

El secreto de 256 bits se deriva mediante HMAC-SHA256, con dominio `contactia:gestion:v1`, slug y UUID de petición, usando la clave privada del servidor. Esto permite recuperar el mismo enlace si se reintenta una creación cuyo resultado no llegó al navegador. Solo se guarda su SHA-256 en `contactia_privado.enlaces_gestion`. `reservar_web_con_gestion` crea la reserva y registra la autorización en una transacción. Nunca se devuelve la clave del servidor. Si se rota la clave, los enlaces existentes siguen funcionando por su hash; un reintento de creación puede emitir otro enlace válido para la misma reserva.

El token va en el fragmento de URL, que el navegador no incluye en la solicitud HTTP ni en el encabezado Referer. La página lo envía únicamente en JSON al servidor del mismo origen. No se usa almacenamiento del navegador, analítica externa ni registro de cuerpos en esta ruta. El enlace es una credencial: quien lo posea puede gestionar esa única reserva. Compartirlo comparte ese acceso. La referencia PRUEBA/UUID no autoriza operaciones.

El enlace está ligado a restaurante y reserva, puede revocarse en la tabla privada y caduca al alcanzar el menor de estos límites: 400 días desde su emisión o 24 horas después del fin actual de la reserva. Solo permite cambios antes del inicio; después se muestra el estado mientras el enlace siga vigente. Suspender nuevas reservas web no impide gestionar las ya creadas.

`gestionar_reserva_web` es SECURITY INVOKER, con search_path vacío y ejecución exclusiva para service_role. Tablas privadas con RLS y sin acceso para anon/authenticated. La API mantiene rama/Preview/interruptor, origen, host, JSON, IP y cuotas: 30 lecturas y 5 escrituras por minuto/IP, compartidas con el formulario. No requiere Turnstile adicional: la autorización es el secreto del enlace. No permite elegir otra reserva, mesas, zona, personas ni duración. Devuelve nombre, fecha, hora, personas, zona, estado y referencia; omite email, teléfono y observaciones.

Los cambios mantienen mesas y duración, validan horario, antelación, zona operativa y ocupación física. Los conflictos dejan intacta la reserva. Cancelar libera todas sus mesas en la misma transacción. El cliente confirma antes de escribir. `inicio_anterior` detecta pantallas desactualizadas. Cada operación lleva un UUID y una copia de su solicitud en `contactia_privado.operaciones_gestion`: un reintento idéntico devuelve el estado actual sin volver a escribir, aunque después se haya cancelado o modificado la reserva. El historial identifica las operaciones del enlace; los campos de auditoría de propietario quedan sin usuario al actuar el cliente.

Si la conexión falla con resultado incierto, se conservan UUID y datos en memoria, se bloquean cambios nuevos y se ofrece reintentar la misma operación. No cerrar ni recargar la pestaña hasta resolverla; si se pierde, abrir de nuevo el enlace para consultar el estado antes de decidir otra acción. No hay escrituras al abrir la página: consulta por POST; los cambios requieren confirmación explícita.

Validación: `npm test`, `npm run test:supabase` y suite SQL `09_gestion_cliente.sql` con ROLLBACK. Incluye aislamiento de tokens/restaurantes, bloqueo de roles públicos, proyección mínima, conflictos sin escritura parcial, vista desactualizada, idempotencia de creación/cambio/cancelación, reintentos antiguos, revocación y caducidad. La comprobación final de navegador requiere crear una reserva de prueba, abrir el enlace, cambiar hora, revisar panel y cancelar desde el enlace.


## Revisión integrada del 31/10/2026

Se añade `test/gestion-cliente-recorrido.test.js`: carga la página y su
JavaScript reales en JSDOM, envía los POST a `crearHandler` de la API y ejecuta
las RPC reales en PostgreSQL efímero (PGlite), aplicando todas las migraciones.
El adaptador SQL usa savepoints para que cada error revierta solamente su RPC,
como una petición independiente a PostgREST, y cada caso termina con ROLLBACK.
No se conecta a Supabase remoto ni se usa Airtable o proveedores de mensajes.

Los nueve casos comprueban:

- Abrir el enlace solo consulta. Cambiar conserva personas, zona y ocupación;
  cancelar libera las mesas y desactiva los botones. Luna no cambia al actuar
  sobre Sol. La respuesta no incluye email, teléfono, observaciones ni mesas.
- Una respuesta perdida después de guardar mantiene UUID y payload. Un 429
  posterior no permite nuevas ediciones; el siguiente reintento recupera la
  operación y deja una única escritura en `operaciones_gestion`.
- Una respuesta HTML después de cancelar no anuncia éxito ni permite otra
  operación hasta recuperar el resultado. La mesa permanece libre y el aviso
  de salida protege la pestaña mientras hay una operación pendiente.
- Una colisión de mesa no cambia la reserva; elegir una hora libre permite
  continuar. Dos pestañas rechazan datos antiguos y recuperan la versión
  actual al pulsar Actualizar datos.
- Rechazar el diálogo de confirmación no escribe; pulsaciones repetidas durante
  una petición en curso tampoco crean operaciones adicionales.
- Tokens desconocidos, de otro restaurante, caducados o revocados no muestran
  datos. Un enlace mal formado no llega a la API.
- Reabrir el enlace tras perder una respuesta consulta el estado vigente sin
  repetir la escritura. Un cambio antiguo reintentado después de cancelar no
  reactiva la reserva ni vuelve a ocupar sus mesas.
- Una reserva ya iniciada puede consultarse mientras el enlace siga vigente,
  pero no permite cambios ni cancelaciones desde la página.

No fue necesario cambiar la interfaz, la API ni las funciones SQL: los
controles existentes superaron estos recorridos. La comprobación automatizada
no sustituye una prueba de acceso y conexión en Vercel con un navegador real.
