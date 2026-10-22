begin;
alter table public.zonas add column estado_version integer not null default 0,
 add column estado_modificado_por uuid references auth.users(id) on delete set null,
 add column estado_modificado_en timestamptz;
alter table public.mesas add column estado_version integer not null default 0,
 add column estado_modificado_por uuid references auth.users(id) on delete set null,
 add column estado_modificado_en timestamptz;
create index zonas_por_editor_estado on public.zonas(estado_modificado_por) where estado_modificado_por is not null;
create index mesas_por_editor_estado on public.mesas(estado_modificado_por) where estado_modificado_por is not null;

create function contactia_privado.disponibilidad_desde_panel(p_restaurante bigint,p_tipo text,p_elemento uuid,p_estado text,p_version integer,p_aplicar boolean,p_afectadas_esperadas integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare usuario uuid:=auth.uid(); actual text; version_actual integer; zona uuid; afectadas integer:=0;
begin
 if usuario is null then raise exception 'ACCESO_NO_PERMITIDO' using errcode='42501'; end if;
 perform 1 from public.restaurante_usuarios where restaurante_id=p_restaurante and usuario_id=usuario and activo and rol in ('propietario','encargado') for share;
 if not found then raise exception 'ACCESO_NO_PERMITIDO' using errcode='42501'; end if;
 if p_tipo is null or p_tipo not in ('zona','mesa') or p_estado is null or p_elemento is null
  or p_version is null or p_version<0 or p_aplicar is null
  or (p_tipo='zona' and p_estado not in ('activo','inactivo'))
  or (p_tipo='mesa' and p_estado not in ('libre','fuera de servicio'))
  or (p_aplicar and (p_afectadas_esperadas is null or p_afectadas_esperadas<0)) then
  raise exception 'DATOS_INVALIDOS' using errcode='22023'; end if;
 -- Mismo orden de bloqueos que el motor: restaurante, zona, mesa.
 perform 1 from public.restaurantes where id=p_restaurante for share;
 if p_tipo='zona' then
  select estado,estado_version into actual,version_actual from public.zonas where restaurante_id=p_restaurante and id=p_elemento for update;
 else
  select zona_id into zona from public.mesas where restaurante_id=p_restaurante and id=p_elemento;
  if not found then raise exception 'ELEMENTO_NO_DISPONIBLE' using errcode='P0002'; end if;
  perform 1 from public.zonas where restaurante_id=p_restaurante and id=zona for share;
  select estado,estado_version into actual,version_actual from public.mesas where restaurante_id=p_restaurante and id=p_elemento for update;
 end if;
 if actual is null then raise exception 'ELEMENTO_NO_DISPONIBLE' using errcode='P0002'; end if;
 if version_actual<>p_version then raise exception 'ESTADO_MODIFICADO' using errcode='40001'; end if;
 if p_estado in ('inactivo','fuera de servicio') then
  select count(distinct r.id)::integer into afectadas from public.reservas r
   join public.reserva_mesas rm on rm.reserva_id=r.id and rm.restaurante_id=r.restaurante_id and rm.activa
   where r.restaurante_id=p_restaurante and r.estado<>'cancelada' and r.fin>clock_timestamp()
    and ((p_tipo='zona' and r.zona_id=p_elemento) or (p_tipo='mesa' and rm.mesa_id=p_elemento));
 end if;
 if p_aplicar then
  if afectadas<>p_afectadas_esperadas then raise exception 'RESERVAS_MODIFICADAS' using errcode='40001'; end if;
  if actual<>p_estado then
   if p_tipo='zona' then
    update public.zonas set estado=p_estado,estado_version=estado_version+1,estado_modificado_por=usuario,estado_modificado_en=now()
     where restaurante_id=p_restaurante and id=p_elemento;
   else
    update public.mesas set estado=p_estado,estado_version=estado_version+1,estado_modificado_por=usuario,estado_modificado_en=now()
     where restaurante_id=p_restaurante and id=p_elemento;
   end if;
   version_actual:=version_actual+1;
  end if;
 end if;
 return jsonb_build_object('version',version_actual,'estado',case when p_aplicar then p_estado else actual end,'afectadas',afectadas,'aplicado',p_aplicar);
end $$;
revoke all on function contactia_privado.disponibilidad_desde_panel(bigint,text,uuid,text,integer,boolean,integer) from public,anon,authenticated,service_role;
grant execute on function contactia_privado.disponibilidad_desde_panel(bigint,text,uuid,text,integer,boolean,integer) to authenticated;
create function public.disponibilidad_panel(p_restaurante bigint,p_tipo text,p_elemento uuid,p_estado text,p_version integer,p_aplicar boolean,p_afectadas_esperadas integer default null)
returns jsonb language sql security invoker set search_path='' as $$
 select contactia_privado.disponibilidad_desde_panel(p_restaurante,p_tipo,p_elemento,p_estado,p_version,p_aplicar,p_afectadas_esperadas);
$$;
revoke all on function public.disponibilidad_panel(bigint,text,uuid,text,integer,boolean,integer) from public,anon,authenticated,service_role;
grant execute on function public.disponibilidad_panel(bigint,text,uuid,text,integer,boolean,integer) to authenticated;
commit;
