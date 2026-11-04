# Voz LiveKit y Supabase

## Estado actual: cierre por voz sin botón final (25/10/2026)

La llamada de prueba de Preview ya procesa cada turno en el servidor y registra
la reserva tras el sí al resumen final. Comunica el resultado por voz, apaga el
micrófono al confirmar y espera a que termine la locución antes de desconectar.
El correo y su lista de destinatarios permitidos conservan sus reglas. WhatsApp
incorpora autorización opcional en voz cuando se habilita el circuito de pruebas;
el respaldo se gestiona desde el panel (véase la ampliación al final). El canal escrito mantiene Turnstile y
«Verificar y confirmar».

La página web de pruebas conserva el control inicial para conectar el micrófono;
no pide otra verificación al cerrar la reserva por voz. El worker Cloud existente
sirve sin actualizarlo: su RPC es ahora un transporte hacia el motor en servidor.
El enlace a un número telefónico/SIP todavía no está habilitado. Al incorporarlo,
se deberá sustituir ese transporte por una conexión autenticada del worker; el
motor y el cierre ya no necesitan decisiones de un navegador.

Las secciones siguientes documentan también etapas anteriores de la integración.

`chat-prueba.html?restaurante=prueba-sol` incorpora una llamada web mediante LiveKit y el mismo motor de conversación que el texto. La conexión está preparada en `migracion-supabase-fase-1`; la prueba real necesita credenciales en esa rama y arrancar el worker existente. No se habilitan SIP o telefonía ni se cambia producción.

## Reutilización

Se recuperó inicialmente `experimentos/livekit/agent.py` sin modificar de `prueba-livekit-cartesia` (HEAD consultado `9df8a97`). Es el worker ejecutado en Windows durante la prueba del 11 de octubre. Conserva el despacho `contactia-cartesia-prueba`. Aunque su nombre histórico dice Cartesia, el código recuperado usa Deepgram Nova-3, GPT-4.1 mini y Rime Coda con voz `lark` (Alondra), mediante LiveKit Inference. La revisión del 25/10 sustituye únicamente TTS por Cartesia Sonic 3, Daniela (`5c5ad5e7-1020-476b-8b91-fdcbe9cc313c`), para resolver el rechazo explícito `REGION_RESTRICTED` en EU.

El worker llama por RPC a `contactia.procesar_turno` en el navegador. La nueva interfaz dirige esa llamada al chat de Supabase, con su calendario, información pública y disponibilidad. No utiliza Airtable ni el prototipo anterior de OpenAI Realtime. Se conservan `record=False`, las métricas numéricas y la ausencia de archivos de audio o transcripciones. No se añade almacenamiento de conversaciones en el navegador.

## Configuración para la prueba real

Variables solo en **Preview, rama `migracion-supabase-fase-1`**:

- `CONTACTIA_SUPABASE_VOICE_ENABLED=1`.
- `LIVEKIT_URL`: la URL `wss://…livekit.cloud` del proyecto de pruebas.
- `LIVEKIT_API_KEY` y `LIVEKIT_API_SECRET`: credenciales del mismo proyecto que utiliza el worker. Guardarlas directamente en Vercel como sensibles, sin enviarlas por chat o subirlas a Git.

Las credenciales existentes están restringidas a la rama antigua: no se leen ni se amplía su alcance. Deben configurarse para la nueva Preview y después redesplegar. El botón solo aparece con el interruptor y las tres variables válidos. No hacen falta claves propias de Deepgram, OpenAI o Rime.

El worker probado está en Windows, bajo `Downloads\agente-restaurante-prueba-livekit-cartesia\agente-restaurante-prueba-livekit-cartesia\experimentos\livekit`. Con su entorno y `.env.local` ya preparados, ejecutar en esa carpeta:

```powershell
.\.venv\Scripts\python.exe agent.py dev
```

La copia local original puede atender la página nueva sin cambiar su código; conserva la voz Rime. La revisión Cloud usa Cartesia compatible con EU. Vercel no ejecuta ese Python. Para una copia nueva del worker, instalar antes sus requisitos y configurar las credenciales como en la prueba original.

## Acceso y transporte

`supabase_voz_sesion` reutiliza Preview/rama, origen, hostname, JSON, IP y límite de cinco escrituras por minuto/IP. Exige Turnstile con `action=iniciar_voz` y UUID propio en `cData`. La confirmación de reserva conserva otra verificación con `action=reservar` y su UUID de operación.

El JWT firmado en servidor dura seis minutos y permite unirse a una sola sala privada, publicar micrófono, suscribirse y enviar datos. No da acceso a cámara, administración de salas, SIP o secretos. Sala e identidad derivan del UUID con HMAC; el navegador no puede elegirlas ni cambiar el agente. La CSP permite conexiones a LiveKit Cloud. `livekit-client@2.17.2` se sirve localmente: `postinstall` copia su UMD y licencia a `vendor/` desde la versión del lockfile.

