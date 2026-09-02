const crypto = require("crypto");


const CAMPOS_SEGUROS_POR_TABLA = Object.freeze({
  RESTAURANTES: [
    "id",
    "nombre",
    "slug_publico",
    "prefijo_reserva",
    "telefono1",
    "telefono2",
    "email",
    "direccion",
    "horario_reservas",
    "intervalo_minutos",
    "dias_cierre",
    "cierres_especiales",
    "estado",
    "margen_capacidad",
    "duracion_reserva_minutos"
  ],
  MESAS: [
    "id",
    "nombre_mesa",
    "capacidad",
    "estado",
    "restaurante",
    "ultima_reserva",
    "notas",
    "zona"
  ],
  RESERVAS: [
    "restaurante",
    "mesa",
    "fecha",
    "hora",
    "personas",
    "estado",
    "duracion_reserva_minutos",
    "anonimizada",
    "anonimizada_en"
  ],
  COMBINACIONES_MESAS: [
    "id_combinacion",
    "nombre",
    "restaurante",
    "mesas",
    "capacidad",
    "estado",
    "prioridad",
    "notas"
  ],
  ZONA: [
    "id_zona",
    "nombre",
    "restaurante",
    "zona",
    "estado",
    "notas"
  ],
  LISTA_ESPERA: [
    "restaurante",
    "fecha",
    "hora",
    "personas",
    "estado",
    "reserva",
    "anonimizada",
    "anonimizada_en"
  ],
  AUDITORIA: [
    "evento_id",
    "fecha_hora",
    "restaurante_id",
    "accion",
    "origen",
    "estado_anterior",
    "estado_nuevo",
    "detalles"
  ]
});

const CAMPOS_PROHIBIDOS = Object.freeze([
  "api_key_restaurante",
  "clave",
  "emailCliente",
  "id_espera",
  "id_reserva",
  "mensaje",
  "nombreCliente",
  "nombre_completo",
  "observaciones",
  "reserva_id",
  "telefonoCliente",
  "telefono",
  "token_gestion"
]);


function clonarValor(valor) {
  if (Array.isArray(valor)) {
    return valor.map((elemento) => clonarValor(elemento));
  }

  if (valor && typeof valor === "object") {
    return Object.fromEntries(
      Object.entries(valor).map(([clave, contenido]) => [
        clave,
        clonarValor(contenido)
      ])
    );
  }

  return valor;
}


function seleccionarCamposSeguros(tabla, campos = {}) {
  const permitidos = CAMPOS_SEGUROS_POR_TABLA[tabla] || [];

  return Object.fromEntries(
    permitidos
      .filter((campo) => campos[campo] !== undefined)
      .map((campo) => [campo, clonarValor(campos[campo])])
  );
}


function crearCopiaSegura(registrosPorTabla, ahora = new Date()) {
  const tablas = {};

  for (const tabla of Object.keys(CAMPOS_SEGUROS_POR_TABLA)) {
    tablas[tabla] = (registrosPorTabla[tabla] || []).map((registro) => ({
      origen_id: String(registro.id || ""),
      fields: seleccionarCamposSeguros(tabla, registro.fields)
    }));
  }

  return {
    formato: "contactia-backup",
    version: 1,
    creado_en: new Date(ahora).toISOString(),
    contiene_datos_personales_clientes: false,
    tablas
  };
}


function obtenerClaveCifrado(claveBase64) {
  const clave = Buffer.from(String(claveBase64 || ""), "base64");

  if (clave.length !== 32) {
    throw new Error("La clave de cifrado de la copia no es válida.");
  }

  return clave;
}


function cifrarCopia(copia, claveBase64) {
  const clave = obtenerClaveCifrado(claveBase64);
  const iv = crypto.randomBytes(12);
  const texto = JSON.stringify(copia);
  const cifrador = crypto.createCipheriv("aes-256-gcm", clave, iv);
  const contenido = Buffer.concat([
    cifrador.update(texto, "utf8"),
    cifrador.final()
  ]);

  return {
    formato: "contactia-backup-encrypted",
    version: 1,
    algoritmo: "AES-256-GCM",
    creado_en: copia.creado_en,
    iv: iv.toString("base64"),
    tag: cifrador.getAuthTag().toString("base64"),
    sha256: crypto.createHash("sha256").update(texto).digest("hex"),
    contenido: contenido.toString("base64")
  };
}


function descifrarCopia(sobre, claveBase64) {
  const clave = obtenerClaveCifrado(claveBase64);
  const descifrador = crypto.createDecipheriv(
    "aes-256-gcm",
    clave,
    Buffer.from(sobre.iv, "base64")
  );

  descifrador.setAuthTag(Buffer.from(sobre.tag, "base64"));

  const texto = Buffer.concat([
    descifrador.update(Buffer.from(sobre.contenido, "base64")),
    descifrador.final()
  ]).toString("utf8");
  const firma = crypto.createHash("sha256").update(texto).digest("hex");

  if (firma !== sobre.sha256) {
    throw new Error("La copia no supera la verificación de integridad.");
  }

  return JSON.parse(texto);
}


function copiaContieneCamposProhibidos(copia) {
  const texto = JSON.stringify(copia).toLowerCase();

  return CAMPOS_PROHIBIDOS.some((campo) =>
    texto.includes(`"${campo.toLowerCase()}"`)
  );
}


module.exports = {
  CAMPOS_SEGUROS_POR_TABLA,
  cifrarCopia,
  copiaContieneCamposProhibidos,
  crearCopiaSegura,
  descifrarCopia,
  seleccionarCamposSeguros
};

