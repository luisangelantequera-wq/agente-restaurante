const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
test('centro muestra operación, comprueba por botón y limpia al cerrar sesión', async () => {
  const nodos = new Map(), llamadas = [];
  function elemento() {
    return { children: [], listeners: {}, textContent: '', value: '', classList: { add() {}, remove() {} },
      append(...n) { this.children.push(...n); }, appendChild(n) { this.children.push(n); }, replaceChildren(...n) { this.children = n; },
      addEventListener(k, f) { this.listeners[k] = f; }, focus() {}, select() {} };
  }
  const document = { querySelector(id) { if (!nodos.has(id)) nodos.set(id, elemento()); return nodos.get(id); }, createElement: elemento };
  const fetch = async (_url, opciones) => {
    const body = JSON.parse(opciones.body); llamadas.push(body);
    let datos = { ok: true, conversaciones: [], resumen: {} };
    if (body.accion === 'listar_retenciones') datos = { ok: true, operaciones: [{
      id: 'a'.repeat(64), restaurante_id: 'rec12345678901234', restaurante: 'Sol <script>',
      fecha: '2026-10-01', hora: '14:00', personas: 4, iniciada: Date.now(), comprobable: true
    }] };
    if (body.accion === 'comprobar_retencion') datos = { ok: true, mensaje: 'Reserva confirmada; mesa protegida.' };
    return { ok: true, json: async () => datos };
  };
  vm.runInNewContext(fs.readFileSync(require.resolve('../centro-contactia.js'), 'utf8'), { document, fetch, Intl, Date, console });
  await new Promise(r => setImmediate(r));
  const lista = nodos.get('#listaRetenciones');
  assert.equal(lista.children.length, 1);
  assert.match(lista.children[0].children[0].textContent, /Sol <script>/);
  const boton = lista.children[0].children.at(-1);
  await boton.listeners.click();
  assert.equal(llamadas.filter(r => r.accion === 'comprobar_retencion').length, 1);
  assert.match(lista.children[0].children[2].textContent, /mesa protegida/);
  await nodos.get('#cerrarSesion').listeners.click();
  assert.equal(lista.children.length, 0);
});
