begin;
insert into auth.users(id) values ('98f10000-0000-4000-a000-000000000001'),('98f10000-0000-4000-a000-000000000002');
insert into public.restaurantes(id,slug,nombre,duracion_reserva_minutos) values
 (991081,'ficha-prueba-propia','Ficha propia',90),(991082,'ficha-prueba-ajena','Ficha ajena',90);
insert into public.restaurante_usuarios(restaurante_id,usuario_id,rol) values
 (991081,'98f10000-0000-4000-a000-000000000001','propietario'),
 (991081,'98f10000-0000-4000-a000-000000000002','empleado');
insert into contactia_privado.configuracion_interna_restaurantes(restaurante_id,datos) values
 (991081,'{"contacto_nombre":"Inicial","voz":"voz interna","cuota_mensual":"42"}'),
 (991082,'{"contacto_nombre":"Otro local"}');

set local role authenticated;
set local "request.jwt.claim.sub" = '98f10000-0000-4000-a000-000000000002';
do $$ begin
  perform public.contacto_ficha_restaurante(991081);
  raise exception 'El empleado pudo leer el contacto';
exception when insufficient_privilege then null;
end $$;

set local "request.jwt.claim.sub" = '98f10000-0000-4000-a000-000000000001';
do $$
declare ficha jsonb; version text; contacto jsonb := '{"contacto_nombre":"Nuevo","contacto_telefono":"+00 000 000 000","contacto_email":"prueba@example.org"}';
begin
  ficha := public.contacto_ficha_restaurante(991081);
  version := ficha->>'version';
  if ficha->'contacto' is distinct from '{"contacto_nombre":"Inicial","contacto_telefono":"","contacto_email":""}'::jsonb then
    raise exception 'La ficha no devolvió solo el contacto';
  end if;
  begin
    perform public.contacto_ficha_restaurante(991082);
    raise exception 'Se leyó el contacto ajeno';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.contacto_ficha_restaurante(991082,version,contacto);
    raise exception 'Se guardó en otro restaurante';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.contacto_ficha_restaurante(991081,version,contacto||'{"voz":"otra"}');
    raise exception 'Se pudo editar un campo interno';
  exception when invalid_parameter_value then null;
  end;
  ficha := public.contacto_ficha_restaurante(991081,version,contacto);
  if ficha->'contacto' is distinct from contacto then raise exception 'No se actualizó el contacto'; end if;
  begin
    perform public.contacto_ficha_restaurante(991081,version,contacto);
    raise exception 'Un cambio obsoleto pudo guardarse';
  exception when serialization_failure then null;
  end;
end $$;
reset role;
do $$ begin
  if not exists(select 1 from contactia_privado.configuracion_interna_restaurantes where restaurante_id=991081
      and datos @> '{"contacto_nombre":"Nuevo","voz":"voz interna","cuota_mensual":"42"}') then
    raise exception 'La edición del propietario alteró la configuración interna';
  end if;
  if (select count(*) from contactia_privado.historial_interno_restaurantes where restaurante_id=991081) <> 1 then
    raise exception 'Falta una única entrada de historial';
  end if;
end $$;
rollback;
