# Botón de llamada por Internet al número estadounidense

Preparación del 25/10/2026, exclusivamente en Preview y rama
`migracion-supabase-fase-1`. No cambia el teléfono personal, WhatsApp, la
configuración del número Twilio, ni la aplicación o el agente de LiveKit.

## Qué está preparado

`telefono-prueba.html` permite llamar con el micrófono y los altavoces del
navegador. Hay un enlace desde el chat de pruebas. El destino es el único número
estadounidense configurado en servidor; no existe un campo para marcar otro.
No pasa por la tarifa de voz del móvil, pero sí consume los tramos de Twilio.

La página requiere una verificación con acción `llamada_usa`. Se comprueban
origen, IP y cuotas; el SDK recibe un token de dos minutos para una sola aplicación
TwiML, sin permiso para recibir llamadas. El servidor verifica antes que el
número pertenece a la cuenta y admite voz, que la app apunta al callback fijado
y que el callback es accesible desde fuera de la sesión del navegador. Una
Preview protegida que bloquee el webhook no puede emitir permisos de llamada.

La autorización para marcar se vincula atómicamente a un Call SID en Supabase.
Un segundo Call SID no puede reutilizarla. Los reenvíos del mismo webhook
conservan el mismo destino. El webhook exige firma Twilio, cuenta, identidad y
pase válidos, ignora destinos alternativos y genera exclusivamente un Dial al
número configurado. El tiempo máximo se impone en Twilio y en el navegador:
180 segundos, con 20 segundos para intentar conectar. Se impide que el número
use la propia app de salida como recepción para evitar un bucle.

El botón «Consultar coste de Twilio» recupera únicamente la llamada vinculada y
su tramo hijo al número fijo. Suma sus importes, convierte el signo negativo del
cargo en gasto positivo y distingue cero de importe pendiente. No hay polling,
reintentos de marcado automáticos ni llamadas realizadas por las pruebas.
Los costes posteriores del lado receptor —por ejemplo LiveKit— no están
incluidos en esta suma. Tampoco incluye el alquiler mensual del número.

El SDK `@twilio/voice-sdk@2.18.5` está fijado en el lockfile. Postinstall copia
el bundle y su licencia a `vendor/`, sin cargar código de CDN. Su log está en
modo silent. La CSP de Twilio se aplica solo a `telefono-prueba.html`.
El token del navegador fija `region=ie1` y el cliente REST también fija
`region=ie1`, ambos con acceso Dublin. Las llamadas se procesan en Irlanda.
Elegir solo el edge Dublin no cambia la región de procesamiento. La aplicación
TwiML, la API key y el Auth Token deben ser de Irlanda. El número estadounidense
sigue siendo el destino de pruebas y no determina la región elegida. Su recepción
también requiere configurar la región de procesamiento entrante IE1 antes de
presentar el recorrido completo como europeo; el uso de un número de EE. UU.
no permite asegurar que todo el tránsito de operadores permanezca en la UE.

## Estado de activación

**Todavía no está operativo.** No se ha emitido un token real ni marcado ningún
número. El interruptor permanece apagado y las credenciales específicas de la
app del navegador todavía no están configuradas.

La migración local `20261025195639_telefono_prueba_internet.sql` y las trece
baterías SQL pasaron en PostgreSQL embebido. Su aplicación remota devolvió
`McpServerError: Invalid or expired requestState` con `apply_migration` y con
`execute_sql`. Una consulta posterior confirmó que la tabla y el registro de
migración **no existen en remoto**. No seguir reintentando sin resolver el
conector. La revisión remota de seguridad solo mostró los avisos anteriores:
RLS sin políticas en tablas privadas y protección de contraseñas filtradas sin
activar. No se han cambiado esos ajustes.

Antes de activar:

1. Aplicar y verificar la migración en el proyecto de desarrollo
   `hjjhfgwzbqrrqrwurvvs`; no en producción. Verificar permisos y consumo único.
2. Crear una **TwiML App de salida** en Twilio con Voice URL POST:
   `https://agente-restaurante-git-migrac-db4675-reservas-projects-46f41d07.vercel.app/api/restaurante?canal=telefono_prueba`.
   No asignar esta app como recepción al propio número: produciría un bucle.
3. Si la Preview requiere Vercel Authentication, usar un bypass de automatización
   para ese callback y conservar la URL exacta únicamente en Twilio y en la
   variable sensible de Vercel. No desactivar la protección del proyecto.
4. Crear una API key Twilio para Voice SDK, de la misma cuenta y región Irlanda (IE1).
   Guardar el secreto directamente en Vercel, nunca en Git ni en el chat.
5. Configurar exclusivamente para esta rama de Preview:
   - `TWILIO_BROWSER_API_KEY_SID` y `TWILIO_BROWSER_API_KEY_SECRET`.
   - `TWILIO_BROWSER_APP_SID`.
   - `CONTACTIA_TWILIO_TEST_NUMBER`: el número +1 comprado ya existente.
   - `CONTACTIA_TWILIO_BROWSER_WEBHOOK_URL`: la Voice URL exacta de la app.
   - `CONTACTIA_TWILIO_BROWSER_ENABLED=1`, únicamente al finalizar los pasos.
   - `TWILIO_BROWSER_AUTH_TOKEN`: Auth Token de Irlanda (IE1), para verificar
     los webhooks regionales. No reutilizar el Auth Token US1 de otras funciones.
   Reutilizar únicamente `TWILIO_ACCOUNT_SID` de la misma cuenta. Hay variables
   globales de Preview y otras de la rama antigua; solo se ha consultado su
   existencia, no sus valores.
6. Comprobar una llamada iniciada manualmente con el botón y su importe real.
   El saldo y un registro anterior a cero no garantizan llamadas gratuitas.

## Conexión posterior con Contactia telefónica

Este botón marca el número real; **no conecta por sí solo al agente de LiveKit**.
El número ejecutará la ruta de recepción que tenga configurada en Twilio.
Antes de esperar una reserva completa hay que preparar esa recepción y el
transporte del worker al motor de reservas sin RPC del navegador. El agente
actual escucha al navegador LiveKit y no atiende todavía un participante
telefónico. No presentar esta preparación como una llamada telefónica completa
ya validada ni sustituir la recepción real del número sin conservar sus ajustes.

El enlace siguiente documenta el flujo oficial del SDK:
https://www.twilio.com/docs/voice/sdks/javascript

Configuración de TwiML y conexión posterior a LiveKit:
https://docs.livekit.io/telephony/accepting-calls/inbound-twilio/

## Validación

Pruebas del handler: destino fijo, firma, cuenta, SID, sesión reutilizada,
permisos del JWT, caducidad, cuotas, captcha, callback inaccesible, bucle y
costes propios. Pruebas de la página real en JSDOM: preparar, conectar, colgar,
colgar durante conexión, límite de duración, recibo manual, configuración
incompleta y CSP. Los proveedores y medios se simulan; no se hacen llamadas
ni se usan credenciales reales. La prueba con Twilio real está pendiente.

## Corrección de región tras la configuración guiada

Se indicó por error al usuario crear la app y clave en US1 por ser la región
predeterminada del código inicial. El 25/10 el usuario recordó el objetivo de
trabajar en Europa. Se corrige el navegador (claim twr=ie1), el cliente REST y la
validación de firmas con Auth Token regional. La app y la clave de esta prueba
deben estar en **Irlanda (IE1)**. No borrar recursos existentes de US1 ni cambiar
otras integraciones. Cambiar el selector de la consola solo muestra recursos:
no los traslada entre regiones. Sigue pendiente la activación documentada arriba.
