begin;
do $$
declare r bigint; z uuid; otra uuid; m1 uuid; m2 uuid; c uuid;
begin
 insert into public.restaurantes(slug,nombre,reservas_web_activas,duracion_reserva_minutos,intervalo_minutos,horario_reservas)
 values('test-chat-sql','Chat ficticio',true,90,30,'{"lunes":["13:00-16:00"],"martes":["13:00-16:00"],"miércoles":["13:00-16:00"],"jueves":["13:00-16:00"],"viernes":["13:00-16:00"],"sábado":["13:00-16:00"],"domingo":["13:00-16:00"]}') returning id into r;
 insert into public.zonas(restaurante_id,nombre) values(r,'Interior') returning id into z;
 insert into public.restaurantes(slug,nombre,duracion_reserva_minutos) values('test-chat-otro','Otro',90) returning id into r;
 insert into public.zonas(restaurante_id,nombre) values(r,'Ajena') returning id into otra;
 select id into r from public.restaurantes where slug='test-chat-sql';
 insert into public.mesas(restaurante_id,zona_id,nombre,capacidad) values(r,z,'Una',2) returning id into m1;
 insert into public.mesas(restaurante_id,zona_id,nombre,capacidad) values(r,z,'Dos',4) returning id into m2;
 insert into public.combinaciones_mesas(restaurante_id,zona_id,nombre,min_personas,max_personas) values(r,z,'Grupo',5,6) returning id into c;
 insert into public.combinacion_mesas(restaurante_id,combinacion_id,mesa_id) values(r,c,m1),(r,c,m2);
end $$;
set local role service_role;
do $$
declare r bigint; z uuid; ajena uuid; d date:=(clock_timestamp() at time zone 'Europe/Madrid')::date+7; v jsonb; n bigint; rid uuid; msg text;
begin
 select id into r from public.restaurantes where slug='test-chat-sql';select id into z from public.zonas where restaurante_id=r;
 select id into ajena from public.zonas where nombre='Ajena';
 select count(*) into n from public.reservas;
 v:=public.consultar_disponibilidad_web('test-chat-sql',d);
 if v<>jsonb_build_object('fecha_admitida',true,'horario',jsonb_build_array('13:00-16:00')) then raise exception 'Calendario incorrecto';end if;
 v:=public.consultar_disponibilidad_web('test-chat-sql',d,'14:00',z,6);
 if v<>'{"disponible":true}'::jsonb then raise exception 'No ofrece combinación';end if;
 if (select count(*) from public.reservas)<>n then raise exception 'Consulta escribió una reserva';end if;
 rid:=public.reservar_web('test-chat-sql',gen_random_uuid(),z,d,'14:00',6,'Ficticio','cliente@example.invalid','600000000');
 if public.consultar_disponibilidad_web('test-chat-sql',d,'14:30',z,2)<>'{"disponible":false}'::jsonb then raise exception 'No respeta ocupación combinada';end if;
 if public.consultar_disponibilidad_web('test-chat-sql',d,'15:30',z,6)<>'{"disponible":true}'::jsonb then raise exception 'No permite periodo adyacente';end if;
 perform public.cancelar_reserva(r,rid);
 if public.consultar_disponibilidad_web('test-chat-sql',d,'14:00',z,6)<>'{"disponible":true}'::jsonb then raise exception 'Cancelación no libera disponibilidad';end if;
 update public.mesas set estado='fuera de servicio' where restaurante_id=r;
 if public.consultar_disponibilidad_web('test-chat-sql',d,'14:00',z,2)<>'{"disponible":false}'::jsonb then raise exception 'Ofrece mesa fuera de servicio';end if;
 update public.restaurantes set cierres_especiales=jsonb_build_array(d::text) where id=r;
 if public.consultar_disponibilidad_web('test-chat-sql',d)->'fecha_admitida'<>'false'::jsonb then raise exception 'Ignora cierre concreto';end if;
 update public.restaurantes set horario_reservas=jsonb_set(horario_reservas,'{_contactia}',jsonb_build_object('especiales',jsonb_build_array(jsonb_build_object('fecha',d::text,'rangos',jsonb_build_array('14:00-15:00'))))) where id=r;
 if public.consultar_disponibilidad_web('test-chat-sql',d)->'horario'<>'["14:00-15:00"]'::jsonb then raise exception 'Fecha exacta no prevalece';end if;
 begin
  perform public.consultar_disponibilidad_web('test-chat-sql',d,'14:00',ajena,2);raise exception 'Aceptó zona ajena';
 exception when raise_exception then get stacked diagnostics msg=message_text;if msg<>'ZONA_NO_DISPONIBLE' then raise;end if;end;
 begin
  perform public.consultar_disponibilidad_web('test-chat-sql',d,'14:15',z,2);raise exception 'Aceptó intervalo incorrecto';
 exception when raise_exception then get stacked diagnostics msg=message_text;if msg<>'FUERA_HORARIO' then raise;end if;end;
 begin
  perform public.consultar_disponibilidad_web('test-chat-sql',d+366);raise exception 'Aceptó fecha lejana';
 exception when invalid_parameter_value then null;end;
end $$;
reset role;
set local role anon;
do $$ begin
 begin perform public.consultar_disponibilidad_web('test-chat-sql',current_date+7);raise exception 'Anon consulta RPC privada';exception when insufficient_privilege then null;end;
end $$;
reset role;
set local role authenticated;
do $$ begin
 begin perform public.consultar_disponibilidad_web('test-chat-sql',current_date+7);raise exception 'Authenticated consulta RPC privada';exception when insufficient_privilege then null;end;
end $$;
reset role;
rollback;
