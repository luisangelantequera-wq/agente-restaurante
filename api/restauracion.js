const crypto = require("crypto");
const { descifrarCopia } = require("../lib/backup");
const { registrarAuditoria } = require("../lib/auditoria");
const { solicitarJsonGoogle } = require("../lib/google-drive");
const {
  TABLAS_RESTAURABLES,
  camposEnlaceRemapeados,
  camposSinEnlaces,
  crearPlanRestauracion,
  crearTokenConfirmacion,
  resumenTotal,
  validarCopiaRestaurable,
  validarTokenConfirmacion
} = require("../lib/restauracion-backup");
const { ejecutarBackup } = require("./backup");


const PATRON_ARCHIVO =
  /^contactia-backup-\d{4}-\d{2}-\d{2}(?:-antes-restaurar-\d{6})?\.json\.enc$/;
const TAMANO_MAXIMO_RESPUESTA = 10 * 1024 * 1024;


function responder(res, status, datos) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  return res.end(JSON.stringify(datos));
}


function secretoValido(req) {
  const secretoCabecera = String(
    req.headers["x-contactia-restore-secret"] || ""
  );
  const autorizado = String(req.headers.authorization || "");
  const recibido = secretoCabecera || autorizado.replace(/^Bearer\s+/i, "");
  const esperado = String(process.env.BACKUP_RESTORE_SECRET || "");
  const recibidoBuffer = Buffer.from(recibido);
  const esperadoBuffer = Buffer.from(esperado);

  return Boolean(
    esperado &&
    recibidoBuffer.length === esperadoBuffer.length &&
    crypto.timingSafeEqual(recibidoBuffer, esperadoBuffer)
  );
}


function leerBody(req) {
  if (req.body && typeof req.body === "object") {
    return req.body;
  }

  if (typeof req.body === "string" && req.body.length <= 20000) {
    return JSON.parse(req.body || "{}");
  }

  return {};
}


async function solicitarDrive(accion, datos = {}) {
  return solicitarJsonGoogle(
    process.env.GOOGLE_APPS_SCRIPT_BACKUP_URL,
    {
      secret: process.env.BACKUP_UPLOAD_SECRET,
      action: accion,
      ...datos
    },
    { tamanoMaximo: TAMANO_MAXIMO_RESPUESTA }
  );
}


async function cargarCopia(archivo) {
  if (!PATRON_ARCHIVO.test(archivo)) {
    throw new Error("El nombre de la copia no es válido.");
  }

  const resultado = await solicitarDrive("read", { filename: archivo });
  let sobre;

  try {
    sobre = JSON.parse(resultado.content || "{}");
  } catch {
    throw new Error("El archivo cifrado no tiene un formato válido.");
  }

  if (
    sobre.formato !== "contactia-backup-encrypted" ||
    sobre.version !== 1 ||
    sobre.algoritmo !== "AES-256-GCM" ||
    !/^[a-f0-9]{64}$/.test(String(sobre.sha256 || ""))
  ) {
    throw new Error("El archivo no es una copia cifrada válida.");
  }

  const copia = descifrarCopia(sobre, process.env.BACKUP_ENCRYPTION_KEY);
  validarCopiaRestaurable(copia);

  return { copia, sobre };
}


async function consultarAirtable(url, opciones = {}) {
  const respuesta = await fetch(url, {
    ...opciones,
    headers: {
      Authorization: `Bearer ${process.env.AIRTABLE_API_KEY}`,
      ...(opciones.body ? { "Content-Type": "application/json" } : {}),
      ...(opciones.headers || {})
    }
  });
  const texto = await respuesta.text();
  let datos;

  try {
    datos = texto ? JSON.parse(texto) : {};
  } catch {
    throw new Error(`Airtable devolvió una respuesta no válida. HTTP ${respuesta.status}`);
  }

  if (!respuesta.ok) {
    throw new Error(
      datos?.error?.message || `Error de Airtable. HTTP ${respuesta.status}`
    );
  }

  return datos;
}


function urlTabla(tabla, parametros = "") {
  return (
    `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/` +
    `${encodeURIComponent(tabla)}${parametros ? `?${parametros}` : ""}`
  );
}


async function listarRegistros(tabla) {
  const registros = [];
  let offset = "";

  do {
    const parametros = new URLSearchParams({ pageSize: "100" });

    if (offset) {
      parametros.set("offset", offset);
    }

    const datos = await consultarAirtable(
      urlTabla(tabla, parametros.toString())
    );
    registros.push(...(datos.records || []));
    offset = datos.offset || "";
  } while (offset);

  return registros;
}


async function cargarEstadoActual() {
  const resultados = await Promise.all(
    TABLAS_RESTAURABLES.map((tabla) => listarRegistros(tabla))
  );

  return Object.fromEntries(
    TABLAS_RESTAURABLES.map((tabla, indice) => [tabla, resultados[indice]])
  );
}


function dividirEnLotes(elementos, tamano = 10) {
  const lotes = [];

  for (let indice = 0; indice < elementos.length; indice += tamano) {
    lotes.push(elementos.slice(indice, indice + tamano));
  }

  return lotes;
}


async function crearRegistros(tabla, registros) {
  const creados = [];

  for (const lote of dividirEnLotes(registros)) {
    const datos = await consultarAirtable(urlTabla(tabla), {
      method: "POST",
      body: JSON.stringify({
        records: lote.map((registro) => ({ fields: registro.fields })),
        typecast: true
      })
    });

    if ((datos.records || []).length !== lote.length) {
      throw new Error(`Airtable no creó todos los registros de ${tabla}.`);
    }

    creados.push(...datos.records);
  }

  return creados;
}


