begin;
create table contactia_privado.turnos_llamadas_voz (
 llamada_id uuid not null, restaurante_id bigint not null references public.restaurantes(id) on delete cascade,
 indice smallint not null check(indice between 1 and 100), creado_en timestamptz not null default clock_timestamp(),
 caduca_en timestamptz not null default(clock_timestamp()+interval '30 days'),
 antes text not null check(length(antes) between 1 and 40), despues text not null check(length(despues) between 1 and 40),
 cliente text not null check(length(cliente)<=600), asistente text not null check(length(asistente)<=1200),
 incidencia boolean not null, finalizada boolean not null, resultado text not null check(resultado in ('en_curso','reserva_finalizada','gestion_finalizada')),
 duracion_ms integer not null check(duracion_ms between 0 and 60000),primary key(llamada_id,indice)
);
alter table contactia_privado.turnos_llamadas_voz enable row level security;
revoke all on contactia_privado.turnos_llamadas_voz from public,anon,authenticated;
grant all on contactia_privado.turnos_llamadas_voz to service_role;
create index llamadas_voz_por_restaurante on contactia_privado.turnos_llamadas_voz(restaurante_id,creado_en desc);
create index llamadas_voz_por_caducidad on contactia_privado.turnos_llamadas_voz(restaurante_id,caduca_en);
create function public.registrar_turno_llamada_voz(p_slug text,p_llamada uuid,p_indice integer,p_turno jsonb)
returns boolean language plpgsql security invoker set search_path='' as $$
declare rest bigint;
begin
 if p_llamada is null or p_indice is null or p_indice not between 1 and 100 or jsonb_typeof(p_turno) is distinct from 'object' or
  (p_turno-'antes'-'despues'-'cliente'-'asistente'-'incidencia'-'finalizada'-'resultado'-'duracion_ms')<>'{}'::jsonb or
  jsonb_typeof(p_turno->'cliente') is distinct from 'string' or jsonb_typeof(p_turno->'asistente') is distinct from 'string' or
  jsonb_typeof(p_turno->'incidencia') is distinct from 'boolean' or jsonb_typeof(p_turno->'finalizada') is distinct from 'boolean' then
  raise exception 'DATOS_INVALIDOS' using errcode='22023';end if;
 select id into rest from public.restaurantes where slug=p_slug and reservas_web_activas;
 if not found then return false;end if;
 delete from contactia_privado.turnos_llamadas_voz where restaurante_id=rest and caduca_en<=clock_timestamp();
 -- Una llamada no puede cambiar de restaurante ni duplicar un turno al reintentar.
 perform pg_advisory_xact_lock(hashtextextended(p_llamada::text,0));
 if exists(select 1 from contactia_privado.turnos_llamadas_voz where llamada_id=p_llamada and restaurante_id<>rest) then
  raise exception 'DATOS_INVALIDOS' using errcode='22023';end if;
 insert into contactia_privado.turnos_llamadas_voz(llamada_id,restaurante_id,indice,antes,despues,cliente,asistente,incidencia,finalizada,resultado,duracion_ms)
 values(p_llamada,rest,p_indice,p_turno->>'antes',p_turno->>'despues',p_turno->>'cliente',p_turno->>'asistente',
  (p_turno->>'incidencia')::boolean,(p_turno->>'finalizada')::boolean,p_turno->>'resultado',(p_turno->>'duracion_ms')::integer)
 on conflict(llamada_id,indice) do nothing;
 return true;
end $$;
create function public.consultar_llamadas_voz_panel(p_usuario uuid,p_restaurante bigint,p_llamada uuid default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v jsonb;
begin
 if p_usuario is null or not exists(select 1 from public.restaurante_usuarios where usuario_id=p_usuario and restaurante_id=p_restaurante and activo and rol in ('propietario','encargado')) then
  raise exception 'ACCESO_NO_PERMITIDO' using errcode='42501';end if;
 delete from contactia_privado.turnos_llamadas_voz where restaurante_id=p_restaurante and caduca_en<=clock_timestamp();
 if p_llamada is not null then
  select coalesce(jsonb_agg(jsonb_build_object('indice',indice,'creado_en',creado_en,'antes',antes,'despues',despues,'cliente',cliente,'asistente',asistente,
   'incidencia',incidencia,'duracion_ms',duracion_ms) order by indice),'[]'::jsonb) into v
   from contactia_privado.turnos_llamadas_voz where restaurante_id=p_restaurante and llamada_id=p_llamada and caduca_en>clock_timestamp();
  return jsonb_build_object('turnos',v);
 end if;
 select coalesce(jsonb_agg(f.fila order by f.ultima desc),'[]'::jsonb) into v from (
  select max(creado_en) as ultima,jsonb_build_object('llamada_id',llamada_id,'inicio',min(creado_en),'ultima',max(creado_en),
   'turnos',count(*),'incidencias',count(*) filter(where incidencia),'finalizada',bool_or(finalizada),
   'ultimo_paso',(array_agg(despues order by indice desc))[1]) as fila
  from contactia_privado.turnos_llamadas_voz where restaurante_id=p_restaurante and caduca_en>clock_timestamp()
  group by llamada_id order by max(creado_en) desc limit 25
 ) f;
 return jsonb_build_object('llamadas',v);
end $$;
revoke all on function public.registrar_turno_llamada_voz(text,uuid,integer,jsonb),public.consultar_llamadas_voz_panel(uuid,bigint,uuid) from public,anon,authenticated,service_role;
grant execute on function public.registrar_turno_llamada_voz(text,uuid,integer,jsonb),public.consultar_llamadas_voz_panel(uuid,bigint,uuid) to service_role;
commit;
