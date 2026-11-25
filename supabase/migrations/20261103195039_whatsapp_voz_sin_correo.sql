begin;
alter table contactia_privado.contactos_reserva_web add column correo_no_comprendido boolean not null default false;

-- Solo el motor autenticado elige este RPC tras confirmar teléfono y permiso.
create function public.reservar_voz_sin_correo(p_slug text,p_peticion uuid,p_zona uuid,p_fecha date,p_hora time,
 p_personas integer,p_nombre text,p_email text,p_telefono text,p_observaciones text,p_hash text,p_whatsapp boolean)
returns uuid language plpgsql security invoker set search_path='' as $$
declare rid uuid;
begin
 if p_whatsapp is distinct from true or p_email is distinct from '' or p_telefono is null or p_telefono !~ '^\+[1-9][0-9]{7,14}$' then
  raise exception 'DATOS_INVALIDOS' using errcode='22023';end if;
 rid:=public.reservar_web_con_gestion(p_slug,p_peticion,p_zona,p_fecha,p_hora,p_personas,p_nombre,'',p_telefono,p_observaciones,p_hash);
 insert into contactia_privado.contactos_reserva_web(reserva_id,whatsapp_autorizado,correo_no_comprendido,consentimiento_version)
 values(rid,true,true,'confirmacion-sin-correo-v1') on conflict do nothing;
 if not exists(select 1 from contactia_privado.contactos_reserva_web where reserva_id=rid and whatsapp_autorizado and correo_no_comprendido) then
  raise exception 'CONSENTIMIENTO_CAMBIADO' using errcode='22023';end if;
 return rid;
end $$;
revoke all on function public.reservar_voz_sin_correo(text,uuid,uuid,date,time,integer,text,text,text,text,text,boolean) from public,anon,authenticated,service_role;
grant execute on function public.reservar_voz_sin_correo(text,uuid,uuid,date,time,integer,text,text,text,text,text,boolean) to service_role;

