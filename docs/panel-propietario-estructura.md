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
