begin;
alter table public.reservas
 add column reprogramado_por uuid references auth.users(id) on delete set null,
 add column reprogramado_en timestamptz;
create index reservas_por_reprogramador on public.reservas(reprogramado_por) where reprogramado_por is not null;

-- Validador común para el formulario y los cambios desde el panel.
create function contactia_privado.validar_horario_reserva(p_restaurante bigint,p_fecha date,p_hora time)
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
revoke all on function contactia_privado.validar_horario_reserva(bigint,date,time) from public,anon,authenticated,service_role;
grant execute on function contactia_privado.validar_horario_reserva(bigint,date,time) to service_role;

create or replace function public.reservar_web(p_slug text,p_peticion uuid,p_zona uuid,p_fecha date,p_hora time,
 p_personas integer,p_nombre text,p_email text,p_telefono text,p_observaciones text default '')
returns uuid language plpgsql security invoker set search_path='' as $$
declare r public.restaurantes; instante timestamptz; civil timestamp; rangos jsonb;
 especial jsonb; dia text; franja text; minutos integer; desde integer; hasta integer;
 valido boolean:=false; candidato record; previo public.reservas;
begin
 if p_fecha is null or p_hora is null or extract(second from p_hora)<>0 or p_hora>=time '24:00'
    or p_zona is null or p_personas is null or p_personas not between 1 and 1000
    or p_peticion is null or p_nombre is null or length(trim(p_nombre)) not between 1 and 200
    or p_email is null or p_telefono is null or p_observaciones is null then
   raise exception 'DATOS_INVALIDOS' using errcode='22023'; end if;
 select * into r from public.restaurantes where slug=p_slug and reservas_web_activas for share;
 if not found then raise exception 'RESTAURANTE_NO_DISPONIBLE' using errcode='P0001'; end if;
 civil:=p_fecha+p_hora; instante:=civil at time zone r.zona_horaria;
 -- No interpretar silenciosamente horas inexistentes o ambiguas del cambio horario.
 if instante at time zone r.zona_horaria<>civil or
    (instante-interval '1 hour') at time zone r.zona_horaria=civil or
    (instante+interval '1 hour') at time zone r.zona_horaria=civil then
   raise exception 'HORA_AMBIGUA' using errcode='22023'; end if;
 select * into previo from public.reservas where restaurante_id=r.id and peticion_id=p_peticion;
 if found then
   if previo.inicio<>instante or previo.zona_id<>p_zona or previo.personas<>p_personas
    or previo.nombre<>p_nombre or previo.email<>p_email or previo.telefono<>p_telefono
    or previo.observaciones<>p_observaciones then raise exception 'PETICION_REUTILIZADA' using errcode='22023'; end if;
   if previo.estado='cancelada' then raise exception 'PETICION_CANCELADA' using errcode='P0001'; end if;
   return previo.id;
 end if;
 perform contactia_privado.validar_horario_reserva(r.id,p_fecha,p_hora);
 perform 1 from public.zonas where id=p_zona and restaurante_id=r.id and estado='activo' for share;
 if not found then raise exception 'ZONA_NO_DISPONIBLE' using errcode='P0001'; end if;
 -- Primero la mesa individual adecuada más pequeña; después combinaciones.
 -- No se acepta ninguna lista de mesas procedente del navegador.
 for candidato in
  select array[m.id] as ids from public.mesas m
  where m.restaurante_id=r.id and m.zona_id=p_zona and m.estado='libre'
   and p_personas between m.min_personas and m.capacidad order by m.capacidad,m.id
 loop
  begin
   return public.crear_reserva(r.id,p_peticion,candidato.ids,instante,p_personas,p_nombre,p_email,p_telefono,p_observaciones);
  exception when exclusion_violation then null; end;
 end loop;
 for candidato in
  select array_agg(cm.mesa_id order by cm.mesa_id) as ids
  from public.combinaciones_mesas c join public.combinacion_mesas cm on cm.combinacion_id=c.id
  join public.mesas m on m.id=cm.mesa_id and m.restaurante_id=c.restaurante_id
  where c.restaurante_id=r.id and c.zona_id=p_zona and c.activa and p_personas between c.min_personas and c.max_personas
  group by c.id having count(*) between 2 and 20 and bool_and(m.estado='libre' and m.zona_id=p_zona)
  order by sum(m.capacidad),c.id
 loop
  begin
   return public.crear_reserva(r.id,p_peticion,candidato.ids,instante,p_personas,p_nombre,p_email,p_telefono,p_observaciones);
  exception when exclusion_violation then null; end;
 end loop;
 raise exception 'SIN_DISPONIBILIDAD' using errcode='P0001';
