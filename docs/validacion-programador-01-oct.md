# Prueba controlada del programador — 1 de octubre de 2026

El activador periódico de Apps Script permanece eliminado. No ejecutar esta prueba antes de comprobar que se ha restablecido la cuota de Airtable. No crear reservas ficticias para forzar un aviso.

1. En el Apps Script existente de Contactia, pegar la función de `scripts/inspeccionar-avisos-contactia.gs`. Conserva las propiedades `CONTACTIA_AVISOS_SECRET` y `VERCEL_AUTOMATION_BYPASS_SECRET` que ya están en ese proyecto. Guardar. No instalar un activador.
2. Ejecutar **solo** `inspeccionarAvisosContactia` una vez y abrir **Ejecuciones**. El registro devuelve contadores, sin nombres ni direcciones: `vencidos`, `vigentes`, `desactualizados`, `consultas_airtable`.
3. Si `vencidos=0`, se confirma que la cola no ha leído Airtable. No activar el programador: aún no hay trabajo real para comprobar el recorrido. Si hay vencidos, se habrá hecho una sola lectura acotada por ID; `vigentes` indica trabajo que el ejecutor sí consideraría y `desactualizados` el que debe descartarse o reprogramarse.
4. Antes de invocar manualmente `comprobarAvisosContactia`, revisar que el/los avisos `vigentes` correspondan a reservas confirmadas que aún necesitan su correo; esa función sí puede enviar correos y escribir seguimiento. Si no hay una correspondencia clara, no ejecutarla y revisar el estado primero.
5. Tras una ejecución autorizada, comparar la respuesta de esa función con el estado del aviso y el consumo de Airtable. La siguiente inspección solo se hace si hay motivo concreto; no repetir cada cinco minutos para observar una cola vacía. Reinstalar el activador periódico únicamente después de validar que no se han duplicado envíos ni creado consultas inesperadas.

La nueva acción `inspeccionar_programados` exige el secreto de los avisos, solo está disponible en Preview y no escribe Redis/Airtable, no llama a Resend y no inicia llamadas o WhatsApp. Si Airtable aún devuelve 429, responde 503 y no altera el estado de las reservas. El uso repetido de esta inspección cuando hay vencidos consume una lectura de Airtable por ejecución.
