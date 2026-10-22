# Acceso del panel con Supabase Auth — prueba de desarrollo

Pantalla: `/acceso-restaurante.html`. Usa el mismo endpoint `/api/restaurante`
con acciones `supabase_entrar`, `supabase_estado`, `supabase_configuracion` y
`supabase_salir`, `supabase_cancelar` y `supabase_reprogramar`, sin añadir otra función de Vercel.

Solo está habilitado en Preview de `migracion-supabase-fase-1`. Producción y
otras ramas responden 404 antes de consultar proveedores. Para ejecución local,
`CONTACTIA_SUPABASE_LOCAL=1` y un origen localhost permiten probar cookies HTTP.

## Sesión y permisos

- SDK oficiales fijados en package.json y lockfile: supabase-js y supabase/ssr.
- Un cliente por petición, con cookies HttpOnly, Secure, SameSite=Strict,
  Path=/ y sin Domain. El SDK renueva la sesión y gestiona cookies fragmentadas.
- El navegador solo llama a la API propia; no recibe access/refresh tokens en
  JSON ni usa localStorage. Todas las acciones exigen POST JSON y mismo origen.
- `auth.getUser()` comprueba la identidad contra Auth antes de consultar datos.
- Las consultas usan la sesión del usuario y una clave publishable. Nunca
  service_role ni metadatos editables como fuente de permisos.
- RLS determina los restaurantes visibles. Una cuenta sin pertenencias activas
  no obtiene datos. Cambiar restaurante_id no evita RLS.
- Logout usa scope local. Como es habitual en Supabase, un JWT ya extraído puede
  seguir siendo válido hasta su caducidad; no se promete revocación instantánea
  del access token. El SDK revoca la renovación de la sesión actual.
- Respuestas privadas sin caché, errores genéricos y sin registros de contraseñas
  ni cookies. Supabase aplica sus límites de intentos de autenticación.

`config/supabase-desarrollo.json` contiene exclusivamente URL y clave PUBLICABLE
del proyecto de pruebas, ambas públicas por diseño. No usar allí claves privadas.
La configuración fija evita conectar por accidente esta pantalla a producción.

## Datos y cuentas de prueba

`supabase/seed-desarrollo.sql` creó Sol y Luna, cada uno con una zona INTERIOR y
una mesa ficticia. Es un seed idempotente que no sobrescribe datos existentes.
No se copiaron datos de Airtable ni se crearon cuentas con contraseñas compartidas.

La cuenta debe crearse en Supabase, Authentication > Users, con una contraseña
establecida por su propietario. No hace falta enviar la contraseña a nadie.
Con el usuario creado, la administración asignará desde SQL su UUID a un
restaurante y rol en restaurante_usuarios. Verificar antes el correo/UUID y el
restaurante; no aceptar IDs proporcionados por el navegador para autoasignación.

Para comprobar aislamiento con sesiones reales, usar dos cuentas independientes,
asignar una a Sol y otra a Luna y verificar cada lista. Probar también cambiar el
ID solicitado al otro restaurante, desactivar la pertenencia y cerrar/reabrir
sesión. Estas verificaciones quedan pendientes hasta tener cuentas de prueba.

## Alcance y validación

La pantalla permite entrar, ver configuración autorizada, consultar las últimas
50 reservas creadas y cerrar sesión. Las reservas se leen con la sesión del
usuario y RLS, filtradas además por restaurante. Muestran nombre, fecha/hora
en la zona horaria del restaurante, personas, zona y estado; no incluyen correo,
teléfono u observaciones. No hay sondeo automático: se usa Actualizar. La lista
incluye canceladas, sin paginación por ahora.

La cancelación requiere confirmación en pantalla y una sesión validada. Todos los
miembros activos del restaurante pueden cancelar reservas futuras confirmadas o
con retraso; las ocupadas, cobradas o ya iniciadas se rechazan. Un reintento sobre
una cancelada devuelve éxito sin alterar su autor o fecha. No se envían avisos.
La RPC pública `cancelar_reserva_panel` es SECURITY INVOKER; llama a una función
privada SECURITY DEFINER de capacidad limitada, con search_path vacío. Esta
exige auth.uid() y bloquea la pertenencia activa y reserva durante la operación.
No acepta un usuario del navegador, no concede escritura directa ni reutiliza
service_role. Los triggers liberan las mesas de forma atómica. Se guardan
cancelado_por y cancelado_en; al borrar una cuenta se conserva la fecha.

La reprogramación abre un diálogo con fecha/hora local del restaurante. Permite
cambiar únicamente reservas futuras confirmadas, conservando mesas, zona,
personas y duración histórica. Reutiliza el motor de ocupación y el validador de
horarios del formulario: días especiales, cierres, intervalos, antelación,
horizonte de 365 días y horas inexistentes/ambiguas de Europe/Madrid. No cambia
la mesa por otra aunque haya hueco: el usuario recibe un conflicto y la reserva
original queda intacta. No se envían avisos.

