begin;

create table contactia_privado.bajas_equipo_restaurante (
  id bigint generated always as identity primary key,
  restaurante_id bigint not null references public.restaurantes(id),
  usuario_id uuid not null,
  rol text not null check (rol in ('encargado','empleado')),
  por_usuario_id uuid,
  desde_contactia boolean not null,
  registrado_en timestamptz not null default now()
);
alter table contactia_privado.bajas_equipo_restaurante enable row level security;
revoke all on contactia_privado.bajas_equipo_restaurante from public, anon, authenticated;

create function contactia_privado.equipo_restaurante(p_restaurante bigint, p_objetivo uuid, p_interno boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); cargo text; baja text;
begin
  if p_interno then
    cargo:='contactia';
  else
    select rol into cargo from public.restaurante_usuarios
      where restaurante_id=p_restaurante and usuario_id=actor and activo;
    if cargo is null or cargo not in ('propietario','encargado') then
      raise exception 'ACCESO_NO_PERMITIDO' using errcode='42501';
    end if;
  end if;

  if p_objetivo is not null then
    -- Serializa las bajas de un mismo restaurante, incluidos los cambios del
    -- encargado mientras otra persona le retira su permiso.
    perform 1 from public.restaurantes where id=p_restaurante for update;
    if not found then raise exception 'RESTAURANTE_NO_ENCONTRADO' using errcode='P0002'; end if;
    if not p_interno then
      select rol into cargo from public.restaurante_usuarios
        where restaurante_id=p_restaurante and usuario_id=actor and activo for share;
      if cargo is null or cargo not in ('propietario','encargado') then
        raise exception 'ACCESO_NO_PERMITIDO' using errcode='42501';
      end if;
    end if;
    update public.restaurante_usuarios m set activo=false
      where m.restaurante_id=p_restaurante and m.usuario_id=p_objetivo and m.activo
      and (m.rol='empleado' or (m.rol='encargado' and cargo in ('propietario','contactia')))
      returning m.rol into baja;
    if baja is null then raise exception 'BAJA_NO_PERMITIDA_O_YA_APLICADA' using errcode='42501'; end if;
    insert into contactia_privado.bajas_equipo_restaurante(restaurante_id,usuario_id,rol,por_usuario_id,desde_contactia)
      values(p_restaurante,p_objetivo,baja,case when not p_interno then actor end,p_interno);
  end if;

  return jsonb_build_object('personas',coalesce((
    select jsonb_agg(jsonb_build_object(
      'id',m.usuario_id,'email',u.email,'rol',m.rol,
      'puede_retirar',m.rol='empleado' or (m.rol='encargado' and cargo in ('propietario','contactia')))
      order by case m.rol when 'propietario' then 0 when 'encargado' then 1 else 2 end, u.email nulls last, m.usuario_id)
    from public.restaurante_usuarios m join auth.users u on u.id=m.usuario_id
    where m.restaurante_id=p_restaurante and m.activo
  ),'[]'::jsonb));
end;
$$;
revoke all on function contactia_privado.equipo_restaurante(bigint,uuid,boolean) from public,anon,authenticated;
grant execute on function contactia_privado.equipo_restaurante(bigint,uuid,boolean) to service_role;

create function contactia_privado.equipo_restaurante_panel(p_restaurante bigint, p_objetivo uuid)
returns jsonb language sql security definer set search_path='' as $$
  select contactia_privado.equipo_restaurante(p_restaurante,p_objetivo,false);
$$;
revoke all on function contactia_privado.equipo_restaurante_panel(bigint,uuid) from public,anon;
grant execute on function contactia_privado.equipo_restaurante_panel(bigint,uuid) to authenticated;

create function public.equipo_restaurante_panel(p_restaurante bigint, p_objetivo uuid default null)
returns jsonb language sql security invoker set search_path='' as $$
  select contactia_privado.equipo_restaurante_panel(p_restaurante,p_objetivo);
$$;
revoke all on function public.equipo_restaurante_panel(bigint,uuid) from public,anon;
grant execute on function public.equipo_restaurante_panel(bigint,uuid) to authenticated;

create function public.equipo_restaurante_contactia(p_restaurante bigint, p_objetivo uuid default null)
returns jsonb language sql security invoker set search_path='' as $$
  select contactia_privado.equipo_restaurante(p_restaurante,p_objetivo,true);
$$;
revoke all on function public.equipo_restaurante_contactia(bigint,uuid) from public,anon,authenticated;
grant execute on function public.equipo_restaurante_contactia(bigint,uuid) to service_role;

commit;
