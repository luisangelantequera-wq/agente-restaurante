# Retenciones de mesas — Preview

## Estado de esta entrega

Implementación local y pruebas automatizadas con los servicios externos simulados.
No se ha ejecutado todavía contra Upstash real ni desplegado esta entrega.
El interruptor está apagado por defecto. Instalar Upstash no activa la protección.

## Configuración

Solo para la rama `prototipo-voz`, en el entorno **Preview**:

- `KV_REST_API_URL`: dirección REST inyectada por la integración.
- `KV_REST_API_TOKEN`: token de escritura inyectado por la integración, secreto.
- `CONTACTIA_RETENCIONES=1`: interruptor de activación explícita.
- `VERCEL_ENV=preview`: variable automática de Vercel, no crear manualmente.

No utilizar el token de solo lectura. No exponer variables al navegador, no incluirlas
en Git ni copiarlas a informes. No tocar Production. Usar Redis sin eviction.
La configuración se toma en un nuevo despliegue, no modifica uno ya existente.

## Comportamiento

1. La comprobación temprana de hora no retiene ninguna mesa.
2. Al verificar fecha, hora, personas y zona se elige y retiene una asignación completa
   antes de devolver `disponible: true`. Se incluyen todas las mesas de una combinación.
3. La oferta dura **3 minutos**, medidos con el reloj de Redis. El navegador recibe un
   token aleatorio de 192 bits; Redis almacena solo su hash y datos operativos.
4. La confirmación comprueba el token y los mismos datos; pasa de `ofrecida` a
   `guardando` atómicamente. Una segunda confirmación no vuelve a escribir en Airtable.
5. Tras confirmar en Airtable, el asiento Redis queda `confirmada`, vinculado al ID
   interno. Sigue protegiendo aunque una lectura posterior de Airtable fuese incompleta.
6. Corregir los datos sustituye la oferta. Rechazar el resumen o cerrar la pestaña
   intenta liberarla; la caducidad cubre cierres sin conexión. La liberación pública
   nunca elimina una reserva `guardando` o `confirmada`.
7. Si caduca, se conservan los datos del cliente, se verifica de nuevo y se solicita
   una nueva confirmación. No se confirma automáticamente otra mesa.
8. Panel, ocupación sin reserva, modificación, reactivación y cambio de mesas pasan
   por el mismo control. Cancelar o finalizar una reserva libera también su asiento.

Se comparan intervalos semiabiertos: 14:00–15:30 bloquea 15:00, pero permite 15:30.
Los asientos nuevos comparan también cruces de medianoche. La lectura histórica de
Airtable conserva su lógica original por fecha; no se garantiza corregir con este
cambio reservas antiguas nocturnas que no estén presentes en Redis.

## Atomicidad y límites

Cada restaurante tiene un documento independiente. Dos scripts Lua leen documento
y reloj, y hacen compare-and-set indivisible. Si cambia el documento se repite la
decisión, como máximo 12 veces. El límite temporal también se valida dentro del CAS.
No hay bloqueo con TTL que pueda caducar durante una escritura en Airtable.
No se utiliza una caché local como alternativa si Redis falla.

Esto **no es una transacción distribuida Redis–Airtable**. Ante una respuesta perdida
o una excepción después de iniciar la escritura, el asiento `guardando` permanece
bloqueado. Se prioriza evitar una doble reserva sobre recuperar disponibilidad.

La protección exige que todos los escritores usen el mismo control. **No cubre**
Producción antigua, previews antiguos, cambios manuales/importaciones en Airtable ni
otros programas que escriban directamente. Si comparten la base, no se puede afirmar
una garantía global de ausencia de duplicados. Antes de Producción hace falta
coordinar o retirar esos escritores.

Los asientos confirmados se limpian al operar sobre el restaurante después del fin
de su franja más un día de margen. No hay purga programada de esta estructura.
Los `guardando` inciertos no caducan automáticamente. Máximo 1000 asientos por
restaurante; al alcanzar el límite se rechaza la operación, no se desalojan retenciones.
No se guardan nombre, correo, teléfono, transcripción ni localizador público en Redis.

## Fallos y conciliación antes del uso real

Un `guardando` pendiente puede significar fallo antes del POST, respuesta perdida del
POST/PATCH, o reserva ya confirmada cuya actualización Redis falló. No borrar todo el
documento ni desactivar el interruptor para desbloquearlo: eso eliminaría la protección.

Antes de corregirlo manualmente: detener las operaciones sobre la reserva afectada,
comprobar que no queda una petición en ejecución y verificar en Airtable restaurante,
mesas y franja. Si hay una reserva confirmada, conservar el bloqueo y vincularlo al
registro correcto; si se demuestra que no hubo escritura ni petición pendiente,
descartar únicamente ese asiento. Una mera ausencia en una lectura no es prueba suficiente.
Falta una interfaz administrativa de conciliación; no se habilita recuperación automática
sin evidencia. Los errores de auditoría/correo posteriores no liberan una reserva creada.

## Verificación

```sh
npm test
npm run test:conversacion
```

Las pruebas nuevas ejecutan el módulo y el handler reales, con Redis y Airtable
simulados. Incluyen concurrencia entre instancias, combinaciones, caducidad, errores,
doble confirmación, cancelación, modificación y reservas desde el panel. La prueba de
la ruta heredada documenta que, con el interruptor apagado, sigue siendo vulnerable
ante vistas parciales; no confundirla con una garantía de esa ruta.

Para probar Lua/REST contra el recurso real, en un entorno autorizado que ya tenga
las variables de Preview, ejecutar:

```sh
node scripts/comprobar-retenciones-redis.js
```

No imprime secretos, no usa Airtable ni envía correos. Opera sobre una clave de
diagnóstico aislada; descarta sus asientos conocidos al terminar. Una respuesta de red
perdida podría dejar una oferta de diagnóstico durante tres minutos, sin mesas reales.
No se ha ejecutado todavía: las credenciales no están disponibles en el entorno local.

Después del despliegue: verificar dos solicitudes para la última mesa, confirmación,
abandono y caducidad en Preview, sin tráfico real y sin crear reservas en Producción.
No activar para clientes reales hasta completar esa comprobación y el procedimiento
de conciliación.
