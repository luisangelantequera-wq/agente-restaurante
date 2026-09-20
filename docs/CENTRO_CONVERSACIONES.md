# Centro de conversaciones

El Centro de conversaciones proporciona trazabilidad y pruebas automáticas.
En el Preview de Restaurante Sol también guarda una transcripción de diagnóstico
filtrada. En las sesiones de voz puede conservar fragmentos del cliente durante
el tramo previo a la solicitud de datos personales.

## Identificación

- Cada sesión recibe un `id_conversacion` aleatorio.
- Cada intervención recibe un `id_turno` correlativo (`T001`, `T002`, etc.).
- El estado activo se traduce a un código estable como `RES-01` (fecha),
  `RES-03` (hora) o `RES-11` (confirmación final).
- Las repreguntas conservan el código y aumentan `intento_pregunta`.

El registro completo permanece en memoria durante la sesión. Para inspeccionarlo
durante las pruebas del navegador se puede ejecutar:

```js
window.ContactiaConversacionActual.exportar()
```

La exportación anonimiza por defecto correos, teléfonos, localizadores y
enlaces.

## Almacenamiento de Preview

Solo en despliegues Preview y únicamente para `restaurante-sol`, el navegador
envía a `/api/conversaciones` una copia filtrada y no bloqueante. El servidor
vuelve a aplicar el filtro antes de actualizar una fila de `CONVERSACIONES`.

- El audio nunca viaja dentro de la transcripción ni se guarda en Airtable.
- Nombre, correo, teléfono, observaciones, localizadores y resúmenes con datos
  del cliente se sustituyen por `[DATO PERSONAL OMITIDO]`.
- Se conservan los códigos de paso, las preguntas, las respuestas no sensibles
  y el número de repreguntas para poder diagnosticar variantes de habla.
- Una conversación se actualiza por `id_conversacion`; no se crea una fila por
  cada turno.
- `eliminar_despues` se fija a 30 días y la tarea diaria de privacidad elimina
  los registros vencidos y sus fragmentos de audio privados.
- Producción no expone ni acepta este endpoint.

## Audio parcial de diagnóstico

- El aviso se reproduce antes de comenzar a escuchar al cliente.
- Solo se graban intervenciones del cliente en intención, fecha, personas,
  hora, zona y comprobación inicial de los datos.
- La captura se detiene antes de preguntar el nombre y no se reanuda durante
  nombre, correo, teléfono, observaciones ni resumen final.
- Si la transcripción del turno contiene un correo, teléfono, localizador,
  enlace o una presentación explícita del nombre, el fragmento se descarta.
- Cada intervención se cifra en el servidor con AES-256-GCM y se guarda como
  un archivo independiente en la carpeta privada `Contactia Audios Temporales`
  de Google Drive. Drive nunca recibe el audio en formato reproducible. La
  referencia visible en Airtable es únicamente un booleano.
- La subida requiere un token breve, firmado, limitado a la conversación y a
  la dirección de la sesión de voz.
- La reproducción exige la cookie administrativa HttpOnly del centro; nunca se
  entrega una URL ni un identificador público de Google Drive. El servidor lee
  el archivo cifrado, verifica su integridad, lo descifra y entrega el binario
  únicamente a la sesión administrativa.
- La tarea diaria elimina primero el audio vencido y después la conversación
  de Airtable. Además ordena a Drive que purgue cualquier archivo cifrado con
  más de 30 días, incluso si hubiera quedado huérfano por un fallo intermedio.
  La copia de seguridad diaria ejecuta la misma purga directamente en Apps
  Script, por lo que la retención no depende de que haya nuevas grabaciones.

### Revisión automática

Cada fila incluye cuatro campos para localizar incidencias sin leer todas las
conversaciones:

- `requiere_revision`: permite filtrar únicamente las conversaciones dudosas;
- `tipo_revision`: `sin_incidencias`, `repregunta` o `incompleta`;
- `pasos_revision`: códigos como `RES-03` para saber dónde ocurrió;
- `motivo_revision`: explicación breve sin datos personales.

El campo `Resultado` permite separar las conversaciones que siguen en curso de
las reservas confirmadas, cancelaciones, modificaciones, consultas, listas de
espera, envíos de contacto y sesiones cerradas sin completar. El flujo marca
el resultado cuando el servidor confirma la operación, por lo que funciona
también cuando la conversación se realiza en inglés o francés.

Una repregunta se marca aunque la conversación termine correctamente, porque
su respuesta puede aportar una expresión nueva para la batería. También se
reconocen las peticiones de repetición sin signo de interrogación, como
«No he reconocido la zona. Opciones: …» o «Puede indicar: reservar…». Si no hubo
repreguntas, solo se marca como incompleta una sesión cerrada sin un resultado
reconocido. Las reservas, cancelaciones, modificaciones, listas de espera y
envíos de contacto completados no se confunden con abandonos.

## Tabla de casos

`test/casos-conversacion.json` es la tabla maestra versionada. Cada fila indica
la entrada del cliente, el paso, el intérprete y el resultado esperado. Puede
contener casos diseñados y, más adelante, ejemplos anonimizados procedentes de
conversaciones reales.

La batería se ejecuta sin consultar disponibilidad, crear reservas ni enviar
correos:

```sh
npm run test:conversacion
```

El mismo comando ejecuta también `test/escenarios-conversacion.json`. Estos
escenarios cargan el `script.js` real dentro de un navegador simulado y recorren
conversaciones completas. Las respuestas de disponibilidad, creación y gestión
se sustituyen por un servidor simulado de pruebas que solo existe mientras se
ejecuta la batería. Por tanto, nunca se ocupan mesas ni se envían
notificaciones.

La batería inicial cubre:

- reserva completa con variantes de habla;
- corrección de la hora sin reiniciar los demás datos;
- cambio de un día de cierre conservando personas, hora y zona;
- selección de una alternativa cuando no hay mesa;
- cancelación desde un enlace de gestión;
- modificación de una reserva conservando los datos no cambiados;
- alta en lista de espera sin crear una reserva;
- envío simulado del contacto y horario para reservas especiales.

Los casos de audio serán una segunda capa. Permitirán verificar también la
transcripción de voz antes de entregar el texto al motor determinista.

## Activación

La captura permanece inactiva si el Preview no tiene configurada la conexión
privada existente con Google Apps Script mediante
`GOOGLE_APPS_SCRIPT_BACKUP_URL`, `BACKUP_UPLOAD_SECRET` y
`BACKUP_ENCRYPTION_KEY`. Para separar criptográficamente los usos, la clave del
audio se deriva con un contexto propio y no coincide con la que cifra las
copias de seguridad. La ausencia del almacén no afecta a la voz, las reservas
ni las transcripciones filtradas.

El Apps Script crea automáticamente la carpeta `Contactia Audios Temporales`,
mantiene sus archivos privados y admite las acciones `audio_upload`,
`audio_read` y `audio_delete_conversations`. Tras modificar
`scripts/google-drive-backup.gs`, es necesario publicar una nueva versión del
despliegue de Apps Script para que esas acciones estén disponibles.
