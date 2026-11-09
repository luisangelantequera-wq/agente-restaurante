# Datos públicos y respuestas informativas en Supabase

El panel de pruebas incluye «Datos públicos e información del restaurante». Mantiene el formato ancho de ordenador, con dos columnas. Guarda nombre, teléfono público, dirección, web y los siete temas existentes: aparcamiento, accesibilidad, mascotas, infancia, grupos, pagos e información gastronómica.

Reutiliza `ajustes-restaurante.validarPublico`, `normalizarPublico`, `registrosPublicos`, `responderGastronomia` y `describirHorario`, y el selector de `conocimiento-restaurante`. No importa carta, crea zonas ni registra encargos de platos. No añade consultas a Airtable, temporizadores o llamadas a modelos de IA.

## Escritura y permisos

Los campos están en `restaurantes`, con la RLS por pertenencia activa existente. Solo propietario y encargado activos guardan mediante `guardar_datos_restaurante_panel`: envoltorio `SECURITY INVOKER` de una función privada `SECURITY DEFINER` con `auth.uid()`, pertenencia comprobada dentro de la transacción y `search_path` vacío. No se habilita escritura directa ni ejecución para `anon` o `service_role`.

JavaScript y PostgreSQL rechazan campos ajenos, nombres vacíos, textos excesivos, teléfonos inválidos y webs con protocolos distintos de http/https o credenciales. Los textos se muestran con `textContent`. La versión detecta una edición obsoleta; guardar los mismos datos no cambia la versión. Se registra usuario y fecha. No se alteran horarios, zonas, mesas, reservas ni avisos existentes.

## Chat

`supabase_web_informacion` recibe una pregunta de hasta 500 caracteres, usa la cuota de lectura compartida y lee solamente campos públicos del restaurante. Devuelve el texto de respuesta sin IDs internos, claves o clientes. Conserva las protecciones de rama/Preview, origen, IP y activación del formulario. Lee al consultar información: un guardado repercute en la siguiente pregunta, incluso en un chat abierto.

La conversación distingue consultas informativas de datos de reserva. Responde «¿Dónde estáis?», «¿Admitís perros?», «¿Tenéis tronas?» o «¿Qué tenéis los jueves?» y vuelve al dato pendiente. Conserva el paso durante resumen y correcciones. No interrumpe una confirmación de resultado incierto ni interpreta como consultas respuestas simples como «hora», «2», «mañana» o un nombre.

Los horarios respetan las reglas habituales, fechas especiales y zona horaria. La gastronomía conserva días y mínimos de los textos; no implica disponibilidad de mesa ni registra comida. La información no configurada se reconoce como desconocida. Las preguntas sobre alérgenos, ingredientes o adaptación de platos se derivan al restaurante con su teléfono público, si existe.

Validación: `npm test`, `npm run test:supabase`, pruebas de API y conversación, y `12_datos_publicos.sql` con ROLLBACK. La comprobación de interfaz simula un guardado y una consulta durante la reserva. Despliegue limitado a `migracion-supabase-fase-1`; producción conserva su proveedor.
