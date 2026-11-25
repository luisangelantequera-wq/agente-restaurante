begin;
insert into auth.users(id,email,invited_at) values
 ('f2000000-0000-4000-a000-000000000001','owner@example.org',null),
 ('f2000000-0000-4000-a000-000000000002','manager@example.org',null),
 ('f2000000-0000-4000-a000-000000000003','staff@example.org',null),
 ('f2000000-0000-4000-a000-000000000004','nuevo@example.org',now());
insert into public.restaurantes(id,slug,nombre,duracion_reserva_minutos) values
 (991101,'prueba-invitaciones','Equipo de prueba',90),(991102,'prueba-invitaciones-ajenas','Equipo ajeno',90);
insert into public.restaurante_usuarios(restaurante_id,usuario_id,rol) values
 (991101,'f2000000-0000-4000-a000-000000000001','propietario'),
 (991101,'f2000000-0000-4000-a000-000000000002','encargado'),
 (991101,'f2000000-0000-4000-a000-000000000003','empleado');
set local role authenticated;
do $$ begin
  perform public.invitacion_equipo_contactia(991101,'f2000000-0000-4000-a000-000000000001','libre@example.org','empleado');
  raise exception 'Usuario autenticado pudo invocar la operación privada directamente';
exception when insufficient_privilege then null;end $$;
reset role;
set local role service_role;
do $$
declare propietario uuid:='f2000000-0000-4000-a000-000000000001'; encargado uuid:='f2000000-0000-4000-a000-000000000002';
 empleado uuid:='f2000000-0000-4000-a000-000000000003'; invitado uuid:='f2000000-0000-4000-a000-000000000004';
begin
  begin
    perform public.invitacion_equipo_contactia(991101,empleado,'libre@example.org','empleado');
    raise exception 'Empleado pudo invitar';
  exception when insufficient_privilege then null;end;
  begin
    perform public.invitacion_equipo_contactia(991101,encargado,'libre@example.org','encargado');
    raise exception 'Encargado pudo invitar a otro encargado';
  exception when insufficient_privilege then null;end;
  begin
    perform public.invitacion_equipo_contactia(991102,propietario,'libre@example.org','empleado');
    raise exception 'Propietario pudo invitar para otro local';
  exception when insufficient_privilege then null;end;
  begin
    perform public.invitacion_equipo_contactia(991101,propietario,'staff@example.org','empleado');
    raise exception 'Se aceptó una cuenta existente';
  exception when unique_violation then null;end;
  if not public.invitacion_equipo_contactia(991101,encargado,'libre@example.org','empleado') then
    raise exception 'Se bloqueó una invitación permitida al encargado';
  end if;
  perform public.equipo_restaurante_contactia(991101,encargado);
  begin
    perform public.invitacion_equipo_contactia(991101,encargado,'nuevo@example.org','empleado',invitado);
    raise exception 'Remitente dado de baja pudo asignar acceso';
  exception when insufficient_privilege then null;end;
  begin
    perform public.invitacion_equipo_contactia(991101,propietario,'otro@example.org','encargado',invitado);
    raise exception 'Se asignó un permiso a otra cuenta';
  exception when invalid_parameter_value then null;end;
  perform public.invitacion_equipo_contactia(991101,propietario,'nuevo@example.org','encargado',invitado);
  if not exists(select 1 from public.restaurante_usuarios where restaurante_id=991101 and usuario_id=invitado and rol='encargado' and activo) then
    raise exception 'Falta el permiso correcto';
  end if;
end $$;
rollback;
