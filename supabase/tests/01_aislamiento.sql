-- Ejecutar tras la migración sobre una base de PRUEBAS. Todo se revierte.
begin;
insert into auth.users (id) values
 ('00000000-0000-0000-0000-000000000001'),
 ('00000000-0000-0000-0000-000000000002'),
 ('00000000-0000-0000-0000-000000000003');
insert into public.restaurantes(id, slug, nombre, duracion_reserva_minutos) values
 (900001, 'sol-prueba-rls', 'Sol ficticio', 90),
 (900002, 'luna-prueba-rls', 'Luna ficticio', 90);
insert into public.restaurante_usuarios(restaurante_id, usuario_id, rol, activo) values
 (900001, '00000000-0000-0000-0000-000000000001', 'propietario', true),
 (900002, '00000000-0000-0000-0000-000000000002', 'encargado', true),
 (900001, '00000000-0000-0000-0000-000000000003', 'empleado', false);
insert into public.zonas(id, restaurante_id, nombre) values
 ('10000000-0000-0000-0000-000000000001', 900001, 'INTERIOR'),
 ('10000000-0000-0000-0000-000000000002', 900002, 'TERRAZA');
insert into public.mesas(restaurante_id, zona_id, nombre, capacidad) values
 (900001, '10000000-0000-0000-0000-000000000001', 'Mesa 1', 4),
 (900002, '10000000-0000-0000-0000-000000000002', 'Mesa 2', 2);

do $$ begin
  begin
    insert into public.mesas(restaurante_id, zona_id, nombre, capacidad)
      values (900001, '10000000-0000-0000-0000-000000000002', 'Cruce prohibido', 2);
    raise exception 'FALLO: mesa vinculada a zona de otro restaurante';
  exception when foreign_key_violation then null; end;
end $$;

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
do $$ begin
  if (select count(*) from public.restaurantes) <> 1 or
     not exists(select 1 from public.restaurantes where id = 900001) or
     (select count(*) from public.zonas) <> 1 or
     (select count(*) from public.mesas) <> 1 or
     (select count(*) from public.restaurante_usuarios) <> 1 then
    raise exception 'FALLO: aislamiento de Sol';
  end if;
  begin
    update public.restaurante_usuarios set rol = 'propietario';
    raise exception 'FALLO: escalada de permisos';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.zonas(restaurante_id, nombre) values (900001, 'Nueva zona');
    raise exception 'FALLO: alta de zona habilitada';
  exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true);
do $$ begin
  if (select count(*) from public.restaurantes) <> 1 or
     exists(select 1 from public.restaurantes where id = 900001) or
     exists(select 1 from public.zonas where restaurante_id = 900001) or
     exists(select 1 from public.mesas where restaurante_id = 900001) then
    raise exception 'FALLO: aislamiento de Luna';
  end if;
end $$;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', true);
do $$ begin
  if exists(select 1 from public.restaurantes) or exists(select 1 from public.zonas) or
     exists(select 1 from public.mesas) or exists(select 1 from public.restaurante_usuarios) then
    raise exception 'FALLO: usuario desactivado';
  end if;
end $$;
set local role anon;
do $$ begin
  begin
    perform 1 from public.restaurantes;
    raise exception 'FALLO: acceso anónimo';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
rollback;
