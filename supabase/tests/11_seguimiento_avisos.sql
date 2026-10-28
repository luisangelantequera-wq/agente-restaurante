begin;
insert into auth.users(id) values('b0000000-0000-4000-8000-000000000001'),('b0000000-0000-4000-8000-000000000002');
insert into public.restaurantes(slug,nombre,duracion_reserva_minutos,reservas_web_activas,horario_reservas) values('test-avisos','Sol ficticio',90,true,
'{"lunes":["13:00-16:00"],"martes":["13:00-16:00"],"miércoles":["13:00-16:00"],"jueves":["13:00-16:00"],"viernes":["13:00-16:00"],"sábado":["13:00-16:00"],"domingo":["13:00-16:00"]}');
insert into public.restaurante_usuarios(restaurante_id,usuario_id,rol,activo) select id,'b0000000-0000-4000-8000-000000000001','propietario',true from public.restaurantes where slug='test-avisos';
insert into public.restaurante_usuarios(restaurante_id,usuario_id,rol,activo) select id,'b0000000-0000-4000-8000-000000000002','empleado',true from public.restaurantes where slug='test-avisos';
insert into public.zonas(restaurante_id,nombre) select id,'Interior' from public.restaurantes where slug='test-avisos';
insert into public.mesas(restaurante_id,zona_id,nombre,capacidad) select restaurante_id,id,'Una',4 from public.zonas where restaurante_id=(select id from public.restaurantes where slug='test-avisos');
set local role service_role;
do $$
declare a bigint; z uuid; d date:=(clock_timestamp() at time zone 'Europe/Madrid')::date+7; pet uuid:=gen_random_uuid();rid uuid;v jsonb;op uuid;
 usuario uuid:='b0000000-0000-4000-8000-000000000001';empleado uuid:='b0000000-0000-4000-8000-000000000002';
