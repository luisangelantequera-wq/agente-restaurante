# Redis real: diagnóstico del destino de WhatsApp

Fecha: 01/10/2026, 18:41 Europe/Madrid.

Resultado verificado en el registro de compilación del despliegue 8Xr36Sk6sXan9zPPsZ31mYpBb71b, commit 6eab1f8cbe551369a55e58beba6387d2bd293d64:

```json
{"ok":true,"comprobaciones":["alta_sin_sustitucion","una_escritura_simultanea","huella_y_version","ttl_sin_prorroga","caducidad"],"consultas_airtable":0,"mensajes_enviados":0,"registros_prueba_eliminados":true}
```

Se utilizó Redis de Preview con identificador ficticio appDiagnosticoRedis y prefijo aleatorio. No se consultó Airtable. Dos escrituras simultáneas aplicaron una sola transición; se validaron huella/versiones, conservación de TTL y caducidad. Las claves ficticias se eliminaron y se comprobó su ausencia.

La compilación termina deliberadamente con exit 1 después del diagnóstico para evitar publicar una web. La primera configuración excedía el límite de longitud del comando; el segundo intento carecía de AIRTABLE_BASE_ID en la rama aislada y no realizó operaciones externas. Ambos se corrigieron antes de la ejecución válida.

Las ramas main y prototipo-voz y la configuración global de Vercel no se modificaron durante el diagnóstico. La rama diagnostico-redis-20261001 quedó con un comando inerte que termina sin efectuar operaciones externas (commit 0612a4151e912b16427439327b7b10b14ebee3f2), para impedir repetir el diagnóstico accidentalmente. Pendiente la integración real de envíos, StatusCallback y proyección del estado en el centro.
