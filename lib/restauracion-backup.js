const crypto = require("crypto");
const {
  CAMPOS_SEGUROS_POR_TABLA,
  copiaContieneCamposProhibidos
} = require("./backup");


const TABLAS_RESTAURABLES = Object.freeze([
  "RESTAURANTES",
  "ZONA",
  "MESAS",
  "COMBINACIONES_MESAS",
  "RESERVAS",
  "LISTA_ESPERA",
  "AUDITORIA"
]);

const CAMPOS_PRIMARIOS = Object.freeze({
  RESTAURANTES: "id",
  ZONA: "id_zona",
  MESAS: "id",
  COMBINACIONES_MESAS: "id_combinacion",
  RESERVAS: "id_reserva",
  LISTA_ESPERA: "id_espera",
  AUDITORIA: "evento_id"
});

const CAMPOS_ENLACE = Object.freeze({
  RESTAURANTES: {},
  ZONA: { restaurante: "RESTAURANTES" },
  MESAS: {
    restaurante: "RESTAURANTES",
    zona: "ZONA"
  },
  COMBINACIONES_MESAS: {
    restaurante: "RESTAURANTES",
    mesas: "MESAS"
  },
  RESERVAS: {
    restaurante: "RESTAURANTES",
    mesa: "MESAS"
  },
  LISTA_ESPERA: {
    restaurante: "RESTAURANTES",
    reserva: "RESERVAS"
  },
  AUDITORIA: {}
});

const MODOS_RESTAURACION = new Set(["faltantes", "completa"]);
const PREFIJOS_IDENTIFICADORES_RECUPERADOS = Object.freeze({
  ZONA: "ZONA-RECUPERADA",
  COMBINACIONES_MESAS: "COMB-RECUPERADA",
  RESERVAS: "RECUPERADA",
  LISTA_ESPERA: "ESP-RECUPERADA",
  AUDITORIA: "AUD-RECUPERADO"
});
const LIMITE_REGISTROS_POR_TABLA = 10000;
const DURACION_CONFIRMACION_MS = 10 * 60 * 1000;


function clonar(valor) {
  if (Array.isArray(valor)) {
    return valor.map((elemento) => clonar(elemento));
  }

  if (valor && typeof valor === "object") {
    return Object.fromEntries(
      Object.entries(valor).map(([clave, contenido]) => [
        clave,
        clonar(contenido)
      ])
    );
  }

  return valor;
}


function idRecuperado(tabla, origenId) {
  const prefijo = PREFIJOS_IDENTIFICADORES_RECUPERADOS[tabla];

  if (!prefijo) {
    throw new Error(
      `No se puede generar de forma segura el identificador principal de ${tabla}.`
    );
  }

  const huella = crypto
    .createHash("sha256")
    .update(`${tabla}:${origenId}`)
    .digest("hex")
    .slice(0, 20)
    .toUpperCase();

  return `${prefijo}-${huella}`;
}


function valorPrimarioRestaurado(tabla, registro) {
  const campoPrimario = CAMPOS_PRIMARIOS[tabla];
  const guardado = registro?.fields?.[campoPrimario];

  if (guardado !== undefined && guardado !== null && guardado !== "") {
    return guardado;
  }

  if (PREFIJOS_IDENTIFICADORES_RECUPERADOS[tabla]) {
    return idRecuperado(tabla, registro.origen_id);
  }

  throw new Error(
    `La copia no contiene el identificador principal de ${tabla}.`
  );
}


function claveComparable(valor) {
  if (typeof valor === "number" && Number.isFinite(valor)) {
    return `n:${valor}`;
  }

  return `s:${String(valor ?? "").trim()}`;
}


