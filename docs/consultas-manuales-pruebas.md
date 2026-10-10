# Consultas manuales durante las pruebas

En Preview de `prototipo-voz`, el centro de conversaciones valida la sesión sin
leer Airtable. Iniciar sesión y cambiar los filtros tampoco carga datos.
Cada botón actualiza exclusivamente su apartado: conversaciones, avisos u
operaciones. No hay refresco periódico en este panel.

El botón **Comprobar avisos pendientes** usa la acción administrativa existente
`inspeccionar_programados`: no envía correos, WhatsApp ni llamadas. Con una cola
vacía o pausada devuelve cero consultas a Airtable. Si hay trabajos vencidos,
hace la lectura acotada que utiliza la inspección existente.

El ejecutor de Apps Script devuelve `pausado: true`, `modo: manual` y cero
consultas por defecto. Esto también evita consumo desde un activador antiguo
que siga llamando al endpoint de este Preview. Para recuperar la ejecución
automática en el futuro será necesario configurar explícitamente
`CONTACTIA_PROGRAMADOR_AUTOMATICO=true` en Preview y desplegar de nuevo.
Mientras esté en modo manual, los reintentos programados de correo, WhatsApp y
llamadas no se ejecutan. Las acciones específicas de las consolas de pruebas
conservan su funcionamiento.

El cambio no recupera la cuota ya agotada ni modifica producción, copias de
seguridad o activadores instalados en Google. Conviene retirar el activador de
avisos ejecutando `detenerComprobacionesContactia` en el Apps Script existente;
el bloqueo del endpoint permite hacerlo sin urgencia. No borrar el proyecto
Apps Script, sus propiedades, ni la aplicación de Drive que almacena copias y
audios. Comprobar por separado los activadores de copias antes de cambiar su
frecuencia; no confundirlos con la retención de archivos.

Validación: prueba de interfaz con peticiones simuladas para entrada, sesión,
filtros y botones; prueba del ejecutor en modo manual sin peticiones externas;
pruebas existentes del centro administrativo y del motor de avisos.
