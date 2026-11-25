begin;
alter table contactia_privado.correos_gestion_reserva
 add column entrega_motivo text,
 add column whatsapp_solicitado boolean not null default false,
 add column whatsapp_estado text not null default 'sin_solicitar' check(whatsapp_estado in ('sin_solicitar','preparado','incierto','aceptado','entregado','fallido')),
 add column whatsapp_snapshot jsonb, add column whatsapp_operacion uuid,
 add column whatsapp_sid text check(whatsapp_sid ~ '^(SM|MM)[a-fA-F0-9]{32}$'),
 add column whatsapp_revisado_en timestamptz;
-- Las filas anteriores quedan fuera del circuito automático de WhatsApp.
create or replace function public.gestionar_reserva_con_correo(p_slug text,p_hash text,p_accion text,p_operacion uuid,
 p_fecha date default null,p_hora time default null,p_inicio_anterior timestamptz default null,
 p_personas integer default null,p_personas_anteriores integer default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare antes jsonb; despues jsonb; existia boolean; v public.reservas; datos jsonb; contador integer; contacto record;
begin
 if p_accion is null or p_accion not in ('cancelar','reprogramar','personas') or p_operacion is null then raise exception 'DATOS_INVALIDOS' using errcode='22023';end if;
 antes:=public.gestionar_reserva_web(p_slug,p_hash);
 select exists(select 1 from contactia_privado.operaciones_gestion where id=p_operacion) into existia;
 if p_accion='personas' then
  despues:=public.gestionar_personas_voz(p_slug,p_hash,p_accion,p_operacion,p_fecha,p_hora,p_inicio_anterior,p_personas,p_personas_anteriores);
 else
  if p_personas is not null or p_personas_anteriores is not null then raise exception 'DATOS_INVALIDOS' using errcode='22023';end if;
  despues:=public.gestionar_reserva_web(p_slug,p_hash,p_accion,p_operacion,p_fecha,p_hora,p_inicio_anterior);
 end if;
 if not existia and (antes->>'inicio' is distinct from despues->>'inicio' or antes->>'personas' is distinct from despues->>'personas' or antes->>'estado' is distinct from despues->>'estado') then
  select r.* into strict v from public.reservas r join contactia_privado.enlaces_gestion e on e.reserva_id=r.id where e.hash=p_hash;
  select c.contador into contador from contactia_privado.codigos_gestion_voz c where c.reserva_id=v.id;
  select coalesce(t.whatsapp_autorizado,false) and exists(select 1 from contactia_privado.codigos_gestion_voz c where c.reserva_id=v.id and c.telefono_original=v.telefono) as autorizado,t.consentimiento_en,t.correo_no_comprendido into contacto from contactia_privado.contactos_reserva_web t where t.reserva_id=v.id;
  datos:=despues||jsonb_build_object('version',1,'slug',p_slug,'peticion_id',v.peticion_id,'email',v.email,
   'gestion_contador',contador,'telefono',v.telefono,'whatsapp_autorizado',coalesce(contacto.autorizado,false),'consentimiento_en',contacto.consentimiento_en,'correo_no_comprendido',coalesce(contacto.correo_no_comprendido,false),'accion',case when p_accion='cancelar' then 'cancelada' else 'modificada' end);
  insert into contactia_privado.correos_gestion_reserva(id,reserva_id,restaurante_id,enlace_hash,datos,whatsapp_solicitado)
   values(p_operacion,v.id,v.restaurante_id,p_hash,datos,true);
 end if;
 return despues||jsonb_build_object('correo_gestion_id',(select id from contactia_privado.correos_gestion_reserva where id=p_operacion and enlace_hash=p_hash));
end $$;
create or replace function public.correos_gestion_panel(p_usuario uuid,p_restaurante bigint,p_accion text default 'listar_gestion',p_aviso uuid default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare c contactia_privado.correos_gestion_reserva; filas jsonb;
begin
 if p_usuario is null or not exists(select 1 from public.restaurante_usuarios where usuario_id=p_usuario and restaurante_id=p_restaurante and activo and rol in ('propietario','encargado')) then
  raise exception 'ACCESO_NO_PERMITIDO' using errcode='42501';end if;
 if p_accion='listar_gestion' and p_aviso is null then
  select coalesce(jsonb_agg(f.fila order by f.secuencia desc),'[]'::jsonb) into filas from (
   select secuencia,jsonb_build_object('aviso_id',cc.id,'nombre',cc.datos->>'nombre','tipo',cc.datos->>'accion','fecha',cc.datos->>'fecha','hora',cc.datos->>'hora','creado_en',cc.creado_en,
    'estado',coalesce(cc.entrega_estado,cc.estado),'whatsapp_estado',cc.whatsapp_estado,'puede_revisar_whatsapp',cc.whatsapp_sid is not null,
    'puede_preparar_whatsapp',cc.whatsapp_solicitado and cc.datos->>'whatsapp_autorizado'='true' and cc.whatsapp_estado in ('sin_solicitar','preparado') and ((cc.datos->>'email'='' and cc.datos->>'correo_no_comprendido'='true') or (cc.entrega_estado='rechazado' and cc.entrega_motivo in ('correo_rebotado','entrega_fallida'))),'puede_revisar',cc.id_proveedor is not null,
    'puede_reintentar',cc.estado in ('pendiente','omitido') and cc.datos->>'email'<>'' and cc.creado_en+interval '23 hours'>clock_timestamp() and cc.intentos<6
      and coalesce(cc.bloqueado_hasta<=clock_timestamp(),true) and not exists(select 1 from contactia_privado.correos_gestion_reserva n where n.reserva_id=cc.reserva_id and n.secuencia>cc.secuencia)) as fila
   from contactia_privado.correos_gestion_reserva cc where cc.restaurante_id=p_restaurante order by secuencia desc limit 50
  ) f;
  return jsonb_build_object('avisos',filas);
 end if;
 if p_accion not in ('reintentar_gestion','consultar_gestion','preparar_whatsapp_gestion','enviar_whatsapp_gestion','consultar_whatsapp_gestion') or p_accion is null or p_aviso is null then raise exception 'DATOS_INVALIDOS' using errcode='22023';end if;
 select * into c from contactia_privado.correos_gestion_reserva where id=p_aviso and restaurante_id=p_restaurante for update;
 if not found then raise exception 'AVISO_NO_DISPONIBLE' using errcode='P0002';end if;
 if p_accion='consultar_whatsapp_gestion' and (c.whatsapp_sid is null or c.whatsapp_revisado_en>clock_timestamp()-interval '30 seconds') then raise exception 'ESPERE_REVISION' using errcode='55000';end if;
 if p_accion='consultar_whatsapp_gestion' then update contactia_privado.correos_gestion_reserva set whatsapp_revisado_en=clock_timestamp() where id=c.id;end if;
 if p_accion='consultar_gestion' then
  if c.id_proveedor is null or c.revisado_en>clock_timestamp()-interval '30 seconds' then raise exception 'ESPERE_REVISION' using errcode='55000';end if;
  update contactia_privado.correos_gestion_reserva set revisado_en=clock_timestamp() where id=c.id;
 end if;
 return jsonb_build_object('aviso_id',c.id,'slug',c.datos->>'slug','enlace_hash',c.enlace_hash,'id_proveedor',c.id_proveedor,'entrega_estado',c.entrega_estado,'whatsapp_sid',c.whatsapp_sid,'whatsapp_estado',c.whatsapp_estado);
end $$;
create function public.preparar_whatsapp_gestion(p_aviso uuid,p_hash text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare c contactia_privado.correos_gestion_reserva; v public.reservas; rid uuid;
begin
 select reserva_id into rid from contactia_privado.correos_gestion_reserva where id=p_aviso and enlace_hash=p_hash;
 if not found then raise exception 'AVISO_NO_DISPONIBLE' using errcode='P0002';end if;
 select * into strict v from public.reservas where id=rid for share;
 select * into strict c from contactia_privado.correos_gestion_reserva where id=p_aviso for update;
 if c.whatsapp_estado in ('incierto','aceptado','entregado','fallido') then return jsonb_build_object('estado',c.whatsapp_estado);end if;
 if not c.whatsapp_solicitado or c.datos->>'whatsapp_autorizado' is distinct from 'true'
  or not exists(select 1 from contactia_privado.contactos_reserva_web t where t.reserva_id=v.id and t.whatsapp_autorizado and t.consentimiento_en=(c.datos->>'consentimiento_en')::timestamptz)
  or c.datos->>'telefono' is distinct from v.telefono
  or c.datos->>'email' is distinct from v.email
  or c.datos->>'estado' is distinct from v.estado
  or (c.datos->>'inicio')::timestamptz is distinct from v.inicio
  or (c.datos->>'personas')::integer is distinct from v.personas
  or not exists(select 1 from contactia_privado.enlaces_gestion e where hash=p_hash and reserva_id=v.id and not revocado and expira_en>clock_timestamp())
  or c.creado_en+interval '7 days'<=clock_timestamp()
  or exists(select 1 from contactia_privado.correos_gestion_reserva n where n.reserva_id=v.id and n.secuencia>c.secuencia)
  or not coalesce(((c.datos->>'email'='' and c.datos->>'correo_no_comprendido'='true') or (c.entrega_estado='rechazado' and c.entrega_motivo in ('correo_rebotado','entrega_fallida'))),false) then
  return jsonb_build_object('estado','no_elegible');end if;
 update contactia_privado.correos_gestion_reserva set whatsapp_estado='preparado' where id=c.id;
 return jsonb_build_object('estado','preparado','datos',c.datos);
end $$;

-- Se registra incertidumbre ANTES del POST. Nunca se repite un envío incierto.
create function public.reclamar_whatsapp_gestion(p_aviso uuid,p_hash text,p_snapshot jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare d jsonb; c contactia_privado.correos_gestion_reserva;
begin
 d:=public.preparar_whatsapp_gestion(p_aviso,p_hash);
 if d->>'estado' is distinct from 'preparado' then return d;end if;
 if p_snapshot is null or jsonb_typeof(p_snapshot) is distinct from 'object' or p_snapshot->>'telefono' is distinct from d->'datos'->>'telefono'
  or p_snapshot->>'tipo' is distinct from d->'datos'->>'accion' or p_snapshot->>'content_sid' is null or p_snapshot->>'content_sid' !~ '^HX[a-fA-F0-9]{32}$'
  or p_snapshot->>'destino' is null or p_snapshot->>'destino' !~ '^\+[1-9][0-9]{7,14}$'
  or jsonb_typeof(p_snapshot->'variables') is distinct from 'object' then raise exception 'DATOS_INVALIDOS' using errcode='22023';end if;
 update contactia_privado.correos_gestion_reserva set whatsapp_estado='incierto',whatsapp_operacion=gen_random_uuid(),whatsapp_snapshot=p_snapshot,
  actualizado_en=clock_timestamp() where id=p_aviso and whatsapp_estado='preparado' returning * into c;
 if not found then return jsonb_build_object('estado','incierto');end if;
 return jsonb_build_object('estado','enviar','operacion',c.whatsapp_operacion,'snapshot',c.whatsapp_snapshot);
end $$;
create function public.finalizar_whatsapp_gestion(p_aviso uuid,p_operacion uuid,p_estado text,p_sid text default null)
returns boolean language plpgsql security invoker set search_path='' as $$
begin
 if p_estado is null or p_estado not in ('incierto','aceptado','fallido') or (p_estado='aceptado' and (p_sid is null or p_sid !~ '^(SM|MM)[a-fA-F0-9]{32}$'))
  or (p_estado<>'aceptado' and p_sid is not null) then raise exception 'DATOS_INVALIDOS' using errcode='22023';end if;
 update contactia_privado.correos_gestion_reserva set whatsapp_estado=p_estado,whatsapp_sid=p_sid,actualizado_en=clock_timestamp()
 where id=p_aviso and whatsapp_operacion=p_operacion and whatsapp_estado='incierto';return found;
end $$;
create function public.entrega_whatsapp_gestion(p_aviso uuid,p_sid text,p_estado text)
returns boolean language plpgsql security invoker set search_path='' as $$
begin
 if p_estado is null or p_estado not in ('aceptado','entregado','fallido') then raise exception 'DATOS_INVALIDOS' using errcode='22023';end if;
 update contactia_privado.correos_gestion_reserva set whatsapp_estado=case when whatsapp_estado='entregado' then 'entregado' else p_estado end,
  actualizado_en=clock_timestamp() where id=p_aviso and whatsapp_sid=p_sid and whatsapp_estado in ('aceptado','entregado','fallido');return found;
end $$;
create function public.entrega_correo_gestion_evento(p_aviso uuid,p_id_proveedor text,p_evento text)
returns boolean language plpgsql security invoker set search_path='' as $$
declare c contactia_privado.correos_gestion_reserva; nuevo_estado text; nuevo_motivo text;
begin
 select * into c from contactia_privado.correos_gestion_reserva where id=p_aviso and id_proveedor=p_id_proveedor and estado='aceptado' for update;
 if not found then return false;end if;
 if c.entrega_estado='rechazado' then return true;end if;
 nuevo_estado:=case when p_evento='delivered' then 'entregado' when p_evento='delivery_delayed' then 'demorado'
  when p_evento in ('bounced','failed','suppressed','complained') then 'rechazado' else 'aceptado' end;
 nuevo_motivo:=case p_evento when 'bounced' then 'correo_rebotado' when 'failed' then 'entrega_fallida' when 'suppressed' then 'correo_suprimido' when 'complained' then 'queja_destinatario' else null end;
 if c.entrega_estado='entregado' and nuevo_estado in ('aceptado','demorado') then return true;end if;
 update contactia_privado.correos_gestion_reserva set entrega_estado=nuevo_estado,entrega_motivo=nuevo_motivo,actualizado_en=clock_timestamp() where id=c.id;return true;
end $$;
revoke all on function public.preparar_whatsapp_gestion(uuid,text),public.reclamar_whatsapp_gestion(uuid,text,jsonb),
 public.finalizar_whatsapp_gestion(uuid,uuid,text,text),public.entrega_whatsapp_gestion(uuid,text,text),public.entrega_correo_gestion_evento(uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function public.preparar_whatsapp_gestion(uuid,text),public.reclamar_whatsapp_gestion(uuid,text,jsonb),
 public.finalizar_whatsapp_gestion(uuid,uuid,text,text),public.entrega_whatsapp_gestion(uuid,text,text),public.entrega_correo_gestion_evento(uuid,text,text) to service_role;
commit;