function validarCopiaRestaurable(copia) {
  if (
    !copia ||
    typeof copia !== "object" ||
    copia.formato !== "contactia-backup" ||
    copia.version !== 1 ||
    copia.contiene_datos_personales_clientes !== false ||
    !copia.tablas ||
    typeof copia.tablas !== "object"
  ) {
    throw new Error("El archivo no es una copia válida de Contactia.");
  }

  if (!Number.isFinite(Date.parse(copia.creado_en))) {
    throw new Error("La fecha de creación de la copia no es válida.");
  }

  if (copiaContieneCamposProhibidos(copia)) {
    throw new Error("La copia contiene campos personales o secretos.");
  }

  for (const tabla of Object.keys(copia.tablas)) {
    if (!TABLAS_RESTAURABLES.includes(tabla)) {
      throw new Error(`La copia contiene una tabla no autorizada: ${tabla}.`);
    }
  }

  for (const tabla of TABLAS_RESTAURABLES) {
    const registros = copia.tablas[tabla];

    if (!Array.isArray(registros)) {
      throw new Error(`La tabla ${tabla} no tiene un formato válido.`);
    }

    if (registros.length > LIMITE_REGISTROS_POR_TABLA) {
      throw new Error(`La tabla ${tabla} supera el límite de seguridad.`);
    }

    const idsOrigen = new Set();
    const clavesPrimarias = new Set();

    for (const registro of registros) {
      if (
        !registro ||
        typeof registro !== "object" ||
        !/^rec[A-Za-z0-9]{10,24}$/.test(String(registro.origen_id || "")) ||
        !registro.fields ||
        typeof registro.fields !== "object" ||
        Array.isArray(registro.fields)
      ) {
        throw new Error(`La tabla ${tabla} contiene un registro no válido.`);
      }

      if (idsOrigen.has(registro.origen_id)) {
        throw new Error(`La tabla ${tabla} contiene registros duplicados.`);
      }
      idsOrigen.add(registro.origen_id);

      const permitidos = new Set(CAMPOS_SEGUROS_POR_TABLA[tabla] || []);
      const camposNoPermitidos = Object.keys(registro.fields).filter(
        (campo) => !permitidos.has(campo)
      );

      if (camposNoPermitidos.length > 0) {
        throw new Error(
          `La tabla ${tabla} contiene campos no autorizados para restaurar.`
        );
      }

      const campoPrimario = CAMPOS_PRIMARIOS[tabla];
      const valorPrimario = registro.fields[campoPrimario];

      // RESTAURANTES y MESAS usan identificadores numéricos. Una copia puede
      // conservar un registro antiguo vacío por su origen_id, pero solo se
      // exigirá su identificador numérico si realmente hubiera que recrearlo.
      if (
        (valorPrimario === undefined ||
          valorPrimario === null ||
          valorPrimario === "") &&
        !PREFIJOS_IDENTIFICADORES_RECUPERADOS[tabla]
      ) {
        continue;
      }

      const clave = claveComparable(valorPrimarioRestaurado(tabla, registro));

      if (clavesPrimarias.has(clave)) {
        throw new Error(
          `La tabla ${tabla} contiene identificadores principales duplicados.`
        );
      }
      clavesPrimarias.add(clave);
    }
  }

  validarReferencias(copia);
  return true;
}


function validarReferencias(copia) {
  const idsPorTabla = Object.fromEntries(
    TABLAS_RESTAURABLES.map((tabla) => [
      tabla,
      new Set(copia.tablas[tabla].map((registro) => registro.origen_id))
    ])
  );

  for (const tabla of TABLAS_RESTAURABLES) {
    for (const registro of copia.tablas[tabla]) {
      for (const [campo, tablaDestino] of Object.entries(CAMPOS_ENLACE[tabla])) {
        const enlaces = registro.fields[campo];

        if (enlaces === undefined) {
          continue;
        }

        if (!Array.isArray(enlaces)) {
          throw new Error(`El enlace ${tabla}.${campo} no es válido.`);
        }

        for (const origenId of enlaces) {
          if (!idsPorTabla[tablaDestino].has(origenId)) {
            throw new Error(
              `La copia contiene un enlace incompleto en ${tabla}.${campo}.`
            );
          }
        }
      }
    }
  }
}


function indexarActuales(tabla, actuales) {
  const porId = new Map();
  const porPrimario = new Map();
  const campoPrimario = CAMPOS_PRIMARIOS[tabla];

  for (const registro of actuales || []) {
    porId.set(registro.id, registro);
    const valor = registro?.fields?.[campoPrimario];

    if (valor === undefined || valor === null || valor === "") {
      continue;
    }

    const clave = claveComparable(valor);

    if (porPrimario.has(clave)) {
      throw new Error(
        `Airtable contiene identificadores principales duplicados en ${tabla}.`
      );
    }

    porPrimario.set(clave, registro);
  }

  return { porId, porPrimario };
}