`reprogramar_reserva_panel` usa el mismo patrón de wrapper invoker y función
privada definer con auth.uid(), pertenencia activa y bloqueo de reserva. Exige
el inicio anterior para detectar ediciones simultáneas; un reintento del mismo
destino ya aplicado devuelve éxito. Se registra el último reprogramado_por/en.
Los permisos de escritura directa siguen revocados. Pruebas SQL reversibles
comprueban aislamiento, conflictos, rollback, auditoría, estado y versión previa.

## Horarios y cierres

La sección desplegable «Horarios y cierres» consulta el horario semanal, las
fechas especiales (concretas o anuales), antelación e intervalo de entradas.
Permite hasta cuatro franjas ordenadas por día y cien fechas especiales. Las
franjas deben empezar y terminar dentro del mismo día, entre 00:00 y 23:59,
sin solapamientos. Un día puede cerrarse con su casilla. Los cierres anteriores
se integran en las fechas especiales al abrir el editor, conservando la prioridad
de una excepción de fecha exacta frente a un cierre o excepción anual.

Solo propietarios y encargados activos pueden guardar. La API valida Auth,
origen y contenido; la RPC valida independientemente el calendario, el rol y
la pertenencia almacenados en base de datos. Una función privada de capacidad
limitada actualiza los campos y deriva dias_cierre; no concede UPDATE directo.
Guarda horarios_version y autor/fecha para detectar cambios simultáneos. Una
versión obsoleta exige volver a cargar antes de guardar, incluso tras perder la
respuesta de un guardado exitoso. La duración de las reservas no se edita aquí.

Las nuevas reglas afectan inmediatamente al formulario público y a la
reprogramación, que leen la misma configuración sin caché. No cancelan ni
desplazan reservas existentes ni envían avisos. El resultado cuenta las reservas
futuras no canceladas que requieren revisión por horarios, cierres, intervalos,
antelación o fechas/horas no válidas según las reglas actuales. El aviso informa
del total; no lista todavía cada reserva afectada.

La sección usa la sesión del usuario, nunca la clave privada del formulario.
Los empleados tienen acceso de lectura. Las pruebas 06_horarios_panel.sql se
ejecutan con datos ficticios dentro de una transacción que siempre se revierte.

## Disponibilidad de zonas y mesas

El panel permite abrir/cerrar zonas y marcar mesas operativas o fuera de
servicio. Propietarios y encargados activos pueden cambiar el estado; empleados
solo lo consultan. No permite crear, borrar ni mover zonas o mesas.

La acción `supabase_disponibilidad` llama a `disponibilidad_panel` usando la
sesión del usuario. Primero previsualiza el recuento de reservas pendientes o en
curso (fin futuro y ocupación activa), contando una combinación una sola vez.
El navegador muestra este recuento antes de confirmar. Al aplicar, la función
privada vuelve a comprobar pertenencia, rol, versión del elemento y recuento;
si cambia el estado o el total, exige actualizar y confirmar de nuevo.

Los bloqueos siguen el orden restaurante → zona → mesa y se coordinan con el
motor de asignación para impedir nuevas reservas mientras se aplica un cierre.
La función actualiza exclusivamente estado, estado_version y autor/fecha.
El wrapper público es SECURITY INVOKER; la escritura limitada vive en esquema
privado con auth.uid() obligatorio. No hay UPDATE directo ni service_role en
el panel. La vista previa no modifica datos ni incrementa versiones.

Cerrar no cancela ni libera reservas existentes y no envía avisos. Reabrir una
zona conserva las mesas que estuvieran fuera de servicio; poner operativa una
mesa tampoco abre su zona ni libera periodos reservados. Estos estados son
generales hasta volver a cambiarlos, no cierres programados para una fecha.
El motor comprueba los estados en cada alta o reprogramación. Las pruebas
07_disponibilidad_panel.sql se ejecutan con datos ficticios y rollback.

No habilita todavía creación de reservas desde el panel, alta de restaurantes o zonas, registro
público de cuentas ni recuperación desde la interfaz. La recuperación la gestiona
administración hasta preparar SMTP y el flujo de restablecimiento.

Pruebas automatizadas: producción/otras ramas bloqueadas, CSRF, credenciales
incorrectas y 429, sesión ausente/anónima, pertenencias vacías, selección de otro
restaurante, logout local, flags reales de cookies del SDK y router sin Airtable.
Las pruebas de permisos SQL se ejecutaron aparte en PostgreSQL alojado.

Antes de producción: completar recuperación, SMTP, invitaciones, MFA de
administración, política de sesiones, revisión de límites de intentos por usuario
y red compartida, y validación con JWT reales y navegación completa.

Fuentes:
- https://supabase.com/docs/guides/auth/server-side/creating-a-client
- https://supabase.com/docs/reference/javascript/auth-signinwithpassword
- https://supabase.com/docs/reference/javascript/auth-signout
- https://supabase.com/docs/guides/auth/sessions
