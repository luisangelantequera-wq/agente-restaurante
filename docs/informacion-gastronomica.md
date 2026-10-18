# Información gastronómica

Ajustes del restaurante → **05 Información gastronómica** permite guardar hasta 1.000 caracteres con especialidades y condiciones de servicio. Se recomienda una especialidad por línea, por ejemplo un cocido los miércoles o paella los jueves con encargo y mínimo de dos personas. Los ejemplos se muestran aparte del campo y nunca se guardan automáticamente.

Se utiliza el editor de ajustes y su sesión de propietario, revisión de cambios de otra sesión y protección de origen existentes. El contenido se almacena en RESTAURANTES.informacion_publica, clave `gastronomia`, sin crear tablas ni campos nuevos. Su editor independiente solo modifica esa clave; conserva las demás respuestas, dirección, web y horarios. El editor general conserva este contenido en un campo interno oculto y detecta revisiones obsoletas. Guardar vacío retira la información.

El guardado actualiza la memoria pública del restaurante/base/rama. Si falla esa actualización, se informa y se puede reintentar sin escribir de nuevo. Las preguntas utilizan únicamente la información guardada; no llaman a OpenAI ni importan documentos. Las coincidencias de especialidad o día devuelven las líneas del propietario conservando todas sus condiciones. Las preguntas de apertura siguen consultando el calendario; una pregunta como «¿Qué días tenéis cocido?» se responde con la especialidad y no con el horario general. No se confirma un encargo, disponibilidad, ingredientes ni aptitud para alergias o dietas a partir de estas notas.

La carta completa queda aparcada: sin navegación ni editor, ni respuestas basadas en sus platos y alérgenos. Los datos preparados anteriormente se conservan. Su servidor solo puede reactivarse expresamente con `CONTACTIA_CARTA_ACTIVA=1`; la interfaz necesitaría además restaurar su acceso. Producción queda fuera del alcance de estos cambios de Sandbox.

Verificación: modelo y API con guardado, consulta inmediata, condiciones, borrado, conservación de otras respuestas, conflictos de revisión, origen/sesión y recuperación de memoria. La carta desactivada no sirve datos publicados. Comprobación funcional del formulario y de los ejemplos sin valores preestablecidos.