begin
 select id into a from public.restaurantes where slug='test-avisos';select id into z from public.zonas where restaurante_id=a;
 rid:=public.reservar_web_con_avisos('test-avisos',pet,z,d,'14:00',2,'Cliente','cliente@example.invalid','600000000','',repeat('e',64),true);
 if public.reservar_web_con_avisos('test-avisos',pet,z,d,'14:00',2,'Cliente','cliente@example.invalid','600000000','',repeat('e',64),true)<>rid then raise exception 'Idempotencia';end if;
 begin perform public.reservar_web_con_avisos('test-avisos',pet,z,d,'14:00',2,'Cliente','cliente@example.invalid','600000000','',repeat('e',64),false);raise exception 'Consentimiento reescrito';exception when invalid_parameter_value then null;end;
 v:=public.preparar_correo_reserva_web('test-avisos',pet,repeat('e',64),'Contactia','preview.example',array['cliente@example.invalid']);
 perform public.finalizar_correo_reserva_web(rid,(v->>'intento')::uuid,'aceptado','f0000000-0000-4000-8000-000000000001');
 begin perform public.avisos_web_panel(gen_random_uuid(),a);raise exception 'Identidad ajena';exception when insufficient_privilege then null;end;
 v:=public.avisos_web_panel(empleado,a);
 if jsonb_array_length(v->'avisos')<>1 or v::text like '%enlace_hash%' or v::text like '%cliente@example.invalid%' or v::text like '%600000000%' or v->'avisos'->0->>'puede_operar'<>'false' then raise exception 'Proyección del panel';end if;
 begin perform public.avisos_web_panel(empleado,a,rid,'consultar_correo');raise exception 'Empleado opera';exception when insufficient_privilege then null;end;
 begin perform public.avisos_web_panel(usuario,a,rid,'preparar_whatsapp');raise exception 'WhatsApp sin rebote';exception when object_not_in_prerequisite_state then null;end;
 v:=public.avisos_web_panel(usuario,a,rid,'consultar_correo');op:=(v->>'operacion')::uuid;
 begin perform public.avisos_web_panel(usuario,a,rid,'consultar_correo');raise exception 'Consulta simultánea';exception when object_not_in_prerequisite_state then null;end;
 if public.finalizar_aviso_web(rid,gen_random_uuid(),'{"estado":"entregado","motivo":"entregado_servidor","evento":"delivered"}') then raise exception 'Operación ajena';end if;
 perform public.finalizar_aviso_web(rid,op,'{"estado":"entregado","motivo":"entregado_servidor","evento":"delivered"}');
 if public.finalizar_aviso_web(rid,op,'{}') then raise exception 'Operación finalizada repetida';end if;
 if (select entrega_estado from contactia_privado.correos_reserva_web where reserva_id=rid)<>'entregado' then raise exception 'Entrega no guardada';end if;
 -- Un evento atrasado no revierte una entrega.
 update contactia_privado.correos_reserva_web set revisado_en=now()-interval '1 minute' where reserva_id=rid;
 v:=public.avisos_web_panel(usuario,a,rid,'consultar_correo');
 perform public.finalizar_aviso_web(rid,(v->>'operacion')::uuid,'{"estado":"demorado","motivo":"entrega_demorada","evento":"delivery_delayed"}');
 if (select entrega_estado from contactia_privado.correos_reserva_web where reserva_id=rid)<>'entregado' then raise exception 'Regresión de entrega';end if;
 -- Rebote confirmado y consentimiento habilitan la preparación.
 update contactia_privado.correos_reserva_web set entrega_estado='rechazado',entrega_motivo='correo_rebotado' where reserva_id=rid;
 v:=public.avisos_web_panel(usuario,a,rid,'preparar_whatsapp');perform public.finalizar_aviso_web(rid,(v->>'operacion')::uuid,'{}');
 -- Modificación después de previsualizar obliga a volver a preparar.
 update public.reservas set inicio=inicio+interval '30 minutes',fin=fin+interval '30 minutes' where id=rid;
 begin perform public.avisos_web_panel(usuario,a,rid,'enviar_whatsapp');raise exception 'Vista desactualizada';exception when serialization_failure then null;end;
 v:=public.avisos_web_panel(usuario,a,rid,'preparar_whatsapp');perform public.finalizar_aviso_web(rid,(v->>'operacion')::uuid,'{}');
 v:=public.avisos_web_panel(usuario,a,rid,'enviar_whatsapp');op:=(v->>'operacion')::uuid;
 perform public.finalizar_aviso_web(rid,op,'{"estado":"incierto","evento":"desconocido"}');
 begin perform public.avisos_web_panel(usuario,a,rid,'enviar_whatsapp');raise exception 'Reenvío incierto';exception when object_not_in_prerequisite_state then null;end;
 begin perform public.avisos_web_panel(usuario,a,rid,'preparar_whatsapp');raise exception 'Repreparación incierta';exception when object_not_in_prerequisite_state then null;end;
 -- Mensaje aceptado consultado mediante API: no hay regresión tras delivered.
 update contactia_privado.contactos_reserva_web set whatsapp_estado='aceptado',whatsapp_sid='SM11111111111111111111111111111111' where reserva_id=rid;
 v:=public.avisos_web_panel(usuario,a,rid,'consultar_whatsapp');
 perform public.finalizar_aviso_web(rid,(v->>'operacion')::uuid,'{"estado":"entregado","sid":"SM11111111111111111111111111111111","evento":"delivered"}');
 update contactia_privado.contactos_reserva_web set whatsapp_revisado_en=now()-interval '1 minute' where reserva_id=rid;
 v:=public.avisos_web_panel(usuario,a,rid,'consultar_whatsapp');
 perform public.finalizar_aviso_web(rid,(v->>'operacion')::uuid,'{"estado":"aceptado","sid":"SM11111111111111111111111111111111","evento":"sent"}');
 if (select whatsapp_estado from contactia_privado.contactos_reserva_web where reserva_id=rid)<>'entregado' then raise exception 'Regresión WhatsApp';end if;
 update public.restaurante_usuarios set activo=false where restaurante_id=a and usuario_id=usuario;
 begin perform public.avisos_web_panel(usuario,a);raise exception 'Usuario inactivo';exception when insufficient_privilege then null;end;
end $$;
reset role;
do $$begin
 if has_function_privilege('authenticated','public.avisos_web_panel(uuid,bigint,uuid,text)','execute') or
 has_table_privilege('anon','contactia_privado.contactos_reserva_web','select') or
 has_function_privilege('anon','public.reservar_web_con_avisos(text,uuid,uuid,date,time,integer,text,text,text,text,text,boolean)','execute') then raise exception 'Permisos públicos';end if;
end $$;
rollback;
