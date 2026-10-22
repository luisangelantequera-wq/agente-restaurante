# Formulario público protegido — desarrollo

Estado: código y SQL preparados; **activación y prueba integral pendientes** de
claves privadas de Supabase y Turnstile en Vercel. No se han introducido claves de
prueba que simulen protección en un despliegue público. Sin configuración completa
se rechazan las solicitudes antes de crear reservas.

## Flujo

`/reserva-prueba.html?restaurante=prueba-sol` llama a `/api/restaurante` mediante
las acciones `supabase_web_config` y `supabase_web_reservar`. No consulta ni escribe
tablas desde el navegador y no requiere una cuenta de cliente. Solo se permite en
Preview de migracion-supabase-fase-1, con un interruptor explícito y los restaurantes
ficticios prueba-sol/prueba-luna. Producción y el chat actual conservan su proveedor.

El servidor comprueba cuerpo, tamaño, origen/host, IP de Vercel, datos, límites
y Turnstile. El widget no basta: Siteverify debe confirmar success, hostname,
action=reservar y cdata igual al UUID de petición. Tokens vacíos, inválidos,
reutilizados o fallos de red no autorizan la escritura. La clave privada no se
incluye en HTML/JS, JSON, repositorio ni logs.

El cliente solo elige fecha, hora, personas y zona. PostgreSQL elige la mesa
individual adecuada más pequeña o una combinación configurada; si colisiona con
otra transacción busca la siguiente opción. Horarios, capacidad, cierres,
antelación, disponibilidad y escritura se comprueban dentro de la operación SQL.
No hay una promesa de mesa retenida antes del envío: se confirma al terminar la
transacción. Las retenciones del chat antiguo quedan separadas y no se importan.

El formato JSON de horarios conserva fechas exactas, cierres concretos,
excepciones anuales y horario semanal, en ese orden. Se valida el intervalo de
entrada y se rechazan horas inexistentes/ambiguas por cambio horario. Como en la
aplicación actual, los tramos determinan horas de entrada; no se exige terminar
la estancia antes de finalizar el tramo de entrada.

## Límites

Contadores atómicos en PostgreSQL, compartidos por todas las instancias: 30
lecturas/minuto y 5 intentos de reserva/minuto por IP. Se calcula HMAC-SHA256 con
la clave privada del servidor; no se almacena la IP en la tabla. Las ventanas las
establece PostgreSQL y las entradas de más de diez minutos se eliminan al usar
el limitador. No es un historial de clientes. La tabla privada carece de políticas
para usuarios deliberadamente: no tienen permisos y solo service_role la usa.
El aviso informativo RLS sin política refleja esta denegación por defecto.

En Vercel se utilizan las cabeceras de IP suministradas/sobrescritas por la
plataforma. Si se añade un proxy externo, revisar esta confianza. Turnstile y el
límite por IP se complementan; no garantizan bloquear todo el abuso distribuido.
Antes de producción, calibrar cuotas para no bloquear redes compartidas.

## Configuración requerida en Vercel

Proyecto agente-restaurante, SOLO Preview y SOLO rama migracion-supabase-fase-1:

| Variable | Tipo y contenido |
|---|---|
| CONTACTIA_SUPABASE_SERVER_KEY | Secret. Clave secret/service_role de contactia-desarrollo. Nunca la publishable. |
| TURNSTILE_SECRET_KEY | Secret. Clave secreta del widget Cloudflare de pruebas. |
| TURNSTILE_SITE_KEY | Config. Clave pública del mismo widget. |
| CONTACTIA_PUBLIC_HOSTNAME | Config. Hostname exacto y estable de la rama Preview, sin https ni rutas. |
| CONTACTIA_WEB_SUPABASE_ENABLED | Config. 1 solo después de configurar las demás y validar las pruebas. |

Crear el widget en Cloudflare Turnstile, modo Managed, con el hostname estable de
la rama Preview. No usar wildcard ni habilitar dominios ajenos. No se necesita
cambiar el proxy/DNS de contactia.net. El CSP permite scripts/iframes/conexiones
solo al origen específico challenges.cloudflare.com, además del mismo origen.
No habilita unsafe-inline, unsafe-eval ni comodines.

Las claves se copian directamente desde sus paneles a Vercel; no se mandan por
chat ni se guardan en documentos. Cambiar variables requiere un nuevo despliegue.
El conector actual de Supabase no ofrece la clave privada y no hay conector
Cloudflare disponible: la preparación de estas credenciales necesita al titular.

El seed `supabase/seed-web-desarrollo.sql` ya completó los horarios ficticios y
marcó reservas_web_activas=true para Sol/Luna; el interruptor HTTP de Vercel sigue
en 0 y bloquea todo el formulario. No habilitar otros restaurantes
ni importar datos reales hasta validar el recorrido completo.

## Pruebas y límites de esta entrega

694 pruebas JavaScript superadas en Node 22 y tres suites SQL en PGlite; la nueva
suite SQL se ejecutó además en Supabase alojado con rollback. Comprueba selección
automática, colisiones, combinaciones, idempotencia, cierres, intervalos, cambios
horarios, cuotas y bloqueo del acceso anónimo a las funciones internas.
Turnstile tiene pruebas de integración de servidor con respuestas simuladas. Falta
resolver un desafío real y probar browser → Vercel → Turnstile → Supabase con las
claves del widget; no se afirma una validación integral antes de ese paso.

El formulario es de prueba: no envía avisos ni genera enlaces de gestión de
clientes, y no modifica el chat o el panel operativo actuales.

Fuentes:
- https://developers.cloudflare.com/turnstile/get-started/server-side-validation/
- https://developers.cloudflare.com/turnstile/reference/content-security-policy/
- https://vercel.com/docs/headers/request-headers