## Conversación y cierre

La RPC se registra antes de conectar y acepta llamadas solo de participantes agente. Conserva resultados por `requestId` y serializa turnos para evitar duplicados. Conectar o hablar no crea una reserva. Al detener el micrófono se puede continuar por texto con los datos conservados.

En el paso final se apaga el micrófono, se indica revisar el resumen y se cierra la conexión. Solo «Verificar y confirmar», con una verificación nueva, registra la reserva. También se cierra al pulsar Detener, salir de la página, alcanzar cinco minutos o pasar 90 segundos sin conversación. Si no aparece agente en 20 segundos, se ofrece continuar por escrito. Se detienen las pistas de audio al cerrar, incluso durante un arranque interrumpido.

## Validación

`test/voz-supabase.test.js`: firma y permisos JWT, rama, configuración, origen, cuotas, validación y separación de acciones Turnstile. `test/voz-supabase-interfaz.test.js`: worker simulado, consulta informativa, deduplicación RPC, recorrido al resumen, apagado del micrófono y creación únicamente con el botón final. El worker se comprueba sintácticamente.

El 24/10/2026 el usuario completó una conversación real con el worker de Windows y el chat Supabase, incluida la pregunta del cocido y la vuelta a la reserva. La voz se oyó entrecortada; la causa no está diagnosticada (posible wifi). Correo, panel y disponibilidad ya se probaron y no requieren repetir sus ensayos por separado.

## Alojamiento del agente en LiveKit Cloud

Preparado para el proyecto de pruebas `contactia-pruebas-pg0dqjqp.livekit.cloud`.
El usuario construyó y desplegó la imagen el 24/10/2026: agente `CA_vkyHrJpZtdWT`, región `eu-central`, worker registrado correctamente. Desde la nube recibe la voz y responde en texto, pero no se oye audio. El recorrido completo sin worker local sigue pendiente. No se cambia
el nombre de despacho ni se despliega el sitio a producción.

En `experimentos/livekit/`:

- `Dockerfile`: Python 3.12 en Debian, usuario sin privilegios y arranque
  `python agent.py start`. Solo copia el agente y las dependencias.
- `requirements-cloud.in`: fija LiveKit Agents 1.8.6 y transporte 1.1.20,
  observados en el registro de la llamada; fija además las dependencias que diferían de la instalación local probada (dotenv 1.2.4).
- `requirements-cloud.txt`: dependencias transitivas fijadas para Python 3.12.
  Se regeneran con `uv pip compile requirements-cloud.in --python-version 3.12
  --no-header --no-annotate -o requirements-cloud.txt` desde esta carpeta.
- `.dockerignore`: lista de archivos permitidos; excluye `.env*`, entornos
  virtuales, grabaciones, registros y configuración local.

El ordenador del usuario ya tiene LiveKit CLI autenticado. Antes del alta,
consultar `lk project list` (sin `--json`, que expone secretos) y la ayuda local
`lk agent create --help`. Elegir el proyecto cuya URL coincide exactamente con
la anterior. No pedir ni copiar claves al chat.

Usar una carpeta nueva para estos archivos, conservando intacta la copia local
probada. Una vez identificado el proyecto con `lk project set-default NOMBRE`,
asegurarse de incluir también `requirements.txt` para que el CLI detecte Python/pip. En una descarga mínima, crearlo con `Copy-Item requirements-cloud.txt requirements.txt`; después ejecutar `lk agent create --region eu-central`. LiveKit
generará `livekit.toml`: conservarlo localmente para futuras actualizaciones.
No importar `.env.local`: LiveKit Cloud inyecta sus tres credenciales de conexión;
los modelos usan Inference y este agente no necesita secretos de Supabase.

El destino por defecto del CLI se denomina `production`, pero pertenece al
proyecto LiveKit de pruebas; no promueve la web ni la base de producción.
No contratar un plan ni cambiar facturación automáticamente. Si el proyecto
rechaza el alta por cuota o plan, conservar el paquete y revisar ese mensaje.

Con el alta completada: consultar `lk agent status`; detener el worker local
con Ctrl+C para que la prueba se atienda en la nube; realizar una conversación
breve desde el mismo chat Preview. Solo después de confirmar este recorrido se
considerará eliminada la dependencia del ordenador. La voz entrecortada sigue
siendo una incidencia pendiente hasta volver a observarla.

Actualizaciones posteriores: `lk agent deploy` desde la carpeta que contiene
`livekit.toml`; diagnóstico: `lk agent status` y `lk agent logs` (pueden contener
datos operativos; compartir solo lo necesario). No borrar el agente como primer
recurso ante fallos; corregir o volver a una versión anterior.

