# Optimización del consumo del panel y conversaciones (Preview)

Fecha: octubre de 2026. Rama `corregir-bateria-pruebas`.

## Lo que muestra la medición sin Airtable

El simulador `npm run medir:simulado` llama al servidor real de agenda con
un `fetch` totalmente ficticio: una carga necesita **5 GET**, uno de
RESTAURANTES, RESERVAS, MESAS, ZONA y LISTA_ESPERA; cuando RESERVAS
requiere una segunda página, cuesta **6 GET**. El panel sin sesión
consume **cero**.

Las cinco tablas tienen funciones distintas (identidad y duración, reservas,
configuración de mesas, zonas y lista de espera); eliminar una lectura
sin rediseñar el panel haría que mostrase información incompleta u obsoleta.

## Cambio seguro: selección de hora manual

Antes, `horaMesas.change` pulsaba automáticamente Actualizar y ocasionaba
**cinco consultas adicionales** en el escenario de una página, aunque el
usuario aún estuviera seleccionando otra hora.

Ahora elegir una hora:
- no consulta ningún servidor;
- invalida y oculta las **mesas libres de la hora anterior**;
- muestra el mensaje `Hora cambiada. Pulse Actualizar para comprobar mesas disponibles.`;
- deja el botón **Actualizar** como única forma de obtener disponibilidad
  fresca para esa hora.

Cambiar de fecha conserva su actualización inmediata, porque los datos
del día anterior tampoco serían válidos. Las acciones operativas de reserva
siguen verificando Airtable y la retención Upstash en el servidor.

**Ahorro estimado, NO observado en Airtable:** si se recorren tres horas y
solo se pulsa Actualizar una vez, las tres recargas anteriores costaban
3 × 5 = 15 GET. Ahora solo cuesta 5 GET por la actualización final:
10 peticiones menos (67 % de ese caso). Seleccionar una hora y NO pulsar
Actualizar ahorra una carga de 5 GET, pero no ofrece datos frescos.

## Guardado de conversaciones

`lib/guardado-conversaciones.js` ya impide escrituras repetidas si el
contenido no cambió; persiste al colgar o tras 90 segundos de inactividad,
y una incidencia crítica puede generar una escritura anticipada que luego
se actualiza en el cierre. Esas escrituras son intencionadas. No
eliminarlas sin evidencia de duplicados: podríamos perder incidencias.

## Seguridad y comprobación

No hay caché nueva compartida para mesas ni reservas. El algoritmo de
asignación, cierre y verificación del servidor no se ha modificado.
La simulación usa exclusivamente datos ficticios y no incorpora
credenciales de Airtable. El script de medición y `npm test` pueden
ejecutarse con los secretos vacíos en GitHub Actions.

Queda por medir el ahorro en uso real después de que se restablezca
la cuota de Airtable en noviembre.
