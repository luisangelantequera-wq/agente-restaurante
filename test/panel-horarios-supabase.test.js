const test=require('node:test');
const assert=require('node:assert/strict');
const {leerConfiguracion}=require('../panel-horarios-supabase');
test('editor conserva excepciones anuales y exactas y fusiona cierres antiguos sin duplicar ni alterar el original',()=>{
 const r={horario_reservas:{lunes:['13:00-16:00'],martes:['13:00-16:00'],_contactia:{especiales:[{fecha:'12-25',rangos:[]},{fecha:'2027-01-01',rangos:['13:30-16:00']}]}},
  dias_cierre:['lunes'],cierres_especiales:['2027-01-01','2027-01-02'],antelacion_minima_reserva_minutos:30,intervalo_minutos:15};
 const copia=structuredClone(r),datos=leerConfiguracion(r);
 assert.deepEqual(datos.horario.lunes,[]);assert.deepEqual(datos.horario.martes,['13:00-16:00']);
 assert.equal(datos.especiales.length,3);
 assert.deepEqual(datos.especiales.find(e=>e.fecha==='2027-01-01').rangos,['13:30-16:00']);
 assert.deepEqual(datos.especiales.find(e=>e.fecha==='2027-01-02').rangos,[]);
 assert.deepEqual(r,copia);
});
