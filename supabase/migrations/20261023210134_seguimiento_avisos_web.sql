begin;
alter table contactia_privado.correos_reserva_web add column entrega_estado text
 check(entrega_estado in ('aceptado','entregado','demorado','rechazado')),
 add column entrega_motivo text, add column evento_proveedor text, add column revisado_en timestamptz;
create table contactia_privado.contactos_reserva_web (
 reserva_id uuid primary key references public.reservas(id) on delete cascade,
 whatsapp_autorizado boolean not null default false,
 consentimiento_en timestamptz not null default clock_timestamp(),
 consentimiento_version text not null default 'confirmacion-correo-fallido-v1',
 whatsapp_estado text not null default 'sin_solicitar' check(whatsapp_estado in
 ('sin_solicitar','preparado','en_curso','aceptado','entregado','fallido','incierto','bloqueado')),
 whatsapp_sid text unique check(whatsapp_sid ~ '^(SM|MM)[a-fA-F0-9]{32}$'),
 whatsapp_proveedor text, whatsapp_snapshot jsonb, whatsapp_revisado_en timestamptz,
 operacion uuid, operacion_accion text, operacion_hasta timestamptz,
 actualizado_por uuid references auth.users(id) on delete set null,
 actualizado_en timestamptz not null default clock_timestamp()
);
alter table contactia_privado.contactos_reserva_web enable row level security;
revoke all on contactia_privado.contactos_reserva_web from public,anon,authenticated;
grant all on contactia_privado.contactos_reserva_web to service_role;
create index contactos_por_operador on contactia_privado.contactos_reserva_web(actualizado_por) where actualizado_por is not null;

-- Reserva, enlace y respuesta de consentimiento constituyen una sola operación.
create function public.reservar_web_con_avisos(p_slug text,p_peticion uuid,p_zona uuid,p_fecha date,p_hora time,
 p_personas integer,p_nombre text,p_email text,p_telefono text,p_observaciones text,p_hash text,p_whatsapp boolean)
returns uuid language plpgsql security invoker set search_path='' as $$
declare rid uuid;
begin
 if p_whatsapp is null then raise exception 'DATOS_INVALIDOS' using errcode='22023';end if;
 rid:=public.reservar_web_con_gestion(p_slug,p_peticion,p_zona,p_fecha,p_hora,p_personas,p_nombre,p_email,p_telefono,p_observaciones,p_hash);
 insert into contactia_privado.contactos_reserva_web(reserva_id,whatsapp_autorizado) values(rid,p_whatsapp) on conflict do nothing;
 if not exists(select 1 from contactia_privado.contactos_reserva_web where reserva_id=rid and whatsapp_autorizado=p_whatsapp) then
  raise exception 'CONSENTIMIENTO_CAMBIADO' using errcode='22023';end if;
 return rid;
end $$;

-- Solo el backend llama con el UUID obtenido de Auth.getUser(), nunca del cuerpo.
-- La pertenencia se comprueba dentro de la misma transacción que reclama el trabajo.
create function public.avisos_web_panel(p_usuario uuid,p_restaurante bigint,p_reserva uuid default null,p_accion text default 'listar')
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
    'correo_estado',coalesce(cc.entrega_estado,cc.estado),'correo_motivo',cc.entrega_motivo,'revisado_en',cc.revisado_en,
    'puede_revisar',cc.id_proveedor is not null,'puede_reintentar',cc.estado='pendiente' and cc.intentos<6
     and cc.creado_en+interval '23 hours'>clock_timestamp() and cc.inicio_reserva=rr.inicio and rr.estado='confirmada' and rr.inicio>clock_timestamp(),
    'whatsapp_estado',coalesce(tt.whatsapp_estado,'sin_solicitar'),'whatsapp_autorizado',coalesce(tt.whatsapp_autorizado,false),
    'puede_preparar_whatsapp',coalesce(tt.whatsapp_autorizado,false) and cc.entrega_estado='rechazado'
     and cc.entrega_motivo in ('correo_rebotado','entrega_fallida') and rr.estado='confirmada' and rr.inicio>clock_timestamp()
     and coalesce(tt.whatsapp_estado,'sin_solicitar') in ('sin_solicitar','preparado','bloqueado'),
    'puede_revisar_whatsapp',tt.whatsapp_sid is not null,'puede_operar',rol in ('propietario','encargado')) as fila
   from public.reservas rr join contactia_privado.correos_reserva_web cc on cc.reserva_id=rr.id
   left join contactia_privado.contactos_reserva_web tt on tt.reserva_id=rr.id
   where rr.restaurante_id=p_restaurante order by rr.creado_en desc,rr.id desc limit 50
  ) f;
  return jsonb_build_object('avisos',v);
 end if;
 if rol not in ('propietario','encargado') then raise exception 'ACCESO_NO_PERMITIDO' using errcode='42501';end if;
 if p_accion is null or p_accion not in ('consultar_correo','reintentar_correo','preparar_whatsapp','enviar_whatsapp','consultar_whatsapp') then
  raise exception 'DATOS_INVALIDOS' using errcode='22023';end if;
 select * into r from public.reservas where id=p_reserva and restaurante_id=p_restaurante for update;
 if not found then raise exception 'NO_DISPONIBLE' using errcode='P0002';end if;
 select * into c from contactia_privado.correos_reserva_web where reserva_id=r.id for update;
 if not found then raise exception 'NO_DISPONIBLE' using errcode='P0002';end if;
 insert into contactia_privado.contactos_reserva_web(reserva_id) values(r.id) on conflict do nothing;
 select * into strict t from contactia_privado.contactos_reserva_web where reserva_id=r.id for update;
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
  if not t.whatsapp_autorizado or c.entrega_estado is distinct from 'rechazado' or
   c.entrega_motivo is null or c.entrega_motivo not in ('correo_rebotado','entrega_fallida') or
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
  'id_proveedor',c.id_proveedor,'correo_estado',coalesce(c.entrega_estado,c.estado),'correo_motivo',c.entrega_motivo,
  'consentimiento_en',t.consentimiento_en,'whatsapp_autorizado',t.whatsapp_autorizado,'datos',snap,
  'whatsapp_sid',t.whatsapp_sid,'whatsapp_estado',t.whatsapp_estado,'whatsapp_proveedor',t.whatsapp_proveedor);
