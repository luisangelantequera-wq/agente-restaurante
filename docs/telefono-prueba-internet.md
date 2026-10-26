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

**Activado en Preview para la primera prueba real; todavía no validado de
principio a fin.** No se han emitido tokens reales ni marcado números desde
estas herramientas. Los dos interruptores se activaron después de completar
los pasos de configuración descritos a continuación. El
26/10 el usuario guardó las cuatro credenciales regionales de la aplicación en
Vercel, sensibles y solo para la rama de Preview. Se verificó su existencia y
ámbito, nunca sus valores. También están configurados el número de pruebas y
la URL de salida. El usuario añadió a esa URL el bypass de automatización, en
Vercel y en la app TwiML. No se ha comprobado todavía una petición con ese bypass.

La migración local `20261025195639_telefono_prueba_internet.sql` y las trece
baterías SQL pasaron en PostgreSQL embebido. Su aplicación automática remota devolvió
`McpServerError: Invalid or expired requestState` con `apply_migration` y con
`execute_sql`. Una consulta posterior confirmó que la tabla y el registro de
migración no existían en remoto. El 26/10, después de otro fallo del conector,
el usuario ejecutó el archivo desde el editor SQL del proyecto de desarrollo.
Se verificaron la tabla, RLS y los permisos: anon/authenticated no pueden leer
ni ejecutar la función de consumo, y service_role sí puede escribir y ejecutarla.
La ejecución manual no ha registrado la migración en schema_migrations; conservar
este dato antes de una sincronización futura por CLI. No repetir el DDL de la
tabla ya creada. La revisión remota de seguridad solo mostró los avisos anteriores:
RLS sin políticas en tablas privadas y protección de contraseñas filtradas sin
activar. No se han cambiado esos ajustes.

Antes de activar:

1. La primera migración ya está aplicada manualmente en desarrollo
   `hjjhfgwzbqrrqrwurvvs`. Aplicar y verificar ahora la ampliación
   `20261026211254_recepcion_telefono_prueba.sql`, aplicada manualmente el 26/10
   y verificada: columna y funciones presentes, sin acceso público y con ejecución
   permitida a service_role.
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

## Recepción telefónica preparada el 26/10

El botón marca el número real. El usuario verificó dos números en su inventario;
el de esta prueba es el primero, +19452125663. No se ha modificado ni liberado el
otro número, ni se sabe si tiene una tarifa gratuita. La recepción del número
de pruebas estaba sin URL en US1. El usuario cambió su región de voz a Irlanda
IE1; Messaging sigue en US1, según el aviso de Twilio para los números +1.
La ventana de recepción IE1 está comprobada: Webhook / Use Webhooks. Se indicó
cancelar sin guardar porque el código de recepción no estaba preparado.

Ahora `lib/telefono-entrada.js` prepara una recepción mediante el conector
Twilio de LiveKit, con `<Connect><Stream>` y Hangup al finalizar. Se exige firma
regional, cuenta y número exactos, dirección entrante y estado activo. Además
se comprueba la llamada en la API de Twilio y un único tramo de salida activo
hacia el número propio. Una función SQL vincula atómicamente su llamada padre
con una sesión del navegador autorizada y no caducada. No se acepta el caller ID
como autorización suficiente. Es una correlación para pruebas de una sola
llamada simultánea; si hay dos candidatos se rechaza. La visibilidad inmediata
de esos tramos en Twilio todavía debe validarse con una llamada real.

El registro transitorio de entrada impide crear varios conectores al reenviar
el mismo webhook. Si se pierde la respuesta de creación del conector, se rechaza
la repetición y se necesita iniciar otra prueba; no hay marcado automático.
No se reutiliza una sesión para otra llamada entrante. La nueva columna solo
guarda un Call SID, sin teléfonos ni conversación.

El worker mantiene un solo rtc_session, con el nombre de dispatch existente
`contactia-cartesia-prueba`. Las salas `contactia-telefono-*` usan el transporte
HTTP autenticado; las salas web mantienen su RPC con el navegador. En telefonía
se espera exclusivamente al participante CONNECTOR con identidad prevista.
Se reutiliza el motor de conversación y la reserva SQL con UUID fijo y cierre
por voz. No hay captcha al finalizar. El acceso al motor caduca a los tres
minutos y solo permite el estado opaco de su llamada, nunca datos elegidos por
el llamante. La dirección del motor con bypass se configura como secreto del
worker: no se incluye el bypass en metadata del job ni en la respuesta TwiML.
Si una respuesta HTTP se pierde, el worker conserva el turno y el token anterior
y pide «reintentar», evitando convertir un turno posterior en otra operación.

