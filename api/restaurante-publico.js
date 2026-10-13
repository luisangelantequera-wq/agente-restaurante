const fetchAirtableContado = require("../lib/contador-airtable").crearFetchMedido("configuracion");
const crypto = require("crypto");
const {
  normalizarRestaurantePublico,
  slugPublicoValido
} = require("../lib/restaurante-publico");
const { leerConCachePublica } = require("../lib/cache-publica");


function responder(res, status, datos) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  return res.end(JSON.stringify(datos));
}


function registroConversacionesHabilitado(
  slugPublico,
  entorno = process.env
) {
  return entorno.VERCEL_ENV === "preview" &&
    slugPublico === "restaurante-sol";
}


function obtenerSlugSolicitud(req) {
  if (typeof req.query?.slug === "string") {
    return req.query.slug;
  }

  try {
    return new URL(
      req.url || "/api/restaurante-publico",
      "https://contactia.net"
    ).searchParams.get("slug") || "";
  } catch {
    return "";
  }
}


async function consultarAirtable(url) {
  const respuesta = await fetchAirtableContado(url, {
    headers: {
      Authorization: `Bearer ${process.env.AIRTABLE_API_KEY}`
    }
  });
  const texto = await respuesta.text();
  let datos;

  try {
    datos = texto ? JSON.parse(texto) : {};
  } catch {
    throw new Error(
      `Airtable devolvió una respuesta no válida. HTTP ${respuesta.status}`
    );
  }

  if (!respuesta.ok) {
    throw new Error(`Error de Airtable. HTTP ${respuesta.status}`);
  }

  return datos;
}


async function consultarRestaurante(slugPublico) {
  const formula =
    `AND({slug_publico}='${slugPublico}',LOWER({estado})='activo')`;
  const parametros = new URLSearchParams({
    filterByFormula: formula,
    maxRecords: "2"
  });

  for (const campo of ["id", "nombre", "slug_publico", "estado"]) {
    parametros.append("fields[]", campo);
  }

  const url =
    `https://api.airtable.com/v0/` +
    `${process.env.AIRTABLE_BASE_ID}/RESTAURANTES?${parametros}`;
  const datos = await consultarAirtable(url);

  const registros = Array.isArray(datos.records) ? datos.records : [];

  if (registros.length > 1) {
    throw new Error("El identificador público está duplicado.");
  }

  return registros[0] || null;
}


async function consultarZonasActivas(restauranteRecordId) {
  const registros = [];
  let offset = "";
  let paginas = 0;

  do {
    const parametros = new URLSearchParams({ pageSize: "100" });

    for (const campo of [
      "id_zona",
      "nombre",
      "zona",
      "estado",
      "restaurante"
    ]) {
      parametros.append("fields[]", campo);
    }

    if (offset) {
      parametros.set("offset", offset);
    }

    const datos = await consultarAirtable(
      `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/` +
      `ZONA?${parametros}`
    );

    registros.push(...(Array.isArray(datos.records) ? datos.records : []));
    offset = typeof datos.offset === "string" ? datos.offset : "";
    paginas += 1;

    if (paginas > 100) {
      throw new Error("La lista de zonas supera el límite permitido.");
    }
  } while (offset);

  return registros
    .filter((registro) => {
      const restaurantes = Array.isArray(registro.fields?.restaurante)
        ? registro.fields.restaurante
        : [];
      const estado = String(registro.fields?.estado || "activo")
        .trim()
        .toLowerCase();

      return restaurantes.includes(restauranteRecordId) &&
        estado !== "inactivo";
    })
    .map((registro) => ({
      nombre: String(
        registro.fields?.nombre ||
        registro.fields?.zona ||
        registro.fields?.id_zona ||
        ""
      ).trim()
    }))
    .filter((zona) => zona.nombre);
}


// Solo se memoriza el resumen PÚBLICO: id, nombre, slug y zonas.
// Los permisos de WhatsApp se calculan siempre con el entorno ACTUAL.
function fichaPublicaValida(datos, slug) {
  if (!datos || typeof datos !== "object" || Array.isArray(datos)) return false;
  const campos = Object.keys(datos);
  if (campos.length !== 4 ||
      campos.some(c => !["id", "nombre", "slug_publico", "zonas"].includes(c))) {
    return false;
  }
  if (!Array.isArray(datos.zonas) ||
      datos.zonas.some(z => !z || typeof z.nombre !== "string")) return false;
  return normalizarRestaurantePublico(datos, slug) !== null;
}

async function cargarFichaPublica(slugPublico) {
  const registro = await consultarRestaurante(slugPublico);
  if (!registro) return null;
  const zonas = await consultarZonasActivas(registro.id);
  return normalizarRestaurantePublico(
    { ...registro.fields, zonas },
    slugPublico
  );
}

module.exports = async (req, res) => {
  if (req.method !== "GET") {
    return responder(res, 405, {
      ok: false,
      error: "Método no permitido."
    });
  }

  const slugPublico = obtenerSlugSolicitud(req);

  if (!slugPublicoValido(slugPublico)) {
    return responder(res, 400, {
      ok: false,
      error: "El identificador del restaurante no es válido."
    });
  }

  try {
    const ficha = await leerConCachePublica({
      tipo: "ficha",
      identificador: slugPublico,
      cargar: () => cargarFichaPublica(slugPublico),
      validar: datos => fichaPublicaValida(datos, slugPublico)
    });

    if (!ficha) {
      return responder(res, 404, {
        ok: false,
        error: "Restaurante no encontrado."
      });
    }

    // Nunca cachear el consentimiento: depende del despliegue/entorno.
    const whatsappHabilitado =
      require("../lib/consentimiento-whatsapp").habilitado();

    return responder(res, 200, {
      ok: true,
      restaurante: {
        ...ficha,
        ...(whatsappHabilitado ? { consentimiento_whatsapp: true } : {})
      },
      ...(registroConversacionesHabilitado(slugPublico)
        ? { registro_conversaciones_habilitado: true }
        : {})
    });
  } catch (error) {
    const idError = crypto.randomBytes(6).toString("hex");

    console.error(`ERROR RESTAURANTE PÚBLICO [${idError}]:`, error);

    return responder(res, 500, {
      ok: false,
      error: `Error interno del servidor. Código: ${idError}`
    });
  }
};


module.exports.registroConversacionesHabilitado =
  registroConversacionesHabilitado;
