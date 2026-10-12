# Reducir consultas repetidas de configuración dentro de una verificación

## Problema observado
La acción `verificar` consulta primero el restaurante y su zona. Si no encuentra mesa, llama a varias funciones que vuelven a leer `MESAS` y `ZONA`, y pueden repetir `COMBINACIONES_MESAS`. Con horarios alternativos ya optimizados, seguía habiendo repeticiones entre la comprobación inicial, la compatibilidad de capacidad y las propuestas de otras horas.

## Solución
Se añade `lib/configuracion-solicitud.js`, una memoria **exclusiva de la ejecución de una petición HTTP `verificar`** (AsyncLocalStorage de Node). Guarda por tabla la promesa de la primera lectura completa, incluyendo todas las páginas.

- Una sola lectura de `RESTAURANTES` por identificador, `ZONA`, `MESAS` y `COMBINACIONES_MESAS` por verificación, aunque distintas funciones vuelvan a solicitarlas.
- Las combinaciones solo se consultan si son necesarias.
- La memoria se descarta al terminar la petición. Una solicitud posterior, incluso del mismo cliente, recupera la configuración nueva.
- **No se cachea `RESERVAS`**, ni los bloqueos de Upstash ni la revisión de retenciones.
- Para las acciones `reservar`, `reservar_panel`, `modificar`, `reactivar`, `cambiar_mesas` y demás acciones con escrituras no se activa la memoria: sus consultas y controles permanecen igual.

No se introduce una caché compartida con TTL porque el usuario modifica configuraciones en Airtable directamente y los cambios podrían quedar desactualizados sin invalidación.

## Comparación simulada de una verificación
Caso: una mesa de 2 personas ocupada de 14:00 a 15:00 y un cliente pide las 14:15. Se ofrecen 15:00 y 15:15.

| Tabla | Antes de esta mejora | Después |
| :-- | --: | --: |
| RESTAURANTES | 1 | 1 |
| ZONA | 4 | 1 |
| MESAS | 3 | 1 |
| RESERVAS | 2 | 2 |
| COMBINACIONES_MESAS | 1 | 1 |
| **Total** | **11** | **7** |

Los números son de un caso ficticio específico sin retenciones, no una predicción para todas las reservas. Las retenciones de Upstash se revisan en tiempo real como antes.

## Verificaciones
- 9 tests de lógica del ámbito de petición (deduplicación, clientes distintos, concurrencia, fallo de lectura, exclusión de escrituras).
- Prueba de la API con Airtable simulado: verificación ocupada, posterior liberación y posterior cambio de mesa a 'fuera de servicio'. La nueva petición siempre refleja el cambio.
- Sintaxis JS de las rutas modificadas validada.
- Pendiente ejecutar `npm test` completo con Node y pruebas reales cuando Airtable restablezca la cuota.

## Alcance
Rama `optimizar-configuracion-solicitud`, creada desde `optimizar-alternativas-airtable`. **No tocar ni fusionar** `main`, `prototipo-voz` o `prueba-livekit-cartesia` sin validación expresa.

La instrumentación del contador Airtable de ramas anteriores permite comparar posteriormente el consumo. Como la nueva rama es independiente, requiere asignar las variables de entorno necesarias en Vercel Preview antes de hacer pruebas reales.
