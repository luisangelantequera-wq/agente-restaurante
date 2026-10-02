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

## Activación autorizada y comprobación externa del 1 de octubre

El usuario autorizó expresamente el acceso de automatización. La comprobación a las 21:40 Europe/Madrid confirmó que las seis variables de callback se habían guardado como Config únicamente en Preview y con rama `prototipo-voz`: bypass, URL base y las cuatro banderas de recepción, lectura y contacto. Todos los valores de bandera son `1`; la URL base no contiene el secreto. No se añadió ni activó `CONTACTIA_WHATSAPP_ENVIO_CORRELACIONADO_HABILITADO`.

Se redesplegó el commit `d7bb62e22739714ad8f9540ee3fa83c6a8db58f8` como Preview, sin promoverlo a producción. Despliegue `dpl_7ee3FgJYmg1TZEsfhmQ7B9dJAW6R`, estado READY. La protección general de acceso y las reglas del firewall permanecen activas.

Prueba externa mediante POST de un formulario ficticio con firma inválida, sin sesiones de navegador ni envíos a Twilio:

| Solicitud | Respuesta observada |
| --- | --- |
| Sin secreto de automatización | HTTP 302; redirección al acceso de Vercel |
| Con secreto existente en el parámetro de automatización | HTTP 403; texto `Forbidden`, cabecera `X-Vercel-Mitigated: deny` |

El segundo rechazo no es la respuesta JSON de la validación de firma de Contactia. Por tanto, el acceso externo al callback sigue pendiente: se observa una denegación de la capa de seguridad de Vercel. El panel muestra Bot Protection y mitigaciones del sistema activas; no se ha atribuido el rechazo a una regla concreta ni se ha alterado el firewall para sortearlo. Estas pruebas no demuestran que una solicitud originada por Twilio reciba el mismo tratamiento, ni acreditan una entrega real.

Mensajes enviados: cero. No se consultaron ni modificaron reservas en estas pruebas. El secreto no se ha guardado en el repositorio ni mostrado en resultados; la copia temporal usada para la comprobación se eliminó. Próximo paso: identificar el bloqueo del firewall y preparar, si procede, un acceso limitado al callback antes de una prueba real autorizada.
# Comprobación desde Windows y adaptación al runtime (01/10/2026)

El usuario confirmó posteriormente 403 «Aviso no validado» con firma falsa y 503 «Seguimiento pendiente de correlación» con firma válida generada localmente y SID ficticio. Ambas verificaciones manuales pasaron. No constituyen todavía una entrega real desde Twilio.

La página administrativa de prueba permite ahora enviar la plantilla ficticia existente con StatusCallback y consultar su seguimiento separado en Redis. Requiere sesión, Preview, las banderas del callback y configuración válida; mantiene destino fijo del entorno y exclusión atómica de envíos. Un aviso firmado solo actualiza una prueba si su SID está registrado en ese espacio separado: no accede a Airtable ni modifica reservas. Estado aceptado no acredita entrega; «delivered» o «read» recibidos en callback válido sí. Los datos de prueba caducan en 24 horas. Se añade el botón «Comprobar entrega», sin reenviar ni consultar el proveedor. Si un callback llega antes de registrar el SID, queda pendiente de correlación; no se presume entrega ni se repite el mensaje. La plantilla propia de confirmación sigue pendiente de configurar y no se ha habilitado el envío correlacionado automático.

Las dos pruebas externas de este entorno fueron denegadas por la regla AI Bots de Vercel (ruta y cliente Python confirmados en Firewall/Traffic). La prueba manual del usuario desde Windows llegó a Contactia y devolvió 400 «Se requiere el cuerpo original». Esto no demuestra aún entrega real de Twilio.

La ruta admite ahora formularios decodificados por el runtime Node de Vercel, con valores exclusivamente de texto; rechaza arrays, objetos anidados y cuerpos excesivos. Conserva todos los parámetros, incluidos campos futuros, y valida la firma oficial de Twilio con la URL completa antes de componer servicios. También admite el formulario textual y el stream original. No añade envíos ni habilita la bandera de envío correlacionado. Pasan 433 pruebas locales; pendiente repetir la prueba manual tras el despliegue: la firma falsa debe recibir 403 «Aviso no validado».


## Entrega real comprobada el 2 de octubre de 2026

El usuario confirmó la recepción en su teléfono del recordatorio ficticio en inglés enviado manualmente desde la página de prueba. La página mostró «Entrega confirmada por el aviso firmado de Twilio». Esto acredita el envío manual y la recepción de un callback firmado correlacionado con la prueba aislada. No acredita una confirmación de reserva real, la aprobación de una plantilla propia ni el funcionamiento fuera de la ventana de atención de 24 horas.

El intento anterior del 1 de octubre terminó en `undelivered`, código `63016`. Tras escribir «Hola» al remitente de prueba y repetir manualmente la prueba al día siguiente, el mensaje llegó. La hora `3:00 PM` pertenece a la cita ficticia incluida en la plantilla; no es la hora del envío ni revela un error de zona horaria de Contactia.

## Plantilla española preparada, pendiente de alta y aprobación

La propuesta `contactia_confirmacion_reserva_es` conserva exactamente el texto y las seis variables de `lib/confirmacion-whatsapp.js`. El archivo `config/plantilla-whatsapp-confirmacion-es.json` es un borrador para Content API, con ejemplos ficticios, no un SID aprobado. Se propone solicitar la categoría `UTILITY`; la decisión de categoría y aprobación corresponde a Meta.

Para utilizar una plantilla personalizada se requiere un remitente WhatsApp registrado. La documentación de Twilio indica que el Sandbox solo permite sus plantillas preaprobadas; el flujo Try out WhatsApp también utiliza plantillas de prueba. Self Sign-up exige una cuenta Twilio actualizada y acceso administrador al portfolio empresarial de Meta. Antes de continuar debe comprobarse el estado real de la cuenta y elegirse el número que actuará como remitente. El teléfono destinatario de las pruebas no se convierte automáticamente en remitente.

Después del registro se podrá crear la plantilla, solicitar su aprobación y configurar su Content SID en `TWILIO_WHATSAPP_CONFIRMACION_CONTENT_SID` para Preview/rama `prototipo-voz`. La plantilla inglesa de prueba no debe reutilizarse como plantilla de confirmación. El borrador no se ha enviado a Twilio ni habilita envíos automáticos.

Fuentes oficiales revisadas el 02/10/2026:
- https://www.twilio.com/docs/whatsapp/sandbox
- https://www.twilio.com/docs/whatsapp/quickstart
- https://www.twilio.com/docs/whatsapp/self-sign-up
- https://www.twilio.com/docs/content/create-templates-with-the-content-template-builder
