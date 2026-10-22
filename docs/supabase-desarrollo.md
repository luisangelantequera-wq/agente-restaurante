# Supabase de desarrollo

- Organización: Contactia (`vvilxpvveefohmirpbsk`).
- Proyecto: `contactia-desarrollo`.
- Referencia: `hjjhfgwzbqrrqrwurvvs`.
- Región: París, `eu-west-3`.
- Coste confirmado al crear: 0 USD/mes.
- Panel: https://supabase.com/dashboard/project/hjjhfgwzbqrrqrwurvvs

## Estado verificado el 22 de octubre de 2026

Se aplicó la migración `configuracion_y_accesos` del archivo
`supabase/migrations/20261022000100_configuracion_y_accesos.sql`.
Las tablas restaurantes, restaurante_usuarios, zonas y mesas están creadas.

La prueba `supabase/tests/01_aislamiento.sql` pasó en el PostgreSQL alojado:
aislamiento Sol/Luna, usuario desactivado, rechazo de acceso anónimo,
bloqueo de autoasignación de roles y de alta de zonas desde el panel,
y relación de mesas limitada a zonas del mismo restaurante.
Se simularon identidades mediante claims SQL; no se emitieron JWT de Auth.
La prueba hizo rollback y las cuatro tablas quedaron vacías.

Los asesores de seguridad y rendimiento devolvieron cero avisos.
Esto verifica la estructura actual; no constituye una auditoría de toda la aplicación.

## Pendiente

- Integrar Supabase Auth en pantallas y API, y verificar sesiones reales.
- Mapear horarios, cierres, datos del restaurante y combinaciones.
- Modelar y probar reservas y transacciones concurrentes.
- Importar datos y habilitar un Preview aislado con Supabase.

Contactia sigue usando Airtable. No se ha cambiado producción ni se han
copiado datos reales. Esta referencia de proyecto es pública y no contiene claves.
