begin;
do $$
declare r bigint; z uuid; m1 uuid; m2 uuid; c uuid;
begin
 insert into public.restaurantes(slug,nombre,duracion_reserva_minutos,intervalo_minutos)
 values('test-web-sql','Web ficticio',90,30) returning id into r;
 insert into public.zonas(restaurante_id,nombre) values(r,'Interior') returning id into z;
 insert into public.mesas(restaurante_id,zona_id,nombre,capacidad) values(r,z,'Pequeña',2) returning id into m1;
 insert into public.mesas(restaurante_id,zona_id,nombre,capacidad) values(r,z,'Grande',4) returning id into m2;
 insert into public.combinaciones_mesas(restaurante_id,zona_id,nombre,min_personas,max_personas)
 values(r,z,'Pequeña+Grande',5,6) returning id into c;
 insert into public.combinacion_mesas(restaurante_id,combinacion_id,mesa_id) values(r,c,m1),(r,c,m2);
 update public.restaurantes set horario_reservas='{"lunes":["13:00-16:00"],"martes":["13:00-16:00"],"miércoles":["13:00-16:00"],"jueves":["13:00-16:00"],"viernes":["13:00-16:00"],"sábado":["13:00-16:00"],"domingo":["13:00-16:00"]}' where id=r;
end $$;
set local role service_role;
do $$
declare r bigint; z uuid; d date:=(clock_timestamp() at time zone 'Europe/Madrid')::date+7;
 rid uuid; rid2 uuid; pet uuid:=gen_random_uuid(); dia text; msg text;
