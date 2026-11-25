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

update public.restaurantes set horario_reservas=jsonb_build_object(
 'lunes',jsonb_build_array('13:00-16:00','20:00-23:00'), 'martes',jsonb_build_array('13:00-16:00','20:00-23:00'),
 'miércoles',jsonb_build_array('13:00-16:00','20:00-23:00'), 'jueves',jsonb_build_array('13:00-16:00','20:00-23:00'),
 'viernes',jsonb_build_array('13:00-16:00','20:00-23:00'), 'sábado',jsonb_build_array('13:00-16:00','20:00-23:00'),
 'domingo',jsonb_build_array('13:00-16:00','20:00-23:00')),
 cierres_especiales=jsonb_build_array(((now() at time zone 'Europe/Madrid')::date+11)::text)
 where id=900041;
select public.crear_reserva(900041,gen_random_uuid(),array['20000000-0000-0000-0000-000000000041'::uuid],
 (((now() at time zone 'Europe/Madrid')::date+10)+time '14:00') at time zone 'Europe/Madrid',2,'Bloqueo de prueba');
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000041',true);
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000041","role":"authenticated"}',true);
do $$
declare rid uuid:='40000000-0000-4000-8000-000000000041'; anterior timestamptz; actual timestamptz;
 fecha date:=(now() at time zone 'Europe/Madrid')::date+10; antes public.reservas;
begin
 select * into antes from public.reservas where id=rid;
 anterior:=antes.inicio;
 begin
  perform public.reprogramar_reserva_panel(900042,'40000000-0000-4000-8000-000000000042',fecha,'20:00',anterior);
  raise exception 'Edición cruzada permitida';
 exception when insufficient_privilege then null; end;
 begin
  perform public.reprogramar_reserva_panel(900041,'40000000-0000-4000-8000-000000000042',fecha,'20:00',anterior);
  raise exception 'ID ajeno aceptado';
 exception when no_data_found then null; end;
 begin
  perform public.reprogramar_reserva_panel(900041,rid,fecha,'14:00',anterior);
  raise exception 'Solapamiento permitido';
 exception when exclusion_violation then null; end;
 if (select inicio from public.reservas where id=rid)<>anterior or
    (select lower(periodo) from public.reserva_mesas where reserva_id=rid)<>anterior or
    (select reprogramado_en from public.reservas where id=rid) is not null then raise exception 'Fallo dejó cambios parciales'; end if;
 begin
  perform public.reprogramar_reserva_panel(900041,rid,fecha,'17:00',anterior);
  raise exception 'Fuera de horario permitido';
 exception when raise_exception then if sqlerrm<>'FUERA_HORARIO' then raise; end if; end;
 begin
  perform public.reprogramar_reserva_panel(900041,rid,fecha+1,'13:00',anterior);
  raise exception 'Día cerrado permitido';
 exception when raise_exception then if sqlerrm<>'FUERA_HORARIO' then raise; end if; end;
 begin
  perform public.reprogramar_reserva_panel(900041,rid,fecha,'20:07',anterior);
  raise exception 'Intervalo inválido permitido';
 exception when raise_exception then if sqlerrm<>'FUERA_HORARIO' then raise; end if; end;
 begin
  perform public.reprogramar_reserva_panel(900041,rid,(now() at time zone 'Europe/Madrid')::date,'00:00',anterior);
  raise exception 'Hora pasada permitida';
 exception when invalid_parameter_value then null; end;
 if not public.reprogramar_reserva_panel(900041,rid,fecha,'20:00',anterior) then raise exception 'Cambio no realizado'; end if;
 actual:=(fecha+time '20:00') at time zone 'Europe/Madrid';
 if not public.reprogramar_reserva_panel(900041,rid,fecha,'20:00',anterior) then raise exception 'Reintento fallido'; end if;
 if not exists(select 1 from public.reservas where id=rid and inicio=actual and fin-inicio=antes.fin-antes.inicio
  and zona_id=antes.zona_id and personas=antes.personas and reprogramado_por=auth.uid() and reprogramado_en is not null) then raise exception 'Datos históricos o auditoría incorrectos'; end if;
 if not exists(select 1 from public.reserva_mesas where reserva_id=rid and mesa_id='20000000-0000-0000-0000-000000000041' and activa and lower(periodo)=actual) then raise exception 'Mesa u ocupación incorrecta'; end if;
 begin
  perform public.reprogramar_reserva_panel(900041,rid,fecha,'21:30',anterior);
  raise exception 'Edición obsoleta aceptada';
 exception when serialization_failure then null; end;
 if not public.reprogramar_reserva_panel(900041,rid,fecha,'21:30',actual) then raise exception 'Cambio posterior fallido'; end if;
 begin
  perform public.reprogramar_reserva_panel(900041,'40000000-0000-4000-8000-000000000043',fecha,'21:30',anterior);
  raise exception 'Cobrada modificada';
 exception when object_not_in_prerequisite_state then null; end;
 perform public.cancelar_reserva_panel(900041,rid);
 begin
  perform public.reprogramar_reserva_panel(900041,rid,fecha,'20:00',anterior);
  raise exception 'Se reactivó reserva cancelada';
 exception when object_not_in_prerequisite_state then null; end;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000042',true);
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000042","role":"authenticated"}',true);
do $$ begin
 begin
  perform public.reprogramar_reserva_panel(900041,'40000000-0000-4000-8000-000000000041',current_date+10,'20:00',now());
  raise exception 'Usuario inactivo permitido';
 exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub','',true);
select set_config('request.jwt.claims','{}',true);
do $$ begin
 begin
  perform public.reprogramar_reserva_panel(900041,'40000000-0000-4000-8000-000000000041',current_date+10,'20:00',now());
  raise exception 'Sin sesión permitido';
 exception when insufficient_privilege then null; end;
end $$;
set local role anon;
do $$ begin
 begin
  perform public.reprogramar_reserva_panel(900041,'40000000-0000-4000-8000-000000000041',current_date+10,'20:00',now());
  raise exception 'Anon permitido';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
set constraints all immediate;
rollback;
