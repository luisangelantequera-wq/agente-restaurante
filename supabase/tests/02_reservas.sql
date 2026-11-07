-- Ficticio y reversible. Ejecutar solo en desarrollo.
begin;
insert into auth.users(id) values('00000000-0000-0000-0000-000000000011');
insert into public.restaurantes(id,slug,nombre,duracion_reserva_minutos) values
 (900011,'sol-test-reservas','Sol test',90),(900012,'luna-test-reservas','Luna test',90);
insert into public.restaurante_usuarios(restaurante_id,usuario_id,rol) values
 (900011,'00000000-0000-0000-0000-000000000011','propietario');
insert into public.zonas(id,restaurante_id,nombre) values
 ('10000000-0000-0000-0000-000000000011',900011,'Interior'),
 ('10000000-0000-0000-0000-000000000012',900012,'Interior'),
 ('10000000-0000-0000-0000-000000000013',900011,'Terraza');
insert into public.mesas(id,restaurante_id,zona_id,nombre,capacidad) values
 ('20000000-0000-0000-0000-000000000011',900011,'10000000-0000-0000-0000-000000000011','Mesa 1',4),
 ('20000000-0000-0000-0000-000000000012',900011,'10000000-0000-0000-0000-000000000011','Mesa 2',4),
 ('20000000-0000-0000-0000-000000000013',900011,'10000000-0000-0000-0000-000000000011','Mesa 3',4),
 ('20000000-0000-0000-0000-000000000014',900012,'10000000-0000-0000-0000-000000000012','Mesa Luna',4),
 ('20000000-0000-0000-0000-000000000015',900011,'10000000-0000-0000-0000-000000000013','Mesa Terraza',4);
insert into public.combinaciones_mesas(id,restaurante_id,zona_id,nombre,min_personas,max_personas) values
 ('30000000-0000-0000-0000-000000000011',900011,'10000000-0000-0000-0000-000000000011','1+2',5,8),
 ('30000000-0000-0000-0000-000000000012',900011,'10000000-0000-0000-0000-000000000011','1+3',5,8);
insert into public.combinacion_mesas(restaurante_id,combinacion_id,mesa_id) values
 (900011,'30000000-0000-0000-0000-000000000011','20000000-0000-0000-0000-000000000011'),
 (900011,'30000000-0000-0000-0000-000000000011','20000000-0000-0000-0000-000000000012'),
 (900011,'30000000-0000-0000-0000-000000000012','20000000-0000-0000-0000-000000000011'),
 (900011,'30000000-0000-0000-0000-000000000012','20000000-0000-0000-0000-000000000013');
set local role service_role;
do $$
declare t timestamptz:=date_trunc('day',now())+interval '7 days 12 hours';
 m1 uuid:='20000000-0000-0000-0000-000000000011'; m2 uuid:='20000000-0000-0000-0000-000000000012';
 m3 uuid:='20000000-0000-0000-0000-000000000013'; rid uuid; adyacente uuid; pet uuid:=gen_random_uuid(); antes integer;