Referencias verificadas el 24/10/2026:
- https://docs.livekit.io/deploy/agents/quickstart/
- https://docs.livekit.io/deploy/agents/builds/
- https://docs.livekit.io/deploy/admin/regions/agent-deployment/
- https://docs.livekit.io/reference/developer-tools/livekit-cli/projects/


## Diagnóstico del silencio en Cloud (24/10/2026)

El registro aportado muestra `failed to synthesize speech`, con
`ClientConnectionResetError: Cannot write to closing transport`. Hay turnos STT
y LLM completados. El error identifica un fallo en una operación TTS, pero por
sí solo no establece la causa de todo el silencio ni permite culpar al navegador.
Desactivar la restricción regional de Inference no recuperó el audio; esa
hipótesis no quedó confirmada. Se indicó volver a `Enabled`.

La lista de paquetes de Windows aportada por el usuario muestra once diferencias
respecto al primer lock de Cloud. Se igualan diez para una comparación controlada:

| Paquete | Primera imagen Cloud | Local probado y nuevo lock |
| --- | --- | --- |
| av | 19.0.2 | 19.0.1 |
| googleapis-common-protos | 1.76.0 | 1.75.5 |
| grpcio | 1.84.1 | 1.84.0 |
| jiter | 0.18.0 | 0.17.0 |
| livekit-api | 1.2.2 | 1.2.1 |
| livekit-blingfire | 1.2.0 | 1.1.0 |
| livekit-protocol | 1.1.28 | 1.1.27 |
| multidict | 7.2.0 | 7.1.0 |
| pycparser | 3.12 | 3.11 |
| python-dotenv | 1.2.1 | 1.2.4 |

Se conserva `certifi==2026.10.23` de la primera imagen en lugar del paquete
2026.7.22 de Windows para mantener actualizada la confianza de certificados.
La versión de pip es una herramienta de instalación; no se copia desde Windows.
No se modifica agente, modelo, voz, región ni interfaz en esta comparación.

Validación del nuevo lock: 70 paquetes instalados en un entorno Linux aislado, `uv pip check` correcto, `agent.py start --help` correcto y constructores STT/LLM/TTS comprobados sin red. No se ha generado audio real desde este entorno ni se ha desplegado esta revisión en Cloud.

Este cambio elimina diferencias conocidas; no se presenta como una reparación
confirmada. Hay que actualizar `requirements-cloud.txt` en la carpeta Cloud,
copiarlo también a `requirements.txt` y ejecutar `lk agent deploy` (no `create`)
con el `livekit.toml` existente. Conservar la primera versión en Git para poder
volver a desplegarla si fuera necesario. La siguiente prueba debe ser solo el
saludo o una pregunta breve, sin repetir una reserva completa.


## Causa confirmada y corrección EU (25/10/2026)

El detalle de Events aportado por el usuario confirma el código
`REGION_RESTRICTED`: `TTS model rime/coda is not available in the data region
serving this request (eu)`. Se reproduce el silencio en Agent Console, fuera del
chat de Contactia. El bloqueo está confirmado para esa solicitud; no se conoce
por qué el intento previo de cambiar el ajuste regional no alteró el resultado.
La alineación de dependencias no solucionó el silencio.

Se sustituye solo `inference.TTS` por `cartesia/sonic-3`, voz oficial Daniela,
`5c5ad5e7-1020-476b-8b91-fdcbe9cc313c`, idioma `es`. Es una voz femenina de español
mexicano y no pretende reproducir Alondra. Sonic 3 tiene endpoint EU según la
documentación oficial. No requiere una clave Cartesia adicional y se conserva
Inference region restriction en Enabled. El resto del motor, credenciales,
despacho, región de alojamiento y dependencias se mantienen.

La sintaxis y construcción de la configuración se verifican localmente sin
credenciales ni conexión a proveedores. La publicación en Cloud requiere
actualizar `agent.py` en la carpeta Windows `contactia-livekit-cloud` y ejecutar
`lk agent deploy --id CA_vkyHrJpZtdWT`. No basta con actualizar Git/Vercel: la
imagen Cloud es independiente. Tras el despliegue hay que cerrar la sesión
anterior y abrir una nueva; la comprobación pendiente es escuchar el saludo.
No se afirma que el audio esté restaurado hasta esa comprobación real.

Fuentes verificadas:
- https://docs.livekit.io/agents/models/tts/cartesia/ (Sonic 3 EU y catálogo oficial de voces)
- https://docs.livekit.io/agents/models/tts/rime/ (Coda sin endpoint EU)


## Prueba real y ajustes de contacto (25/10/2026)

