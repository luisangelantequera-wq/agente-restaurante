const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const codigo = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'google-avisos-programados.gs'), 'utf8');
function simular({ datos = { comprobados: 0, sin_trabajo: true }, lock = true, status = 200 } = {}) {
  const contador = { creados: 0, eliminados: 0, solicitudes: 0, liberaciones: 0 };
  const funciones = vm.runInNewContext(`${codigo}\n({ instalarComprobacionesContactia })`, {
    LockService: { getScriptLock: () => ({ tryLock: () => lock, releaseLock: () => contador.liberaciones++ }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => 'x'.repeat(40), setProperty() {} }) },
    UrlFetchApp: { fetch() {
      contador.solicitudes++;
      return { getResponseCode: () => status, getContentText: () => JSON.stringify(datos) };
    } },
    ScriptApp: {
      getProjectTriggers: () => [{ getHandlerFunction: () => 'comprobarAvisosContactia' }],
      deleteTrigger: () => contador.eliminados++,
      newTrigger(nombre) {
        assert.equal(nombre, 'comprobarAvisosContactia');
        return { timeBased() { return this; }, everyMinutes(minutos) {
          assert.equal(minutos, 5); return this;
        }, create() { contador.creados++; } };
      }
    },
    console: { log() {} }
  });
  return { instalar: funciones.instalarComprobacionesContactia, contador };
}

for (const [caso, opciones] of [
  ['pausa de servicio', { datos: { comprobados: 0, pausado: true } }],
  ['ejecución remota en curso', { datos: { en_curso: true } }],
  ['ejecución local en curso', { lock: false }],
  ['fallo HTTP', { status: 503 }]
]) {
  test(`el instalador conserva activadores existentes y no crea uno durante ${caso}`, () => {
    const { instalar, contador } = simular(opciones);
    assert.throws(instalar);
    assert.equal(contador.creados, 0);
    assert.equal(contador.eliminados, 0);
    assert.equal(contador.liberaciones, opciones.lock === false ? 0 : 1);
  });
}

test('una comprobación válida permite sustituir el activador por uno cada cinco minutos', () => {
  const { instalar, contador } = simular();
  instalar();
  assert.equal(contador.creados, 1);
  assert.equal(contador.eliminados, 1);
  assert.equal(contador.liberaciones, 1);
});
