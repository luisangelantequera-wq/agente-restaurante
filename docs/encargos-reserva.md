# Platos por encargo durante la reserva (Sandbox)

En Ajustes → 05 Información gastronómica se mantiene el texto informativo y se añade «Preguntar al hacer una reserva». El propietario puede añadir hasta diez grupos y quince platos por grupo (hasta 6.000 caracteres de configuración), escribir cada plato en una línea, marcar de lunes a domingo, fijar un mínimo por plato y una antelación entera en horas desde 1. También puede personalizar la pregunta y desactivar un grupo sin borrarlo.

Las reglas se guardan bajo `encargos` en el JSON existente de RESTAURANTES.informacion_publica; los demás ajustes se conservan. No se rellenan platos ni días automáticamente. El editor informa del resultado del guardado en su pie fijo.

La respuesta de disponibilidad incluye los grupos elegibles usando el restaurante ya leído: no añade una consulta de Airtable para preguntar por ellos. Se aplican fecha, hora, zona disponible, día de servicio, personas y antelación. La antelación se calcula en horas transcurridas para Europe/Madrid, incluidos cambios de horario. En una hora local inexistente no se ofrecen encargos; para una hora repetida se toma la primera aparición como criterio conservador.

Después de comprobar la disponibilidad y antes de pedir los datos de contacto, el asistente permite elegir plato por nombre o número, preguntar para cuántas personas y añadir otro plato del mismo grupo si quedan comensales. «No, gracias» continúa sin encargo. Los mínimos se aplican a cada plato y la suma del grupo no puede superar las personas de la reserva. La elección aparece en la confirmación visual y hablada. Una reverificación idéntica conserva la elección; un cambio de datos o condiciones exige revisarla. Si la antelación vence, se informa y se vuelve a revisar antes de crear la reserva, sin quitar el encargo silenciosamente.

El servidor comprueba otra vez los nombres, cantidades, grupo, día y antelación, al recibir el alta y justo antes de escribirla. Nunca confía en nombres de grupo ni otras condiciones enviadas por el navegador. Se conservan las observaciones por separado y se añaden los platos a los correos del cliente y del restaurante.

Airtable Sandbox, RESERVAS: campo de texto largo `encargo_json` (`fldMHUrMDrWZh7AYM`), creado en `tbldeANM8cJka2nUT` de `appNFqY50AnEiDdPq`. Guarda versión, platos, cantidades y marca de visto. No contiene más datos de identidad. Las reservas anteriores sin este campo se muestran como antes.

La agenda muestra una franja destacada «ENCARGO · plato: N personas» separada de las observaciones. Hasta que el restaurante pulse «Marcar como visto» permanece resaltada. La marca se guarda en Airtable, con revisión para evitar reconocer una versión obsoleta, sesión de propietario, control de origen y pertenencia de la reserva. Las reservas canceladas lo indican en el propio aviso. Una modificación válida de fecha, hora o personas conserva el encargo y vuelve a dejarlo pendiente de ver; un cambio que incumpla sus condiciones se rechaza para revisión con el restaurante. Cambiar o retirar los platos de una reserva existente no dispone todavía de editor propio; esta versión recoge los encargos al crear la reserva.

Habilitado solo en Preview con CONTACTIA_PANEL_V2=1. Sin grupos configurados no se pregunta ni se escriben encargos. Producción no se despliega ni modifica. No se han enviado mensajes ni creado reservas reales para verificarlo.

Verificación: reglas, cantidades, límites y cambio de hora; conversación completa con encargo y sin él; API de alta, persistencia, agenda, correos simulados y visto con controles de acceso; conservación de grupos al editar otros ajustes; formulario y agenda en DOM con siete tipos de arroz y marcado de visto.
