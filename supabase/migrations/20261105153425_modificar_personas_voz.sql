begin;
-- Acceso exclusivo del servidor, con el enlace obtenido tras teléfono y código.
-- No altera la firma del endpoint de gestión escrito existente.
create function public.gestionar_personas_voz(p_slug text,p_hash text,p_accion text,p_operacion uuid,
 p_fecha date,p_hora time,p_inicio_anterior timestamptz,p_personas integer,p_personas_anteriores integer)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare actual jsonb; reserva public.reservas; previo contactia_privado.operaciones_gestion;
 solicitud jsonb; candidato record; ids uuid[]; cambiada boolean:=false;
begin
 if p_accion is distinct from 'personas' or p_operacion is null or p_inicio_anterior is null
  or not isfinite(p_inicio_anterior) or p_personas is null or p_personas not between 1 and 1000
  or p_personas_anteriores is null or p_personas_anteriores not between 1 and 1000
  or p_fecha is null or p_hora is null then raise exception 'DATOS_INVALIDOS' using errcode='22023';end if;
 -- Valida restaurante, enlace, caducidad y obtiene los mismos bloqueos que la gestión habitual.
 actual:=public.gestionar_reserva_web(p_slug,p_hash);
 select r.* into strict reserva from public.reservas r join contactia_privado.enlaces_gestion e on e.reserva_id=r.id where e.hash=p_hash for update of r;
 solicitud:=jsonb_build_object('accion','personas','fecha',p_fecha,'hora',p_hora,'inicio_anterior',p_inicio_anterior,
  'personas',p_personas,'personas_anteriores',p_personas_anteriores);
 select * into previo from contactia_privado.operaciones_gestion where id=p_operacion;
 if found then
  if previo.enlace_hash<>p_hash or previo.solicitud<>solicitud then raise exception 'OPERACION_REUTILIZADA' using errcode='22023';end if;
  return actual;
 end if;
 if reserva.inicio<>p_inicio_anterior or reserva.personas<>p_personas_anteriores
  or p_fecha::text<>actual->>'fecha' or to_char(p_hora,'HH24:MI')<>actual->>'hora' then
  raise exception 'RESERVA_MODIFICADA' using errcode='40001';end if;
 if reserva.estado<>'confirmada' or reserva.inicio<=clock_timestamp() then raise exception 'ESTADO_NO_MODIFICABLE' using errcode='55000';end if;
 perform 1 from public.zonas where id=reserva.zona_id and restaurante_id=reserva.restaurante_id and estado='activo' for share;
 if not found then raise exception 'ZONA_NO_DISPONIBLE' using errcode='P0001';end if;
 -- Primero mesas individuales, después solo combinaciones configuradas por el restaurante.
 -- Cada intento es una subtransacción: un conflicto restaura íntegra la ocupación original.
 for candidato in
  select array[m.id] as mesas,0 as clase,m.capacidad as capacidad,m.id as orden,null::uuid as combo
  from public.mesas m where m.restaurante_id=reserva.restaurante_id and m.zona_id=reserva.zona_id
   and m.estado='libre' and p_personas between m.min_personas and m.capacidad
  union all
  select array_agg(m.id order by m.id),1,sum(m.capacidad)::integer,c.id,c.id
  from public.combinaciones_mesas c join public.combinacion_mesas cm on cm.combinacion_id=c.id
  join public.mesas m on m.id=cm.mesa_id and m.restaurante_id=c.restaurante_id
  where c.restaurante_id=reserva.restaurante_id and c.zona_id=reserva.zona_id and c.activa
   and p_personas between c.min_personas and c.max_personas
  group by c.id having count(*) between 2 and 20 and bool_and(m.estado='libre' and m.zona_id=reserva.zona_id) and sum(m.capacidad)>=p_personas
  order by clase,capacidad,orden
 loop
  begin
   ids:=candidato.mesas;
   perform 1 from public.mesas where id=any(ids) order by id for share;
   if exists(select 1 from public.mesas where id=any(ids) and (estado<>'libre' or zona_id<>reserva.zona_id or restaurante_id<>reserva.restaurante_id)) then continue;end if;
   if candidato.combo is not null then
    perform 1 from public.combinaciones_mesas c where id=candidato.combo and activa and p_personas between min_personas and max_personas for share;
    if not found then continue;end if;
    perform 1 from public.combinacion_mesas where combinacion_id=candidato.combo order by mesa_id for share;
    if ids is distinct from (select array_agg(mesa_id order by mesa_id) from public.combinacion_mesas where combinacion_id=candidato.combo) then continue;end if;
   elsif not exists(select 1 from public.mesas where id=ids[1] and p_personas between min_personas and capacidad) then continue;
   end if;
   delete from public.reserva_mesas where reserva_id=reserva.id;
   insert into public.reserva_mesas(restaurante_id,reserva_id,mesa_id,periodo,activa)
    select reserva.restaurante_id,reserva.id,x,tstzrange(reserva.inicio,reserva.fin,'[)'),true from unnest(ids) x;
   update public.reservas set personas=p_personas,reprogramado_por=null,reprogramado_en=now() where id=reserva.id;
   cambiada:=true;exit;
  exception when exclusion_violation then null;
  end;
 end loop;
 if not cambiada then raise exception 'SIN_DISPONIBILIDAD' using errcode='P0001';end if;
 insert into contactia_privado.operaciones_gestion(id,enlace_hash,solicitud) values(p_operacion,p_hash,solicitud);
 return public.gestionar_reserva_web(p_slug,p_hash);
end $$;
revoke all on function public.gestionar_personas_voz(text,text,text,uuid,date,time,timestamptz,integer,integer) from public,anon,authenticated,service_role;
grant execute on function public.gestionar_personas_voz(text,text,text,uuid,date,time,timestamptz,integer,integer) to service_role;
commit;
