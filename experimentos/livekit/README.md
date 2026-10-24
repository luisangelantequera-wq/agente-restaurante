# Worker reutilizado para la voz de Supabase

`agent.py` y `requirements.txt` proceden de `prueba-livekit-cartesia` y conservan su lógica, despacho `contactia-cartesia-prueba` y voz Rime Coda `lark`. Se ejecuta fuera de Vercel. El navegador conecta ahora su RPC `contactia.procesar_turno` al chat de pruebas de Supabase.

Ver configuración, arranque y límites en [docs/voz-supabase.md](../../docs/voz-supabase.md). Utilizar el proyecto y los datos ficticios de pruebas.

## Alojamiento en la nube

`Dockerfile`, `.dockerignore` y `requirements-cloud.txt` preparan este mismo
agente para LiveKit Cloud. El alta se realiza desde una sesión autorizada del
CLI y el proyecto de pruebas; ver los pasos y el estado en
[`docs/voz-supabase.md`](../../docs/voz-supabase.md#alojamiento-del-agente-en-livekit-cloud).
No subir `.env.local` ni copiar claves: LiveKit las inyecta al arrancar.
