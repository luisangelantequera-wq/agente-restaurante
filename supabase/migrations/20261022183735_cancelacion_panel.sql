begin;
alter table public.reservas
  add column cancelado_por uuid references auth.users(id) on delete set null,
  add column cancelado_en timestamptz;
create index reservas_por_cancelador on public.reservas(cancelado_por) where cancelado_por is not null;

-- Capacidad limitada: no se conceden escrituras directas sobre reservas u ocupación.
-- La función privilegiada queda fuera del esquema expuesto y exige auth.uid().
create function contactia_privado.cancelar_desde_panel(p_restaurante bigint,p_reserva uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare usuario uuid:=auth.uid(); reserva public.reservas;
begin
  if usuario is null then raise exception 'ACCESO_NO_PERMITIDO' using errcode='42501'; end if;
  -- El bloqueo impide que se revoque la pertenencia durante la operación.
  perform 1 from public.restaurante_usuarios
    where restaurante_id=p_restaurante and usuario_id=usuario and activo for share;
  if not found then raise exception 'ACCESO_NO_PERMITIDO' using errcode='42501'; end if;
  select * into reserva from public.reservas
    where restaurante_id=p_restaurante and id=p_reserva for update;
  if not found then raise exception 'RESERVA_NO_DISPONIBLE' using errcode='P0002'; end if;
  if reserva.estado='cancelada' then return true; end if;
  if reserva.estado not in ('confirmada','con retraso') or reserva.inicio<=now() then
    raise exception 'ESTADO_NO_CANCELABLE' using errcode='55000';
  end if;
  update public.reservas set estado='cancelada',cancelado_por=usuario,cancelado_en=now()
    where id=p_reserva and restaurante_id=p_restaurante;
  -- El trigger existente libera todas las mesas en esta misma transacción.
  return true;
end $$;
revoke all on function contactia_privado.cancelar_desde_panel(bigint,uuid) from public,anon,authenticated,service_role;
grant execute on function contactia_privado.cancelar_desde_panel(bigint,uuid) to authenticated;

create function public.cancelar_reserva_panel(p_restaurante bigint,p_reserva uuid)
returns boolean language sql security invoker set search_path='' as $$
  select contactia_privado.cancelar_desde_panel(p_restaurante,p_reserva);
$$;
revoke all on function public.cancelar_reserva_panel(bigint,uuid) from public,anon,authenticated,service_role;
grant execute on function public.cancelar_reserva_panel(bigint,uuid) to authenticated;
commit;
