'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),m=require('../lib/encargos-restaurante');
const entrada=require('../lib/entrada-conversacional'),{crear}=require('../lib/encargos-conversacion');
const grupo=()=>({id:'arroces',nombre:'Arroces',platos:['Paella valenciana','Arroz del señoret','Arroz negro'],dias:[...m.DIAS],minimo:2,antelacion_horas:1,pregunta:'Si va a pedir algún arroz, indique cuál.',activo:true});
test('configura platos libres, lunes a domingo y horas enteras desde una hora',()=>{
 const g=grupo();assert.equal(m.validarGrupos([g])[0].platos.length,3);
 for(const patch of [{dias:[]},{antelacion_horas:0},{antelacion_horas:1.5},{minimo:0},{platos:['Paella','paella']},{activo:'sí'}])assert.throws(()=>m.validarGrupos([{...g,...patch}]));
 assert.throws(()=>m.validarGrupos([g,g]));assert.deepEqual(m.leer({informacion_publica:'{"gastronomia":"Información anterior"}'}),[]);
});
test('comprueba el día, personas y antelación de una hora en Madrid, incluido el cambio de hora',()=>{
 const g=grupo(),ahora=Date.parse('2026-10-19T10:00:00Z');
 assert.equal(m.disponibles([g],'2026-10-19','13:00',2,ahora).length,1);assert.equal(m.disponibles([g],'2026-10-19','12:59',2,ahora).length,0);
 assert.equal(m.disponibles([g],'2026-10-19','13:00',1,ahora).length,0);g.dias=['martes'];assert.equal(m.disponibles([g],'2026-10-19','13:00',2,ahora).length,0);
 assert.equal(m.instante('2026-03-29','02:30'),null);assert.equal(m.instante('2026-10-25','02:30'),Date.parse('2026-10-25T00:30:00Z'));assert.equal(m.instante('2026-02-30','13:00'),null);
});
test('valida selección en servidor, no confía en nombres enviados, respeta mínimos y limita personas por grupo',()=>{
 const grupos=[grupo()],fecha='2026-10-19',hora='13:00',ahora=Date.parse('2026-10-19T10:00:00Z');
 const s=[{grupo_id:'arroces',plato:'arroz del senoret',personas:2,grupo:'Falso'}];const e=m.validarSeleccion(s,grupos,fecha,hora,4,ahora);assert.equal(e.items[0].plato,'Arroz del señoret');assert.equal(e.items[0].grupo,'Arroces');assert.equal(e.visto,false);
 for(const seleccion of [[{...s[0],personas:1}],[{...s[0],personas:5}],[{...s[0],plato:'Sushi'}],[s[0],s[0]],[s[0],{...s[0],plato:'Arroz negro',personas:3}]])assert.throws(()=>m.validarSeleccion(seleccion,grupos,fecha,hora,4,ahora));
 assert.throws(()=>m.validarSeleccion(s,grupos,fecha,hora,4,Date.parse('2026-10-19T10:01:00Z')));
 assert.deepEqual(m.leerReserva(JSON.stringify(e)),e);assert.equal(e.fecha,fecha);assert.notEqual(require('../lib/encargos-panel').revision(e),require('../lib/encargos-panel').revision(m.validarSeleccion(s,grupos,'2026-10-20',hora,4,ahora)));assert.equal(m.leerReserva(''),null);
});
test('conversación permite varios arroces, cantidades, no gracias y no borra la selección en una reverificación igual',()=>{
 let estado='',terminado=0;const mensajes=[],datos={personas:4};const c=crear({modelo:m,entrada,datos:()=>datos,decir:t=>mensajes.push(t),paso:p=>estado=p});
 c.configurar([grupo()],['2026-10-19','14:00',4]);c.comenzar(()=>terminado++);assert.equal(estado,'encargo_plato');assert.match(mensajes.at(-1),/Arroz del señoret/);
 c.procesar('arroz del señoret',estado);assert.equal(estado,'encargo_personas');c.procesar('1',estado);assert.match(mensajes.at(-1),/El mínimo para Arroz del señoret es de 2 personas/);c.procesar('dos',estado);assert.equal(estado,'encargo_otro');c.procesar('sí',estado);c.procesar('arroz negro para dos',estado);assert.equal(terminado,1);assert.equal(c.seleccion().length,2);assert.match(c.resumen(),/Arroz negro: 2/);
 c.configurar([grupo()],['2026-10-19','14:00',4]);c.comenzar(()=>terminado++);assert.equal(c.seleccion().length,2);assert.equal(terminado,2);
 c.configurar([grupo()],['2026-10-20','14:00',4]);assert.equal(c.seleccion().length,0);c.comenzar(()=>terminado++);c.procesar('no gracias',estado);assert.equal(terminado,3);
 c.limpiar();assert.equal(c.seleccion().length,0);
});
