# Prueba LiveKit + Deepgram + OpenAI + Cartesia (aislada de producción)

**Estado: implementado en rama de laboratorio; no probado extremo a extremo ni desplegado.**
La rama `main` y la rama `prototipo-voz` no se modifican.

## Objetivo

Medir una reserva completa en Restaurante Sol. Comparamos el motor de voz
actual con un agente LiveKit que escucha (Deepgram Nova-3), entiende
(OpenAI GPT-4.1 mini), habla (Cartesia Sonic-3 en español peninsular)
y **consulta obligatoriamente** el motor actual de Contactia mediante RPC.
Contactia continúa decidiendo disponibilidad, retenciones y confirmación.

## Arquitectura y ubicación

- `api/livekit-prueba.js`: emite JWT de sala privada exclusivamente en Preview.
  Requiere clave de ensayo y configuración; no inicia ninguna llamada telefónica.
- `voz-livekit.js`: interfaz web `/r/restaurante-sol?voz=1&motor=livekit`.
  La conexión LiveKit se realiza desde el navegador al servidor LiveKit.
  La función RPC conecta con `window.ContactiaVozBridge.procesarTurno`.
- `experimentos/livekit/agent.py`: **worker separado**, que debe estar
  ejecutándose en LiveKit Cloud o en un ordenador/servidor disponible.
  No es una función de Vercel. Identificador de despacho:
  `contactia-cartesia-prueba`.
- `test/livekit-prueba.test.js`: verificaciones del control de acceso y aislamiento.

## Antes de hacer pruebas

1. Crear un proyecto LiveKit compatible con agentes y obtener su URL, API key y API secret.
2. En las variables de entorno **solo de la Preview de esta rama** en Vercel:
   `LIVEKIT_PRUEBA_ENABLED=true`,
   `LIVEKIT_URL=wss://TU-PROYECTO.livekit.cloud`,
   `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, y
   `LIVEKIT_PRUEBA_ACCESS_CODE` (una contraseña aleatoria de 20 caracteres o más).
   Nunca poner valores secretos en GitHub ni el navegador.
3. Configurar en el worker **separado**:
   `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`,
   `OPENAI_API_KEY`, `DEEPGRAM_API_KEY`, `CARTESIA_API_KEY`
   y `CARTESIA_VOICE_ID`. La última es el ID **real** de la voz
   de Cartesia elegida y validada para español de España; no usar una voz
   en inglés por defecto.
4. En un entorno Python 3.11+ instalar `requirements.txt` y ejecutar
   `python agent.py dev` desde `experimentos/livekit/` (para producción
   de agentes se requiere un worker desplegado de manera permanente).
   Comprobar primero compatibilidad de versión de las dependencias.
5. Desplegar la rama `prueba-livekit-cartesia` como Preview privada,
   visitar `/r/restaurante-sol?voz=1&motor=livekit` en HTTPS,
   introducir la clave de prueba, permitir micrófono e iniciar.
   **No abrir el enlace del prototipo anterior**, que continúa usando OpenAI.
6. Usar solo fecha futura, teléfono, nombre y correo **ficticios**.
   No enviar confirmaciones a terceros. Revisar que las variables de
   Airtable y proveedores corresponden a un entorno de pruebas aislado.

El worker y las claves no se despliegan automáticamente al crear esta rama.
El botón mostrará un error mientras `LIVEKIT_PRUEBA_ENABLED` no esté
activado o no haya un agente LiveKit conectado.

## Privacidad y límites

- El worker no escribe transcripciones ni audio a ficheros. Los mensajes
  pasan por los servicios de terceros para poder completar la conversación.
- El cliente web reutiliza el motor Contactia, que puede registrar
  conversaciones o realizar acciones reales. Usar **exclusivamente datos
  sintéticos** y una base de pruebas; antes de ensayos con datos reales,
  auditar también las retenciones y las políticas de LiveKit/Deepgram/
  OpenAI/Cartesia.
- No se habilita SIP, telefonía ni llamadas salientes.
- Cada conexión de cliente está limitada a 5 minutos en el navegador.
  La limitación no sustituye un tope de costes a nivel de proveedores.
- En `vercel.json` se amplía la CSP **solo en esta rama** para cargar
  el SDK desde jsDelivr y abrir transporte `wss:`. Si esta rama se
  promociona, restringir la CSP al host concreto y servir el SDK localmente.

## Plan de medición

Realizar 3–5 reservas de prueba idénticas por arquitectura, con corrección
de hora y zona en una de ellas. Anotar duración completa, latencia por
turno (fin de habla hasta primera voz), porcentaje de interrupciones y
errores, y uso facturado a proveedores.

El worker imprime exclusivamente métricas numéricas que informe el SDK
cuando emite `metrics_collected` (latencia, tokens y audio si están
disponibles) y el tiempo de la RPC de Contactia. **No equivale a una
factura:** extraer además consumos de LiveKit, Deepgram, OpenAI y Cartesia.
La suma económica requiere sus tarifas exactas y los mínimos mensuales.
Nunca usar el precio por minuto de conversación como si todo ese minuto
fuera tiempo de síntesis de Cartesia.

## Criterio para continuar

No avanzar a producción sin una sesión real satisfactoria, validación de
cancelaciones y correcciones, controles de privacidad y costes, y una
comparación numérica con el prototipo anterior.
