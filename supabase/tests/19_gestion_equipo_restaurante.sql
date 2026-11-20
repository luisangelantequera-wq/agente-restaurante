begin;
insert into auth.users(id,email) values
 ('f1900000-0000-4000-a000-000000000001','propietario@example.org'),('f1900000-0000-4000-a000-000000000002','encargado@example.org'),
 ('f1900000-0000-4000-a000-000000000003','empleado@example.org'),('f1900000-0000-4000-a000-000000000004','encargado2@example.org');
insert into public.restaurantes(id,slug,nombre,duracion_reserva_minutos) values
 (991091,'mi-equipo-prueba','Equipo propio',90),(991092,'equipo-ajeno-prueba','Equipo ajeno',90);
insert into public.restaurante_usuarios(restaurante_id,usuario_id,rol) values
 (991091,'f1900000-0000-4000-a000-000000000001','propietario'),
 (991091,'f1900000-0000-4000-a000-000000000002','encargado'),
 (991091,'f1900000-0000-4000-a000-000000000003','empleado'),
 (991091,'f1900000-0000-4000-a000-000000000004','encargado'),
 (991092,'f1900000-0000-4000-a000-000000000003','empleado');

set local role authenticated;
set local "request.jwt.claim.sub"='f1900000-0000-4000-a000-000000000003';
do $$ begin
  begin
    perform public.equipo_restaurante_panel(991091);
    raise exception 'El empleado pudo consultar el equipo';
  exception when insufficient_privilege then null; end;
  begin
    perform public.equipo_restaurante_contactia(991091);
    raise exception 'Un usuario accedió por la operación interna';
  exception when insufficient_privilege then null; end;
  begin
    perform contactia_privado.equipo_restaurante(991091,null,true);
    raise exception 'Un usuario ejecutó directamente la función privada';
  exception when insufficient_privilege then null; end;
end $$;

set local "request.jwt.claim.sub"='f1900000-0000-4000-a000-000000000002';
do $$
declare lista jsonb;
begin
  lista:=public.equipo_restaurante_panel(991091)->'personas';
  if jsonb_array_length(lista)<>4 or
     not lista @> '[{"email":"empleado@example.org","rol":"empleado","puede_retirar":true}]' or
     lista @> '[{"rol":"encargado","puede_retirar":true}]' then
    raise exception 'La lista no representa los permisos del encargado';
  end if;
  begin
    perform public.equipo_restaurante_panel(991092,'f1900000-0000-4000-a000-000000000003');
    raise exception 'El encargado pudo dar de baja a un empleado en otro restaurante';
  exception when insufficient_privilege then null; end;
  begin
    perform public.equipo_restaurante_panel(991091,'f1900000-0000-4000-a000-000000000004');
    raise exception 'El encargado dio de baja a un colega';
  exception when insufficient_privilege then null; end;
  lista:=public.equipo_restaurante_panel(991091,'f1900000-0000-4000-a000-000000000003')->'personas';
  if jsonb_array_length(lista)<>3 or lista @> '[{"rol":"empleado"}]' then
    raise exception 'El empleado dado de baja sigue en la lista activa';
  end if;
end $$;

set local "request.jwt.claim.sub"='f1900000-0000-4000-a000-000000000003';
do $$ begin
  if exists(select 1 from public.restaurantes where id=991091) or
     not exists(select 1 from public.restaurantes where id=991092) then
    raise exception 'La baja no quedó limitada a un restaurante con la misma sesión';
  end if;
end $$;
set local "request.jwt.claim.sub"='f1900000-0000-4000-a000-000000000001';
select public.equipo_restaurante_panel(991091,'f1900000-0000-4000-a000-000000000002');
reset role;
set local role service_role;
do $$ begin
  begin
    perform public.equipo_restaurante_contactia(991091,'f1900000-0000-4000-a000-000000000001');
    raise exception 'Se retiró al propietario desde la gestión del equipo';
  exception when insufficient_privilege then null; end;
  perform public.equipo_restaurante_contactia(991091,'f1900000-0000-4000-a000-000000000004');
end $$;
reset role;
do $$ begin
  if (select count(*) from contactia_privado.bajas_equipo_restaurante where restaurante_id=991091)<>3
    or not exists(select 1 from contactia_privado.bajas_equipo_restaurante where restaurante_id=991091 and desde_contactia)
    or not exists(select 1 from public.restaurante_usuarios where restaurante_id=991092 and activo) then
    raise exception 'Error en el historial o el alcance de la baja';
  end if;
end $$;
rollback;
