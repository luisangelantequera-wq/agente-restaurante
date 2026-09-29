# Restauración de copias de Contactia

La restauración es una operación administrativa excepcional. No se muestra en
el panel diario del restaurante para evitar activaciones accidentales o ataques.

## Protecciones incorporadas

- Solo acepta archivos cifrados creados por Contactia.
- Verifica el cifrado y la integridad antes de leer los datos.
- Rechaza cualquier copia que contenga datos personales o campos secretos.
- Primero genera una previsualización, sin modificar Airtable.
- La confirmación de la previsualización caduca a los diez minutos.
- Antes de aplicar cambios crea otra copia preventiva en Google Drive.
- Nunca elimina registros que existan en Airtable.
- Registra la restauración en la tabla `AUDITORIA`.

## Modos disponibles

### `faltantes` — recomendado

Crea únicamente los registros que han desaparecido. Conserva sin cambios los
registros que todavía existen. Es el modo adecuado si se ha borrado una lista de
reservas, mesas, zonas o configuraciones.

### `completa`

Además de crear los registros ausentes, devuelve los campos respaldados de los
registros existentes al estado de la copia. No elimina registros nuevos. Debe
utilizarse únicamente cuando se haya comprobado que también se modificaron datos
existentes de forma incorrecta.

## Procedimiento

1. Listar las copias disponibles en Google Drive.
2. Seleccionar el archivo anterior al incidente.
3. Ejecutar la previsualización en modo `faltantes`.
4. Revisar por tabla cuántos registros se crearán, conservarán o actualizarán.
5. Si el resultado es correcto, aplicar la confirmación temporal recibida.
6. Comprobar Airtable, el panel del restaurante y la tabla `AUDITORIA`.

Si la copia debe sustituir también valores de registros existentes, se repite la
previsualización en modo `completa` antes de autorizarla.

## Límite deliberado de privacidad

Las copias no guardan nombres, teléfonos, correos, mensajes, tokens ni
localizadores de clientes. Una reserva que tenga que ser recreada recibe un
identificador técnico `RECUPERADA-…` y conserva fecha, hora, personas, estado y
mesas. Los datos personales eliminados no se pueden recuperar desde estas copias.

La clave de restauración y la clave de cifrado permanecen como secretos de
producción en Vercel. Nunca deben copiarse al repositorio, al navegador del
cliente ni a Airtable.

## Retención de copias en Drive

La subida diaria solicita conservar las copias durante siete días. La versión
preparada de `scripts/google-drive-backup.gs` elimina definitivamente, tras
una subida satisfactoria, los archivos con el nombre de copia de Contactia
que ya han superado ese plazo. También crea la copia nueva antes de borrar una
versión anterior del mismo nombre: si falla la creación, la anterior permanece.
Si Drive no confirma la eliminación, el script devuelve un error y conserva
los archivos no eliminados para una revisión posterior.

Esta política no vacía automáticamente las copias que ya estuvieran en la
papelera por ejecuciones antiguas, ni ejecuta la purga cuando no hay una nueva
subida. La actualización requiere publicar una nueva versión de la
implementación web del Apps Script de copias y afecta a todos los entornos que
usen esa misma URL. Antes de publicarla se debe revisar si hay copias antiguas
en la carpeta que todavía se necesiten para restaurar datos.