end $$;

create function contactia_privado.reprogramar_desde_panel(p_restaurante bigint,p_reserva uuid,p_fecha date,p_hora time,p_inicio_anterior timestamptz)
returns boolean language plpgsql security definer set search_path='' as $$
declare usuario uuid:=auth.uid(); reserva public.reservas; instante timestamptz; tz text;
begin
 if usuario is null then raise exception 'ACCESO_NO_PERMITIDO' using errcode='42501'; end if;
 perform 1 from public.restaurante_usuarios where restaurante_id=p_restaurante and usuario_id=usuario and activo for share;
 if not found then raise exception 'ACCESO_NO_PERMITIDO' using errcode='42501'; end if;
 select * into reserva from public.reservas where restaurante_id=p_restaurante and id=p_reserva for update;
 if not found then raise exception 'RESERVA_NO_DISPONIBLE' using errcode='P0002'; end if;
 if reserva.estado<>'confirmada' or reserva.inicio<=now() then
  raise exception 'ESTADO_NO_MODIFICABLE' using errcode='55000'; end if;
 if p_inicio_anterior is null or not isfinite(p_inicio_anterior) then
  raise exception 'DATOS_INVALIDOS' using errcode='22023'; end if;
 if p_fecha is null or not isfinite(p_fecha) or p_hora is null or extract(second from p_hora)<>0 or p_hora>=time '24:00' then
  raise exception 'DATOS_INVALIDOS' using errcode='22023'; end if;
 select zona_horaria into strict tz from public.restaurantes where id=p_restaurante for share;
 -- Reintento tras éxito: no se vuelve a modificar el registro ni su auditoría.
 instante:=(p_fecha+p_hora) at time zone tz;
 if instante at time zone tz<>p_fecha+p_hora or
    (instante-interval '1 hour') at time zone tz=p_fecha+p_hora or
    (instante+interval '1 hour') at time zone tz=p_fecha+p_hora then
  raise exception 'HORA_AMBIGUA' using errcode='22023'; end if;
 if reserva.inicio=instante then return true; end if;
 if reserva.inicio<>p_inicio_anterior then
  raise exception 'RESERVA_MODIFICADA' using errcode='40001'; end if;
 instante:=contactia_privado.validar_horario_reserva(p_restaurante,p_fecha,p_hora);
 if not public.reprogramar_reserva(p_restaurante,p_reserva,instante) then
  raise exception 'ESTADO_NO_MODIFICABLE' using errcode='55000'; end if;
 update public.reservas set reprogramado_por=usuario,reprogramado_en=now()
  where restaurante_id=p_restaurante and id=p_reserva;
 return true;
end $$;
revoke all on function contactia_privado.reprogramar_desde_panel(bigint,uuid,date,time,timestamptz) from public,anon,authenticated,service_role;
grant execute on function contactia_privado.reprogramar_desde_panel(bigint,uuid,date,time,timestamptz) to authenticated;
create function public.reprogramar_reserva_panel(p_restaurante bigint,p_reserva uuid,p_fecha date,p_hora time,p_inicio_anterior timestamptz)
returns boolean language sql security invoker set search_path='' as $$
 select contactia_privado.reprogramar_desde_panel(p_restaurante,p_reserva,p_fecha,p_hora,p_inicio_anterior);
$$;
revoke all on function public.reprogramar_reserva_panel(bigint,uuid,date,time,timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.reprogramar_reserva_panel(bigint,uuid,date,time,timestamptz) to authenticated;
commit;
