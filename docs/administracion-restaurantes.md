# Administración interna de restaurantes

Preview de migracion-supabase-fase-1, Supabase de desarrollo. Entrada:
`/administracion-restaurantes.html`. Usa la sesión administrativa firmada
del Centro Contactia; las sesiones del propietario no conceden acceso.

Búsqueda manual global (nombre, slug, teléfono, dirección y otros valores
de la fila), paginación de veinte fichas, resumen compacto y detalle editable.
El detalle permite consultar los 23 campos actuales de restaurantes (incluye
los campos técnicos sin editar). Edita nombre, datos públicos, zona horaria,
duración, antelación, intervalo, activación web, horarios y cierres. Conserva
identificadores y referencias de reservas; no cambia slug ni ID.

La ficha guarda por separado estado del servicio, modalidad, cuota mensual,
suplemento de voz, moneda, proveedor/voz acordados, estado de activación,
teléfono de reservas, contacto (nombre, teléfono directo y correo) y notas. No contiene claves de proveedores.
Estas condiciones son de gestión interna: no disparan cobros ni despliegues.
Cambiar la voz se marca pendiente; la verificación se registra manualmente.
No cambia el agente LiveKit ni necesita llamadas para comprobar el panel.

Escritura transaccional con huella optimista de la fila y la configuración,
bloqueo de fila compartido con el panel, historial antes/después, incremento
de versiones de datos/horarios. Nunca reescribe reservas. El guardado de cambios
operativos avisa que se deben revisar las reservas existentes afectadas.

Las dos tablas nuevas están en contactia_privado, con RLS sin políticas para
usuarios. Solo service_role accede a la RPC SECURITY INVOKER; la API verifica
rama, entorno, origen y sesión interna antes de crear el cliente servidor.
El historial identifica la sesión compartida como Administración Contactia;
no pretende identificar a una persona concreta. Últimas 30 entradas visibles.

No incluye eliminación de restaurantes, altas de propietarios,
facturación automática ni despliegue de proveedores. Los datos estructurados adicionales se muestran mediante campos anidados;
se conservan las propiedades existentes.

## Alta durante una visita

«Nuevo restaurante» abre una ficha en blanco para anotar nombre, contacto,
horarios, condiciones de reserva, información para clientes, voz y notas.
Solo se exige el nombre. El identificador público se genera a partir del
nombre; si ya existe, se pide revisar la ficha o distinguir la ubicación.

Se pueden añadir zonas y mesas iniciales con sus plazas antes del primer
guardado. La ficha y esos datos se crean en la misma transacción. Si falta
información, se puede guardar el borrador y reabrir la ficha para completar
sus datos generales. La edición posterior de la distribución de mesas y el
alta del usuario propietario se realizan por separado.

La ficha se crea con estado Borrador y las reservas web desactivadas. El
botón no añade el local a la lista pública de pruebas, no crea un usuario
y no envía invitaciones, avisos ni solicitudes de contratación.
