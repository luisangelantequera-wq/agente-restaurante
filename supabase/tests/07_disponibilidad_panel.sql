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

insert into public.mesas(id,restaurante_id,zona_id,nombre,capacidad) values('20000000-0000-0000-0000-000000000043',900041,'10000000-0000-0000-0000-000000000041','2',4);
insert into public.combinaciones_mesas(id,restaurante_id,zona_id,nombre,min_personas,max_personas) values('30000000-0000-0000-0000-000000000041',900041,'10000000-0000-0000-0000-000000000041','1+2',5,8);
insert into public.combinacion_mesas(restaurante_id,combinacion_id,mesa_id) values
 (900041,'30000000-0000-0000-0000-000000000041','20000000-0000-0000-0000-000000000041'),
 (900041,'30000000-0000-0000-0000-000000000041','20000000-0000-0000-0000-000000000043');
select public.crear_reserva(900041,gen_random_uuid(),array['20000000-0000-0000-0000-000000000041'::uuid,'20000000-0000-0000-0000-000000000043'::uuid],now()+interval '9 days',6,'Combinación');
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000041',true);
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000041","role":"authenticated"}',true);
do $$
declare z uuid:='10000000-0000-0000-0000-000000000041';m uuid:='20000000-0000-0000-0000-000000000041';resultado jsonb;
begin
 begin
  perform public.disponibilidad_panel(900042,'zona','10000000-0000-0000-0000-000000000042','inactivo',0,false);raise exception 'Luna accesible';
 exception when insufficient_privilege then null; end;
 begin
  perform public.disponibilidad_panel(900041,'zona','10000000-0000-0000-0000-000000000042','inactivo',0,false);raise exception 'ID de Luna accesible';
 exception when no_data_found then null; end;
 begin
  update public.zonas set estado='inactivo' where id=z;raise exception 'Escritura directa permitida';
 exception when insufficient_privilege then null; end;
 resultado:=public.disponibilidad_panel(900041,'zona',z,'inactivo',0,false);
 if resultado->>'afectadas'<>'3' or resultado->>'aplicado'<>'false' then raise exception 'Previsualización o recuento de combinaciones incorrecto'; end if;
 if (select estado from public.zonas where id=z)<>'activo' then raise exception 'Previsualización alteró zona'; end if;
 begin
  perform public.disponibilidad_panel(900041,'zona',z,'inactivo',0,true,0);raise exception 'Aviso obsoleto aceptado';
 exception when serialization_failure then null; end;
 perform public.disponibilidad_panel(900041,'zona',z,'inactivo',0,true,3);
 if not exists(select 1 from public.zonas where id=z and estado='inactivo' and estado_version=1 and estado_modificado_por=auth.uid() and estado_modificado_en is not null) then raise exception 'Cierre o auditoría fallidos'; end if;
 if (select count(*) from public.reservas where restaurante_id=900041 and estado='confirmada')<>3 then raise exception 'Cierre canceló reservas'; end if;
 if (select count(*) from public.reserva_mesas where restaurante_id=900041 and activa)<>5 then raise exception 'Cierre liberó ocupación'; end if;
 begin
  perform public.disponibilidad_panel(900041,'zona',z,'activo',0,true,0);raise exception 'Versión obsoleta aceptada';
 exception when serialization_failure then null; end;
 resultado:=public.disponibilidad_panel(900041,'mesa',m,'fuera de servicio',0,false);
 if resultado->>'afectadas'<>'3' then raise exception 'Impacto de mesa incorrecto'; end if;
 perform public.disponibilidad_panel(900041,'mesa',m,'fuera de servicio',0,true,3);
 perform public.disponibilidad_panel(900041,'zona',z,'activo',1,true,0);
 if (select estado from public.mesas where id=m)<>'fuera de servicio' then raise exception 'Reabrir zona activó mesa'; end if;
end $$;
set local role service_role;
do $$ begin
 begin
  perform public.crear_reserva(900041,gen_random_uuid(),array['20000000-0000-0000-0000-000000000041'::uuid],now()+interval '10 days',2,'Bloqueada');raise exception 'Mesa desactivada admitió reservas';
 exception when invalid_parameter_value then null; end;
end $$;
set local role authenticated;
select public.disponibilidad_panel(900041,'mesa','20000000-0000-0000-0000-000000000041','libre',1,true,0);
select public.disponibilidad_panel(900041,'zona','10000000-0000-0000-0000-000000000041','inactivo',2,true,3);
set local role service_role;
do $$ begin
 begin
  perform public.crear_reserva(900041,gen_random_uuid(),array['20000000-0000-0000-0000-000000000041'::uuid],now()+interval '10 days',2,'Zona cerrada');raise exception 'Zona cerrada admitió reserva';
 exception when invalid_parameter_value then null; end;
end $$;
set local role authenticated;
select public.disponibilidad_panel(900041,'zona','10000000-0000-0000-0000-000000000041','activo',3,true,0);
set local role service_role;
select public.crear_reserva(900041,gen_random_uuid(),array['20000000-0000-0000-0000-000000000041'::uuid],now()+interval '10 days',2,'Reabierta');
reset role;
update public.restaurante_usuarios set activo=true where usuario_id='00000000-0000-0000-0000-000000000042';
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000042',true);
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000042","role":"authenticated","user_metadata":{"rol":"propietario"}}',true);
do $$ begin
 begin
  perform public.disponibilidad_panel(900041,'zona','10000000-0000-0000-0000-000000000041','inactivo',4,false);raise exception 'Empleado o metadata permitidos';
 exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub','',true);
select set_config('request.jwt.claims','{}',true);
do $$ begin
 begin
  perform public.disponibilidad_panel(900041,'mesa','20000000-0000-0000-0000-000000000041','libre',2,false);raise exception 'Sin sesión permitido';
 exception when insufficient_privilege then null; end;
end $$;
set local role anon;
do $$ begin
 begin
  perform public.disponibilidad_panel(900041,'zona','10000000-0000-0000-0000-000000000041','inactivo',4,false);raise exception 'Anon permitido';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
set constraints all immediate;
rollback;
