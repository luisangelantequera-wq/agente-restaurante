# Envío correlacionado de WhatsApp en Preview

Etapa preparada el 1 de octubre de 2026. El módulo no está conectado a una API de envío ni al programador. No se han activado banderas, enviado mensajes reales o modificado producción.

## Comportamiento

- Comprueba que la reserva está confirmada, es futura en Europe/Madrid, tiene consentimiento y un fallo de correo que permite pasar a WhatsApp.
- Comprueba nuevamente la reserva en Airtable antes de inicializar el contacto y después de adquirir el control exclusivo de envío.
- Un control Redis por reserva impide que dos solicitudes simultáneas envíen el mismo mensaje. Conserva el plazo original de siete días; no lo renueva al guardar el resultado.
- Una respuesta aceptada del proveedor se vincula con la reserva y su huella privada. Aceptación no significa entrega: la entrega requiere el callback firmado.
- Ante un timeout, rechazo o resultado ambiguo no reintenta automáticamente. Si el proveedor aceptó y se guardó su SID, `recuperar` puede restaurar el seguimiento sin enviar otro mensaje.
- Los registros operativos Redis omiten teléfono, correo y contenido del mensaje.

## Activación

`desdeEntorno` exige `VERCEL_ENV=preview` y las cinco banderas a `1`: `CONTACTIA_WHATSAPP_CONFIRMACION_HABILITADA`, `CONTACTIA_WHATSAPP_LECTURA_RESERVA_HABILITADA`, `CONTACTIA_WHATSAPP_CONTACTO_REDIS_HABILITADO`, `CONTACTIA_WHATSAPP_CALLBACK_HABILITADO` y `CONTACTIA_WHATSAPP_ENVIO_CORRELACIONADO_HABILITADO`. También exige la configuración previa del lector, Redis, plantilla aprobada y callback HTTPS. Esta etapa no cambia esas variables.

## Validación y límites

420 pruebas locales pasan. La prueba integrada simula lector de reservas, Redis y proveedor: envío único, registro del SID y callback firmado que resuelve el contacto. Incluye concurrencia, fallos de persistencia, recuperación sin reenvío, cambios de reserva y reservas pasadas. No acredita entrega real de Twilio ni acceso externo al callback de Vercel.

El control contra duplicados caduca a los siete días. Tras su caducidad no garantiza impedir un nuevo intento; un futuro invocador debe conservar un historial duradero o limitar la ventana de envío. No debe conectar este módulo a un barrido recurrente sin resolverlo.

La última lectura de Airtable y la petición al proveedor no son una transacción; una modificación posterior a la lectura sigue siendo una carrera posible. Si el callback llega antes de guardar el SID, se necesita recuperación explícita: no se presupone que Twilio lo reintentará. Si fallan tanto la persistencia del resultado como la del seguimiento, queda pendiente revisión manual.

Quedan pendientes el invocador controlado, comprobar que Twilio puede acceder al callback con la protección actual de Preview, y mostrar el seguimiento en el centro de conversaciones antes de una prueba real autorizada.

## Revisión privada sin envío

La acción JSON `whatsapp_confirmacion_revisar`, con `reserva_id`, está disponible en `/api/centro-conversaciones` únicamente en Preview y tras validar la sesión administrativa existente. No permite envío ni recuperación que escriba datos. La inspección usa exclusivamente el lector de reservas y operaciones `GET` de los almacenes de control y contacto. No incorpora botón en la interfaz en esta etapa.

Para consultar requiere las tres banderas de confirmación, lectura y contacto Redis. No necesita activar la bandera de envío. Con las banderas apagadas no construye servicios ni consulta Airtable o Redis. Una referencia candidata devuelve `requiere_validacion_final`, `envio_autorizado:false`, `mensajes_enviados:0` y `escrituras:0`. No acredita fecha futura, plantilla aprobada, disponibilidad del proveedor ni acceso al callback; esas comprobaciones siguen pendientes antes de ejecutar. Un intento anterior o un cambio de huella exige revisión y no permite deducir entrega.

El 1 de octubre de 2026 la consulta de configuración de Vercel confirmó `ssoProtection.enabled:true` y `deploymentType:all_except_custom_domains`. No se cambió esa protección. El acceso de Twilio al callback todavía no está verificado.

Tras añadir esta inspección, 427 pruebas locales pasan. Se prueban sesión obligatoria, bloqueo en producción y con banderas apagadas, reservas no elegibles, intentos previos, contactos ya resueltos y ausencia de datos privados en las respuestas. Se actualiza también el diagnóstico manual del lector para admitir el nuevo campo de resumen `whatsapp_contacto_pendiente`; no se ejecutó contra Airtable real.

## Acceso de automatización al callback

`lib/url-callback-whatsapp.js` construye una única URL compartida por el proveedor y la validación de firmas. La nueva bandera `CONTACTIA_WHATSAPP_CALLBACK_BYPASS_HABILITADO=1` añade el secreto del sistema `VERCEL_AUTOMATION_BYPASS_SECRET` como parámetro `x-vercel-protection-bypass`. Se mantiene en `TWILIO_WHATSAPP_STATUS_CALLBACK_URL` la URL base sin consultas: `https://agente-restaurante-git-prototipo-voz-reservas-projects-46f41d07.vercel.app/api/whatsapp-resultado`.

El modo de automatización está restringido por código a Preview, ese hostname y esa ruta exacta, sin puertos, credenciales, fragmentos ni consultas previas. La URL completa, incluyendo el secreto, se usa tanto en `StatusCallback` como al comprobar la firma oficial de Twilio. No se reconstruye a partir de cabeceras entrantes. Una firma falsa se rechaza antes de acceder a reservas o Redis.

Vercel ya muestra un secreto de automatización configurado como variable de sistema. No se ha mostrado, regenerado o copiado al repositorio. Esta etapa añade soporte; la nueva bandera no se ha activado todavía. 431 pruebas locales pasan, con secretos ficticios. No se ha realizado una prueba externa con ese secreto ni enviado WhatsApp.

La activación supone que, al enviar un mensaje, Twilio recibirá el secreto en la URL del callback. El secreto de Vercel tiene alcance de proyecto, no está limitado por Vercel a esta ruta; la restricción de ruta y host está en nuestro código. No imprimir ni compartir la URL completa, el formulario del proveedor o sus credenciales. La bandera de envío y las restantes barreras siguen siendo independientes. Falta comprobar el acceso externo tras autorizar la configuración; superar la protección de Vercel por sí solo no acredita procesamiento del callback ni entrega real.
