'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process'),path=require('node:path');
test('worker telefónico: autorización, transporte, turnos serializados y recuperación sin duplicados',()=>{
 const r=spawnSync('python',['experimentos/livekit/test_telefono.py'],{cwd:path.join(__dirname,'..'),encoding:'utf8',timeout:20000});
 assert.equal(r.status,0,r.stderr || r.error?.message);assert.match(r.stderr,/Ran 4 tests/);
});
