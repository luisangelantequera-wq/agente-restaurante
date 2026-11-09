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

update public.restaurantes set reservas_web_activas=true where id=900041;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000041',true);
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000041","role":"authenticated"}',true);
do $$
declare cerrado jsonb; abierto jsonb; especial jsonb; resultado jsonb; malos jsonb; fecha text;
begin
 select jsonb_object_agg(d,'[]'::jsonb),jsonb_object_agg(d,'["13:00-16:00","20:00-23:00"]'::jsonb)
 into cerrado,abierto from unnest(array['lunes','martes','miércoles','jueves','viernes','sábado','domingo']) d;
 begin
  perform public.guardar_horarios_panel(900042,0,cerrado,'[]',30,15);raise exception 'Edición de Luna permitida';
 exception when insufficient_privilege then null; end;
 begin
  update public.restaurantes set horario_reservas=cerrado where id=900041;raise exception 'Escritura directa permitida';
 exception when insufficient_privilege then null; end;
 resultado:=public.guardar_horarios_panel(900041,0,cerrado,'[{"fecha":"12-25","rangos":[]}]',30,15);
 if resultado->>'version'<>'1' or (resultado->>'reservas_a_revisar')::integer<>2 then raise exception 'Aviso de reservas incorrecto'; end if;
 if (select count(*) from public.reservas where restaurante_id=900041 and estado='confirmada')<>2 then raise exception 'Se cancelaron reservas al cerrar'; end if;
 if not exists(select 1 from public.restaurantes where id=900041 and horarios_version=1 and horarios_modificado_por=auth.uid() and horarios_modificado_en is not null and dias_cierre ? 'lunes') then raise exception 'Datos o auditoría incorrectos'; end if;
 begin
  perform public.guardar_horarios_panel(900041,0,abierto,'[]',30,15);raise exception 'Versión antigua aceptada';
 exception when serialization_failure then null; end;
 for malos in select valor from (values
  ('["16:00-13:00"]'::jsonb),('["13:00-16:00","15:00-17:00"]'::jsonb),('["24:00-25:00"]'::jsonb),('[1]'::jsonb),('null'::jsonb)
 ) v(valor) loop
  begin
   perform public.guardar_horarios_panel(900041,1,abierto||jsonb_build_object('lunes',malos),'[]',30,15);raise exception 'Franja inválida permitida';
  exception when invalid_parameter_value then null; end;
 end loop;
 for malos in select valor from (values
  ('[{"fecha":"2027-02-30","rangos":[]}]'::jsonb),('[{"fecha":"12-25","rangos":[]},{"fecha":"12-25","rangos":[]}]'::jsonb),('[{"fecha":"12-25","rangos":[],"usuario":"otro"}]'::jsonb)
 ) v(valor) loop
  begin
   perform public.guardar_horarios_panel(900041,1,abierto,malos,30,15);raise exception 'Fecha inválida permitida';
  exception when invalid_parameter_value then null; end;
 end loop;
 begin
  perform public.guardar_horarios_panel(900041,1,abierto,'[]',-1,0);raise exception 'Reglas inválidas permitidas';
 exception when invalid_parameter_value then null; end;
 if (select horarios_version from public.restaurantes where id=900041)<>1 then raise exception 'Cambio inválido dejó datos parciales'; end if;
 fecha:=((now() at time zone 'Europe/Madrid')::date+10)::text;
 especial:=jsonb_build_array(jsonb_build_object('fecha',fecha,'rangos',jsonb_build_array('13:30-16:00')),jsonb_build_object('fecha','12-25','rangos','[]'::jsonb));
 resultado:=public.guardar_horarios_panel(900041,1,abierto,especial,60,30);
 if resultado->>'version'<>'2' then raise exception 'Guardado válido fallido'; end if;
 if not exists(select 1 from public.restaurantes where id=900041 and dias_cierre='[]' and cierres_especiales='[]' and antelacion_minima_reserva_minutos=60 and intervalo_minutos=30) then raise exception 'Reglas no guardadas'; end if;
end $$;
reset role;
-- Una pertenencia activa de empleado permite leer, pero no editar ajustes.
update public.restaurante_usuarios set activo=true where usuario_id='00000000-0000-0000-0000-000000000042';
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000042',true);
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000042","role":"authenticated","user_metadata":{"rol":"propietario"}}',true);
do $$ begin
 begin
  perform public.guardar_horarios_panel(900041,2,'{}','[]',30,15);raise exception 'Empleado o metadatos dieron permisos';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
update public.restaurante_usuarios set rol='encargado' where usuario_id='00000000-0000-0000-0000-000000000042';
set local role authenticated;
do $$ declare r public.restaurantes; resultado jsonb; begin
 select * into r from public.restaurantes where id=900041;
 resultado:=public.guardar_horarios_panel(r.id,r.horarios_version,r.horario_reservas-'_contactia',r.horario_reservas->'_contactia'->'especiales',60,30);
 if resultado->>'version'<>'3' then raise exception 'Encargado rechazado'; end if;
end $$;
reset role;
update public.restaurante_usuarios set activo=false where usuario_id='00000000-0000-0000-0000-000000000042';
set local role authenticated;
do $$ begin
 begin
  perform public.guardar_horarios_panel(900041,3,'{}','[]',30,15);raise exception 'Encargado inactivo permitido';
 exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub','',true);
select set_config('request.jwt.claims','{}',true);
do $$ begin
 begin
  perform public.guardar_horarios_panel(900041,3,'{}','[]',30,15);raise exception 'Sin sesión permitido';
 exception when insufficient_privilege then null; end;
end $$;
set local role anon;
do $$ begin
 begin
  perform public.guardar_horarios_panel(900041,3,'{}','[]',30,15);raise exception 'Anon permitido';
 exception when insufficient_privilege then null; end;
end $$;
set local role service_role;
do $$ declare fecha date:=(now() at time zone 'Europe/Madrid')::date+10; rid uuid; begin
 begin
  perform public.reservar_web('sol-cancelacion-test',gen_random_uuid(),'10000000-0000-0000-0000-000000000041',fecha,'13:00',2,'Fuera de horario','prueba@example.invalid','600000000','');
  raise exception 'Horario nuevo no aplicado';
 exception when raise_exception then if sqlerrm<>'FUERA_HORARIO' then raise; end if; end;
 begin
  perform public.reservar_web('sol-cancelacion-test',gen_random_uuid(),'10000000-0000-0000-0000-000000000041',fecha,'13:45',2,'Intervalo','prueba@example.invalid','600000000','');
  raise exception 'Intervalo nuevo no aplicado';
 exception when raise_exception then if sqlerrm<>'FUERA_HORARIO' then raise; end if; end;
 rid:=public.reservar_web('sol-cancelacion-test',gen_random_uuid(),'10000000-0000-0000-0000-000000000041',fecha,'13:30',2,'Horario actualizado','prueba@example.invalid','600000000','');
 if rid is null then raise exception 'Horario especial válido rechazado'; end if;
end $$;
reset role;
set constraints all immediate;
rollback;
