# Panel del propietario: primera ampliación

Solo Preview `corregir-bateria-pruebas`, base Sandbox `appNFqY50AnEiDdPq`.

## Navegación

- Inicio: reservas, comensales, canceladas, mesas disponibles y lista de espera del día seleccionado.
- Reservas: conserva todas las funciones de agenda existentes.
- Mesas y zonas: mesas libres agrupadas por zona y acceso al cierre/reapertura.
- Avisos y recados: integra la lista de espera actual. No añade aún un sistema independiente de recados telefónicos.
- Ajustes: datos de contacto, horarios/calendario e información del restaurante.
- Ayuda: guía de las funciones existentes.

Pendientes para fases siguientes: carta, voz/idiomas y consumo/plan del propietario. El contador técnico de Airtable sigue en Centro Contactia.

## Ajustes nuevos

`lib/ajustes-panel.js` reutiliza `/api/restaurante` mediante `ajustes_consultar`, `ajustes_guardar` y `ajustes_sincronizar`. Solo Preview, sesión firmada, origen HTTPS igual al host y lista cerrada de campos. Cada sección tiene huella para evitar sobrescrituras sucesivas de ediciones antiguas (no constituye una transacción entre editores simultáneos).

Sección pública: dirección, web, aparcamiento/transporte, accesibilidad, mascotas, infancia, grupos y formas de pago. Solo escribe `direccion`, `web` e `informacion_publica`. Los apartados vacíos no generan respuestas. No usar estos textos para guardar información personal de clientes.

Horarios: hasta cuatro franjas por día dentro del mismo día, días cerrados y hasta cien cierres por fecha. Guarda el formato existente de `horario_reservas`, `dias_cierre` y `cierres_especiales`, compatible con el motor de reservas. Antes de escribir, consulta reservas desde hoy y pide confirmación si el nuevo horario las afecta. La confirmación incluye una huella de las reservas afectadas; si varían, se solicita otra revisión. No cancela ni cambia reservas.

## Memoria y respuestas

- Nombre/teléfonos conservan su sincronización ya existente.
- La información habitual utiliza una clave pública `informacion`, aislada por base, rama y restaurante. TTL 24 horas y sobrescritura al guardar. Las respuestas y valores se validan antes de leer/escribir memoria.
- Los horarios se consultan en Airtable cuando se pregunta por ellos. No se guardan en esta caché ni reemplazan la comprobación de disponibilidad al reservar.
- `CONTACTIA_PANEL_V2=1` activa las respuestas ampliadas solo en Preview. El panel y esta rama no se fusionan a producción.
- Si Redis falla tras guardar, el panel diferencia el dato guardado de la memoria pendiente y permite sincronizar sin repetir el PATCH. Las copias previas pueden seguir respondiendo hasta la sincronización/expiración: nunca mostrar éxito falso.

## Esquema Sandbox

En RESTAURANTES se han añadido `web` (texto) e `informacion_publica` (texto largo JSON). No se han alterado datos operativos ni credenciales con esta ampliación.

## Verificación

Pruebas automatizadas de sesión/origen/producción, validación de URLs y horarios, conflictos de edición, guardado limitado a campos públicos, respuestas con memoria e invalidación inmediata, fallo Redis/reintento, aislamiento de reservas afectadas y lectura fresca de horarios.

## Horario habitual y excepciones (octubre 2026)

El editor presenta una base habitual, casillas de cierre semanal, horarios distintos por día opcionales y dos líneas iniciales de fechas especiales con botón para añadir más. Al abrir datos antiguos se infiere como base el horario más repetido; no se escribe nada hasta guardar y se conservan las diferencias semanales y cierres existentes.

La tabla semanal compatible se conserva en `horario_reservas`. La misma columna incluye `_contactia: { habitual, especiales }`; no se añaden columnas ni tablas. Cada fecha especial tiene `{ fecha, rangos }`: `MM-DD` para cada año, `AAAA-MM-DD` para un año, y una lista vacía para cerrado. Prioridad: fecha con año, cierre antiguo con fecha, fecha anual y calendario semanal. Las fechas especiales del restaurante se aplican también al horario de zonas; sus estados de cierre operativo siguen vigentes. No altera reservas existentes; el aviso previo considera el nuevo calendario.

El motor de reservas y las alternativas usan las franjas efectivas de la fecha solicitada. Las respuestas informativas agrupan días con horarios iguales y resuelven una fecha concreta, hoy/mañana y días de semana en Europe/Madrid. Las respuestas siguen consultando datos frescos; no cachean los cierres. El horario descrito es el de aceptación de reservas; no se crea un horario comercial independiente.

La captura de nuevas reservas consulta `validar_fecha` al reconocer el día, antes de preguntar por personas u hora. Solo lee RESTAURANTES, aplica cierres semanales y especiales y no comprueba ni promete mesas. Una marca local de la captura evita repetir esa lectura al completar los datos del mismo día; la verificación de disponibilidad y la creación definitiva vuelven a comprobar el calendario actual. Un fallo de consulta pide repetir la fecha. No se pide una zona para descartar un cierre general.

## Zonas de reserva (detección automática, Preview)

En Ajustes aparece el apartado **06. Zonas de reserva**. Muestra si
hay una única zona activa, varias o todas cerradas, tomando los datos
que ya devolvió la carga de agenda (`/api/restaurante`). Cerrar/reabrir
una zona y actualizar la agenda recalcula el estado sin nuevas consultas
específicas de este apartado. El enlace «Gestionar mesas y zonas» abre
la pestaña existente.

Por diseño **no se añade una casilla que almacene «zona única» en Airtable**:
sería un dato duplicado que podría contradecir los cierres reales. La
selección automática de una única zona activa ya funciona en la rama
Preview; esta tarjeta hace visible esa decisión al propietario.

No se modifica el esquema de Airtable, ni se crea una nueva función
Vercel, ni se guardan zonas operativas en Upstash. Al reservar,
`/api/chat` sigue consultando las zonas reales y comprobando mesas.
Una sesión sin datos cargados muestra «Se mostrará al cargar la agenda»
y un error de carga no se presenta como un estado verificado.