El usuario confirmó que el cambio de Rime a Cartesia recuperó el sonido desde
Cloud. La reproducción fue fluida, sin cortes, pero Daniela tenía acento
latinoamericano. Quedaron pendientes el acento de España, los correos dictados y
las fórmulas del nombre.

La siguiente revisión selecciona Marta (`de38f545-c574-44e8-9b54-a7d6fec1c6b1`),
voz femenina conversacional catalogada por Cartesia como Castilian Spanish,
región Spain. Se mantiene `cartesia/sonic-3` con endpoint EU y la restricción
regional activada. La elección está verificada en el catálogo, pendiente de la
valoración auditiva del usuario:
https://www.cartesia.ai/voices/library/marta-friendly-guide-de38f545-c574-44e8-9b54-a7d6fec1c6b1

El chat distingue `canal: voz` en `enviar`. Solo en el paso de correo de ese
canal convierte símbolos hablados, deletreo español y dígitos a su representación
escrita. Las direcciones ya escritas no se reinterpretan; no se completan dominios
ni se adivinan correcciones. Una entrada con dos arrobas se rechaza. La respuesta
lee la parte local por caracteres, expone la dirección interpretada en pantalla
y pide Sí/No antes de aceptar el correo. No avanza al teléfono hasta el Sí.
El cliente puede rechazarlo o sustituirlo, consultar información sin perder el
correo pendiente y continuar por escrito al detener la voz. El resumen final
mantiene los datos y la creación sigue requiriendo el botón explícito.

El nombre ya tenía una limpieza básica; se refuerzan fórmulas como «Pues a nombre
de Juan, por favor», «La reserva sería a nombre de Juan», «Me llamo Juan» y comillas
del transcriptor. Se conservan nombres compuestos y apellidos con «de». Se muestra
«A nombre de Juan» después de interpretarlo; la transcripción original del turno
sigue visible en el chat y no es por sí sola el dato guardado.

Validación: 760 pruebas Node superadas, con casos de dictado, rechazo, sustitución,
corrección de un correo tras el resumen final y recorrido de voz simulado hasta
la escritura explícita de reserva con nombre y correo normalizados. Sintaxis del
worker Python comprobada. No se ha sintetizado audio de Marta desde el entorno
de preparación: requiere desplegar `agent.py` en el mismo agente Cloud y una
comprobación breve con el usuario. La web Preview se actualiza desde Git;
Cloud requiere su propio `lk agent deploy`.


## Regresión con la transcripción real (25/10/2026)

El usuario aportó un recorrido con dos «Sí» seguidos: el primero confirmó el
resumen de fecha/hora/personas; el segundo llegó en el paso nombre y se guardó
como nombre. Después se recibió literalmente «Oen vídeo arroba Gmail punto
com.», que fue rechazado por la tilde introducida por el transcriptor.

Se rechazan confirmaciones genéricas como nombre, además de teléfonos y correos,
y se mantiene el paso nombre con una petición explícita. No se descartan todos
los turnos repetidos ni se añaden ventanas de tiempo: un Sí posterior en una
confirmación válida debe seguir funcionando.

La normalización del correo por voz quita tildes ortográficas de vocales y admite
comas/pausas entre letras. Sigue sin adivinar la diferencia Oen/OEM: ofrece
`oenvideo@gmail.com` como candidato, lo lee y espera confirmación; si se rechaza,
permite dictar `O, e, eme, uve, i, de, e, o, arroba Gmail punto com.` y aceptar
`oemvideo@gmail.com`. Una prueba recorre exactamente estos turnos y verifica que
el payload final contiene Juan y solo el correo confirmado. La transcripción
seguirá dependiendo del reconocedor; no se presenta la normalización como una
garantía de que reconozca cualquier cuenta.

Solo cambia el chat de Preview; no hace falta redesplegar el worker Cloud para
esta corrección. Tras publicarse, requiere recargar la página para cargar el
JavaScript nuevo. La siguiente prueba manual es únicamente la recuperación del
Sí repetido y del dictado del correo; no requiere registrar otra reserva.


## Respuestas naturales recuperadas en el chat Supabase (25/10/2026)

Una segunda transcripción real mostró que «Dos.» se rechazaba repetidamente,
«Catorce.» y «Catorce horas.» no se aceptaban y «Para el martes, y dos personas»
provocaba volver a preguntar personas. En ese mismo recorrido se guardó José
correctamente y se sustituyó el primer correo por Pepito antes de confirmar.

