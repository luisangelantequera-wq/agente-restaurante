begin;
alter table contactia_privado.llamadas_prueba
 add column entrada_sid text unique check(entrada_sid ~ '^CA[0-9a-fA-F]{32}$');
-- Solo el servidor vincula una recepción a la sesión del navegador autorizada.
-- Una segunda llamada entrante nunca puede apropiarse de la misma sesión.
create function public.vincular_recepcion_llamada_prueba(p_call_sid text,p_entrada_sid text) returns uuid
language plpgsql security invoker set search_path='' as $$
declare resultado uuid;
begin
 if p_call_sid is null or p_call_sid !~ '^CA[0-9a-fA-F]{32}$'
  or p_entrada_sid is null or p_entrada_sid !~ '^CA[0-9a-fA-F]{32}$' or p_call_sid=p_entrada_sid then return null;end if;
 update contactia_privado.llamadas_prueba set entrada_sid=p_entrada_sid
 where call_sid=p_call_sid and caduca>clock_timestamp()
  and (entrada_sid is null or entrada_sid=p_entrada_sid)
 returning id into resultado;
 return resultado;
end $$;
revoke all on function public.vincular_recepcion_llamada_prueba(text,text) from public,anon,authenticated;
grant execute on function public.vincular_recepcion_llamada_prueba(text,text) to service_role;
create function public.consultar_recepcion_llamada_prueba(p_id uuid,p_hash text) returns text
language sql stable security invoker set search_path='' as $$
 select entrada_sid from contactia_privado.llamadas_prueba where id=p_id and hash=p_hash
$$;
revoke all on function public.consultar_recepcion_llamada_prueba(uuid,text) from public,anon,authenticated;
grant execute on function public.consultar_recepcion_llamada_prueba(uuid,text) to service_role;
commit;
