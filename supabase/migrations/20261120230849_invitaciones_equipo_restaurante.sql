begin;

create function contactia_privado.invitacion_equipo(
  p_restaurante bigint,p_actor uuid,p_email text,p_rol text,p_invitado uuid
)
returns boolean language plpgsql security definer set search_path='' as $$
declare cargo text;
begin
  if p_rol is null or p_rol not in ('encargado','empleado') or
     p_email is null or p_email='' or length(p_email)>254 then
    raise exception 'INVITACION_INVALIDA' using errcode='22023';
  end if;
  select rol into cargo from public.restaurante_usuarios
    where restaurante_id=p_restaurante and usuario_id=p_actor and activo;
  if cargo is null or cargo not in ('propietario','encargado') or (cargo='encargado' and p_rol<>'empleado') then
    raise exception 'ACCESO_NO_PERMITIDO' using errcode='42501';
  end if;

  if p_invitado is null then
    if exists(select 1 from auth.users where lower(email)=p_email) then
      raise exception 'CUENTA_EXISTENTE' using errcode='23505';
    end if;
    return true;
  end if;

  -- Usa el mismo orden de bloqueo que las bajas del equipo y vuelve a
  -- autorizar al remitente después de que el proveedor haya enviado el correo.
  perform 1 from public.restaurantes where id=p_restaurante for update;
  if not found then raise exception 'ACCESO_NO_PERMITIDO' using errcode='42501';end if;
  select rol into cargo from public.restaurante_usuarios
    where restaurante_id=p_restaurante and usuario_id=p_actor and activo for share;
  if cargo is null or cargo not in ('propietario','encargado') or (cargo='encargado' and p_rol<>'empleado') then
    raise exception 'ACCESO_NO_PERMITIDO' using errcode='42501';
  end if;
  perform 1 from auth.users where id=p_invitado and lower(email)=p_email and invited_at is not null for update;
  if not found then raise exception 'INVITADO_NO_VALIDO' using errcode='22023';end if;
  if exists(select 1 from public.restaurante_usuarios where usuario_id=p_invitado) then
    raise exception 'CUENTA_EXISTENTE' using errcode='23505';
  end if;
  insert into public.restaurante_usuarios(restaurante_id,usuario_id,rol,activo)
    values(p_restaurante,p_invitado,p_rol,true);
  return true;
end;
$$;
revoke all on function contactia_privado.invitacion_equipo(bigint,uuid,text,text,uuid) from public,anon,authenticated;
grant execute on function contactia_privado.invitacion_equipo(bigint,uuid,text,text,uuid) to service_role;

create function public.invitacion_equipo_contactia(
  p_restaurante bigint,p_actor uuid,p_email text,p_rol text,p_invitado uuid default null
)
returns boolean language sql security invoker set search_path='' as $$
  select contactia_privado.invitacion_equipo(p_restaurante,p_actor,p_email,p_rol,p_invitado);
$$;
revoke all on function public.invitacion_equipo_contactia(bigint,uuid,text,text,uuid) from public,anon,authenticated;
grant execute on function public.invitacion_equipo_contactia(bigint,uuid,text,text,uuid) to service_role;

commit;
