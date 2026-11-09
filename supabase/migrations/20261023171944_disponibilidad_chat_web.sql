begin;
-- Una sola prioridad de calendario para chat, formulario y reprogramaciones.
create function contactia_privado.horario_para_fecha(p_restaurante bigint,p_fecha date)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare r public.restaurantes; especial jsonb; rangos jsonb; dia text;
begin
 select * into strict r from public.restaurantes where id=p_restaurante for share;
 -- Misma prioridad que ajustes-restaurante.horarioParaFecha: fecha exacta,
 -- cierre concreto, excepción anual y, finalmente, horario semanal.
 select e into especial from jsonb_array_elements(coalesce(r.horario_reservas->'_contactia'->'especiales','[]')) e
 where e->>'fecha'=p_fecha::text limit 1;
 if especial is not null then rangos:=especial->'rangos';
 elsif r.cierres_especiales ? p_fecha::text then rangos:='[]';
 else
   select e into especial from jsonb_array_elements(coalesce(r.horario_reservas->'_contactia'->'especiales','[]')) e
   where e->>'fecha'=to_char(p_fecha,'MM-DD') limit 1;
   if especial is not null then rangos:=especial->'rangos';
   else
     dia:=(array['domingo','lunes','martes','miércoles','jueves','viernes','sábado'])[extract(dow from p_fecha)::integer+1];
     rangos:=case when r.dias_cierre ? dia then '[]'::jsonb else coalesce(r.horario_reservas->dia,'[]') end;
   end if;
 end if;
 if jsonb_typeof(rangos) is distinct from 'array' then raise exception 'HORARIO_NO_CONFIGURADO' using errcode='P0001'; end if;
 return rangos;
end $$;
revoke all on function contactia_privado.horario_para_fecha(bigint,date) from public,anon,authenticated,service_role;
grant execute on function contactia_privado.horario_para_fecha(bigint,date) to service_role;

create or replace function contactia_privado.validar_horario_reserva(p_restaurante bigint,p_fecha date,p_hora time)
returns timestamptz language plpgsql security invoker set search_path='' as $$
declare r public.restaurantes; instante timestamptz; civil timestamp; rangos jsonb;
 especial jsonb; dia text; franja text; minutos integer; desde integer; hasta integer; valido boolean:=false;
begin
 if p_fecha is null or not isfinite(p_fecha) or p_hora is null or extract(second from p_hora)<>0 or p_hora>=time '24:00' then
  raise exception 'DATOS_INVALIDOS' using errcode='22023'; end if;
 select * into strict r from public.restaurantes where id=p_restaurante for share;
 civil:=p_fecha+p_hora; instante:=civil at time zone r.zona_horaria;
 if instante at time zone r.zona_horaria<>civil or
    (instante-interval '1 hour') at time zone r.zona_horaria=civil or
    (instante+interval '1 hour') at time zone r.zona_horaria=civil then
  raise exception 'HORA_AMBIGUA' using errcode='22023'; end if;
 if p_fecha>(clock_timestamp() at time zone r.zona_horaria)::date+365 or
    instante<clock_timestamp()+make_interval(mins=>r.antelacion_minima_reserva_minutos) then
   raise exception 'ANTELACION_INVALIDA' using errcode='22023'; end if;
 rangos:=contactia_privado.horario_para_fecha(p_restaurante,p_fecha);
 if jsonb_typeof(rangos) is distinct from 'array' then raise exception 'HORARIO_NO_CONFIGURADO' using errcode='P0001'; end if;
 minutos:=extract(hour from p_hora)::integer*60+extract(minute from p_hora)::integer;
 for franja in select jsonb_array_elements_text(rangos) loop
   if franja !~ '^([01][0-9]|2[0-3]):[0-5][0-9]-([01][0-9]|2[0-3]):[0-5][0-9]$' then
     raise exception 'HORARIO_NO_CONFIGURADO' using errcode='P0001'; end if;
   desde:=extract(hour from substring(franja,1,5)::time)::integer*60+extract(minute from substring(franja,1,5)::time)::integer;
   hasta:=extract(hour from substring(franja,7,5)::time)::integer*60+extract(minute from substring(franja,7,5)::time)::integer;
   if desde>=hasta then raise exception 'HORARIO_NO_CONFIGURADO' using errcode='P0001'; end if;
   if minutos>=desde and minutos<hasta and (minutos-desde)%r.intervalo_minutos=0 then valido:=true; end if;
 end loop;
 if not valido then raise exception 'FUERA_HORARIO' using errcode='P0001'; end if;
 return instante;
end $$;

-- Lectura sin retenciones ni escrituras de reservas. No devuelve datos de clientes o mesas.
create function public.consultar_disponibilidad_web(p_slug text,p_fecha date,p_hora time default null,p_zona uuid default null,p_personas integer default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare r public.restaurantes; rangos jsonb; instante timestamptz; v_periodo tstzrange; candidato record;
begin
 select * into r from public.restaurantes where slug=p_slug and reservas_web_activas for share;
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
end $$;
revoke all on function public.consultar_disponibilidad_web(text,date,time,uuid,integer) from public,anon,authenticated,service_role;
grant execute on function public.consultar_disponibilidad_web(text,date,time,uuid,integer) to service_role;
commit;
