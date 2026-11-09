begin;
insert into public.restaurantes(slug,nombre,duracion_reserva_minutos,reservas_web_activas,horario_reservas)
values('test-gestion-a','Gestión A',90,true,'{"lunes":["13:00-16:00"],"martes":["13:00-16:00"],"miércoles":["13:00-16:00"],"jueves":["13:00-16:00"],"viernes":["13:00-16:00"],"sábado":["13:00-16:00"],"domingo":["13:00-16:00"]}'),
('test-gestion-b','Gestión B',90,true,'{"lunes":["13:00-16:00"],"martes":["13:00-16:00"],"miércoles":["13:00-16:00"],"jueves":["13:00-16:00"],"viernes":["13:00-16:00"],"sábado":["13:00-16:00"],"domingo":["13:00-16:00"]}');
insert into public.zonas(restaurante_id,nombre) select id,'Interior' from public.restaurantes where slug in ('test-gestion-a','test-gestion-b');
insert into public.mesas(restaurante_id,zona_id,nombre,capacidad) select restaurante_id,id,'Una',4 from public.zonas where restaurante_id in(select id from public.restaurantes where slug in ('test-gestion-a','test-gestion-b'));
set local role service_role;
do $$
declare a bigint; z uuid; b bigint; zb uuid; d date:=(clock_timestamp() at time zone 'Europe/Madrid')::date+7;
 rid uuid; otra uuid; v jsonb; inicio timestamptz; cambiado timestamptz; op uuid:=gen_random_uuid(); cancelar uuid:=gen_random_uuid(); pet uuid:=gen_random_uuid(); msg text;
begin
 select id into a from public.restaurantes where slug='test-gestion-a';select id into z from public.zonas where restaurante_id=a;
 select id into b from public.restaurantes where slug='test-gestion-b';select id into zb from public.zonas where restaurante_id=b;
 rid:=public.reservar_web_con_gestion('test-gestion-a',pet,z,d,'14:00',2,'Cliente A','a@example.invalid','600000000','',repeat('a',64));
 if public.reservar_web_con_gestion('test-gestion-a',pet,z,d,'14:00',2,'Cliente A','a@example.invalid','600000000','',repeat('a',64))<>rid then raise exception 'Idempotencia de creación';end if;
 otra:=public.reservar_web_con_gestion('test-gestion-b',gen_random_uuid(),zb,d,'14:00',2,'Cliente B','b@example.invalid','600000000','',repeat('b',64));
 v:=public.gestionar_reserva_web('test-gestion-a',repeat('a',64));inicio:=(v->>'inicio')::timestamptz;
 if v->>'nombre'<>'Cliente A' or v ? 'email' or v ? 'telefono' or v ? 'mesa_ids' then raise exception 'Proyección de datos incorrecta';end if;
 begin perform public.gestionar_reserva_web('test-gestion-a',repeat('b',64));raise exception 'Cruce de restaurantes';
 exception when no_data_found then null;end;
 begin perform public.gestionar_reserva_web('test-gestion-a',repeat('f',64));raise exception 'Token desconocido';
 exception when no_data_found then null;end;
 -- Conflicto conserva reserva inicial y no registra una operación confirmada.
 perform public.reservar_web('test-gestion-a',gen_random_uuid(),z,d+1,'14:00',2,'Ocupada','o@example.invalid','600000000','');
 begin perform public.gestionar_reserva_web('test-gestion-a',repeat('a',64),'reprogramar',op,d+1,'14:00',inicio);raise exception 'Solapamiento aceptado';
 exception when exclusion_violation then null;end;
 if exists(select 1 from contactia_privado.operaciones_gestion where id=op) or (select rr.inicio from public.reservas rr where rr.id=rid)<>inicio then raise exception 'Conflicto no atómico';end if;
 v:=public.gestionar_reserva_web('test-gestion-a',repeat('a',64),'reprogramar',op,d,'15:00',inicio);cambiado:=(v->>'inicio')::timestamptz;
 if v->>'hora'<>'15:00' or v->>'zona'<>'Interior' or (select rr.fin-rr.inicio from public.reservas rr where rr.id=rid)<>interval '90 minutes' then raise exception 'Cambio no conserva datos';end if;
 perform public.gestionar_reserva_web('test-gestion-a',repeat('a',64),'reprogramar',op,d,'15:00',inicio);
 if (select count(*) from contactia_privado.operaciones_gestion where id=op)<>1 then raise exception 'Reintento duplicado';end if;
 begin perform public.gestionar_reserva_web('test-gestion-a',repeat('a',64),'reprogramar',op,d,'15:30',inicio);raise exception 'Reutilización de operación';
 exception when invalid_parameter_value then null;end;
 begin perform public.gestionar_reserva_web('test-gestion-a',repeat('a',64),'reprogramar',gen_random_uuid(),d,'15:30',inicio);raise exception 'Vista desactualizada aceptada';
 exception when serialization_failure then null;end;
 begin perform public.gestionar_reserva_web('test-gestion-a',repeat('a',64),'reprogramar',gen_random_uuid(),d,'12:00',cambiado);raise exception 'Horario incorrecto aceptado';
 exception when raise_exception then get stacked diagnostics msg=message_text;if msg<>'FUERA_HORARIO' then raise;end if;end;
 v:=public.gestionar_reserva_web('test-gestion-a',repeat('a',64),'cancelar',cancelar,null,null,cambiado);
 if v->>'estado'<>'cancelada' or v->>'puede_cambiar'<>'false' or exists(select 1 from public.reserva_mesas where reserva_id=rid and activa) then raise exception 'Cancelación no libera mesa';end if;
 perform public.gestionar_reserva_web('test-gestion-a',repeat('a',64),'cancelar',cancelar,null,null,cambiado);
 -- Un reintento antiguo de cambio después de cancelar no reactiva ni modifica la reserva.
 v:=public.gestionar_reserva_web('test-gestion-a',repeat('a',64),'reprogramar',op,d,'15:00',inicio);
 if v->>'estado'<>'cancelada' then raise exception 'Reintento antiguo sobrescribe estado';end if;
 update contactia_privado.enlaces_gestion set revocado=true where hash=repeat('a',64);
 begin perform public.gestionar_reserva_web('test-gestion-a',repeat('a',64));raise exception 'Enlace revocado aceptado';exception when no_data_found then null;end;
 update contactia_privado.enlaces_gestion set expira_en=now()-interval '1 second' where hash=repeat('b',64);
 begin perform public.gestionar_reserva_web('test-gestion-b',repeat('b',64));raise exception 'Enlace caducado aceptado';exception when no_data_found then null;end;
end $$;
reset role;
set local role anon;
do $$ begin
 begin perform public.gestionar_reserva_web('test-gestion-a',repeat('a',64));raise exception 'Anon RPC';exception when insufficient_privilege then null;end;
 begin perform 1 from contactia_privado.enlaces_gestion;raise exception 'Anon hashes';exception when insufficient_privilege then null;end;
end $$;
reset role;
set local role authenticated;
do $$ begin
 begin perform public.gestionar_reserva_web('test-gestion-a',repeat('a',64));raise exception 'Authenticated RPC';exception when insufficient_privilege then null;end;
 begin perform 1 from contactia_privado.operaciones_gestion;raise exception 'Authenticated auditoría';exception when insufficient_privilege then null;end;
end $$;
reset role;
rollback;
