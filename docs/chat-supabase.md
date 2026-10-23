# Chat de reservas de prueba con Supabase

Ruta: `/chat-prueba.html?restaurante=prueba-sol`, en la Preview de `migracion-supabase-fase-1`. Admite también `prueba-luna`. El chat original, voz, correos y WhatsApp siguen pendientes de migración.

El navegador usa `/api/restaurante` con cookies del mismo origen para atravesar la protección de Vercel. El servidor aplica la misma restricción de rama, activación, origen, IP y cuotas del formulario. La clave privada de Supabase y el secreto de Turnstile permanecen en el servidor.

Las acciones nuevas son `supabase_web_chat_config`, `supabase_web_fecha` y `supabase_web_disponibilidad`. Las dos últimas llaman a la función `consultar_disponibilidad_web`, disponible únicamente para `service_role`. Se devuelve solo calendario o un booleano de disponibilidad, sin clientes ni identificadores de mesas. Cuota compartida de lectura: 30/minuto/IP, usando HMAC de la IP.

La prioridad del calendario se comparte en `contactia_privado.horario_para_fecha`: fecha exacta, cierre concreto, excepción anual y horario semanal. La validación de hora conserva antelación, horizonte, intervalos y cambios de horario de verano. La disponibilidad considera mesas individuales y combinaciones, estado operativo y ocupación física solapada. Consultar no retiene ninguna mesa.

La conversación reutiliza los intérpretes de fechas, personas y horas. Usa la fecha civil del restaurante y pide aclaración de horas ambiguas. Con una zona activa se asigna automáticamente. Antes de pedir datos personales consulta disponibilidad; al confirmar el resumen final vuelve a comprobarla. El motor de escritura sigue siendo quien decide la asignación definitiva con la exclusión PostgreSQL que evita solapamientos.

Turnstile se carga al final, con `action=reservar` y el UUID de petición como `cData`. La escritura reutiliza `supabase_web_reservar`, con su verificación en servidor y límite de cinco intentos/minuto/IP. La reserva no envía avisos. Tras un resultado incierto se bloquean las correcciones y «Nueva reserva» y se reintenta la misma petición y datos; el UUID se mantiene en memoria de esta pestaña. **No recargar ni cerrar la pestaña durante un resultado incierto**: se perdería esa identidad; comprobar primero el panel antes de iniciar otra reserva. No se guarda la conversación ni los datos personales en almacenamiento del navegador.

Pruebas: `npm test` cubre conversación, correcciones, cierre, una o varias zonas, falta de disponibilidad, bloqueo de reintentos inciertos, protección y proyección de API; `npm run test:supabase` aplica migraciones y comprueba aislamiento, permisos y disponibilidad con PGlite. La suite SQL `08_chat_disponibilidad.sql` usa datos ficticios y finaliza en ROLLBACK; puede ejecutarse también en desarrollo remoto. Queda la comprobación manual del navegador y desafío real de Turnstile.

Prueba manual sugerida: reservar para una fecha abierta, dos personas, 14:00 y un nombre ficticio; completar Turnstile, confirmar y comprobar en el panel. Repetir para la misma mesa y franja debe informar de falta de disponibilidad. Después cancelar las pruebas desde el panel. También comprobar un día cerrado y una corrección de hora antes de confirmar.
