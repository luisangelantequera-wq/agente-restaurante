# Flujo telefónico de reservas y gestión

## Secuencia acordada

- Saludo: «Bienvenido al sistema de reservas del Restaurante Sol. ¿En qué le puedo ayudar?».
- Reserva nueva: pedir día y hora, y después personas. Aprovechar los datos adelantados, sin confundir comensales con horas.
- Modificación genérica: teléfono, código y elección entre día, hora o personas.
- Modificación concreta: conservar campo y valor expresados antes de identificar al cliente. Tras teléfono y código, continuar con ese cambio.
- Cancelación: teléfono, código y confirmación explícita antes de cancelar.
- Todas las modificaciones requieren un sí final. Si no hay disponibilidad, conservar reserva y ocupación originales.

## Cambio de personas

`gestionar_personas_voz` utiliza el enlace autorizado por teléfono y código, conserva día, hora y zona y asigna una mesa adecuada o una combinación configurada. La exclusión de ocupación impide solapamientos. Un intento fallido revierte la reasignación; los reintentos recuperan la misma operación. Comprueba tanto el inicio anterior como el número de personas anterior para detectar cambios simultáneos.

No cambia el teléfono, el código de gestión ni los datos personales. Igual que la modificación de día/hora existente, no genera automáticamente una segunda notificación por correo o WhatsApp.

## Publicación

1. Aplicar `20261105153425_modificar_personas_voz.sql` en el proyecto de desarrollo `hjjhfgwzbqrrqrwurvvs` y verificar permisos exclusivos de `service_role`.
2. Publicar el commit en `migracion-supabase-fase-1` y comprobar Preview READY. La nueva gestión de personas depende de la función SQL anterior.
3. El saludo está en el worker: actualizar `experimentos/livekit/agent.py` en la carpeta local del agente de pruebas y ejecutar `lk agent deploy --id CA_vkyHrJpZtdWT`. Publicar Vercel no sustituye este paso.
4. Probar una llamada real; las pruebas automáticas no verifican la locución del worker desplegado.

Validación local: `npm test` (902 pruebas) y `npm run test:supabase`. Incluye consentimiento y contactos existentes, confirmación previa, falta de capacidad, mesa ocupada, reasignación, combinaciones autorizadas, reintento sin duplicado y detección de cantidad modificada concurrentemente.