function crearPlanRestauracion(copia, actualesPorTabla, modo = "faltantes") {
  validarCopiaRestaurable(copia);

  if (!MODOS_RESTAURACION.has(modo)) {
    throw new Error("El modo de restauración no es válido.");
  }

  const tablas = {};
  const mapeos = {};

  for (const tabla of TABLAS_RESTAURABLES) {
    const indices = indexarActuales(tabla, actualesPorTabla[tabla] || []);
    const faltantes = [];
    const existentes = [];
    const mapeo = new Map();

    for (const registro of copia.tablas[tabla]) {
      let actual = indices.porId.get(registro.origen_id) || null;

      // El identificador interno de Airtable es la coincidencia más precisa.
      // Solo necesitamos el campo principal —o generar uno técnico— cuando el
      // registro original ya no existe y hay que buscarlo o recrearlo.
      if (!actual) {
        const clave = claveComparable(
          valorPrimarioRestaurado(tabla, registro)
        );
        actual = indices.porPrimario.get(clave) || null;
      }

      if (actual) {
        existentes.push({ copia: registro, actual });
        mapeo.set(registro.origen_id, actual.id);
      } else {
        faltantes.push(registro);
      }
    }

    tablas[tabla] = { faltantes, existentes };
    mapeos[tabla] = mapeo;
  }

  return {
    modo,
    tablas,
    mapeos,
    resumen: Object.fromEntries(
      TABLAS_RESTAURABLES.map((tabla) => [tabla, {
        copia: copia.tablas[tabla].length,
        crear: tablas[tabla].faltantes.length,
        actualizar: modo === "completa"
          ? tablas[tabla].existentes.length
          : 0,
        conservar: modo === "faltantes"
          ? tablas[tabla].existentes.length
          : 0
      }])
    )
  };
}


function camposSinEnlaces(tabla, registro, incluirPrimarioGenerado = false) {
  const enlaces = new Set(Object.keys(CAMPOS_ENLACE[tabla]));
  const campos = Object.fromEntries(
    Object.entries(registro.fields)
      .filter(([campo]) => !enlaces.has(campo))
      .map(([campo, valor]) => [campo, clonar(valor)])
  );
  const campoPrimario = CAMPOS_PRIMARIOS[tabla];

  if (
    incluirPrimarioGenerado &&
    campos[campoPrimario] === undefined
  ) {
    campos[campoPrimario] = valorPrimarioRestaurado(tabla, registro);
  }

  return campos;
}


function camposEnlaceRemapeados(tabla, registro, mapeos) {
  const resultado = {};

  for (const [campo, tablaDestino] of Object.entries(CAMPOS_ENLACE[tabla])) {
    if (registro.fields[campo] === undefined) {
      continue;
    }

    resultado[campo] = registro.fields[campo].map((origenId) => {
      const destinoId = mapeos[tablaDestino].get(origenId);

      if (!destinoId) {
        throw new Error(
          `No se pudo reconstruir el enlace ${tabla}.${campo}.`
        );
      }

      return destinoId;
    });
  }

  return resultado;
}


function resumenTotal(resumen) {
  return Object.values(resumen).reduce(
    (total, tabla) => ({
      copia: total.copia + tabla.copia,
      crear: total.crear + tabla.crear,
      actualizar: total.actualizar + tabla.actualizar,
      conservar: total.conservar + tabla.conservar
    }),
    { copia: 0, crear: 0, actualizar: 0, conservar: 0 }
  );
}


function crearTokenConfirmacion({
  archivo,
  sha256,
  modo,
  secreto,
  ahora = Date.now()
}) {
  if (!secreto || !MODOS_RESTAURACION.has(modo)) {
    throw new Error("No se pudo crear la confirmación de restauración.");
  }

  const contenido = Buffer.from(JSON.stringify({
    archivo,
    sha256,
    modo,
    expira: Number(ahora) + DURACION_CONFIRMACION_MS,
    nonce: crypto.randomBytes(12).toString("hex")
  })).toString("base64url");
  const firma = crypto
    .createHmac("sha256", secreto)
    .update(contenido)
    .digest("base64url");

  return `${contenido}.${firma}`;
}


function validarTokenConfirmacion(token, {
  archivo,
  sha256,
  modo,
  secreto,
  ahora = Date.now()
}) {
  try {
    const [contenido, firma] = String(token || "").split(".");

    if (!contenido || !firma || !secreto) {
      return false;
    }

    const esperada = crypto
      .createHmac("sha256", secreto)
      .update(contenido)
      .digest("base64url");
    const recibidaBuffer = Buffer.from(firma);
    const esperadaBuffer = Buffer.from(esperada);

    if (
      recibidaBuffer.length !== esperadaBuffer.length ||
      !crypto.timingSafeEqual(recibidaBuffer, esperadaBuffer)
    ) {
      return false;
    }

    const datos = JSON.parse(Buffer.from(contenido, "base64url").toString());

    return Boolean(
      datos.archivo === archivo &&
      datos.sha256 === sha256 &&
      datos.modo === modo &&
      Number(datos.expira) >= Number(ahora)
    );
  } catch {
    return false;
  }
}


module.exports = {
  CAMPOS_ENLACE,
  CAMPOS_PRIMARIOS,
  TABLAS_RESTAURABLES,
  camposEnlaceRemapeados,
  camposSinEnlaces,
  crearPlanRestauracion,
  crearTokenConfirmacion,
  idRecuperado,
  resumenTotal,
  validarCopiaRestaurable,
  validarTokenConfirmacion,
  valorPrimarioRestaurado
};

