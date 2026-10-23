begin;
insert into public.restaurantes(slug,nombre,duracion_reserva_minutos,reservas_web_activas,horario_reservas)
values('test-correo','Correo',90,true,'{"lunes":["13:00-16:00"],"martes":["13:00-16:00"],"miércoles":["13:00-16:00"],"jueves":["13:00-16:00"],"viernes":["13:00-16:00"],"sábado":["13:00-16:00"],"domingo":["13:00-16:00"]}');
insert into public.zonas(restaurante_id,nombre) select id,'Interior' from public.restaurantes where slug='test-correo';
insert into public.mesas(restaurante_id,zona_id,nombre,capacidad) select restaurante_id,id,'Una',4 from public.zonas where restaurante_id=(select id from public.restaurantes where slug='test-correo');
set local role service_role;
do $$
declare a bigint; z uuid; d date:=(clock_timestamp() at time zone 'Europe/Madrid')::date+7;
 rid uuid; pet uuid:=gen_random_uuid(); v jsonb; segundo jsonb; lease uuid; pet2 uuid:=gen_random_uuid(); rid2 uuid;
begin
 select id into a from public.restaurantes where slug='test-correo';select id into z from public.zonas where restaurante_id=a;
 rid:=public.reservar_web_con_gestion('test-correo',pet,z,d,'14:00',2,'Cliente','cliente@example.invalid','600000000','',repeat('c',64));
 -- No hay envío para direcciones ajenas a la lista, ni asignación de trabajo.
 v:=public.preparar_correo_reserva_web('test-correo',pet,repeat('c',64),'Contactia <reservas@contactia.net>','preview.example',array['otro@example.invalid']);
 if v->>'estado'<>'omitido' or exists(select 1 from contactia_privado.correos_reserva_web where reserva_id=rid) then raise exception 'Lista de pruebas';end if;
 begin perform public.preparar_correo_reserva_web('otro',pet,repeat('c',64),'Contactia','preview.example',array['cliente@example.invalid']);raise exception 'Cruce de restaurante';exception when no_data_found then null;end;
 v:=public.preparar_correo_reserva_web('test-correo',pet,repeat('c',64),'Contactia <reservas@contactia.net>','preview.example',array['cliente@example.invalid']);
 lease:=(v->>'intento')::uuid;
 if v->>'estado'<>'enviar' or v->'datos'->>'hora'<>'14:00' or v->'datos'->>'email'<>'cliente@example.invalid' or v->'datos' ? 'token' then raise exception 'Snapshot';end if;
 segundo:=public.preparar_correo_reserva_web('test-correo',pet,repeat('c',64),'Otro','otro.example',array['cliente@example.invalid']);
 if segundo->>'estado'<>'pendiente' or (select intentos from contactia_privado.correos_reserva_web where reserva_id=rid)<>1 then raise exception 'Reclamación concurrente';end if;
 if public.finalizar_correo_reserva_web(rid,gen_random_uuid(),'aceptado','id') then raise exception 'Lease ajeno';end if;
 perform public.finalizar_correo_reserva_web(rid,lease,'pendiente');
 update contactia_privado.correos_reserva_web set bloqueado_hasta=now()-interval '1 second' where reserva_id=rid;
 segundo:=public.preparar_correo_reserva_web('test-correo',pet,repeat('c',64),'Otro','otro.example',array['cliente@example.invalid']);
 if segundo->'datos'<>v->'datos' or segundo->>'intento'=v->>'intento' then raise exception 'Reintento alterado';end if;
 if public.finalizar_correo_reserva_web(rid,lease,'rechazado') then raise exception 'Respuesta antigua';end if;
 perform public.finalizar_correo_reserva_web(rid,(segundo->>'intento')::uuid,'aceptado','proveedor-id');
 v:=public.preparar_correo_reserva_web('test-correo',pet,repeat('c',64),'Otro','otro.example',array['cliente@example.invalid']);
 if v->>'estado'<>'aceptado' or (select intentos from contactia_privado.correos_reserva_web where reserva_id=rid)<>2 then raise exception 'Correo duplicado';end if;
 -- Una reserva modificada después de un intento incierto exige revisión.
 rid2:=public.reservar_web_con_gestion('test-correo',pet2,z,d+1,'14:00',2,'Cliente','cliente@example.invalid','600000000','',repeat('d',64));
 perform public.preparar_correo_reserva_web('test-correo',pet2,repeat('d',64),'Contactia','preview.example',array['cliente@example.invalid']);
 update public.reservas set inicio=inicio+interval '30 minutes',fin=fin+interval '30 minutes' where id=rid2;
 update contactia_privado.correos_reserva_web set bloqueado_hasta=now()-interval '1 second' where reserva_id=rid2;
 v:=public.preparar_correo_reserva_web('test-correo',pet2,repeat('d',64),'Contactia','preview.example',array['cliente@example.invalid']);
 if v->>'estado'<>'revision' then raise exception 'Correo desactualizado';end if;
 -- Ventana inferior a las 24 horas de idempotencia del proveedor.
 update contactia_privado.correos_reserva_web set estado='pendiente',inicio_reserva=(select inicio from public.reservas where id=rid2),creado_en=now()-interval '24 hours' where reserva_id=rid2;
 v:=public.preparar_correo_reserva_web('test-correo',pet2,repeat('d',64),'Contactia','preview.example',array['cliente@example.invalid']);
 if v->>'estado'<>'revision' then raise exception 'Reintento fuera de ventana';end if;
end $$;
reset role;
do $$ begin
 if not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='contactia_privado' and c.relname='correos_reserva_web' and c.relrowsecurity) then raise exception 'RLS deshabilitada';end if;
 if has_function_privilege('anon','public.preparar_correo_reserva_web(text,uuid,text,text,text,text[])','EXECUTE') or
 has_function_privilege('authenticated','public.finalizar_correo_reserva_web(uuid,uuid,text,text)','EXECUTE') or
 has_table_privilege('authenticated','contactia_privado.correos_reserva_web','SELECT') then raise exception 'Permisos públicos';end if;
end $$;
rollback;