begin
 select id into r from public.restaurantes where slug='test-web-sql';
 select id into z from public.zonas where restaurante_id=r;
 begin
   perform public.reservar_web('test-web-sql',pet,z,d,'14:00',2,'Cliente','cliente@example.invalid','600000000');
   raise exception 'Web desactivada aceptó reserva';
 exception when raise_exception then
   get stacked diagnostics msg=message_text;
   if msg<>'RESTAURANTE_NO_DISPONIBLE' then raise; end if;
 end;
 update public.restaurantes set reservas_web_activas=true where id=r;
 rid:=public.reservar_web('test-web-sql',pet,z,d,'14:00',2,'Cliente','cliente@example.invalid','600000000');
 if not exists(select 1 from public.reserva_mesas rm join public.mesas m on m.id=rm.mesa_id where rm.reserva_id=rid and m.capacidad=2) then
   raise exception 'No eligió la mesa individual más pequeña'; end if;
 if public.reservar_web('test-web-sql',pet,z,d,'14:00',2,'Cliente','cliente@example.invalid','600000000')<>rid then raise exception 'Idempotencia web'; end if;
 rid2:=public.reservar_web('test-web-sql',gen_random_uuid(),z,d,'14:00',2,'Otro','otro@example.invalid','600000000');
 if not exists(select 1 from public.reserva_mesas rm join public.mesas m on m.id=rm.mesa_id where rm.reserva_id=rid2 and m.capacidad=4) then
   raise exception 'No buscó otra mesa tras el conflicto'; end if;
 begin
   perform public.reservar_web('test-web-sql',gen_random_uuid(),z,d,'14:00',2,'Lleno','lleno@example.invalid','600000000');
   raise exception 'Aceptó reserva con todas las mesas ocupadas';
 exception when raise_exception then
   get stacked diagnostics msg=message_text;
   if msg<>'SIN_DISPONIBILIDAD' then raise; end if;
 end;
 rid2:=public.reservar_web('test-web-sql',gen_random_uuid(),z,d+1,'14:00',5,'Grupo','grupo@example.invalid','600000000');
 if (select count(*) from public.reserva_mesas where reserva_id=rid2)<>2 then raise exception 'No asignó combinación'; end if;
 for msg in select unnest(array['12:00','14:15','16:00']) loop
  begin
   perform public.reservar_web('test-web-sql',gen_random_uuid(),z,d,msg::time,2,'Horario','horario@example.invalid','600000000');
   raise exception 'Aceptó hora fuera de turno o intervalo';
  exception when raise_exception then
   get stacked diagnostics msg=message_text;
   if msg<>'FUERA_HORARIO' then raise; end if;
  end;
 end loop;
 -- Cierre concreto, excepción anual y fecha exacta que prevalece sobre la anual.
 update public.restaurantes set cierres_especiales=jsonb_build_array((d+2)::text) where id=r;
 begin
  perform public.reservar_web('test-web-sql',gen_random_uuid(),z,d+2,'14:00',2,'Cierre','cierre@example.invalid','600000000');
  raise exception 'Aceptó cierre concreto';
 exception when raise_exception then get stacked diagnostics msg=message_text;if msg<>'FUERA_HORARIO' then raise;end if;end;
 update public.restaurantes set cierres_especiales='[]',
 horario_reservas=jsonb_set(horario_reservas,'{_contactia}',jsonb_build_object('especiales',jsonb_build_array(
  jsonb_build_object('fecha',to_char(d+2,'MM-DD'),'rangos','[]'::jsonb)))) where id=r;
 begin
  perform public.reservar_web('test-web-sql',gen_random_uuid(),z,d+2,'14:00',2,'Anual','anual@example.invalid','600000000');
  raise exception 'Aceptó cierre anual';
 exception when raise_exception then get stacked diagnostics msg=message_text;if msg<>'FUERA_HORARIO' then raise;end if;end;
 update public.restaurantes set horario_reservas=jsonb_set(horario_reservas,'{_contactia,especiales}',
 (horario_reservas->'_contactia'->'especiales')||jsonb_build_array(jsonb_build_object('fecha',(d+2)::text,'rangos',jsonb_build_array('14:00-15:00')))) where id=r;
 perform public.reservar_web('test-web-sql',gen_random_uuid(),z,d+2,'14:00',2,'Exacta','exacta@example.invalid','600000000');
 dia:=(array['domingo','lunes','martes','miércoles','jueves','viernes','sábado'])[extract(dow from d+3)::integer+1];
 update public.restaurantes set dias_cierre=jsonb_build_array(dia) where id=r;
 begin
  perform public.reservar_web('test-web-sql',gen_random_uuid(),z,d+3,'14:00',2,'Semanal','semanal@example.invalid','600000000');
  raise exception 'Aceptó cierre semanal';
 exception when raise_exception then get stacked diagnostics msg=message_text;if msg<>'FUERA_HORARIO' then raise;end if;end;
 begin
  perform public.reservar_web('test-web-sql',gen_random_uuid(),z,date '2027-03-28','02:30',2,'Hora inexistente','hora@example.invalid','600000000');
  raise exception 'Aceptó hora inexistente';
 exception when invalid_parameter_value then null;end;
 begin
  perform public.reservar_web('test-web-sql',gen_random_uuid(),z,date '2026-10-25','02:30',2,'Hora ambigua','hora@example.invalid','600000000');
  raise exception 'Aceptó hora ambigua';
 exception when invalid_parameter_value then null;end;
 -- Las ventanas y contadores se calculan en PostgreSQL, compartidos entre instancias.
 for n in 1..5 loop
  if not public.consumir_limite_web(repeat('a',64),'reserva') then raise exception 'Límite antes de tiempo';end if;
 end loop;
 if public.consumir_limite_web(repeat('a',64),'reserva') then raise exception 'Límite de 5 reservas no aplicado';end if;
 if not public.consumir_limite_web(repeat('a',64),'lectura') then raise exception 'Cuotas no separadas';end if;
end $$;
reset role;
set local role anon;
do $$ begin
 begin
  perform public.consumir_limite_web(repeat('b',64),'reserva');raise exception 'Anon puede consumir cuota interna';
 exception when insufficient_privilege then null;end;
 begin
  perform 1 from contactia_privado.limites_web;raise exception 'Anon lee límites';
 exception when insufficient_privilege then null;end;
end $$;
reset role;
rollback;
