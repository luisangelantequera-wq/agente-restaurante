# Contactia — recuperación de la batería automatizada

Fecha de validación: 14 de octubre de 2026.
Rama aislada: `corregir-bateria-pruebas`, basada en `panel-sincronizar-cache-publica`.

## Estado anterior

La batería de Node 22 en la rama anterior contenía **567 pruebas**: 501 correctas, 63 fallidas y 3 canceladas. La batería conversacional de frases pasaba 14/14, pero los 13 flujos completos fallaban por `Cannot read properties of undefined (reading 'crearGestor')`.

La comparación inicial se ejecutó en GitHub Actions con los servicios reales deshabilitados (sin credenciales de Airtable, Upstash ni Twilio).

## Causas y correcciones

1. **Simulador conversacional desactualizado:** `test/soporte/simulador-conversacion.js` no proporcionaba `window.ContactiaGuardadoConversaciones`, aunque `index.html` carga ese módulo antes de `script.js`. El simulador vuelve a reproducir el navegador sin modificar las reglas de conversación.
2. **Contador de Airtable no aislado en los VM de pruebas:** `test/concurrencia-reservas.test.js` y `test/retenciones-api.test.js` importaban el contador desde Node, fuera de su VM de `fetch` ficticio. Los simuladores ahora pasan `fetchImpl: fetchFalso` explícitamente al contador para evitar red real y conservar intactas las comprobaciones de disponibilidad y bloqueo.
3. **Programador desactivado por política de ahorro:** el código del programador solo permite trabajar automáticamente cuando `CONTACTIA_PROGRAMADOR_AUTOMATICO=true`. Las pruebas de `test/cola-avisos.test.js` y la integración de `test/llamada-seguimiento.test.js` activan esta bandera **solo durante sus escenarios simulados** y restauran el entorno al terminar. El proyecto operativo sigue en modo manual.
4. **Fechas de prueba caducadas:** el reloj de `test/revision-retenciones.test.js` usa un instante simulado correspondiente al 1 de octubre, la fecha de la reserva ficticia; `test/aviso-restaurante.test.js` emplea una reserva futura para la prueba del panel. Evitamos que la expiración legítima por fecha invalide escenarios que no pretendían probar el paso del tiempo.
5. **Aserciones de interfaz antiguas:** `test/centro-conversaciones.test.js` ya no exige un `setTimeout` de 1200 ms que dejó de existir al delegar en `lib/guardado-conversaciones.js`; ahora verifica que el gestor tiene su temporizador de inactividad de 90 segundos y que se cierra al abandonar. `test/revision-retenciones-ui.test.js` comprueba que la consulta de retenciones **no se hace automáticamente**, sino al pulsar el botón manual `Actualizar operaciones`, respetando el ahorro de Airtable.

## Validaciones de Node 22 en GitHub Actions

- `npm test`: **567/567** pruebas aprobadas, **0 errores, 0 canceladas**.
- `npm run test:conversacion`: **14/14 frases y 13/13 flujos** aprobados.
- Pruebas específicas de los cambios recientes de memoria, panel y disponibilidad: **40/40** aprobadas.
- Flujo automatizado en `.github/workflows/bateria-contactia-preview.yml`: ejecuta tanto las pruebas específicas como la regresión y la batería conversacional. Se eliminó la ejecución redundante de la rama anterior: su fallo conocido mantenía GitHub Actions en rojo aunque la rama reparada estuviera completamente en verde.

**No se realizaron pruebas contra Airtable, Redis, Resend o Twilio reales**. Los tests usan respuestas ficticias; la ejecución real en Vercel y el panel requiere una prueba posterior cuando se restablezca la cuota de Airtable.

## Límites y próximos pasos

- Ningún cambio en el motor de reservas real `api/chat.js`, la lógica de bloqueos `lib/retenciones-mesas.js` o el programador. Los cambios afectan a simuladores, pruebas y al workflow de CI.
- Las pruebas integradas de Preview con credenciales reales permanecen pendientes y deben ejecutarse **sin fusionar** esta rama en producción.
- El siguiente paso tras recuperar Airtable es medir la reducción de peticiones con el contador y validar cambios de nombre/teléfonos desde el panel, comprobando simultáneamente que el cierre de una zona se refleja en la próxima verificación.
