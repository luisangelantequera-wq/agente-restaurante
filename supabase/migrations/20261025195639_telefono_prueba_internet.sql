begin;
-- Accesos de prueba: no guarda teléfonos, tokens, audio ni transcripciones.
create table contactia_privado.llamadas_prueba (
 id uuid primary key,
 hash text not null check(hash ~ '^[a-f0-9]{64}$'),
 creada timestamptz not null default clock_timestamp(),
 caduca timestamptz not null,
 call_sid text unique check(call_sid ~ '^CA[0-9a-fA-F]{32}$')
);
alter table contactia_privado.llamadas_prueba enable row level security;
revoke all on contactia_privado.llamadas_prueba from public,anon,authenticated;
grant all on contactia_privado.llamadas_prueba to service_role;
create function public.crear_sesion_llamada_prueba(p_id uuid,p_hash text,p_caduca timestamptz) returns boolean
language plpgsql security invoker set search_path='' as $$
begin
 if p_id is null or p_hash is null or p_hash !~ '^[a-f0-9]{64}$' or p_caduca is null or not isfinite(p_caduca)
  or p_caduca<=clock_timestamp() or p_caduca>clock_timestamp()+interval '3 minutes' then
  raise exception 'Acceso no válido' using errcode='22023';
 end if;
 delete from contactia_privado.llamadas_prueba where creada<clock_timestamp()-interval '2 days';
 insert into contactia_privado.llamadas_prueba(id,hash,caduca) values(p_id,p_hash,p_caduca) on conflict(id) do nothing;
 return found;
end $$;
create function public.usar_sesion_llamada_prueba(p_id uuid,p_hash text,p_call_sid text) returns boolean
language plpgsql security invoker set search_path='' as $$
begin
 if p_call_sid is null or p_call_sid !~ '^CA[0-9a-fA-F]{32}$' then return false;end if;
 update contactia_privado.llamadas_prueba set call_sid=p_call_sid
 where id=p_id and hash=p_hash and caduca>clock_timestamp() and (call_sid is null or call_sid=p_call_sid);
 return found;
end $$;
create function public.consultar_llamada_prueba(p_id uuid,p_hash text) returns text
language sql stable security invoker set search_path='' as $$
 select call_sid from contactia_privado.llamadas_prueba where id=p_id and hash=p_hash
$$;
revoke all on function public.crear_sesion_llamada_prueba(uuid,text,timestamptz),public.usar_sesion_llamada_prueba(uuid,text,text),public.consultar_llamada_prueba(uuid,text) from public,anon,authenticated;
grant execute on function public.crear_sesion_llamada_prueba(uuid,text,timestamptz),public.usar_sesion_llamada_prueba(uuid,text,text),public.consultar_llamada_prueba(uuid,text) to service_role;
commit;
