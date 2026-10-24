# Voz LiveKit y Supabase

`chat-prueba.html?restaurante=prueba-sol` incorpora una llamada web mediante LiveKit y el mismo motor de conversación que el texto. La conexión está preparada en `migracion-supabase-fase-1`; la prueba real necesita credenciales en esa rama y arrancar el worker existente. No se habilitan SIP o telefonía ni se cambia producción.

## Reutilización

Se recupera `experimentos/livekit/agent.py` sin modificar de `prueba-livekit-cartesia` (HEAD consultado `9df8a97`). Es el worker ejecutado en Windows durante la prueba del 11 de octubre. Conserva el despacho `contactia-cartesia-prueba`. Aunque su nombre histórico dice Cartesia, el código recuperado usa Deepgram Nova-3, GPT-4.1 mini y Rime Coda con voz `lark` (Alondra), mediante LiveKit Inference.

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

Puede atender la página nueva sin cambiar su código. Vercel no ejecuta ese Python. Para una copia nueva del worker, instalar antes sus requisitos y configurar las credenciales como en la prueba original.

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
Se han instalado y comprobado las 70 dependencias en un entorno Linux aislado con Python 3.12 y se ha ejecutado `agent.py start --help` correctamente. No hay Docker disponible en el entorno de preparación: la construcción de la imagen, el alta remota y la comprobación sin worker local están pendientes. No se cambia
el nombre de despacho ni se despliega el sitio a producción.

En `experimentos/livekit/`:

- `Dockerfile`: Python 3.12 en Debian, usuario sin privilegios y arranque
  `python agent.py start`. Solo copia el agente y las dependencias.
- `requirements-cloud.in`: fija LiveKit Agents 1.8.6 y transporte 1.1.20,
  observados en el registro de la llamada; dotenv se fija en 1.2.1.
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
desde esa carpeta ejecutar `lk agent create --region eu-central`. LiveKit
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
