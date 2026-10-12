"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  conConfiguracionSolicitud,
  leerConfiguracionSolicitud
} = require("../lib/configuracion-solicitud");

test("sin contexto no hay caché: las reservas y escrituras mantienen lecturas frescas", async () => {
  let llamadas = 0;
  const cargar = async () => ++llamadas;
  assert.equal(await leerConfiguracionSolicitud("tabla:MESAS", cargar), 1);
  assert.equal(await leerConfiguracionSolicitud("tabla:MESAS", cargar), 2);
});

test("verificar comparte la misma lectura de mesas y zonas dentro de la petición", async () => {
  const llamadas = { mesas: 0, zonas: 0 };
  const valores = await conConfiguracionSolicitud("verificar", async () => {
    const lecturas = [];
    for (let n = 0; n < 10; n++) {
      lecturas.push(await leerConfiguracionSolicitud("tabla:MESAS",
        async () => ({ pagina: ++llamadas.mesas })));
      lecturas.push(await leerConfiguracionSolicitud("tabla:ZONA",
        async () => ({ pagina: ++llamadas.zonas })));
    }
    return lecturas;
  });
  assert.equal(llamadas.mesas, 1);
  assert.equal(llamadas.zonas, 1);
  assert.ok(valores.every((v, i) => v.pagina === 1));
});

test("la petición siguiente vuelve a leer la nueva configuración", async () => {
  let mesasEnAirtable = ["recMesa1"];
  const consultar = async () => [...mesasEnAirtable];
  const primera = await conConfiguracionSolicitud("verificar", () =>
    leerConfiguracionSolicitud("tabla:MESAS", consultar));
  mesasEnAirtable = [];
  const segunda = await conConfiguracionSolicitud("verificar", () =>
    leerConfiguracionSolicitud("tabla:MESAS", consultar));
  assert.deepEqual(primera, ["recMesa1"]);
  assert.deepEqual(segunda, [], "no se comparte caché entre clientes");
});

test("nunca cachea acciones de escritura o administración", async () => {
  for (const accion of ["reservar", "reservar_panel", "modificar",
    "reactivar", "actualizar_disponibilidad", "cambiar_mesas"]) {
    let lecturas = 0;
    await conConfiguracionSolicitud(accion, async () => {
      await leerConfiguracionSolicitud("tabla:MESAS", async () => ++lecturas);
      await leerConfiguracionSolicitud("tabla:MESAS", async () => ++lecturas);
    });
    assert.equal(lecturas, 2, accion);
  }
});

test("dos peticiones simultáneas jamás se comparten los resultados", async () => {
  let liberaA, liberaB, llamadas = 0;
  const esperaA = new Promise(resolve => { liberaA = resolve; });
  const esperaB = new Promise(resolve => { liberaB = resolve; });
  const a = conConfiguracionSolicitud("verificar", async () => {
    const datos = await leerConfiguracionSolicitud("tabla:ZONA",
      async () => { llamadas++; await esperaA; return ["A"]; });
    return datos;
  });
  const b = conConfiguracionSolicitud("verificar", async () => {
    const datos = await leerConfiguracionSolicitud("tabla:ZONA",
      async () => { llamadas++; await esperaB; return ["B"]; });
    return datos;
  });
  liberaB();
  liberaA();
  assert.deepEqual(await Promise.all([a, b]), [["A"], ["B"]]);
  assert.equal(llamadas, 2);
});

test("las lecturas simultáneas de la misma petición comparten incluso la promesa", async () => {
  let consultas = 0, soltar;
  const espera = new Promise(resolve => { soltar = resolve; });
  const promesa = conConfiguracionSolicitud("verificar", async () => {
    const lista = Array.from({ length: 10 }, () =>
      leerConfiguracionSolicitud("tabla:COMBINACIONES_MESAS", async () => {
        consultas++; await espera; return { records: [] };
      }));
    soltar();
    return Promise.all(lista);
  });
  const respuestas = await promesa;
  assert.equal(consultas, 1);
  assert.ok(respuestas.every(r => r === respuestas[0]));
});

test("si Airtable falla se propaga el error en lugar de suponer mesas libres", async () => {
  let consultas = 0;
  await assert.rejects(
    () => conConfiguracionSolicitud("verificar", async () => {
      const pedir = () => leerConfiguracionSolicitud("tabla:MESAS", async () => {
        consultas++;
        throw new Error("Airtable bloqueado 429");
      });
      try { await pedir(); } catch { /* una segunda lectura sigue fallando */ }
      return pedir();
    }),
    /Airtable bloqueado 429/
  );
  assert.equal(consultas, 1);
});

test("las claves vacías o sin almacenamiento de configuración no se memorizan", async () => {
  let consultas = 0;
  await conConfiguracionSolicitud("verificar", async () => {
    assert.equal(await leerConfiguracionSolicitud(null, async () => ++consultas), 1);
    assert.equal(await leerConfiguracionSolicitud(null, async () => ++consultas), 2);
  });
});

test("no admite funciones de carga o petición inválidas", () => {
  assert.throws(() => conConfiguracionSolicitud("verificar", null), /función/);
  assert.throws(() => leerConfiguracionSolicitud("MESAS", null), /función/);
});
