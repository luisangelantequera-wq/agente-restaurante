# Actualización de datos estables desde el panel de Contactia

## Alcance: primera fase

La rama `panel-sincronizar-cache-publica` añade un editor de **nombre y teléfonos del restaurante** dentro de `restaurante.html`. Los datos tienen origen en Airtable y, después de guardarse correctamente allí, Contactia actualiza las copias públicas de Upstash del mismo restaurante. Se evita esperar el vencimiento de la caché de 24 horas.

**No se modifican** en esta fase la dirección (el campo exacto no se ha confirmado), los horarios, los cierres especiales por fecha, las zonas ni las mesas desde este editor. El cierre y reapertura de zonas/mesas siguen usando el diálogo ya existente.

## Flujo de guardado

1. El propietario abre el panel (con sesión autenticada) y pulsa **Datos del restaurante**. Solo entonces se hace una lectura real de la tabla `RESTAURANTES` para cargar su nombre y teléfonos.
2. El servidor devuelve también una huella SHA-256 de los tres campos. Si han cambiado desde que se abrió el editor, el guardado devuelve **409** y pide recargar antes de modificar.
3. El propietario modifica nombre o teléfonos y pulsa **Guardar y actualizar memoria**.
4. El servidor valida el origen HTTP, la cookie firmada de sesión, el restaurante y los límites de campos; lee la versión actual de Airtable y, si cambió, escribe **solo nombre, telefono1 y telefono2** con PATCH.
5. Únicamente después de confirmar el PATCH de Airtable, el servidor sobrescribe **en una sola operación Redis EVAL** las claves separadas de ficha pública y teléfonos. Se restablece el TTL de 24 h desde ese momento.
6. Las visitas siguientes a `/api/restaurante-publico` y las preguntas de `/api/informacion-restaurante` ven inmediatamente la nueva copia. No hay invalidaciones mediante consultas programadas ni sondeo.
7. Si Upstash falla tras el PATCH, el panel diferencia **“Airtable guardado, memoria pendiente”** y habilita el botón **Reintentar sincronización**, que vuelve a consultar Airtable y actualiza Redis sin repetir el PATCH.
8. Si no hay ningún cambio de campos, el PATCH se omite por completo.

## Seguridad y límites

- Las acciones `datos_consultar`, `datos_guardar` y `datos_sincronizar` de `/api/restaurante` solo funcionan en **Preview**, con petición POST del **mismo origen HTTPS**, cookie firmada de sesión válida y validación de entrada.
- No se envía ni almacena en Redis la clave privada del restaurante, la contraseña del panel, datos de clientes, reservas ni información de ocupación.
- Cada restaurante, rama y base de Airtable mantiene claves separadas de caché.
- **La activación de caché sigue siendo opt-in** con `CONTACTIA_CACHE_PUBLICA=1` y las variables Upstash. Sin ella, el editor permite guardar en Airtable pero indica que la memoria experimental no está activa.
- La huella reduce sobrescrituras accidentales entre ediciones **sucesivas**, pero no es una transacción de Airtable entre dos editores simultáneos: hace falta un bloqueo o control de versión a nivel de almacenamiento para garantizar que dos escrituras concurrentes no se pisen.
- Si Upstash falla mientras contiene una copia anterior, las páginas públicas pueden utilizar información antigua hasta que Redis se recupere y se pulse **Reintentar sincronización** (o caduque esa copia); el panel muestra un aviso y **no** indica que la memoria esté al día.
- Los cierres de zonas, mesas y el estado de reservas **nunca** se toman de la caché compartida; siguen consultándose al verificar y antes de confirmar.
- El diálogo de `Cierre de zonas/mesas` ya detecta reservas afectadas y pide confirmación, y no las cancela. El cierre actualmente es **hasta reapertura**, no un cierre fechado exclusivamente para mañana. Los cierres excepcionales por fechas deberán añadirse por separado.
- El botón existente **Actualizar** de la agenda no guarda ni sincroniza estos datos estables, solo refresca las reservas del día; es una función distinta.

## Ahorro de peticiones

- Abrir el editor: una lectura de `RESTAURANTES`.
- Guardar una modificación: una lectura nueva para evitar datos obsoletos y, si hay cambios, un PATCH.
- Sincronizar la memoria: una sola operación Redis que escribe ambas claves sin hacer lecturas adicionales de Airtable, una vez que se conoce el registro guardado.
- Visitantes posteriores dentro de las 24 h: para identidad y teléfonos, leen la caché pública sin nuevas consultas a Airtable.
- Las zonas operativas, horarios y reservas continúan con consultas frescas, junto con las optimizaciones por petición de las ramas previas.

## Verificaciones

- 8 pruebas simuladas del nuevo servidor: autenticación, protección de origen, guardado sin repetir escrituras, huella de edición, actualización atómica de dos claves, fallo Redis + reintento, aislamiento de producción y prohibición de editar campos privados.
- Prueba de integración simulada con `/api/restaurante-publico`: el nombre cambia inmediatamente después de guardar, mientras que una terraza cerrada queda excluida en la consulta siguiente.
- No se ha contactado con Airtable ni Upstash reales; falta `npm test` completo en Node y las pruebas de Preview con la base de ensayos cuando se restablezca la cuota.

## Activación futura

Una vez validada la aplicación con la base aislada de pruebas, establecer `CONTACTIA_CACHE_PUBLICA=1` **exclusivamente** en la rama Preview correspondiente y ejecutar pruebas controladas con el contador. No fusionar a `main`, `prototipo-voz` ni ramas de Alondra antes de probar el circuito completo.

## Compatibilidad con Vercel Hobby

La primera implementación de esta mejora añadía la función `api/datos-restaurante.js`, pero Vercel rechazó el despliegue al superar el límite de **12 Serverless Functions** del plan Hobby. La versión corregida traslada la lógica a `lib/datos-restaurante-panel.js` y la conecta con el endpoint existente `api/restaurante.js` mediante acciones exclusivas `datos_consultar`, `datos_guardar` y `datos_sincronizar`. El cliente web utiliza `/api/restaurante`. La ruta extra se ha eliminado; la versión actual de Preview vuelve a desplegar correctamente.
