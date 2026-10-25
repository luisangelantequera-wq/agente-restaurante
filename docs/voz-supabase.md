# Voz LiveKit y Supabase

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