async function actualizarRegistros(tabla, registros) {
  let actualizados = 0;

  for (const lote of dividirEnLotes(registros)) {
    await consultarAirtable(urlTabla(tabla), {
      method: "PATCH",
      body: JSON.stringify({ records: lote, typecast: true })
    });
    actualizados += lote.length;
  }

  return actualizados;
}


async function aplicarPlan(plan) {
  let creados = 0;
  let actualizados = 0;

  for (const tabla of TABLAS_RESTAURABLES) {
    const faltantes = plan.tablas[tabla].faltantes;

    for (const lote of dividirEnLotes(faltantes)) {
      const solicitudes = lote.map((registro) => ({
        fields: camposSinEnlaces(tabla, registro, true)
      }));
      const respuesta = await crearRegistros(tabla, solicitudes);

      respuesta.forEach((registroCreado, indice) => {
        plan.mapeos[tabla].set(lote[indice].origen_id, registroCreado.id);
      });
      creados += respuesta.length;
    }
  }

  for (const tabla of TABLAS_RESTAURABLES) {
    const operaciones = [];

    for (const registro of plan.tablas[tabla].faltantes) {
      const fields = camposEnlaceRemapeados(tabla, registro, plan.mapeos);

      if (Object.keys(fields).length > 0) {
        operaciones.push({
          id: plan.mapeos[tabla].get(registro.origen_id),
          fields
        });
      }
    }

    if (plan.modo === "completa") {
      for (const { copia, actual } of plan.tablas[tabla].existentes) {
        const fields = {
          ...camposSinEnlaces(tabla, copia, false),
          ...camposEnlaceRemapeados(tabla, copia, plan.mapeos)
        };

        if (Object.keys(fields).length > 0) {
          operaciones.push({ id: actual.id, fields });
        }
      }
    }

    actualizados += await actualizarRegistros(tabla, operaciones);
  }

  return { creados, actualizados };
}


async function registrarRestauracion(copia, archivo, modo, resultado) {
  const restaurantes = copia.tablas.RESTAURANTES
    .map((registro) => Number(registro.fields.id))
    .filter((id) => Number.isInteger(id) && id > 0);

  await Promise.all(restaurantes.map((restauranteId) => registrarAuditoria({
    restauranteId,
    reservaId: "",
    accion: "copia_restaurada",
    origen: "sistema",
    estadoAnterior: "",
    estadoNuevo: "restaurado",
    detalles: {
      archivo,
      modo,
      creados: resultado.creados,
      actualizados: resultado.actualizados,
      tipo: "restauracion_backup"
    }
  })));
}


function validarVariables() {
  const necesarias = [
    "AIRTABLE_API_KEY",
    "AIRTABLE_BASE_ID",
    "BACKUP_ENCRYPTION_KEY",
    "BACKUP_RESTORE_SECRET",
    "BACKUP_UPLOAD_SECRET",
    "GOOGLE_APPS_SCRIPT_BACKUP_URL"
  ];

  return necesarias.every((nombre) => process.env[nombre]);
}


module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return responder(res, 405, { ok: false, error: "Método no permitido." });
  }

  if (!validarVariables()) {
    return responder(res, 503, {
      ok: false,
      error: "La restauración no está configurada."
    });
  }

  if (!secretoValido(req)) {
    return responder(res, 401, { ok: false, error: "No autorizado." });
  }

  try {
    const body = leerBody(req);
    const accion = String(body.accion || "listar");

    if (accion === "listar") {
      const resultado = await solicitarDrive("list");
      return responder(res, 200, {
        ok: true,
        archivos: resultado.files || []
      });
    }

    const archivo = String(body.archivo || "");
    const modo = String(body.modo || "faltantes");
    const { copia, sobre } = await cargarCopia(archivo);

    if (accion === "previsualizar") {
      const actuales = await cargarEstadoActual();
      const plan = crearPlanRestauracion(copia, actuales, modo);
      const total = resumenTotal(plan.resumen);
      const confirmacion = crearTokenConfirmacion({
        archivo,
        sha256: sobre.sha256,
        modo,
        secreto: process.env.BACKUP_RESTORE_SECRET
      });

      return responder(res, 200, {
        ok: true,
        archivo,
        creado_en: copia.creado_en,
        modo,
        resumen: plan.resumen,
        total,
        confirmacion,
        confirmacion_valida_minutos: 10,
        aviso: "La restauración nunca elimina registros actuales."
      });
    }

    if (accion !== "aplicar") {
      return responder(res, 400, { ok: false, error: "Acción no válida." });
    }

    if (!validarTokenConfirmacion(body.confirmacion, {
      archivo,
      sha256: sobre.sha256,
      modo,
      secreto: process.env.BACKUP_RESTORE_SECRET
    })) {
      return responder(res, 409, {
        ok: false,
        error: "La confirmación ha caducado. Vuelve a previsualizar la copia."
      });
    }

    const copiaPreventiva = await ejecutarBackup(new Date(), {
      etiqueta: "antes-restaurar"
    });
    const actuales = await cargarEstadoActual();
    const plan = crearPlanRestauracion(copia, actuales, modo);
    const resultado = await aplicarPlan(plan);
    await registrarRestauracion(copia, archivo, modo, resultado);

    return responder(res, 200, {
      ok: true,
      archivo,
      modo,
      copia_preventiva: copiaPreventiva.archivo,
      ...resultado
    });
  } catch (error) {
    console.error("ERROR RESTAURACIÓN DE COPIA:", error.message);
    return responder(res, 500, {
      ok: false,
      error: "No se pudo completar la operación de restauración."
    });
  }
};


module.exports.aplicarPlan = aplicarPlan;
module.exports.cargarCopia = cargarCopia;
module.exports.cargarEstadoActual = cargarEstadoActual;

