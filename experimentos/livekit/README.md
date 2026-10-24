# Worker reutilizado para la voz de Supabase

`agent.py` y `requirements.txt` proceden de `prueba-livekit-cartesia` y conservan su lógica, despacho `contactia-cartesia-prueba` y voz Rime Coda `lark`. Se ejecuta fuera de Vercel. El navegador conecta ahora su RPC `contactia.procesar_turno` al chat de pruebas de Supabase.

Ver configuración, arranque y límites en [docs/voz-supabase.md](../../docs/voz-supabase.md). Utilizar el proyecto y los datos ficticios de pruebas.
