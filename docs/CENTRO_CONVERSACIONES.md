# Centro de conversaciones

El Centro de conversaciones proporciona trazabilidad y pruebas automáticas.
En el Preview de Restaurante Sol también guarda una transcripción de diagnóstico
anonimizada. No graba ni almacena audio.

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

- No se acepta ningún campo de audio o grabación.
- Nombre, correo, teléfono, observaciones, localizadores y resúmenes con datos
  del cliente se sustituyen por `[DATO PERSONAL OMITIDO]`.
- Se conservan los códigos de paso, las preguntas, las respuestas no sensibles
  y el número de repreguntas para poder diagnosticar variantes de habla.
- Una conversación se actualiza por `id_conversacion`; no se crea una fila por
  cada turno.
- `eliminar_despues` se fija a 30 días y la tarea diaria de privacidad elimina
  los registros vencidos.
- Producción no expone ni acepta este endpoint.

### Revisión automática

Cada fila incluye cuatro campos para localizar incidencias sin leer todas las
conversaciones:

- `requiere_revision`: permite filtrar únicamente las conversaciones dudosas;
- `tipo_revision`: `sin_incidencias`, `repregunta` o `incompleta`;
- `pasos_revision`: códigos como `RES-03` para saber dónde ocurrió;
- `motivo_revision`: explicación breve sin datos personales.

Una repregunta se marca aunque la conversación termine correctamente, porque
su respuesta puede aportar una expresión nueva para la batería. También se
reconocen las peticiones de repetición sin signo de interrogación, como
«No he reconocido la zona. Opciones: …». Si no hubo
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

## Fase posterior

Antes del piloto telefónico se definirá por separado el almacenamiento seguro
de referencias de audio. La grabación no se activará hasta disponer del aviso
de privacidad, control de acceso y borrado automático específicos para audio.
