-- Pruebas ficticias, incluidas escrituras, siempre revertidas.
begin;
insert into auth.users(id) values ('00000000-0000-0000-0000-000000000041'),('00000000-0000-0000-0000-000000000042');
insert into public.restaurantes(id,slug,nombre,duracion_reserva_minutos) values
 (900041,'sol-cancelacion-test','Sol cancelación',90),(900042,'luna-cancelacion-test','Luna cancelación',90);
insert into public.restaurante_usuarios(restaurante_id,usuario_id,rol,activo) values
 (900041,'00000000-0000-0000-0000-000000000041','propietario',true),
 (900041,'00000000-0000-0000-0000-000000000042','empleado',false);
insert into public.zonas(id,restaurante_id,nombre) values
 ('10000000-0000-0000-0000-000000000041',900041,'Interior'),('10000000-0000-0000-0000-000000000042',900042,'Interior');
insert into public.mesas(id,restaurante_id,zona_id,nombre,capacidad) values
 ('20000000-0000-0000-0000-000000000041',900041,'10000000-0000-0000-0000-000000000041','1',4),
 ('20000000-0000-0000-0000-000000000042',900042,'10000000-0000-0000-0000-000000000042','1',4);
insert into public.reservas(id,restaurante_id,zona_id,peticion_id,inicio,fin,personas,nombre,estado) values
 ('40000000-0000-4000-8000-000000000041',900041,'10000000-0000-0000-0000-000000000041',gen_random_uuid(),now()+interval '7 days',now()+interval '7 days 90 minutes',2,'Prueba Sol','confirmada'),
 ('40000000-0000-4000-8000-000000000042',900042,'10000000-0000-0000-0000-000000000042',gen_random_uuid(),now()+interval '7 days',now()+interval '7 days 90 minutes',2,'Prueba Luna','confirmada'),
 ('40000000-0000-4000-8000-000000000043',900041,'10000000-0000-0000-0000-000000000041',gen_random_uuid(),now()+interval '8 days',now()+interval '8 days 90 minutes',2,'Cobrada','cobrada'),
 ('40000000-0000-4000-8000-000000000044',900041,'10000000-0000-0000-0000-000000000041',gen_random_uuid(),now()-interval '2 days',now()-interval '2 days'+interval '90 minutes',2,'Pasada','confirmada');
insert into public.reserva_mesas(restaurante_id,reserva_id,mesa_id) values
 (900041,'40000000-0000-4000-8000-000000000041','20000000-0000-0000-0000-000000000041'),
 (900042,'40000000-0000-4000-8000-000000000042','20000000-0000-0000-0000-000000000042'),
 (900041,'40000000-0000-4000-8000-000000000043','20000000-0000-0000-0000-000000000041'),
 (900041,'40000000-0000-4000-8000-000000000044','20000000-0000-0000-0000-000000000041');
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000041',true);
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000041","role":"authenticated"}',true);
do $$ begin
 begin
  perform public.cancelar_reserva_panel(900042,'40000000-0000-4000-8000-000000000042');
  raise exception 'Cancelación cruzada permitida';
 exception when insufficient_privilege then null; end;
 begin
  perform public.cancelar_reserva_panel(900041,'40000000-0000-4000-8000-000000000042');
  raise exception 'Se aceptó reserva ajena con restaurante propio';
 exception when no_data_found then null; end;
 begin
  update public.reservas set estado='cancelada' where restaurante_id=900041;
  raise exception 'Escritura directa permitida';
 exception when insufficient_privilege then null; end;
 begin
  perform public.cancelar_reserva_panel(900041,'40000000-0000-4000-8000-000000000043');
  raise exception 'Se canceló reserva cobrada';
 exception when object_not_in_prerequisite_state then null; end;
 begin
  perform public.cancelar_reserva_panel(900041,'40000000-0000-4000-8000-000000000044');
  raise exception 'Se canceló reserva pasada';
 exception when object_not_in_prerequisite_state then null; end;
 if not public.cancelar_reserva_panel(900041,'40000000-0000-4000-8000-000000000041') then raise exception 'No cancelada'; end if;
 if not public.cancelar_reserva_panel(900041,'40000000-0000-4000-8000-000000000041') then raise exception 'Reintento no idempotente'; end if;
 if exists(select 1 from public.reserva_mesas where reserva_id='40000000-0000-4000-8000-000000000041' and activa) then raise exception 'Mesa no liberada'; end if;
 if not exists(select 1 from public.reservas where id='40000000-0000-4000-8000-000000000041' and estado='cancelada' and cancelado_por=auth.uid() and cancelado_en is not null) then raise exception 'Auditoría ausente'; end if;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000042',true);
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000042","role":"authenticated"}',true);
do $$ begin
 begin
  perform public.cancelar_reserva_panel(900041,'40000000-0000-4000-8000-000000000041');
  raise exception 'Pertenencia inactiva permitida';
 exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub','',true);
select set_config('request.jwt.claims','{}',true);
do $$ begin
 begin
  perform public.cancelar_reserva_panel(900041,'40000000-0000-4000-8000-000000000041');
  raise exception 'Sesión ausente permitida';
 exception when insufficient_privilege then null; end;
end $$;
set local role anon;
do $$ begin
 begin
  perform public.cancelar_reserva_panel(900041,'40000000-0000-4000-8000-000000000041');
  raise exception 'Anon permitido';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
do $$ begin
 if (select estado from public.reservas where id='40000000-0000-4000-8000-000000000042')<>'confirmada' then raise exception 'Luna alterada'; end if;
 perform public.crear_reserva(900041,gen_random_uuid(),array['20000000-0000-0000-0000-000000000041'::uuid],now()+interval '7 days',2,'Hueco reutilizado');
end $$;
set constraints all immediate;
rollback;