-- Un único envío automático después del sí final. El hash vincula la operación
-- con la reserva recién creada; no existe ruta pública para iniciar este trabajo.
create function public.whatsapp_voz_sin_correo(p_reserva uuid,p_hash text,p_accion text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare r public.reservas; t contactia_privado.contactos_reserva_web; rest public.restaurantes; zona text; snap jsonb; op uuid;
begin
 if p_accion is null or p_accion not in ('preparar_whatsapp','enviar_whatsapp') then raise exception 'DATOS_INVALIDOS' using errcode='22023';end if;
 select * into r from public.reservas where id=p_reserva for update;
 if not found then raise exception 'NO_DISPONIBLE' using errcode='P0002';end if;
 if not exists(select 1 from contactia_privado.enlaces_gestion where reserva_id=r.id and hash=p_hash and not revocado and expira_en>clock_timestamp()) then
  raise exception 'ACCESO_NO_PERMITIDO' using errcode='42501';end if;
 select * into t from contactia_privado.contactos_reserva_web where reserva_id=r.id for update;
 if not found or not t.correo_no_comprendido or not t.whatsapp_autorizado or r.email<>'' or r.estado<>'confirmada' or r.inicio<=clock_timestamp() then
  raise exception 'WHATSAPP_NO_ELEGIBLE' using errcode='55000';end if;
 if t.whatsapp_estado in ('en_curso','aceptado','entregado','fallido','incierto') then
  return jsonb_build_object('estado','ya_tramitado','whatsapp_estado',t.whatsapp_estado);end if;
 if t.operacion_hasta>clock_timestamp() then raise exception 'OPERACION_EN_CURSO' using errcode='55000';end if;
 select * into strict rest from public.restaurantes where id=r.restaurante_id;
 select nombre into strict zona from public.zonas where id=r.zona_id and restaurante_id=r.restaurante_id;
 snap:=jsonb_build_object('nombre',r.nombre,'restaurante',rest.nombre,'fecha',to_char(r.inicio at time zone rest.zona_horaria,'YYYY-MM-DD'),
  'hora',to_char(r.inicio at time zone rest.zona_horaria,'HH24:MI'),'personas',r.personas,'zona',zona,
  'telefono',r.telefono,'localizador',upper('PRUEBA-'||r.id::text),'inicio',r.inicio);
 if p_accion='enviar_whatsapp' and (t.whatsapp_estado<>'preparado' or t.whatsapp_snapshot is distinct from snap) then
  raise exception 'PREVISUALIZACION_CAMBIADA' using errcode='40001';end if;
 op:=gen_random_uuid();
 update contactia_privado.contactos_reserva_web set operacion=op,operacion_accion=p_accion,operacion_hasta=clock_timestamp()+interval '30 seconds',
  whatsapp_estado=case p_accion when 'preparar_whatsapp' then 'preparado' else 'en_curso' end,
  whatsapp_snapshot=case when p_accion='preparar_whatsapp' then snap else whatsapp_snapshot end,actualizado_en=clock_timestamp() where reserva_id=r.id;
 return jsonb_build_object('operacion',op,'reserva_id',r.id,'datos',snap,'correo_no_comprendido',true,'correo_motivo','correo_no_comprendido',
  'whatsapp_autorizado',t.whatsapp_autorizado,'consentimiento_en',t.consentimiento_en,'whatsapp_estado',t.whatsapp_estado);
end $$;
revoke all on function public.whatsapp_voz_sin_correo(uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function public.whatsapp_voz_sin_correo(uuid,text,text) to service_role;

create or replace function public.avisos_web_panel(p_usuario uuid,p_restaurante bigint,p_reserva uuid default null,p_accion text default 'listar')
returns jsonb language plpgsql security invoker set search_path='' as $$
declare rol text; r public.reservas; rest public.restaurantes; c contactia_privado.correos_reserva_web;
 t contactia_privado.contactos_reserva_web; v jsonb; snap jsonb; op uuid; zona text;
begin
 if p_usuario is null then raise exception 'ACCESO_NO_PERMITIDO' using errcode='42501';end if;
 select ru.rol into rol from public.restaurante_usuarios ru where ru.restaurante_id=p_restaurante and ru.usuario_id=p_usuario and ru.activo for share;
 if not found then raise exception 'ACCESO_NO_PERMITIDO' using errcode='42501';end if;
 if p_accion='listar' and p_reserva is null then
  select coalesce(jsonb_agg(f.fila order by f.creado_en desc,f.id desc),'[]'::jsonb) into v from (
   select rr.id,rr.creado_en,jsonb_build_object('reserva_id',rr.id,'nombre',rr.nombre,'inicio',rr.inicio,'estado_reserva',rr.estado,
    'correo_estado',case when tt.correo_no_comprendido then 'sin_direccion' else coalesce(cc.entrega_estado,cc.estado) end,'correo_motivo',case when tt.correo_no_comprendido then 'correo_no_comprendido' else cc.entrega_motivo end,'revisado_en',cc.revisado_en,
    'puede_revisar',cc.id_proveedor is not null,'puede_reintentar',cc.estado='pendiente' and cc.intentos<6
     and cc.creado_en+interval '23 hours'>clock_timestamp() and cc.inicio_reserva=rr.inicio and rr.estado='confirmada' and rr.inicio>clock_timestamp(),
    'whatsapp_estado',coalesce(tt.whatsapp_estado,'sin_solicitar'),'whatsapp_autorizado',coalesce(tt.whatsapp_autorizado,false),
    'puede_preparar_whatsapp',coalesce(tt.whatsapp_autorizado,false) and ((cc.entrega_estado='rechazado' and cc.entrega_motivo in ('correo_rebotado','entrega_fallida')) or (tt.correo_no_comprendido and rr.email='' and cc.reserva_id is null)) and rr.estado='confirmada' and rr.inicio>clock_timestamp()
     and coalesce(tt.whatsapp_estado,'sin_solicitar') in ('sin_solicitar','preparado','bloqueado'),
    'puede_revisar_whatsapp',tt.whatsapp_sid is not null,'puede_operar',rol in ('propietario','encargado')) as fila
   from public.reservas rr left join contactia_privado.correos_reserva_web cc on cc.reserva_id=rr.id
   left join contactia_privado.contactos_reserva_web tt on tt.reserva_id=rr.id
   where rr.restaurante_id=p_restaurante and (cc.reserva_id is not null or tt.correo_no_comprendido) order by rr.creado_en desc,rr.id desc limit 50
  ) f;
  return jsonb_build_object('avisos',v);
 end if;
 if rol not in ('propietario','encargado') then raise exception 'ACCESO_NO_PERMITIDO' using errcode='42501';end if;
 if p_accion is null or p_accion not in ('consultar_correo','reintentar_correo','preparar_whatsapp','enviar_whatsapp','consultar_whatsapp') then
  raise exception 'DATOS_INVALIDOS' using errcode='22023';end if;
 select * into r from public.reservas where id=p_reserva and restaurante_id=p_restaurante for update;
 if not found then raise exception 'NO_DISPONIBLE' using errcode='P0002';end if;
 select * into c from contactia_privado.correos_reserva_web where reserva_id=r.id for update;
 insert into contactia_privado.contactos_reserva_web(reserva_id) values(r.id) on conflict do nothing;
 select * into strict t from contactia_privado.contactos_reserva_web where reserva_id=r.id for update;
 if c.reserva_id is null and not t.correo_no_comprendido then raise exception 'NO_DISPONIBLE' using errcode='P0002';end if;
 if t.correo_no_comprendido and p_accion in ('consultar_correo','reintentar_correo') then raise exception 'SIN_ENVIO' using errcode='55000';end if;
 if t.operacion_hasta>clock_timestamp() then raise exception 'OPERACION_EN_CURSO' using errcode='55000';end if;
 if p_accion in ('reintentar_correo','preparar_whatsapp','enviar_whatsapp') and (r.estado<>'confirmada' or r.inicio<=clock_timestamp()) then
  raise exception 'RESERVA_NO_ELEGIBLE' using errcode='55000';end if;
 if p_accion='consultar_correo' then
  if c.id_proveedor is null then raise exception 'SIN_ENVIO' using errcode='55000';end if;
  if c.revisado_en>clock_timestamp()-interval '30 seconds' then raise exception 'ESPERE_REVISION' using errcode='55000';end if;
  update contactia_privado.correos_reserva_web set revisado_en=clock_timestamp() where reserva_id=r.id;
 elsif p_accion='reintentar_correo' then
  if c.estado<>'pendiente' or c.intentos>=6 or c.creado_en+interval '23 hours'<=clock_timestamp() or
   c.inicio_reserva<>r.inicio or c.bloqueado_hasta>clock_timestamp() then raise exception 'REINTENTO_NO_SEGURO' using errcode='55000';end if;
 elsif p_accion in ('preparar_whatsapp','enviar_whatsapp') then
  if not t.whatsapp_autorizado or not ((c.entrega_estado is not distinct from 'rechazado' and coalesce(c.entrega_motivo in ('correo_rebotado','entrega_fallida'),false)) or (t.correo_no_comprendido and r.email='' and c.reserva_id is null)) or
   t.whatsapp_estado not in ('sin_solicitar','preparado','bloqueado') then raise exception 'WHATSAPP_NO_ELEGIBLE' using errcode='55000';end if;
 elsif p_accion='consultar_whatsapp' then
  if t.whatsapp_sid is null or t.whatsapp_revisado_en>clock_timestamp()-interval '30 seconds' then
   raise exception 'ESPERE_REVISION' using errcode='55000';end if;
 end if;
 select * into strict rest from public.restaurantes where id=p_restaurante;
 select nombre into strict zona from public.zonas where id=r.zona_id and restaurante_id=p_restaurante;
 snap:=jsonb_build_object('nombre',r.nombre,'restaurante',rest.nombre,'fecha',to_char(r.inicio at time zone rest.zona_horaria,'YYYY-MM-DD'),
  'hora',to_char(r.inicio at time zone rest.zona_horaria,'HH24:MI'),'personas',r.personas,'zona',zona,
  'telefono',r.telefono,'localizador',upper('PRUEBA-'||r.id::text),'inicio',r.inicio);
 if p_accion='enviar_whatsapp' and (t.whatsapp_estado<>'preparado' or t.whatsapp_snapshot is distinct from snap) then
  raise exception 'PREVISUALIZACION_CAMBIADA' using errcode='40001';end if;
 op:=gen_random_uuid();
 update contactia_privado.contactos_reserva_web set operacion=op,operacion_accion=p_accion,operacion_hasta=clock_timestamp()+interval '30 seconds',
  actualizado_por=p_usuario,actualizado_en=clock_timestamp(),
  whatsapp_estado=case p_accion when 'preparar_whatsapp' then 'preparado' when 'enviar_whatsapp' then 'en_curso' else whatsapp_estado end,
  whatsapp_snapshot=case when p_accion='preparar_whatsapp' then snap else whatsapp_snapshot end,
  whatsapp_revisado_en=case when p_accion='consultar_whatsapp' then clock_timestamp() else whatsapp_revisado_en end where reserva_id=r.id;
 return jsonb_build_object('operacion',op,'reserva_id',r.id,'slug',rest.slug,'peticion_id',r.peticion_id,'enlace_hash',c.enlace_hash,
  'id_proveedor',c.id_proveedor,'correo_estado',coalesce(c.entrega_estado,c.estado),'correo_motivo',case when t.correo_no_comprendido then 'correo_no_comprendido' else c.entrega_motivo end,
  'correo_no_comprendido',t.correo_no_comprendido,'consentimiento_en',t.consentimiento_en,'whatsapp_autorizado',t.whatsapp_autorizado,'datos',snap,
  'whatsapp_sid',t.whatsapp_sid,'whatsapp_estado',t.whatsapp_estado,'whatsapp_proveedor',t.whatsapp_proveedor);
end $$;

commit;