La regresión estaba en la adaptación conversacional, no en la base de datos:
Supabase llamaba a `analizarPersonas`, que busca marcadores explícitos, pero no
reutilizaba `extraerPersonas` para respuestas breves. En hora no utilizaba la
opción `permitirRespuestaBreve` de `extraerHora`. Esas funciones ya existían y se
habían validado en el flujo anterior; los tests iniciales de Supabase usaban
principalmente cifras y frases completas y no cubrían estas entradas reales.

Se añaden adaptadores limitados al campo preguntado que reutilizan los
intérpretes existentes, y se conservan ambigüedades y validaciones de rango.
Se capturan personas con marcador explícito, hora inequívoca y zona explícita en
los turnos de recogida de reserva. Se pregunta el primer campo aún ausente;
no se pregunta de nuevo uno ya capturado. Personas y hora claras se conservan
si el servidor rechaza un día cerrado. Los números de una fecha no se toman por
comensales y no se aplica esta captura al nombre, correo, resumen de confirmación
o solicitud incierta. Las correcciones explícitas conservan su flujo propio.

La extracción complementaria no valida fechas nuevas fuera del paso fecha ni
sustituye al servidor: horario, antelación, disponibilidad y escritura conservan
sus comprobaciones. Se sigue pidiendo aclaración para «las dos» sin periodo.
El texto de la pregunta inicial de hora se simplifica, con ejemplos solo cuando
hace falta aclarar una respuesta.

Pruebas de regresión: respuestas breves con puntuación, varios datos explícitos
en un turno, dato dicho antes del día, cierre que conserva personas/hora,
alternativas ambiguas y correcciones. El recorrido completo reproduce el nombre
José y sustitución de Oen vídeo por Pepito, sin crear una reserva automáticamente.
La simulación de navegador/RPC también usa Dos y Catorce horas. La verificación
manual sigue siendo necesaria para evaluar transcripción y voz reales; los tests
no se presentan como garantía de reconocimiento acústico.


## Hora coloquial y presentación del correo (25/10/2026)

El usuario establece explícitamente que «a las dos» en una reserva de restaurante
significa 14:00. Se retira el filtro de hora explícita que se había mantenido en
Supabase y se recupera la interpretación histórica de `extraerHora`: horas de 1
a 11 sin periodo se entienden como 13:00–23:00 en este contexto. «02:00» y «dos de
la mañana» conservan 02:00. Alternativas como «dos o tres» siguen pidiendo una
sola hora. Para capturar horas complementarias fuera del campo hora se exige
marcador horario, para que «dos o tres personas» nunca genere una hora.
El servidor mantiene horario, antelación y disponibilidad como validación final.
Esta regla actual sustituye la exigencia de mañana/tarde de revisiones previas.

La última transcripción aportada ya reconocía Antonio García arroba Gmail punto
com como antoniogarcia@gmail.com y quedaba esperando Sí/No. Se mejora la
presentación: la dirección normalizada completa se muestra en pantalla y la voz
la lee por palabras y símbolos, sin separar todas las letras de entrada. La
confirmación continúa siendo obligatoria antes de guardar. En ese paso se puede
pedir «deletrealo», «puede deletrearlo», «deletreelo» o «letra a letra» para oír
las letras sin modificar la dirección ni avanzar.

El callback conversacional puede aportar una locución distinta del texto visible.
La interfaz sigue renderizando texto mediante createTextNode y devuelve al worker
la locución correspondiente; no se cambia el agente Cloud ni la base de datos.
Pruebas: recorrido literal de martes / para dos / a las dos / Antonio / correo,
lectura natural, dirección visible, deletreo solicitado, confirmación y payload;
la simulación JSDOM/RPC comprueba también las dos presentaciones y la escritura
solo con el botón final. La síntesis real depende del modelo de voz ya desplegado.

## Prueba completa confirmada y cierre telefónico pendiente (25/10/2026)

El usuario completó una reserva real de prueba: «A las dos» se interpretó como
14:00, «A nombre de Antonio» guardó Antonio y el correo dictado se confirmó
correctamente. También se entendió el teléfono con un «Sí» inicial. La reserva
quedó registrada; no se envió correo porque la dirección no estaba habilitada.

Los dos resúmenes conservan 14:00 en pantalla y en los datos, y la locución
dice «a las catorce horas». Para horas con minutos se leen también los minutos.

La verificación y el botón final siguen siendo requisitos de esta prueba web.
No existe aún un cierre telefónico: el worker depende de la RPC del navegador
y la ruta de reserva exige Turnstile. La telefonía requiere trasladar la
conversación al servidor y una confirmación autenticada desde el agente,
vinculada a la llamada, con validación de disponibilidad e idempotencia, tras
un sí explícito del cliente. No se debe eliminar Turnstile de la ruta pública
ni prometer que el canal telefónico actual ya funciona sin pantalla. No se
habilita telefonía ni se cambia producción en esta corrección.

## Implementación del cierre de voz en servidor

