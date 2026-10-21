# Contactia — entorno Airtable Sandbox aislado

Preparado el 14/10/2026. **Solo rama Preview `corregir-bateria-pruebas`**.

## Dos espacios distintos

- Base principal: `Reservas Restaurantes IA` — `appI5U8eaG976ExdD`. No se ha tocado.
- Base anterior de restauración: `Contactia - Prueba de restauración` — `app6rSnGO92wrC4ml`. No se ha tocado.
- Base nueva: **`Contactia - Sandbox aislado (datos ficticios)`** — `appNFqY50AnEiDdPq`.
- La nueva base está en el **segundo espacio de trabajo**, `Espacio de trabajo`, distinta del espacio de trabajo principal `Mi primer espacio de trabajo`.

La cuota de Airtable Free se computa por espacio de trabajo. La base nueva permite separar los futuros ensayos del espacio original, aunque habrá que verificar su propio consumo antes de usarlos.

## Tablas y registros ficticios

Se crearon 9 tablas: `RESTAURANTES`, `ZONA`, `MESAS`, `COMBINACIONES_MESAS`, `RESERVAS`, `LISTA_ESPERA`, `AUDITORIA`, `CONOCIMIENTO_RESTAURANTE`, `CONVERSACIONES`, con 11 campos vinculados entre ellas.

La base tiene:
- Un restaurante ficticio: `Restaurante Sol (SANDBOX)`, `id=1`, `slug=restaurante-sol`, dirección ficticia, teléfonos de ejemplo y correo `example.invalid`.
- Tres zonas: `INTERIOR`, `TERRAZA`, `SALA VIP1`.
- Cinco mesas: capacidades de 2 y 4 personas, vinculadas a sus respectivas zonas.
- Sin reservas históricas ni datos personales reales.
- Horario de ejemplo, antelación de 30 minutos, duración 90 minutos.

**Advertencia:** Es un **esquema mínimo de ensayo**, no una copia exacta validada de toda la estructura de la base principal. Antes de probar cada funcionalidad (reserva, cambio de zona, panel, memoria, correo, etc.), comprobar que el esquema y los permisos se ajustan a los campos realmente usados. Algunas tablas son deliberadamente vacías.

## Vercel

Solo para `corregir-bateria-pruebas`:
- `AIRTABLE_BASE_ID` → `appNFqY50AnEiDdPq`.
- `CONTACTIA_SANDBOX_BASE_ID` → `appNFqY50AnEiDdPq`.
- `CONTACTIA_CACHE_PUBLICA=0`, expresamente apagada hasta validar credenciales y circuito.

Existe además un `AIRTABLE_API_KEY` de tipo sensitive aplicable tanto a Production como Preview. **No se ha revelado, reemplazado ni validado su permiso de acceso sobre la nueva base**, por lo que todavía no se debe dar por operativa la integración en vivo.

## Protección de seguridad (fail closed)

En la rama `corregir-bateria-pruebas`, `lib/contador-airtable.js` exige que `AIRTABLE_BASE_ID` y `CONTACTIA_SANDBOX_BASE_ID` coincidan, tengan aspecto de ID de Airtable válido y que toda petición a `api.airtable.com/v0/` use exclusivamente la base permitida. Rechaza la petición antes de usar la red si no coincide. Las restantes ramas no aplican esta regla experimental.

`test/aislamiento-base-preview.test.js` comprueba el aislamiento y que **ninguna** petición a la base principal sale cuando las variables están mal configuradas.

## Pendientes antes de pruebas reales

1. Confirmar que el token de Airtable usado en Preview tiene permisos suficientes **solo para la base Sandbox**; es preferible emitir un PAT separado y asignarlo únicamente a esta rama. No reutilizar sin revisar la credencial compartida con Production.
2. Revisar los campos y tipos que requieren los flujos de reserva contra el esquema mínimo, usando metadata; corregirlos en el Sandbox, no en producción.
3. Verificar el despliegue de rama después de asignar el identificador de base; variables nuevas no siempre se incorporan a despliegues antiguos.
4. Ejecutar una lectura de prueba controlada con la credencial de ensayo y monitorizar el número de solicitudes, previa aprobación del usuario.
5. Activar `CONTACTIA_CACHE_PUBLICA=1` **solo después** de verificar aislamiento, permiso y circuito de guardado.
6. Probar nombre y teléfonos desde el panel, cerrar la terraza y reservar con datos ficticios. Nunca habilitar correo, WhatsApp ni llamada real en esta fase.

**No modificar la producción ni ramas de Alondra.**
