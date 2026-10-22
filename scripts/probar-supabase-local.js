"use strict";

// PostgreSQL embebido, sin red, sin claves y sin llamadas a Airtable.
// auth.uid() se simula aquí. No prueba el servicio Auth ni PostgREST remoto.
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');

async function main() {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon;
      create role authenticated;
      create role service_role bypassrls;
      create schema auth;
      create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
      $$;
      grant usage on schema auth to authenticated;
      grant execute on function auth.uid() to authenticated;
    `);
    const raiz = path.join(__dirname, '..', 'supabase');
    for (const archivo of fs.readdirSync(path.join(raiz, 'migrations')).filter(f => f.endsWith('.sql')).sort()) {
      await db.exec(fs.readFileSync(path.join(raiz, 'migrations', archivo), 'utf8'));
      console.log(`Migración correcta: ${archivo}`);
    }
    await db.exec(fs.readFileSync(path.join(raiz, 'tests', '01_aislamiento.sql'), 'utf8'));
    console.log('Aislamiento Sol/Luna, usuario desactivado, bloqueo anónimo, permisos y relaciones: OK.');
  } finally {
    await db.close();
  }
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
