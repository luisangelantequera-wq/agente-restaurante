# Ensayo de alta: Restaurante Cielo

Entorno: Contactia de desarrollo y rama Preview `migracion-supabase-fase-1`.
Identificador público: `prueba-cielo`. Se crea sin reservas web activas.
Dos zonas (Interior y Terraza), dos mesas por zona (2 y 4 plazas), duración
de 90 minutos, entradas cada 15 minutos, 45 minutos de antelación y cierre los lunes.

## Recorrido que se comprobó

La prueba `test/aislamiento-restaurantes-recorrido.test.js` aplica las migraciones
a PostgreSQL efímero, crea Cielo con el mismo seed del entorno de pruebas y le
asigna una cuenta de propietario ficticia. La API del panel devuelve solo Cielo;
las consultas cruzadas con Sol y Luna se rechazan. La comprobación usa RLS real,
pero simula la identidad de Auth y no verifica un inicio de sesión en remoto.

El formulario se habilita dentro de esa prueba: reserva a las 14:00, cambio a
las 15:00 y cancelación desde el enlace privado. Se verifica que la mesa queda
libre, que Sol y Luna no cambian y que se genera un correo distinto para cada
paso. La verificación del formulario y el proveedor de correo se simulan.
No se prueba entrega a un buzón, WhatsApp ni telefonía de Cielo.

## Qué podemos hacer desde el panel y qué falta

| Paso | Situación |
| --- | --- |
| Crear la ficha con nombre e identificador único | El primer alta todavía requiere un seed o la base de datos. |
| Ajustar horarios, antelación e intervalo | Disponible en la ficha interna. |
| Crear zonas y mesas con sus capacidades iniciales | Todavía requiere el seed o la base de datos. |
| Crear el acceso del propietario y vincularlo al restaurante | El recorrido usa una cuenta ficticia; la operativa real requiere Auth y asignar la pertenencia. |
| Habilitar la reserva web | Disponible en el panel para los restaurantes de prueba que admite el servidor. La lista de pruebas sigue siendo explícita; no habilita locales reales. |
| Confirmar recepción en un buzón real | Pendiente de usar una dirección controlada y autorizada en el entorno de pruebas. |

Siguiente mejora: asistente interno «Nuevo restaurante» que cree primero un
borrador privado, guíe la configuración de zonas y mesas y permita preparar el
acceso de su propietario antes de activar la web. La voz y las notificaciones
deben revisarse por separado antes del alta de un restaurante real.

El seed `supabase/seed-piloto-cielo.sql` se ejecuta solo en desarrollo; es
idempotente y nunca sobrescribe un restaurante o mesas ya existentes.
