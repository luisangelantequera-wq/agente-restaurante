# Reservas PostgreSQL — motor de desarrollo

Aplicado solo a `contactia-desarrollo`. No está conectado todavía al chat ni a
las acciones del panel y no envía correos, WhatsApp ni llamadas. Airtable sigue
siendo el proveedor de la aplicación activa.

## Modelo

- `reservas`: restaurante, zona, personas, datos del cliente, inicio/fin con
  zona horaria y estado. Cada nueva reserva conserva su duración efectiva.
- `reserva_mesas`: una ocupación por mesa física. Un índice GiST con exclusión
  rechaza dos intervalos activos solapados para la misma mesa.
- `combinaciones_mesas` y `combinacion_mesas`: combinaciones autorizadas por
  restaurante, zona y capacidad. No se permite unir mesas arbitrariamente.
- Intervalos `[inicio, fin)`: una reserva puede empezar exactamente cuando acaba
  la anterior. Los intervalos completos detectan también cruces de medianoche.

Los triggers derivan la ocupación del horario y estado de la reserva. Una
restricción diferida impide confirmar una reserva activa sin ninguna ocupación.
Una combinación se inserta en la misma transacción: si falla una mesa, se
revierte toda la reserva. No hay bloqueos parciales ni reservas huérfanas.

## Operaciones internas del servidor

`crear_reserva(restaurante, peticion_uuid, mesas_uuid[], inicio_timestamptz,
personas, nombre, email, telefono, observaciones)` devuelve el UUID de reserva.
Comprueba antelación, capacidad, mesas operativas, zona abierta y combinación
configurada. Una petición repetida con los mismos datos devuelve el UUID ya
creado; reutilizar la clave con otros datos se rechaza. La clave identifica una
operación original: no se utiliza para volver a crear una reserva cancelada.

`cancelar_reserva(restaurante, reserva_uuid)` cambia el estado y libera todas
sus ocupaciones dentro de la misma transacción.

`reprogramar_reserva(restaurante, reserva_uuid, nuevo_inicio)` conserva mesas,
zona y duración de una reserva confirmada. Valida antelación y recursos abiertos.
Un solapamiento revierte horario y ocupación al estado anterior. No modifica
personas, datos del cliente ni reasigna mesas en esta fase.

Son funciones SECURITY INVOKER con ejecución restringida a `service_role`.
Los usuarios del panel solo tienen lectura bajo RLS; no pueden llamarlas ni
modificar directamente las tablas. Las claves privadas quedan en el servidor.
Antes de usarlas desde una API, validar la sesión y sus permisos: service_role
omite RLS. No pasar un restaurante del navegador como autorización.

El error SQL `23P01` indica conflicto de ocupación; el servidor deberá traducirlo
a «La mesa acaba de reservarse; vamos a buscar otra opción». No exponer detalles
SQL ni reintentar a ciegas con otra clave de petición.

## Verificaciones realizadas

- Pruebas SQL locales con PostgreSQL embebido PGlite y extensión btree_gist.
- Pruebas SQL en el proyecto alojado con rollback: solapamiento parcial,
  contigüidad, combinación ocupada, combinación parcial fallida, cancelación,
  reprogramación válida/fallida, capacidad, antelación, zona cerrada, mesa fuera
  de servicio, mesas ajenas, idempotencia y permisos del panel.
- Dos llamadas SQL lanzadas en paralelo a Supabase para la misma mesa e intervalo:
  A confirmó; B recibió `23P01` por `mesa_sin_solapamiento`. Solo quedó una reserva
  y una ocupación, sin reserva parcial de B.
- Tras cancelar A se pudo crear otra reserva en el mismo intervalo dentro de una
  transacción de prueba con rollback. A quedó finalmente cancelada y sin ocupación
  activa. Registro ficticio conservado: `TEST-CONCURRENCIA-20261022-A`.
- Las migraciones locales tienen las mismas versiones que el historial alojado.
- Se corrigieron dos índices de claves foráneas y se movió btree_gist al esquema
  extensions. Los índices nuevos pueden aparecer como aún no utilizados.

El asesor conserva un aviso de Auth sobre comprobación de contraseñas filtradas
no habilitada. Es independiente del motor de reservas y queda pendiente antes
de producción: https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection

## Pendiente antes de conectar clientes reales

- Validación de horarios habituales/especiales y cierres por fecha (actualmente
  sigue en la aplicación existente). El motor todavía no interpreta horarios.
- Retenciones temporales de mesa y su caducidad. Evitar mantener dos sistemas de
  bloqueos independientes al integrar el motor.
- Migrar la configuración real y los mínimos de capacidad aplicando las reglas
  actuales de margen cuando Airtable no tiene un mínimo explícito.
- Mapear localizador público, enlaces de gestión, auditoría, lista de espera y
  confirmaciones. El UUID interno no sustituye el token secreto de gestión.
- Validar permisos de cada acción, disponibilidad, reservas y reintentos mediante
  la API del Preview. La prueba concurrente actual es del motor SQL, no del chat.
- Gestión administrativa de cambios en combinaciones: coordinar los cambios de
  cabecera y componentes en una transacción; no editar la configuración mientras
  se asignan mesas sin definir previamente su estrategia de bloqueo.

Ejecutar `npm run test:supabase` para aplicar las migraciones en una base efímera
y recorrer las pruebas SQL. No apunta a Supabase remoto ni consume Airtable.
