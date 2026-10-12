# Optimización de lectura de disponibilidad: horarios alternativos

## Objetivo
Evitar que la búsqueda de alternativas a una hora ocupada vuelva a consultar en Airtable todas las mesas, zonas y reservas por cada candidato.

## Cambio realizado
Se ha introducido `lib/lectura-alternativas.js`: una **foto efímera por petición** creada solo cuando existe al menos un horario candidato válido.

- Primero se revisan las operaciones de retención pendientes de ese restaurante (misma lógica conservadora previa).
- Después, una única lectura por conjunto de MESAS, ZONA y RESERVAS para el día y restaurante en cuestión.
- COMBINACIONES_MESAS se consulta únicamente si hace falta y como máximo una vez para esa búsqueda.
- La evaluación de cada hora conserva los filtros de restaurante, zona, capacidad, duración y estados de reserva.
- **La comprobación de bloqueos de Upstash para cada horario sigue haciéndose en tiempo real.**
- La foto se descarta al terminar esa solicitud. No se reutiliza entre clientes, días ni llamadas posteriores.
- `verificar`, `reservar`, `modificar` y `reactivar` continúan iniciando una lectura fresca y mantienen sus propios controles de conflictos; la foto se utiliza solo para **proponer horas alternativas**.

## Ahorro de peticiones a Airtable
Antes, revisar N horarios podía requerir N lecturas de MESAS, N de ZONA, N de RESERVAS y varias de COMBINACIONES_MESAS, además de las lecturas iniciales para la hora solicitada.
Ahora, para **todos los horarios de una misma búsqueda**, se realiza una lectura de cada conjunto y como máximo una de combinaciones, además de la lectura inicial.
Las comprobaciones en Upstash no desaparecen: mantienen la protección frente a otros clientes.

## Validaciones realizadas
- 7 pruebas aisladas de la clase de lecturas compartidas (sin peticiones reales).
- Ejecución simulada del módulo completo `api/chat.js`, con datos de prueba (misma mesa):
  - Reserva existente a las 14:00, duración 60 min.
  - Solicitud a las 14:15: no disponible, alternativas 15:00 y 15:15.
  - La combinación de búsqueda inicial y alternativas necesitó 2 lecturas de RESERVAS en lugar de una por candidato.
  - Una petición **nueva** después de liberar la reserva ofrece la mesa a las 14:15.
- Se añade además `test/alternativas-lecturas-api.test.js` para reproducir ese caso con el ejecutor habitual de Node.
- La sintaxis del servidor y los nuevos tests es correcta.
- Pendiente: ejecutar `npm test` íntegro y realizar prueba real después de recuperar la cuota de Airtable.

## Seguridad
- No se altera el código que confirma o crea una reserva, ni las transacciones de bloqueo/retención.
- No se incorpora una caché persistente o de varios clientes.
- Ante fallo de lectura, no se inventan alternativas.
- No modificar `main`, `prototipo-voz` ni `prueba-livekit-cartesia` hasta validar e integrar expresamente los cambios.

## Rama de pruebas
`optimizar-alternativas-airtable`, creada desde `medir-consumo-airtable`, que a su vez hereda el búfer de conversaciones. Las nuevas mejoras pueden fusionarse selectivamente en el orden previsto tras la aceptación.
