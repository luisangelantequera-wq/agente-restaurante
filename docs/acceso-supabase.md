# Acceso del panel con Supabase Auth — prueba de desarrollo

Pantalla: `/acceso-restaurante.html`. Usa el mismo endpoint `/api/restaurante`
con acciones `supabase_entrar`, `supabase_estado`, `supabase_configuracion` y
`supabase_salir`, sin añadir otra función de Vercel.

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
incluye canceladas y es de lectura, sin paginación ni edición por ahora.
No habilita todavía creación de reservas desde el panel, edición, alta de restaurantes o zonas, registro
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