- `supabase_voz_sesion` verifica el acceso inicial y emite la sesión LiveKit más
  un estado de conversación cifrado y autenticado con AES-256-GCM. Deriva la
  clave del secreto Supabase de servidor, con un propósito independiente. El
  estado se vincula al host, restaurante, sala y huella HMAC de IP; caduca a los
  seis minutos sin renovar ese plazo por cada turno. Solo admite cien turnos.
- `supabase_voz_turno` admite únicamente el token y la transcripción, nunca un
  estado de conversación o datos de reserva elegidos por el cliente. Restaura el
  motor compartido, consulta calendario/disponibilidad y devuelve los mensajes
  de pantalla y la locución. No añade tablas ni almacena una transcripción; el
  token en memoria conserva los campos actuales necesarios para continuar.
- El sí final llama a la misma transacción de disponibilidad, asignación y
  registro que el canal escrito. Esta operación conserva un UUID estable,
  derivado del acceso de voz, y los límites de escritura existentes. El estado
  temporal de voz no concede capacidad para omitir controles del canal escrito.
- No se hace otra consulta de disponibilidad antes de repetir el cierre de voz:
  podría ver la mesa que ya ocupó la propia solicitud. La transacción identifica
  primero una operación repetida y devuelve la misma reserva. Un fallo incierto
  conserva los datos y requiere un «reintentar» o «sí» explícito. Un conflicto
  conocido permite corregir. Nunca se anuncia éxito antes del resultado SQL.
- Si se pierde la respuesta final y el usuario pasa a escrito, la interfaz
  conserva también el UUID y los datos pendientes; el cierre escrito verifica
  esa misma solicitud, sin generar otra. El botón para detener la llamada sigue
  disponible durante un resultado pendiente.
- La referencia completa y el enlace privado siguen visibles. La confirmación
  por voz no dicta el UUID largo ni pide conservar un enlace en pantalla.
  El cierre observa el atributo LiveKit `lk.agent.state` (speaking → listening),
  con margen para el audio recibido y un límite de respaldo si falta el evento.

Validación: recorrido desde el HTML real con RPC LiveKit simulada y handler de
servidor real contra una base simulada; confirma al sí final sin botón ni segunda
verificación. Se comprueban respuesta perdida, reintento con resultado incierto,
conflicto al escribir, continuidad escrita con UUID conservado, manipulación y
caducidad del token y separación del canal escrito. No se crean reservas ni se
envían correos desde estas pruebas. La escucha real de la locución final queda
pendiente de la siguiente llamada del usuario.

## Validación real y voces candidatas (25/10/2026)

El usuario completó la llamada tras publicar el cierre por voz y confirmó que
«todo perfecto». Queda validado el recorrido por llamada web, incluida la
confirmación final sin botón ni verificación adicional. La telefonía/SIP sigue
pendiente de conexión; no confundir ambas validaciones.

El usuario ha escuchado y elegido estas voces como candidatas para conservar
y valorar una futura elección de voz por restaurante:

| Voz | Proveedor |
| --- | --- |
| Iker | Gradium |
| Alba | Gradium |
| Iria | Cartesia |
| Rafael | Cartesia |
| Celia | Cartesia |
| Thiago | Cartesia |
| Marcos | Cartesia |

Esta lista recoge la preferencia del usuario, no una comprobación individual de
compatibilidad. Antes de habilitar cada voz hay que verificar su identificador,
disponibilidad mediante LiveKit Inference en EU y coste. No se han atribuido
acentos ni características no confirmadas a estas voces. Mantener Marta activa
hasta elegir y probar una sustituta. La selección desde el panel del restaurante
es una mejora futura, todavía no implementada.

## Botón telefónico por Internet: preparado, sin activar (25/10/2026)

El usuario ha elegido probar el número estadounidense de Twilio desde un botón
web para evitar llamadas internacionales desde su tarifa móvil. Se prepara
`telefono-prueba.html` con destino fijo, límite de tres minutos y recibo manual
de costes. No se ha llamado ni configurado la recepción del número. Faltan la
app y la API key del SDK, aplicar la migración remota (conector devuelve
`Invalid or expired requestState`) y conectar el receptor al agente. El estado
y los pasos de activación están en `docs/telefono-prueba-internet.md`.
Las reservas de voz web que ya funcionaban conservan su flujo.

### Región de Twilio para el botón de pruebas

Se corrige la indicación anterior de US1: la app TwiML y la API key del navegador
se crearán en Irlanda (IE1). El código fuerza IE1 en el token y en REST, y exige
un Auth Token regional independiente. El número de destino estadounidense no
obliga a procesar las llamadas en US1. La recepción del número también deberá
configurarse para IE1. No se promete residencia íntegra de todos los servicios
o del tránsito telefónico solo por configurar este componente.

