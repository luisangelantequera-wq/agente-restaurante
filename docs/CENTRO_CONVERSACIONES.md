# Centro de conversaciones

Esta primera fase proporciona trazabilidad y pruebas sin guardar todavía audio
ni conversaciones reales fuera del navegador.

## Identificación

- Cada sesión recibe un `id_conversacion` aleatorio.
- Cada intervención recibe un `id_turno` correlativo (`T001`, `T002`, etc.).
- El estado activo se traduce a un código estable como `RES-01` (fecha),
  `RES-03` (hora) o `RES-11` (confirmación final).
- Las repreguntas conservan el código y aumentan `intento_pregunta`.

El registro permanece en memoria. Para inspeccionarlo durante las pruebas del
navegador se puede ejecutar:

```js
window.ContactiaConversacionActual.exportar()
```

La exportación anonimiza por defecto correos, teléfonos, localizadores y
enlaces. Esta fase no envía conversaciones a Airtable ni a ningún otro
servicio.

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

Los casos de audio serán una segunda capa. Permitirán verificar también la
transcripción de voz antes de entregar el texto al motor determinista.

## Siguiente fase

Antes del piloto telefónico se añadirá el almacenamiento seguro de metadatos,
transcripciones anonimizadas y referencias de audio con conservación limitada.
La grabación no se activará hasta disponer del aviso de privacidad, control de
acceso y borrado automático.
