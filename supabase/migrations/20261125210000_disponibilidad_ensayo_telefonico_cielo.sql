CREATE OR REPLACE FUNCTION contactia_privado.consultar_disponibilidad(p_slug text, p_fecha date, p_hora time, p_zona uuid, p_personas integer, p_exigir_web boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare r public.restaurantes; rangos jsonb; instante timestamptz; v_periodo tstzrange; candidato record;
begin
 select * into r from public.restaurantes where slug=p_slug and (not p_exigir_web or reservas_web_activas) for share;
 if not found then raise exception 'RESTAURANTE_NO_DISPONIBLE' using errcode='P0001'; end if;
 if p_fecha is null or not isfinite(p_fecha) or p_fecha<(clock_timestamp() at time zone r.zona_horaria)::date
  or p_fecha>(clock_timestamp() at time zone r.zona_horaria)::date+365 then
  raise exception 'FECHA_INVALIDA' using errcode='22023'; end if;
 if p_hora is null and p_zona is null and p_personas is null then
  rangos:=contactia_privado.horario_para_fecha(r.id,p_fecha);
  return jsonb_build_object('fecha_admitida',jsonb_array_length(rangos)>0,'horario',rangos);
 end if;
 if p_hora is null or p_zona is null or p_personas is null or p_personas not between 1 and 1000 then
  raise exception 'DATOS_INVALIDOS' using errcode='22023'; end if;
 instante:=contactia_privado.validar_horario_reserva(r.id,p_fecha,p_hora);
 perform 1 from public.zonas where id=p_zona and restaurante_id=r.id and estado='activo' for share;
 if not found then raise exception 'ZONA_NO_DISPONIBLE' using errcode='P0001'; end if;
 v_periodo:=tstzrange(instante,instante+make_interval(mins=>r.duracion_reserva_minutos),'[)');
 for candidato in
  select array[m.id] as ids from public.mesas m
  where m.restaurante_id=r.id and m.zona_id=p_zona and m.estado='libre'
   and p_personas between m.min_personas and m.capacidad order by m.capacidad,m.id
 loop
  if not exists(select 1 from public.reserva_mesas rm where rm.mesa_id=any(candidato.ids) and rm.activa and rm.periodo && v_periodo) then
   return jsonb_build_object('disponible',true);
  end if;
 end loop;
 for candidato in
  select array_agg(cm.mesa_id order by cm.mesa_id) as ids
  from public.combinaciones_mesas c join public.combinacion_mesas cm on cm.combinacion_id=c.id
  join public.mesas m on m.id=cm.mesa_id and m.restaurante_id=c.restaurante_id
  where c.restaurante_id=r.id and c.zona_id=p_zona and c.activa and p_personas between c.min_personas and c.max_personas
  group by c.id having count(*) between 2 and 20 and bool_and(m.estado='libre' and m.zona_id=p_zona)
  order by sum(m.capacidad),c.id
 loop
  if not exists(select 1 from public.reserva_mesas rm where rm.mesa_id=any(candidato.ids) and rm.activa and rm.periodo && v_periodo) then
   return jsonb_build_object('disponible',true);
  end if;
 end loop;
 return jsonb_build_object('disponible',false);
end $function$;

revoke all on function contactia_privado.consultar_disponibilidad(text,date,time,uuid,integer,boolean) from public, anon, authenticated;
grant execute on function contactia_privado.consultar_disponibilidad(text,date,time,uuid,integer,boolean) to service_role;

create or replace function public.consultar_disponibilidad_web(p_slug text, p_fecha date, p_hora time default null, p_zona uuid default null, p_personas integer default null)
returns jsonb language sql set search_path = ''
as $$ select contactia_privado.consultar_disponibilidad(p_slug,p_fecha,p_hora,p_zona,p_personas,true); $$;

create function public.consultar_disponibilidad_ensayo_cielo(p_fecha date, p_hora time, p_zona uuid, p_personas integer)
returns jsonb language sql set search_path = ''
as $$ select contactia_privado.consultar_disponibilidad('prueba-cielo',p_fecha,p_hora,p_zona,p_personas,false); $$;

revoke all on function public.consultar_disponibilidad_ensayo_cielo(date,time,uuid,integer) from public, anon, authenticated;
grant execute on function public.consultar_disponibilidad_ensayo_cielo(date,time,uuid,integer) to service_role;