## Recorrido telefónico más breve (01/11/2026)

Tras una reserva real de 223 segundos, se recortan locuciones y turnos en el
motor de cierre por voz. El saludo pregunta directamente día, hora y personas;
se aceptan juntos y se preguntan únicamente los datos que falten. La disponibilidad
se comprueba antes de pedir contactos, sin un resumen ni un sí intermedios.

No se recita el horario tras elegir fecha: se conserva en el estado y se explica
si la hora solicitada queda fuera de apertura. Se eliminan el anuncio de zona
única y el eco del nombre. Se acortan observaciones y confirmaciones. El correo
sigue necesitando un sí separado, permite repetición y deletreo, y no se vuelve
a dictar en el resumen final. Ese resumen conserva fecha, hora, personas, zona,
nombre, teléfono y las observaciones que existan; solo su confirmación permite
escribir. Los conflictos e incertidumbre mantienen el mismo cierre transaccional.

Pruebas: recorrido del handler con siete respuestas cuando día, hora y personas
se indican juntos; correcciones de personas, hora y correo; datos parciales;
hora fuera de horario con dos tramos; falta de mesas y elección entre zonas.
La duración real y las pausas deben medirse en una nueva llamada: siete respuestas
no equivalen a una duración garantizada. Los cambios del motor requieren el nuevo
Preview; el saludo requiere además desplegar `experimentos/livekit/agent.py`.

### Fechas habladas al corregir y repregunta del nombre

Se elimina el ejemplo de nombre también cuando la primera respuesta no es válida.
Se reproduce y corrige el rechazo de «cinco de noviembre» o «día seis»: el
intérprete convierte los días en letras únicamente junto a marcadores de fecha.
Mantiene el rechazo de días imposibles, alternativas y contradicciones con el
día de la semana. Las pruebas del servidor cambian la fecha después de recoger
los contactos, conservan hora/personas/contactos y exigen confirmar el resumen
actualizado antes de escribir. La causa de la incidencia concreta del usuario
requiere conocer una frase literal; no se conservan transcripciones de llamadas.


## Autorización de WhatsApp desde llamadas SIP (01/11/2026)

La sesión de voz conserva en su token cifrado si estaba disponible WhatsApp al
iniciar. Con `CONTACTIA_SUPABASE_WHATSAPP_ENABLED=1`, después del teléfono pregunta:
«Si falla el correo, ¿autoriza que le enviemos la confirmación por WhatsApp a este
teléfono?». Solo una respuesta explícita autoriza; una duda vuelve a preguntar.
El no permite continuar la reserva. Si se cambia el teléfono antes de confirmar,
se invalida la respuesta anterior y se solicita autorización para el nuevo.
También se puede elegir «WhatsApp» entre los datos a corregir para revocarla.

El sí final guarda reserva y respuesta mediante `reservar_web_con_avisos`, con
fecha y versión de consentimiento existentes. Se elimina el falso forzado en los
transportes telefónico y de voz web; las sesiones anteriores o con el circuito
apagado mantienen la autorización falsa. El worker no cambia ni requiere deploy.

El seguimiento reutiliza «Avisos y confirmaciones» del panel: comprobar el correo,
preparar WhatsApp si hay un rebote/fallo confirmado y autorización, enviar a un
teléfono permitido y comprobar entrega. No añade barridos ni envíos automáticos
al motor telefónico; un resultado incierto no permite reenviar. No se atribuye
al nuevo recorrido la validación real del envío antiguo de Twilio.

`test/telefono-whatsapp-recorrido.test.js` recorre inicio SIP firmado, motor real,
funciones SQL reales en PGlite, y proveedores simulados. Comprueba consentimiento,
reserva idempotente, correo rebotado/entregado, negativa del cliente, envío de
plantilla y consulta de entrega, e incertidumbre sin duplicados. Las pruebas no
usan la base remota ni envían mensajes. La siguiente prueba real necesita una
nueva llamada con autorización y un fallo de correo elegible revisado en el panel.

## Gestión telefónica con código corto (Preview)

`CONTACTIA_SUPABASE_GESTION_VOZ_ENABLED=1` habilita el circuito solo en la rama
Preview existente. Las nuevas reservas obtienen un código de seis cifras
pseudorrandom seguro, representado en dos grupos de tres. Es estable al reintentar
una reserva y se incluye en las confirmaciones nuevas por email y WhatsApp. La
plantilla aprobada conserva su texto: la variable de localizador contiene el
código agrupado. No se dictan el código ni el enlace privado durante la llamada.
Los mensajes ya enviados y los correos con instantánea previa no se reescriben.