La llamada se termina al completar la locución final o al alcanzar tres minutos.
El worker borra la sala para finalizar el conector. Como límite adicional de
Twilio, el Dial de salida conserva su timeLimit de 180 segundos. `record=False`
sigue desactivando Agent Insights para la sesión. No se cambian modelos ni voz.
La función de Vercel api/restaurante queda en cdg1 (París) en esta rama Preview.
El cliente de servidor LiveKit desactiva failover. Esto no demuestra por sí solo
que todos los tránsitos de operadores o el conector permanezcan en la UE.

El coste consultado incluye navegador, salida e ingreso cuando este último está
vinculado. Call.price cubre conectividad; Media Streams, LiveKit, inferencia y
alquiler se contabilizan aparte y la página lo indica. No se estima que sea gratis.

### Configuración completada y primera prueba

El usuario aplicó y se verificó la ampliación SQL. Añadió el secreto del motor
en la pantalla Secrets del agente LiveKit, y ejecutó el despliegue de agent.py
del commit c878c9c929a380b6e27b273452b17370f50e6d7e; la CLI confirmó éxito. El usuario
guardó la recepción IE1 en Twilio con HTTP POST después de un error genérico de
su consola. Se activaron los dos interruptores solo para la rama de Preview y
el despliegue dpl_AJugZRyUMdRX6DoVQgbf6LoyhJ4H quedó READY. La primera pulsación
en Preparar no llegó a marcar: mostró «No se pudo cargar la llamada».

La carga de SDK se probaba antes con un Device simulado y no cubría su archivo
real. Se añade una prueba que carga el bundle real y alcanza la verificación,
sin crear dispositivos ni llamadas reales. Se versionan bundle y licencia en
vendor/, igual que LiveKit, para incluirlos como archivos de origen estáticos;
no depender de que postinstall los agregue al inventario estático del despliegue.
La versión sigue fijada y el test compara el bundle con la dependencia instalada.
Los errores distinguen ahora descarga fallida de librería no disponible.
Queda pendiente comprobar en el navegador del usuario la corrección y después
el recorrido telefónico completo. Las peticiones automáticas de comprobación
a Vercel reciben Security Checkpoint 429 incluso con el conector autenticado;
no se ha desactivado esa protección ni se ha confirmado el contenido HTTP del
archivo desde estas herramientas.

Orden seguido para la activación:

1. Aplicar la nueva migración de recepción en desarrollo y verificar permisos.
2. Guardar en los secretos del agente LiveKit `CONTACTIA_TELEFONO_MOTOR_URL`:
   la URL completa ya guardada en Vercel, cambiando solo `canal=telefono_prueba`
   por `canal=telefono_motor` y conservando el bypass. Nunca pegarla en el chat.
3. Actualizar agent.py en el directorio Windows de despliegue y redesplegar el
   agente CA_vkyHrJpZtdWT. Dockerfile y requisitos Python no cambian. Comprobar
   el registro del worker antes de activar.
4. En la recepción IE1 del número propio, guardar la misma URL completa base
   cambiando únicamente el canal por `telefono_entrada`, mediante HTTP POST.
   Es diferente de la URL de la app de salida; no poner la app de salida como recepción.
5. Crear `CONTACTIA_TWILIO_BROWSER_ENABLED=1` y
   `CONTACTIA_TWILIO_INBOUND_ENABLED=1`, solo en la rama Preview, y redesplegar.
6. Una única prueba manual de principio a fin. Verificar audio, confirmación,
   cierre y coste real. La recepción todavía no está validada contra proveedores.

El enlace siguiente documenta el flujo oficial del SDK:
https://www.twilio.com/docs/voice/sdks/javascript

Configuración de TwiML y conexión posterior a LiveKit:
https://docs.livekit.io/telephony/accepting-calls/inbound-twilio/

## Validación

Pruebas del handler: destino fijo, firma, cuenta, SID, sesión reutilizada,
permisos del JWT, caducidad, cuotas, captcha, callback inaccesible, bucle y
costes propios, incluido el tramo entrante. La recepción y el motor tienen
pruebas de firma, cuota, llamadas activas, correlación ambigua, reenvíos,
autorización, reserva completa y respuesta perdida tras guardar. El worker se
prueba sin proveedores: un único rtc_session, transporte web/telefónico,
serialización, validación de URL y recuperación del mismo turno. Pruebas de la
página real en JSDOM: preparar, conectar, colgar,
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
