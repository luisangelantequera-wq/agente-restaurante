# Migración a Supabase — fase 1

## Estado de la Preview a 24 de octubre de 2026

En `migracion-supabase-fase-1` funcionan acceso y configuración del panel, reservas y ocupación transaccional, horarios, zonas y mesas, chat de pruebas, enlace privado de gestión, correo y consulta de entrega. Los datos públicos y las respuestas informativas se describen en `datos-publicos-supabase.md`. WhatsApp está adaptado y desactivado para envíos reales hasta autorizar un teléfono de prueba. La conexión de voz LiveKit está preparada (ver `voz-supabase.md`) y requiere configurar las credenciales de esta Preview y una llamada real. El cambio de proveedor de producción sigue pendiente.

El resto del documento conserva el alcance histórico de la primera entrega. Para las ampliaciones, consultar `acceso-supabase.md`, `reservas-web-supabase.md`, `chat-supabase.md`, `gestion-cliente-supabase.md` y `seguimiento-avisos-supabase.md`.

## Alcance histórico de la primera entrega

Base de trabajo: `corregir-bateria-pruebas`, commit `2cb0bfb`.
La rama conserva las optimizaciones de Airtable y la decisión de no habilitar
creación de zonas desde el panel. El proveedor activo sigue siendo Airtable.

## Preparado en esta entrega

- Migración versionada para restaurantes, pertenencias de usuarios, zonas y mesas.
- Identificador numérico de restaurante compatible con el actual; UUID para zonas
  y mesas, y campo separado para conservar la correspondencia con registros Airtable.
- Usuarios referenciados a `auth.users`; no se copian contraseñas ni
  `api_key_restaurante` de Airtable a las nuevas tablas.
- RLS con lectura por pertenencia activa; sin acceso anónimo ni escritura desde
  el panel en esta fase. Los roles se almacenan en una tabla que el usuario no
  puede editar. Los permisos de escritura diferenciados por rol quedan pendientes.
- Clave foránea compuesta: una mesa no puede pertenecer a la zona de otro restaurante.
- Adaptador de lectura `lib/supabase-panel.js` sin rutas activas: usa una clave
  pública y el token del usuario para que PostgREST aplique RLS.
- Pruebas de JavaScript y pruebas SQL en PostgreSQL embebido PGlite.

El panel actual ya tiene sesiones firmadas y cookies HttpOnly. Supabase Auth
sustituirá gradualmente el acceso por clave de restaurante; esta entrega no
cambia el inicio de sesión existente.

## Validación reproducible

Requiere Node 22, como el proyecto:

```sh
npm ci
node --test test/supabase-panel.test.js
npm run test:supabase
npm test
```

`test:supabase` crea un PostgreSQL efímero en memoria, aplica las migraciones y
ejecuta `supabase/tests/01_aislamiento.sql`. Simula `auth.users` y `auth.uid()`:
verifica SQL y RLS, pero NO valida emisión de JWT, correo, recuperación de
contraseña, configuración del proyecto alojado ni llamadas PostgREST reales.
No contiene datos de clientes ni llama a Airtable.

La prueba SQL usa una transacción y hace rollback. Ejecutarla únicamente en
un proyecto vacío de desarrollo con un rol administrativo; no en producción.

## Aplicación al proyecto alojado

1. Identificar o crear un proyecto **de desarrollo** de Supabase en una región
   europea. Verificar organización y plan antes de crear recursos de pago.
2. Revisar que esté vacío y aplicar la migración SQL mediante el conector o CLI.
3. Verificar RLS/permisos con los asesores de Supabase y repetir la prueba SQL.
4. Configurar Auth por invitación y SMTP propio, URLs permitidas y recuperación.
5. Crear usuarios de prueba y pertenencias desde administración de servidor.
   No crear automáticamente pertenencias desde metadatos editables del usuario.
6. Probar con JWT reales que Sol no puede consultar Luna y que un usuario sin
   pertenencias no obtiene datos. Las tablas no tienen políticas anónimas.

La clave `service_role` omite RLS: mantenerla exclusivamente en el servidor para
tareas administrativas. El adaptador del panel rechaza esa clave. Los errores
de red no deben exponerse sin filtrar ni provocar un fallback silencioso a Airtable.

## Trabajo pendiente antes de migrar reservas

- Mapear campos actuales: teléfonos, horarios habituales y especiales,
  cierres, información gastronómica, encargos y combinaciones de mesas.
- Exportar desde una copia autorizada o backup cuando esté disponible. Validar
  duplicados y relaciones; no importar una base remota que no se haya identificado.
- Modelar reservas, sus mesas e intervalos de ocupación; resolver en transacciones
  la creación, modificación y cancelación de todas las mesas de una combinación.
- Restricción de exclusión por mesa física e intervalo para evitar solapamientos.
  Probar dos conexiones simultáneas: solo una debe obtener la última mesa.
- Integrar retenciones temporales, antelación, horario y zonas cerradas sin perder
  reglas actuales. No se ha implementado todavía el bloqueo de doble reserva SQL.
- Migrar enlaces de gestión, espera, conversaciones, auditoría, avisos y backups.
- Integrar Auth en la interfaz y API: sesión validada, cookies seguras si procede,
  protección CSRF y comprobación de permisos en cada operación de escritura.
- Activar Supabase únicamente en un Preview aislado, verificar la aplicación
  completa y documentar el cambio de proveedor y recuperación antes del corte.

No hay sincronización bidireccional ni cambios en producción en esta fase.
Para retirar esta entrega basta con cerrar la rama: ninguna ruta activa la importa.

Fuentes técnicas:
- https://supabase.com/docs/guides/database/postgres/row-level-security
- https://supabase.com/docs/guides/deployment/database-migrations
- https://www.postgresql.org/docs/current/rangetypes.html