Al empezar una llamada, «cancelar» o «modificar mi reserva» activa la gestión.
Se pide teléfono y seis cifras, sin nombre de restaurante: la llamada ya está
vinculada a su restaurante en el servidor. Los códigos admiten ceros iniciales y
cifras habladas. No se revelan datos de reserva antes de validar ambos valores.
La gestión inicial permite cancelar o cambiar día/hora; cambiar comensales o zona
no está incluido todavía en esta ruta telefónica.

Se guardan hashes HMAC del código y teléfono en un esquema privado con RLS y
acceso exclusivo del servidor. Los intentos se limitan a cinco por teléfono y
restaurante cada quince minutos, incluyendo llamadas nuevas, y diez por origen.
Las respuestas negativas no distinguen teléfono, código o reserva inexistentes.
Los códigos solo autentican reservas futuras, con enlace no revocado y vigente;
la autorización posterior queda dentro de la sesión cifrada de seis minutos.
La rotación de la clave del servidor requiere planificar la renovación de enlaces
y códigos, que dependen de esa clave.

Cada cambio o cancelación se resume y exige un sí explícito. Se reutilizan las
transacciones existentes, la comprobación de disponibilidad y el inicio anterior
para evitar cambios sobre una reserva modificada por otro canal. La operación
posee un UUID determinista por sesión y propuesta: una respuesta perdida permite
comprobar la misma operación sin duplicarla ni sustituir sus datos. No se envía
un segundo WhatsApp ni un correo nuevo al realizar la gestión en esta primera
versión; el resultado se confirma por voz y en el panel.


El teléfono admite cifras sueltas, grupos escritos y bloques hablados entre diez
y noventa y nueve (por ejemplo «seis, cuarenta y seis, cero, veintitrés, seis,
veinticuatro»). Se conserva cada cero dicho y no se rellenan bloques incompletos.
Las alternativas ambiguas se vuelven a pedir. La lectura de confirmación puede
seguir siendo cifra a cifra aunque el cliente haya dictado por bloques.

## Registro de diagnóstico de voz en Supabase

`CONTACTIA_SUPABASE_REGISTRO_VOZ_ENABLED=1`, exclusivo de Preview y de esta rama,
guarda un par de turnos (entrada literal que recibe el motor y respuesta que
prevé comunicar) por solicitud autenticada. No equivale a una transcripción
verificada de lo que sonó: no captura el saludo emitido directamente por el
worker, ni las reformulaciones de voz o el audio. `record=False` de LiveKit se
mantiene. No requiere actualizar el worker ni consulta Airtable.

El panel añade «Conversaciones de voz», con carga manual de las últimas 25
llamadas y detalle de sus turnos. Se marcan repeticiones de paso y respuestas de
rechazo para facilitar la revisión; estas marcas no demuestran un fallo por sí
solas. Una llamada interrumpida conserva sus turnos anteriores y último paso,
sin inventar una despedida ni un resultado final. Solo se registran llamadas
a partir de activar el circuito; las anteriores no se pueden reconstruir.

Se omiten los campos de nombre, correo, teléfono, observaciones y código; también
se filtran correos, teléfonos, secuencias numéricas y enlaces dictados fuera de su
campo. Los resúmenes que contienen contactos se omiten. No se guarda el estado
cifrado, identificador de sala con teléfono, IP, credenciales o audio. Se conserva
el texto de peticiones de día/hora y del menú de cambio para revisar su comprensión.
Es un registro filtrado, no una garantía de anonimización de cualquier dato que
alguien mencione espontáneamente fuera de esos campos.

Cada llamada tiene un UUID no semántico y cada índice de turno es único: repetir
una solicitud no duplica el registro. La escritura tiene un plazo de 1,2 segundos;
un fallo de diagnóstico no cambia el resultado de la reserva o gestión. La tabla
privada usa RLS; solo el servidor ejecuta sus RPC. Para consultar desde el panel
se verifica Auth y la pertenencia activa como propietario o encargado al mismo
restaurante. No hay acceso anónimo ni entre restaurantes.

Los registros caducan a los 30 días. Nunca se muestran tras caducar, y se eliminan
físicamente al siguiente acceso o escritura de ese restaurante. No hay un borrado
periódico independiente: si el restaurante no vuelve a acceder, el borrado físico
puede ocurrir después de la caducidad. No se ha activado grabación de audio.

En gestión telefónica se conserva el campo indicado al inicio: «quiero cambiar
el día/la fecha» lleva directamente a pedir el nuevo día después de validar
el teléfono y código; «quiero cambiar la hora» lleva a pedir la nueva hora.
Si no se indicó un único campo, se mantiene la pregunta de día u hora. Esto no
sustituye la identificación ni el resumen y sí final antes de ejecutar el cambio.
