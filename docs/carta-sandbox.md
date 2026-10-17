# Carta editable en Sandbox

Habilitada solo en Preview con `CONTACTIA_PANEL_V2=1`. Acceso: panel del restaurante → Carta, o Ajustes → Carta y bebidas. Utiliza la sesión firmada del propietario y el endpoint existente `/api/restaurante`; no añade una función serverless.

## Configuración

- Airtable Sandbox, tabla RESTAURANTES: campo de texto largo `carta_json`. Guarda un sobre con `borrador`, `publicada` y `publicada_en`.
- `OPENAI_API_KEY` en el entorno Preview de la rama `corregir-bateria-pruebas`, seguido de un nuevo despliegue. Sin esta variable, el editor manual funciona y la lectura automática informa de que está pendiente de activación.
- Modelo predeterminado: `gpt-5.4-mini`; se puede cambiar con `CONTACTIA_CARTA_MODEL` por otro compatible con PDF e información estructurada en Responses.
- Redis/Upstash existente: limita la importación a una por restaurante/base/rama cada tres minutos. La importación falla si esta protección no está disponible.
- La importación envía el PDF a OpenAI únicamente al pulsar Importar. Usa Responses con `store:false`, esquema JSON estricto, sin herramientas y un tiempo máximo de 150 segundos. La función tiene 180 segundos. No se almacena el PDF original en Airtable: se guardan nombre, huella y número de páginas; el enlace de vista previa sirve para el archivo seleccionado en la sesión del navegador.

## Flujo

1. PDF real de hasta 2,5 MB y entre 1 y 12 páginas. Admite documentos escaneados porque envía el propio PDF al lector visual.
2. El resultado es una propuesta: conserva categorías, condiciones, precios, unidades y referencias de página. Las referencias de página dudosas quedan pendientes de comprobar y se avisa al propietario, conservando los platos. Si aparece una referencia imposible para el archivo, se descartan todas las referencias de página de esa lectura sin cambiar nombres ni precios; no se calcula un desplazamiento a partir de los números impresos. No se guarda ni publica hasta que el propietario acepte el borrador y lo guarde.
3. Todos los platos importados quedan pendientes de revisión y todos los alérgenos sin confirmar. Los símbolos sin leyenda inequívoca no se interpretan como alérgenos conocidos.
4. El editor admite hasta 30 categorías y 150 platos/bebidas, con un máximo de 40.000 caracteres por versión. Incluye disponibilidad y listas separadas de alérgenos y trazas, con icono y nombre.
5. Guardar borrador conserva la publicación anterior. Publicar exige revisión de todos los platos y una confirmación con el recuento de cambios. Se seleccionan los alérgenos y trazas por plato, sin casillas adicionales de confirmación. Una modificación manual de estas listas con algún valor seleccionado marca la información como declarada por el propietario; una selección vacía queda pendiente. La importación no confirma listas automáticamente.
6. Cambiar nombre o descripción deja los alérgenos pendientes hasta volver a ajustar su selección; cualquier edición de un plato invalida su revisión. Cambiar condiciones de categoría invalida la revisión de sus platos.
7. La revisión utiliza una huella para detectar cambios de otra sesión antes del guardado. Airtable no ofrece una transacción de comparación y escritura: no abrir dos editores para guardar simultáneamente.
8. Publicar, retirar o sincronizar actualiza la copia pública del restaurante y rama. Un fallo de Redis conserva el guardado y muestra un aviso con el botón para reintentar; mientras tanto una copia antigua podría seguir sirviendo respuestas hasta actualizarse o caducar (24 horas).

## Respuestas

El endpoint de información responde de forma determinista desde la versión publicada: categorías, platos, precio/unidad, disponibilidad y condiciones. No envía cada pregunta al lector ni utiliza el borrador. Las coincidencias ambiguas solicitan concretar. No recomienda platos seguros para una alergia. Alérgenos pendientes se eliminan de la copia pública; una lista vacía no se presenta como garantía de ausencia ni de falta de contacto cruzado.

## Verificación

Pruebas automáticas del modelo, validación PDF y respuestas del proveedor simuladas; flujo API con sesión, origen, aislamiento de restaurantes, borrador/publicación, conflictos de revisión, retirada y recuperación de memoria. Comprobación funcional del editor en DOM con alta, edición, revisión y publicación. El PDF de ejemplo `Carta.pdf` pasa la validación: 5 páginas y 893.300 bytes. La transcripción real requiere activar la clave en esta rama y comprobar el borrador resultante; no se ha ejecutado sin esa configuración.