begin
 rid:=public.crear_reserva(900011,pet,array[m1],t,2,'Cliente ficticio');
 if public.crear_reserva(900011,pet,array[m1],t,2,'Cliente ficticio')<>rid then raise exception 'Fallo idempotencia'; end if;
 begin
   perform public.crear_reserva(900011,pet,array[m1],t,3,'Cliente ficticio');
   raise exception 'Se aceptó petición repetida con otros datos';
 exception when invalid_parameter_value then null; end;
 begin
   perform public.crear_reserva(900011,gen_random_uuid(),array[m1],t+interval '30 minutes',2,'Solape');
   raise exception 'Se permitió solapamiento parcial';
 exception when exclusion_violation then null; end;
 adyacente:=public.crear_reserva(900011,gen_random_uuid(),array[m1],t+interval '90 minutes',2,'Adyacente');
 perform public.crear_reserva(900011,gen_random_uuid(),array[m1],t+interval '3 days 11 hours 30 minutes',2,'Cruce de medianoche');
 begin
   perform public.crear_reserva(900011,gen_random_uuid(),array[m1],t+interval '3 days 12 hours',2,'Solape al día siguiente');
   raise exception 'Solape al cruzar medianoche aceptado';
 exception when exclusion_violation then null; end;
 perform public.cancelar_reserva(900011,rid);
 rid:=public.crear_reserva(900011,gen_random_uuid(),array[m1],t,2,'Mesa liberada');
 begin
   perform public.reprogramar_reserva(900011,rid,t+interval '60 minutes');
   raise exception 'Modificación solapada aceptada';
 exception when exclusion_violation then null; end;
 if (select inicio from public.reservas where id=rid)<>t then raise exception 'Modificación fallida alteró reserva'; end if;
 if (select lower(periodo) from public.reserva_mesas where reserva_id=rid)<>t then raise exception 'Modificación fallida alteró ocupación'; end if;
 perform public.reprogramar_reserva(900011,rid,t-interval '2 hours');
 if (select lower(periodo) from public.reserva_mesas where reserva_id=rid)<>t-interval '2 hours' then raise exception 'Ocupación no se actualizó'; end if;
 -- Duración histórica: cambiar la configuración no cambia reservas existentes.
 update public.restaurantes set duracion_reserva_minutos=120 where id=900011;
 if (select fin-inicio from public.reservas where id=rid)<>interval '90 minutes' then raise exception 'Duración histórica alterada'; end if;
 update public.restaurantes set duracion_reserva_minutos=90 where id=900011;
 rid:=public.crear_reserva(900011,gen_random_uuid(),array[m2,m1],t+interval '1 day',6,'Combinación');
 if (select count(*) from public.reserva_mesas where reserva_id=rid and activa)<>2 then raise exception 'Combinación incompleta'; end if;
 begin
   perform public.crear_reserva(900011,gen_random_uuid(),array[m2],t+interval '1 day',2,'Individual sobre combinación');
   raise exception 'Se pudo usar parte de combinación ocupada';
 exception when exclusion_violation then null; end;
 select count(*) into antes from public.reservas;
 begin
   perform public.crear_reserva(900011,gen_random_uuid(),array[m3,m1],t+interval '1 day',6,'Combinación parcial fallida');
   raise exception 'Se permitió combinación parcialmente ocupada';
 exception when exclusion_violation then null; end;
 if (select count(*) from public.reservas)<>antes or exists(select 1 from public.reserva_mesas where mesa_id=m3) then
   raise exception 'Quedó una reserva o bloqueo parcial'; end if;
 perform public.cancelar_reserva(900011,rid);
 perform public.crear_reserva(900011,gen_random_uuid(),array[m2],t+interval '1 day',2,'Combinación cancelada');
 begin
   perform public.crear_reserva(900011,gen_random_uuid(),array[m2,m3],t+interval '2 days',6,'Combinación sin autorizar');
   raise exception 'Se combinaron mesas sin configuración';
 exception when invalid_parameter_value then null; end;
 begin
   perform public.crear_reserva(900011,gen_random_uuid(),array[m1,m1],t,6,'Duplicada');
   raise exception 'Mesas repetidas aceptadas';
 exception when invalid_parameter_value then null; end;
 begin
   perform public.crear_reserva(900011,gen_random_uuid(),array[m1],now(),2,'Pasada');
   raise exception 'Antelación no respetada';
 exception when invalid_parameter_value then null; end;
 begin
   perform public.crear_reserva(900011,gen_random_uuid(),array[m1],t,5,'Exceso capacidad');
   raise exception 'Capacidad no respetada';
 exception when invalid_parameter_value then null; end;
 begin
   perform public.crear_reserva(900011,gen_random_uuid(),array['20000000-0000-0000-0000-000000000014'::uuid],t,2,'Mesa ajena');
   raise exception 'Mesa ajena aceptada';
 exception when invalid_parameter_value then null; end;
 begin
   perform public.crear_reserva(900011,gen_random_uuid(),array[m1,'20000000-0000-0000-0000-000000000015'::uuid],t,6,'Zonas mezcladas');
   raise exception 'Se mezclaron zonas';
 exception when invalid_parameter_value then null; end;
 update public.zonas set estado='inactivo' where id='10000000-0000-0000-0000-000000000011';
 begin
   perform public.crear_reserva(900011,gen_random_uuid(),array[m3],t,2,'Zona cerrada');
   raise exception 'Se reservó zona cerrada';
 exception when invalid_parameter_value then null; end;
 begin
   perform public.reprogramar_reserva(900011,adyacente,t+interval '10 days');
   raise exception 'Se reprogramó en zona cerrada';
 exception when invalid_parameter_value then null; end;
 update public.zonas set estado='activo' where id='10000000-0000-0000-0000-000000000011';
 update public.mesas set estado='fuera de servicio' where id=m3;
 begin
   perform public.crear_reserva(900011,gen_random_uuid(),array[m3],t,2,'Mesa cerrada');
   raise exception 'Se reservó mesa fuera de servicio';
 exception when invalid_parameter_value then null; end;
end $$;
select public.crear_reserva(900012,gen_random_uuid(),array['20000000-0000-0000-0000-000000000014'::uuid],date_trunc('day',now())+interval '7 days 12 hours',2,'Cliente Luna');
-- Disparar comprobaciones diferidas sobre todas las reservas válidas.
set constraints all immediate;
set constraints all deferred;
-- Un INSERT directo sin ocupación también debe fallar al confirmar.
do $$ begin
 begin
   insert into public.reservas(restaurante_id,zona_id,peticion_id,inicio,fin,personas,nombre)
   values(900011,'10000000-0000-0000-0000-000000000011',gen_random_uuid(),now()+interval '30 days',now()+interval '30 days 1 hour',2,'Huérfana');
   set constraints all immediate;
   raise exception 'Reserva activa sin mesas aceptada';
 exception when check_violation then null; end;
end $$;
set constraints all deferred;
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000011',true);
do $$ begin
 if not exists(select 1 from public.reservas where restaurante_id=900011) or
   exists(select 1 from public.reservas where restaurante_id<>900011) then raise exception 'RLS reservas'; end if;
 begin
   perform public.cancelar_reserva(900011,gen_random_uuid());
   raise exception 'Usuario pudo ejecutar escritura interna';
 exception when insufficient_privilege then null; end;
 begin
   update public.reservas set estado='cancelada';
   raise exception 'Usuario pudo escribir directamente';
 exception when insufficient_privilege then null; end;
 if exists(select 1 from public.reserva_mesas where restaurante_id<>900011) or
    exists(select 1 from public.combinaciones_mesas where restaurante_id<>900011) or
    exists(select 1 from public.combinacion_mesas where restaurante_id<>900011) then
   raise exception 'RLS ocupaciones o combinaciones'; end if;
end $$;
reset role;
rollback;
