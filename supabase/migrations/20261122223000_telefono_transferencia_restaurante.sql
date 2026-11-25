begin;
-- El destino de transferencia y su horario se guardan en la configuración privada de la ficha.
create or replace function public.administrar_restaurantes_contactia(p_accion text,p_id bigint default null,p_busqueda text default '',p_pagina integer default 0,p_version text default null,p_datos jsonb default null,p_configuracion jsonb default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare ficha_restaurante public.restaurantes; configuracion_actual jsonb; anterior jsonb; posterior jsonb; version_actual text; total integer; lista jsonb; k text;
begin
 if current_user <> 'service_role' then raise exception 'ACCESO_NO_PERMITIDO' using errcode='42501';end if;
 if p_accion='listar' then
  if length(p_busqueda)>120 or p_pagina<0 or p_pagina>100000 then raise exception 'DATOS_INVALIDOS' using errcode='22023';end if;
  select count(*) into total from public.restaurantes r where p_busqueda='' or strpos(lower(to_jsonb(r)::text),lower(p_busqueda))>0;
  select coalesce(jsonb_agg(x.ficha order by x.nombre,x.id),'[]') into lista from (
   select r.id,r.nombre,jsonb_build_object('datos',to_jsonb(r),'configuracion',coalesce(config.datos,'{}')) ficha
   from public.restaurantes r left join contactia_privado.configuracion_interna_restaurantes config on config.restaurante_id=r.id
   where p_busqueda='' or strpos(lower(to_jsonb(r)::text),lower(p_busqueda))>0
   order by r.nombre,r.id limit 20 offset p_pagina*20) x;
  return jsonb_build_object('restaurantes',lista,'total',total,'pagina',p_pagina);
 end if;
 if p_accion not in ('detalle','guardar') or p_id is null then raise exception 'DATOS_INVALIDOS' using errcode='22023';end if;
 select * into ficha_restaurante from public.restaurantes where id=p_id for update;
 if not found then raise exception 'NO_ENCONTRADO' using errcode='P0002';end if;
 select datos into configuracion_actual from contactia_privado.configuracion_interna_restaurantes where restaurante_id=p_id;
 configuracion_actual:=coalesce(configuracion_actual,'{}');anterior:=jsonb_build_object('datos',to_jsonb(ficha_restaurante),'configuracion',configuracion_actual);version_actual:=md5(anterior::text);
 if p_accion='guardar' then
  if p_version is distinct from version_actual then raise exception 'VERSION_DISTINTA' using errcode='40001';end if;
  if jsonb_typeof(p_datos) is distinct from 'object' or jsonb_typeof(p_configuracion) is distinct from 'object' then raise exception 'DATOS_INVALIDOS' using errcode='22023';end if;
  for k in select jsonb_object_keys(p_datos) loop
   if k not in ('nombre','telefono_publico','direccion','web','informacion_publica','zona_horaria','duracion_reserva_minutos','antelacion_minima_reserva_minutos','intervalo_minutos','reservas_web_activas','horario_reservas','dias_cierre','cierres_especiales') then raise exception 'CAMPO_NO_EDITABLE' using errcode='22023';end if;
  end loop;
  for k in select jsonb_object_keys(p_configuracion) loop
   if k not in ('estado_servicio','plan','cuota_mensual','suplemento_voz','moneda','proveedor_voz','voz','estado_activacion','telefono_reservas','telefono_transferencia','horario_atencion_telefonica','contacto_nombre','contacto_telefono','contacto_email','notas') then raise exception 'CAMPO_NO_EDITABLE' using errcode='22023';end if;
  end loop;
  if exists(select 1 from jsonb_each(p_configuracion) e where e.key<>'horario_atencion_telefonica' and
     (jsonb_typeof(e.value)<>'string' or length(e.value#>>'{}')>2000)) then
   raise exception 'DATOS_INVALIDOS' using errcode='22023';
  end if;
  if p_configuracion ? 'horario_atencion_telefonica' and
     (jsonb_typeof(p_configuracion->'horario_atencion_telefonica') is distinct from 'object' or
      length((p_configuracion->'horario_atencion_telefonica')::text)>800) then
   raise exception 'HORARIO_TELEFONICO_INVALIDO' using errcode='22023';
  end if;
  if coalesce(p_configuracion->>'telefono_transferencia','') <> '' and
     ((p_configuracion->>'telefono_transferencia') !~ '^\+[1-9][0-9]{7,14}$' or
      length(regexp_replace(coalesce(p_datos->>'telefono_publico',ficha_restaurante.telefono_publico),'[^0-9]','','g')) < 7) then
   raise exception 'TELEFONOS_DE_ASISTENCIA_INVALIDOS' using errcode='22023';
  end if;
  if anterior->'datos' @> p_datos and configuracion_actual=p_configuracion then return anterior||jsonb_build_object('version',version_actual,'sin_cambios',true);end if;
  ficha_restaurante:=jsonb_populate_record(ficha_restaurante,p_datos);
  if to_jsonb(ficha_restaurante) is distinct from anterior->'datos' then
  update public.restaurantes set nombre=ficha_restaurante.nombre,telefono_publico=ficha_restaurante.telefono_publico,direccion=ficha_restaurante.direccion,web=ficha_restaurante.web,
   informacion_publica=ficha_restaurante.informacion_publica,zona_horaria=ficha_restaurante.zona_horaria,duracion_reserva_minutos=ficha_restaurante.duracion_reserva_minutos,
   antelacion_minima_reserva_minutos=ficha_restaurante.antelacion_minima_reserva_minutos,intervalo_minutos=ficha_restaurante.intervalo_minutos,
   reservas_web_activas=ficha_restaurante.reservas_web_activas,horario_reservas=ficha_restaurante.horario_reservas,dias_cierre=ficha_restaurante.dias_cierre,cierres_especiales=ficha_restaurante.cierres_especiales,
   datos_version=datos_version+1,datos_modificado_por=null,datos_modificado_en=now(),
   horarios_version=horarios_version+1,horarios_modificado_por=null,horarios_modificado_en=now()
   where id=p_id returning * into ficha_restaurante;
  end if;
  insert into contactia_privado.configuracion_interna_restaurantes(restaurante_id,datos) values(p_id,p_configuracion)
   on conflict(restaurante_id) do update set datos=excluded.datos,actualizado_en=now();
  posterior:=jsonb_build_object('datos',to_jsonb(ficha_restaurante),'configuracion',p_configuracion);
  insert into contactia_privado.historial_interno_restaurantes(restaurante_id,editor,antes,despues) values(p_id,'Administración Contactia',anterior,posterior);
  anterior:=posterior;version_actual:=md5(anterior::text);
 end if;
 select coalesce(jsonb_agg(x),'[]') into lista from (select id,creado_en,editor,antes,despues from contactia_privado.historial_interno_restaurantes where restaurante_id=p_id order by id desc limit 30)x;
 return anterior||jsonb_build_object('version',version_actual,'historial',lista);
end;
$$;

create function public.asistencia_telefonica_contactia(p_restaurante bigint)
returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object(
  'telefono_reservas',datos->'telefono_reservas',
  'telefono_transferencia',datos->'telefono_transferencia',
  'horario_atencion_telefonica',datos->'horario_atencion_telefonica')
 from contactia_privado.configuracion_interna_restaurantes where restaurante_id=p_restaurante;
$$;
revoke all on function public.asistencia_telefonica_contactia(bigint) from public,anon,authenticated;
grant execute on function public.asistencia_telefonica_contactia(bigint) to service_role;
commit;
