begin;
alter table public.restaurantes
 add column horarios_version integer not null default 0,
 add column horarios_modificado_por uuid references auth.users(id) on delete set null,
 add column horarios_modificado_en timestamptz;
create index restaurantes_por_editor_horarios on public.restaurantes(horarios_modificado_por) where horarios_modificado_por is not null;

create function contactia_privado.validar_rangos_horarios(p_rangos jsonb)
returns void language plpgsql security invoker set search_path='' as $$
declare e jsonb; franja text; inicio integer; fin integer; anterior integer:=-1;
begin
 if jsonb_typeof(p_rangos) is distinct from 'array' then raise exception 'HORARIO_INVALIDO' using errcode='22023'; end if;
 if jsonb_array_length(p_rangos)>4 then raise exception 'HORARIO_INVALIDO' using errcode='22023'; end if;
 for e in select jsonb_array_elements(p_rangos) loop
  if jsonb_typeof(e) is distinct from 'string' then raise exception 'HORARIO_INVALIDO' using errcode='22023'; end if;
  franja:=e#>>'{}';
  if franja !~ '^([01][0-9]|2[0-3]):[0-5][0-9]-([01][0-9]|2[0-3]):[0-5][0-9]$' then
   raise exception 'HORARIO_INVALIDO' using errcode='22023'; end if;
  inicio:=extract(hour from substring(franja,1,5)::time)::integer*60+extract(minute from substring(franja,1,5)::time)::integer;
  fin:=extract(hour from substring(franja,7,5)::time)::integer*60+extract(minute from substring(franja,7,5)::time)::integer;
  if inicio>=fin or inicio<=anterior then raise exception 'HORARIO_INVALIDO' using errcode='22023'; end if;
  anterior:=fin;
 end loop;
end $$;
revoke all on function contactia_privado.validar_rangos_horarios(jsonb) from public,anon,authenticated,service_role;

create function contactia_privado.guardar_horarios_desde_panel(p_restaurante bigint,p_version integer,p_horario jsonb,p_especiales jsonb,p_antelacion integer,p_intervalo integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare usuario uuid:=auth.uid(); r public.restaurantes; dias text[]:=array['lunes','martes','miércoles','jueves','viernes','sábado','domingo'];
 dia text; e jsonb; fecha text; fecha_completa text; fechas text[]:=array[]::text[]; cerrados jsonb:='[]';
 reserva record; revisar integer:=0;
begin
 if usuario is null then raise exception 'ACCESO_NO_PERMITIDO' using errcode='42501'; end if;
 perform 1 from public.restaurante_usuarios where restaurante_id=p_restaurante and usuario_id=usuario and activo and rol in ('propietario','encargado') for share;
 if not found then raise exception 'ACCESO_NO_PERMITIDO' using errcode='42501'; end if;
 if p_version is null or p_version<0 or p_antelacion is null or p_antelacion not between 0 and 525600
  or p_intervalo is null or p_intervalo not between 1 and 1440 then raise exception 'HORARIO_INVALIDO' using errcode='22023'; end if;
 if jsonb_typeof(p_horario) is distinct from 'object' or jsonb_typeof(p_especiales) is distinct from 'array' then
  raise exception 'HORARIO_INVALIDO' using errcode='22023'; end if;
 if (select count(*) from jsonb_object_keys(p_horario))<>7 or jsonb_array_length(p_especiales)>100 then
  raise exception 'HORARIO_INVALIDO' using errcode='22023'; end if;
 foreach dia in array dias loop
  perform contactia_privado.validar_rangos_horarios(p_horario->dia);
  if jsonb_array_length(p_horario->dia)=0 then cerrados:=cerrados||jsonb_build_array(dia); end if;
 end loop;
 for e in select jsonb_array_elements(p_especiales) loop
  if jsonb_typeof(e) is distinct from 'object' then raise exception 'HORARIO_INVALIDO' using errcode='22023'; end if;
  if (select count(*) from jsonb_object_keys(e))<>2 or jsonb_typeof(e->'fecha') is distinct from 'string' then
   raise exception 'HORARIO_INVALIDO' using errcode='22023'; end if;
  fecha:=e->>'fecha';
  if fecha ~ '^[0-9]{2}-[0-9]{2}$' then fecha_completa:='2000-'||fecha;
  elsif fecha ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then fecha_completa:=fecha;
  else raise exception 'HORARIO_INVALIDO' using errcode='22023'; end if;
  begin
   if to_char(fecha_completa::date,'YYYY-MM-DD')<>fecha_completa then raise exception 'HORARIO_INVALIDO' using errcode='22023'; end if;
  exception when invalid_datetime_format or datetime_field_overflow then raise exception 'HORARIO_INVALIDO' using errcode='22023'; end;
  if fecha=any(fechas) then raise exception 'HORARIO_INVALIDO' using errcode='22023'; end if;
  fechas:=array_append(fechas,fecha);
  perform contactia_privado.validar_rangos_horarios(e->'rangos');
 end loop;
 select * into r from public.restaurantes where id=p_restaurante for update;
 if not found then raise exception 'ACCESO_NO_PERMITIDO' using errcode='42501'; end if;
 if r.horarios_version<>p_version then raise exception 'HORARIO_MODIFICADO' using errcode='40001'; end if;
 update public.restaurantes set horario_reservas=p_horario||jsonb_build_object('_contactia',jsonb_build_object('especiales',p_especiales)),
  dias_cierre=cerrados,cierres_especiales='[]',antelacion_minima_reserva_minutos=p_antelacion,intervalo_minutos=p_intervalo,
  horarios_version=horarios_version+1,horarios_modificado_por=usuario,horarios_modificado_en=now()
  where id=p_restaurante;
 -- Las reservas existentes se conservan. Avisar de las que requieren revisión.
 for reserva in select inicio from public.reservas where restaurante_id=p_restaurante and inicio>now() and estado<>'cancelada' loop
  begin
   perform contactia_privado.validar_horario_reserva(p_restaurante,(reserva.inicio at time zone r.zona_horaria)::date,(reserva.inicio at time zone r.zona_horaria)::time);
  exception
   when invalid_parameter_value then revisar:=revisar+1;
   when raise_exception then
    if sqlerrm in ('FUERA_HORARIO','HORARIO_NO_CONFIGURADO') then revisar:=revisar+1; else raise; end if;
  end;
 end loop;
 return jsonb_build_object('version',r.horarios_version+1,'reservas_a_revisar',revisar);
end $$;
revoke all on function contactia_privado.guardar_horarios_desde_panel(bigint,integer,jsonb,jsonb,integer,integer) from public,anon,authenticated,service_role;
grant execute on function contactia_privado.guardar_horarios_desde_panel(bigint,integer,jsonb,jsonb,integer,integer) to authenticated;

create function public.guardar_horarios_panel(p_restaurante bigint,p_version integer,p_horario jsonb,p_especiales jsonb,p_antelacion integer,p_intervalo integer)
returns jsonb language sql security invoker set search_path='' as $$
 select contactia_privado.guardar_horarios_desde_panel(p_restaurante,p_version,p_horario,p_especiales,p_antelacion,p_intervalo);
$$;
revoke all on function public.guardar_horarios_panel(bigint,integer,jsonb,jsonb,integer,integer) from public,anon,authenticated,service_role;
grant execute on function public.guardar_horarios_panel(bigint,integer,jsonb,jsonb,integer,integer) to authenticated;
commit;
