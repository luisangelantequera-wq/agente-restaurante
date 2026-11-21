begin;
insert into auth.users(id) values('c0000000-0000-4000-8000-000000000001'),('c0000000-0000-4000-8000-000000000002');
insert into public.restaurantes(slug,nombre,duracion_reserva_minutos) values('test-datos','Prueba',90),('test-datos-ajeno','Otro',90);
insert into public.restaurante_usuarios(restaurante_id,usuario_id,rol,activo)
 select id,'c0000000-0000-4000-8000-000000000001','propietario',true from public.restaurantes where slug='test-datos';
insert into public.restaurante_usuarios(restaurante_id,usuario_id,rol,activo)
 select id,'c0000000-0000-4000-8000-000000000002','empleado',true from public.restaurantes where slug='test-datos';
set local role authenticated;
select set_config('request.jwt.claim.sub','c0000000-0000-4000-8000-000000000001',true);
do $$
declare a bigint;v jsonb;d jsonb:='{"nombre":"Sol de prueba","telefono_publico":"910000000","direccion":"Calle ficticia 1","web":"https://ejemplo.invalid","informacion":{"mascotas":"Admitimos perros en terraza.","gastronomia":"Miércoles cocido.\nJueves paella mínimo 2 personas."}}';
begin
 select id into a from public.restaurantes where slug='test-datos';
 v:=public.guardar_datos_restaurante_panel(a,0,d);
 if v->>'version'<>'1' or v->>'cambiado'<>'true' then raise exception 'Guardado';end if;
 if (select nombre from public.restaurantes where id=a)<>'Sol de prueba' or (select duracion_reserva_minutos from public.restaurantes where id=a)<>90 then raise exception 'Modifica campos ajenos';end if;
 v:=public.guardar_datos_restaurante_panel(a,1,d);
 if v->>'version'<>'1' or v->>'cambiado'<>'false' then raise exception 'Escritura innecesaria';end if;
 begin perform public.guardar_datos_restaurante_panel(a,0,d);raise exception 'Version antigua';exception when serialization_failure then null;end;
 begin perform public.guardar_datos_restaurante_panel(a,1,d||'{"nombre":""}');raise exception 'Nombre vacío';exception when invalid_parameter_value then null;end;
 begin perform public.guardar_datos_restaurante_panel(a,1,d||'{"duracion_reserva_minutos":1}');raise exception 'Campos no permitidos';exception when invalid_parameter_value then null;end;
 begin perform public.guardar_datos_restaurante_panel(a,1,d||'{"web":"javascript:alert(1)"}');raise exception 'Web insegura';exception when invalid_parameter_value then null;end;
 begin perform public.guardar_datos_restaurante_panel(a,1,d||'{"web":"https://usuario:clave@ejemplo.invalid"}');raise exception 'Credenciales en web';exception when invalid_parameter_value then null;end;
 begin perform public.guardar_datos_restaurante_panel(a,1,d||'{"informacion":{"clave_privada":"x"}}');raise exception 'Tema desconocido';exception when invalid_parameter_value then null;end;
 begin perform public.guardar_datos_restaurante_panel(a,1,d||'{"informacion":{"mascotas":true}}');raise exception 'Valor no textual';exception when invalid_parameter_value then null;end;
 begin perform public.guardar_datos_restaurante_panel(a,1,d||jsonb_build_object('informacion',jsonb_build_object('mascotas',repeat('x',1001))));raise exception 'Texto largo';exception when invalid_parameter_value then null;end;
 begin update public.restaurantes set nombre='Directo' where id=a;raise exception 'Escritura directa';exception when insufficient_privilege then null;end;
end $$;
select set_config('request.jwt.claim.sub','c0000000-0000-4000-8000-000000000002',true);
do $$declare a bigint;begin
 select id into a from public.restaurantes where slug='test-datos';
 begin perform public.guardar_datos_restaurante_panel(a,1,'{}');raise exception 'Empleado escribe';exception when insufficient_privilege then null;end;
 begin perform public.guardar_datos_restaurante_panel(-1,1,'{}');raise exception 'Otro restaurante';exception when insufficient_privilege then null;end;
end $$;
reset role;
update public.restaurante_usuarios set activo=false where usuario_id='c0000000-0000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.sub','c0000000-0000-4000-8000-000000000001',true);
do $$begin
 begin perform public.guardar_datos_restaurante_panel(-1,1,'{}');raise exception 'Inactivo escribe';exception when insufficient_privilege then null;end;
end $$;
reset role;
do $$begin
 if has_function_privilege('anon','public.guardar_datos_restaurante_panel(bigint,integer,jsonb)','execute') or
 has_function_privilege('service_role','public.guardar_datos_restaurante_panel(bigint,integer,jsonb)','execute') then raise exception 'Permisos de escritura inesperados';end if;
end $$;
rollback;