end $$;

create function public.finalizar_aviso_web(p_reserva uuid,p_operacion uuid,p_resultado jsonb)
returns boolean language plpgsql security invoker set search_path='' as $$
declare t contactia_privado.contactos_reserva_web; anterior text;
begin
 select * into t from contactia_privado.contactos_reserva_web where reserva_id=p_reserva for update;
 if not found or t.operacion is distinct from p_operacion or t.operacion_hasta is null then return false;end if;
 if p_resultado is null or jsonb_typeof(p_resultado)<>'object' or (p_resultado-'estado'-'motivo'-'evento'-'sid')<>'{}'::jsonb then
  raise exception 'DATOS_INVALIDOS' using errcode='22023';end if;
 if t.operacion_accion='consultar_correo' and p_resultado ? 'estado' then
  if p_resultado->>'estado' not in ('aceptado','entregado','demorado','rechazado') or
   coalesce(p_resultado->>'evento','') not in ('sent','scheduled','opened','clicked','delivered','delivery_delayed','bounced','failed','suppressed','complained','desconocido') or
   coalesce(p_resultado->>'motivo','') not in ('aceptado_proveedor','entregado_servidor','entrega_demorada','correo_rebotado','entrega_fallida','correo_suprimido','queja_destinatario') then
   raise exception 'DATOS_INVALIDOS' using errcode='22023';end if;
  select entrega_estado into anterior from contactia_privado.correos_reserva_web where reserva_id=p_reserva for update;
  if not (coalesce(anterior,'')='entregado' and p_resultado->>'estado' in ('aceptado','demorado')) and not (coalesce(anterior,'')='rechazado' and p_resultado->>'estado'<>'rechazado') then
   update contactia_privado.correos_reserva_web set entrega_estado=p_resultado->>'estado',entrega_motivo=p_resultado->>'motivo',
    evento_proveedor=p_resultado->>'evento' where reserva_id=p_reserva;
  end if;
 elsif t.operacion_accion in ('enviar_whatsapp','consultar_whatsapp') and p_resultado ? 'estado' then
  if p_resultado->>'estado' not in ('aceptado','entregado','fallido','incierto','bloqueado') or
   (p_resultado ? 'sid' and p_resultado->>'sid' !~ '^(SM|MM)[a-fA-F0-9]{32}$') or
   (p_resultado->>'estado' in ('aceptado','entregado') and coalesce(p_resultado->>'sid',t.whatsapp_sid) is null) then
   raise exception 'DATOS_INVALIDOS' using errcode='22023';end if;
  if t.operacion_accion='consultar_whatsapp' and p_resultado ? 'sid' and p_resultado->>'sid' is distinct from t.whatsapp_sid then
   raise exception 'SID_AJENO' using errcode='22023';end if;
  if not (t.whatsapp_estado='entregado' and p_resultado->>'estado'<>'entregado') and not(t.whatsapp_estado='fallido' and p_resultado->>'estado'='aceptado') then
   update contactia_privado.contactos_reserva_web set whatsapp_estado=p_resultado->>'estado',
    whatsapp_sid=coalesce(p_resultado->>'sid',whatsapp_sid),whatsapp_proveedor=p_resultado->>'evento' where reserva_id=p_reserva;
  end if;
 end if;
 update contactia_privado.contactos_reserva_web set operacion_hasta=null,actualizado_en=clock_timestamp() where reserva_id=p_reserva;
 return true;
end $$;

revoke all on function public.reservar_web_con_avisos(text,uuid,uuid,date,time,integer,text,text,text,text,text,boolean) from public,anon,authenticated,service_role;
revoke all on function public.avisos_web_panel(uuid,bigint,uuid,text) from public,anon,authenticated,service_role;
revoke all on function public.finalizar_aviso_web(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.reservar_web_con_avisos(text,uuid,uuid,date,time,integer,text,text,text,text,text,boolean) to service_role;
grant execute on function public.avisos_web_panel(uuid,bigint,uuid,text) to service_role;
grant execute on function public.finalizar_aviso_web(uuid,uuid,jsonb) to service_role;
commit;
