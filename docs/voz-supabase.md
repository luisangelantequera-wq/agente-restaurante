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

La conexión real con LiveKit Cloud y Supabase queda pendiente de una llamada con datos ficticios. Correo, panel y disponibilidad ya se probaron y no requieren repetir sus ensayos por separado.
