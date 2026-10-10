# Prueba LiveKit Inference + Deepgram + OpenAI + Rime Alondra (aislada de producción)

**Estado: implementado en rama de laboratorio; no probado extremo a extremo ni desplegado.**
La rama `main` y la rama `prototipo-voz` no se modifican.

## Objetivo

Medir una reserva completa en Restaurante Sol. Comparamos el motor de voz
actual con un agente LiveKit que escucha (Deepgram Nova-3), entiende
(OpenAI GPT-4.1 mini), habla (Rime Coda, voz Alondra/lark en español)
y **consulta obligatoriamente** el motor actual de Contactia mediante RPC.
Contactia continúa decidiendo disponibilidad, retenciones y confirmación.

## Arquitectura y ubicación

- `api/voz-sesion.js?motor=livekit` con `lib/livekit-prueba.js`: emite JWT de sala privada exclusivamente en Preview.
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
   `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`.
   **No hacen falta claves propias de OpenAI, Deepgram o Rime**:
   el worker usa LiveKit Inference con el proyecto de LiveKit.
   La voz elegida es `rime/coda` con ID `lark` (Alondra).
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

- El worker establece `record=False` para impedir la subida de audio,
  transcripciones, trazas y logs de sesión a Agent Insights. Los mensajes
  siguen siendo procesados por terceros para completar la conversación.
  **Rime no dispone de un endpoint específico de la UE**; antes de emplear
  clientes reales será necesaria una decisión sobre residencia de datos.
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

## Servicios seleccionados (LiveKit Inference)

- STT: `deepgram/nova-3`, idioma `es`.
- LLM: `openai/gpt-4.1-mini`.
- TTS: `rime/coda`, voz `lark`, idioma `es`.

**No comprar servicios externos por ahora.** El plan Build incluye créditos
limitados para modelos; los precios de Rime Coda pueden cambiar y no
significan que la sesión completa sea gratuita.
