const test = require("node:test");
const assert = require("node:assert/strict");
const {
  analizarFecha,
  extraerFecha
} = require("../lib/fecha-conversacional");


const AHORA = new Date(2026, 8, 3, 12, 0, 0, 0);


test("reconoce fechas numéricas con uno o dos dígitos", () => {
  assert.equal(extraerFecha("04/09/2026", AHORA), "2026-09-04");
  assert.equal(extraerFecha("4/9/2026", AHORA), "2026-09-04");
});


test("reconoce fechas escritas dentro de una frase", () => {
  assert.equal(
    extraerFecha(
      "Quiero reservar el 4 de septiembre de 2026 a las 14:00",
      AHORA
    ),
    "2026-09-04"
  );
  assert.equal(extraerFecha("4 de septiembre", AHORA), "2026-09-04");
});


test("una fecha natural sin año que ya pasó se lleva al año siguiente", () => {
  const despues = new Date(2026, 8, 5, 12, 0, 0, 0);
  assert.equal(extraerFecha("4 de septiembre", despues), "2027-09-04");
});


test("rechaza fechas imposibles", () => {
  assert.equal(extraerFecha("31/02/2026", AHORA), null);
  assert.equal(extraerFecha("31 de febrero de 2026", AHORA), null);
});


test("clasifica fechas seguras, ambiguas y ausentes", () => {
  assert.deepEqual(
    analizarFecha("Quiero reservar mañana", AHORA),
    { estado: "seguro", valor: "2026-09-04", expresiones: ["manana"] }
  );
  assert.equal(
    analizarFecha("mañana viernes", AHORA).estado,
    "seguro"
  );
  assert.equal(
    analizarFecha("mañana día 4", AHORA).estado,
    "seguro"
  );
  assert.equal(
    analizarFecha("mañana día 2", AHORA).estado,
    "ambiguo"
  );
  assert.equal(
    analizarFecha("mañana 10 de septiembre de 2026", AHORA).estado,
    "ambiguo"
  );
  assert.equal(analizarFecha("Quiero reservar", AHORA).estado, "ausente");
});


test("acepta un día del mes aislado sin confundirlo con dos fechas", () => {
  assert.deepEqual(
    analizarFecha("El día 3", AHORA),
    { estado: "seguro", valor: "2026-09-03", expresiones: ["el dia 3"] }
  );
  assert.deepEqual(
    analizarFecha("El día 2", AHORA),
    { estado: "seguro", valor: "2026-10-02", expresiones: ["el dia 2"] }
  );
  assert.deepEqual(
    analizarFecha("El 15", AHORA),
    { estado: "seguro", valor: "2026-09-15", expresiones: ["el 15"] }
  );
});


test("distingue un día aislado de una referencia relativa contradictoria", () => {
  const quinceSeptiembre = new Date(2026, 8, 15, 12, 0, 0, 0);

  assert.equal(
    analizarFecha("mañana día 15", quinceSeptiembre).estado,
    "ambiguo"
  );
  assert.deepEqual(
    analizarFecha("el día 15", quinceSeptiembre),
    { estado: "seguro", valor: "2026-09-15", expresiones: ["el dia 15"] }
  );
  assert.deepEqual(
    analizarFecha("mañana miércoles", quinceSeptiembre),
    {
      estado: "seguro",
      valor: "2026-09-16",
      expresiones: ["miercoles", "manana"]
    }
  );
});

test('fechas habladas convierten días en letras con mes o marcador de día',()=>{
 const ahora=new Date(2026,10,1,12);
 for(const [frase,fecha] of [
  ['El cinco de noviembre','2026-11-05'],['Para el día seis','2026-11-06'],
  ['El veintidós de noviembre','2026-11-22'],['Treinta y uno de diciembre','2026-12-31'],
  ['El treinta y uno','2026-12-31'],['Para el martes, dos personas a las dos','2026-11-03']
 ])assert.equal(analizarFecha(frase,ahora).valor,fecha,frase);
 for(const frase of ['Dos personas a las dos','Treinta y dos de noviembre','El día treinta y dos','Ciento cinco de noviembre'])
  assert.notEqual(analizarFecha(frase,ahora).estado,'seguro',frase);
});
test('fechas habladas conservan ambigüedad, días imposibles y contradicciones',()=>{
 const ahora=new Date(2026,10,1,12);
 for(const frase of ['El cinco o seis','El día cinco o el seis','Cinco o seis de noviembre','Treinta y uno de noviembre','El martes cinco de noviembre'])
  assert.notEqual(analizarFecha(frase,ahora).estado,'seguro',frase);
});
