begin;
create table contactia_privado.codigos_gestion_voz (
 reserva_id uuid primary key references public.reservas(id) on delete cascade,
 restaurante_id bigint not null references public.restaurantes(id) on delete cascade,
 enlace_hash text not null references contactia_privado.enlaces_gestion(hash) on delete cascade,
 telefono_original text not null,
 telefono_hash text not null check(telefono_hash ~ '^[a-f0-9]{64}$'),
 codigo_hash text not null check(codigo_hash ~ '^[a-f0-9]{64}$'),
 contador integer not null check(contador between 0 and 15),
 creado_en timestamptz not null default clock_timestamp(),
 unique(restaurante_id,telefono_hash,codigo_hash)
);
create index codigos_gestion_por_enlace on contactia_privado.codigos_gestion_voz(enlace_hash);
create table contactia_privado.intentos_gestion_voz (
 clave text primary key, ventana timestamptz not null default clock_timestamp(), intentos integer not null default 0
);
alter table contactia_privado.codigos_gestion_voz enable row level security;
alter table contactia_privado.intentos_gestion_voz enable row level security;
revoke all on contactia_privado.codigos_gestion_voz,contactia_privado.intentos_gestion_voz from public,anon,authenticated;
grant all on contactia_privado.codigos_gestion_voz,contactia_privado.intentos_gestion_voz to service_role;

create function public.registrar_codigo_gestion_voz(p_slug text,p_peticion uuid,p_enlace text,p_telefono text,p_candidatos jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare r public.reservas; c contactia_privado.codigos_gestion_voz; candidato jsonb;
begin
 if p_telefono is null or p_telefono !~ '^[a-f0-9]{64}$' or jsonb_typeof(p_candidatos) is distinct from 'array' or jsonb_array_length(p_candidatos)<>16 then
  raise exception 'DATOS_INVALIDOS' using errcode='22023';end if;
 select rr.* into r from public.reservas rr join public.restaurantes rest on rest.id=rr.restaurante_id where rest.slug=p_slug and rr.peticion_id=p_peticion for update of rr;
 if not found or not exists(select 1 from contactia_privado.enlaces_gestion where reserva_id=r.id and hash=p_enlace and not revocado and expira_en>clock_timestamp()) then
  raise exception 'NO_DISPONIBLE' using errcode='P0002';end if;
 select * into c from contactia_privado.codigos_gestion_voz where reserva_id=r.id;
 if found then
  if c.telefono_hash<>p_telefono or c.enlace_hash<>p_enlace then raise exception 'DATOS_CAMBIADOS' using errcode='22023';end if;
  return jsonb_build_object('contador',c.contador);end if;
 for candidato in select value from jsonb_array_elements(p_candidatos) loop
  if coalesce(candidato->>'hash','') !~ '^[a-f0-9]{64}$' or coalesce(candidato->>'contador','') !~ '^([0-9]|1[0-5])$' then
   raise exception 'DATOS_INVALIDOS' using errcode='22023';end if;
  begin
   insert into contactia_privado.codigos_gestion_voz(reserva_id,restaurante_id,enlace_hash,telefono_original,telefono_hash,codigo_hash,contador)
    values(r.id,r.restaurante_id,p_enlace,r.telefono,p_telefono,candidato->>'hash',(candidato->>'contador')::integer);
   return jsonb_build_object('contador',(candidato->>'contador')::integer);
  exception when unique_violation then null;end;
 end loop;
 raise exception 'CODIGO_NO_DISPONIBLE' using errcode='55000';
end $$;

create function public.autenticar_gestion_voz(p_slug text,p_telefono text,p_codigo text,p_origen text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare rest bigint; k text; limite integer; n integer; v contactia_privado.codigos_gestion_voz; d jsonb;
begin
 if p_telefono is null or p_codigo is null or p_origen is null or p_telefono !~ '^[a-f0-9]{64}$' or p_codigo !~ '^[a-f0-9]{64}$' or p_origen !~ '^[a-f0-9]{64}$' then
  raise exception 'DATOS_INVALIDOS' using errcode='22023';end if;
 select id into rest from public.restaurantes where slug=p_slug and reservas_web_activas;
 if not found then return jsonb_build_object('ok',false);end if;
 -- Contadores en base de datos; el del teléfono persiste entre nuevas llamadas.
 for k in select unnest(array['o:'||rest||':'||p_origen,'t:'||rest||':'||p_telefono]) order by 1 loop
  insert into contactia_privado.intentos_gestion_voz(clave) values(k) on conflict do nothing;
  perform 1 from contactia_privado.intentos_gestion_voz where clave=k for update;
  update contactia_privado.intentos_gestion_voz set intentos=0,ventana=clock_timestamp() where clave=k and ventana<=clock_timestamp()-interval '15 minutes';
  select intentos into n from contactia_privado.intentos_gestion_voz where clave=k;
  limite:=case when left(k,2)='t:' then 5 else 10 end;
  if n>=limite then return jsonb_build_object('ok',false,'limitado',true);end if;
 end loop;
 update contactia_privado.intentos_gestion_voz set intentos=intentos+1 where clave in ('o:'||rest||':'||p_origen,'t:'||rest||':'||p_telefono);
 select c.* into v from contactia_privado.codigos_gestion_voz c join public.reservas r on r.id=c.reserva_id
  join contactia_privado.enlaces_gestion e on e.hash=c.enlace_hash
  where c.restaurante_id=rest and c.telefono_hash=p_telefono and c.codigo_hash=p_codigo and r.telefono=c.telefono_original and r.inicio>clock_timestamp()
   and not e.revocado and e.expira_en>clock_timestamp();
 if not found then return jsonb_build_object('ok',false);end if;
 d:=public.gestionar_reserva_web(p_slug,v.enlace_hash,'consultar');
 return jsonb_build_object('ok',true,'enlace_hash',v.enlace_hash,'reserva',d);
end $$;
revoke all on function public.registrar_codigo_gestion_voz(text,uuid,text,text,jsonb),public.autenticar_gestion_voz(text,text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.registrar_codigo_gestion_voz(text,uuid,text,text,jsonb),public.autenticar_gestion_voz(text,text,text,text) to service_role;

create or replace function public.preparar_correo_reserva_web(p_slug text,p_peticion uuid,p_hash text,
 p_remitente text,p_hostname text,p_permitidos text[])
returns jsonb language plpgsql security invoker set search_path='' as $$
declare r public.restaurantes; v public.reservas; c contactia_privado.correos_reserva_web; z text; datos jsonb; lease uuid;
begin
 if p_hash is null or p_hash !~ '^[a-f0-9]{64}$' or p_remitente is null or length(p_remitente) not between 3 and 254
  or p_remitente ~ '[\r\n]' or p_hostname is null or p_hostname !~ '^[a-z0-9.-]+$'
  or p_permitidos is null or cardinality(p_permitidos) not between 1 and 10 then
  raise exception 'DATOS_INVALIDOS' using errcode='22023';end if;
 select * into r from public.restaurantes where slug=p_slug for share;
 if not found then raise exception 'NO_DISPONIBLE' using errcode='P0002';end if;
 select * into v from public.reservas where restaurante_id=r.id and peticion_id=p_peticion for update;
 if not found or not exists(select 1 from contactia_privado.enlaces_gestion where hash=p_hash
  and restaurante_id=r.id and reserva_id=v.id and not revocado and expira_en>clock_timestamp()) then
  raise exception 'NO_DISPONIBLE' using errcode='P0002';end if;
 if not coalesce(lower(v.email)=any(p_permitidos),false) or v.email='' then return jsonb_build_object('estado','omitido');end if;
 select * into c from contactia_privado.correos_reserva_web where reserva_id=v.id for update;
 if found and c.estado in ('aceptado','rechazado','revision') then return jsonb_build_object('estado',c.estado);end if;
 if v.estado<>'confirmada' or v.inicio<=clock_timestamp() or v.creado_en+interval '23 hours'<=clock_timestamp() then
  return jsonb_build_object('estado','revision');end if;
 if c.reserva_id is not null then
  if c.creado_en+interval '23 hours'<=clock_timestamp() or c.intentos>=6 or c.enlace_hash<>p_hash or c.inicio_reserva<>v.inicio or c.datos->>'email'<>v.email then
   update contactia_privado.correos_reserva_web set estado='revision',actualizado_en=clock_timestamp() where reserva_id=v.id;
   return jsonb_build_object('estado','revision');end if;
  if c.bloqueado_hasta>clock_timestamp() then return jsonb_build_object('estado','pendiente');end if;
 else
  select nombre into strict z from public.zonas where restaurante_id=r.id and id=v.zona_id;
  datos:=jsonb_build_object('gestion_contador',(select contador from contactia_privado.codigos_gestion_voz where reserva_id=v.id),'peticion_id',v.peticion_id,'version',1,'slug',r.slug,'restaurante',r.nombre,'nombre',v.nombre,'email',v.email,
   'fecha',to_char(v.inicio at time zone r.zona_horaria,'YYYY-MM-DD'),'hora',to_char(v.inicio at time zone r.zona_horaria,'HH24:MI'),
   'personas',v.personas,'zona',z,'referencia','PRUEBA-'||v.id::text,'remitente',p_remitente,'hostname',p_hostname);
  insert into contactia_privado.correos_reserva_web(reserva_id,enlace_hash,datos,inicio_reserva)
   values(v.id,p_hash,datos,v.inicio);
 end if;
 lease:=gen_random_uuid();
 update contactia_privado.correos_reserva_web set intentos=intentos+1,intento=lease,
  bloqueado_hasta=clock_timestamp()+interval '30 seconds',actualizado_en=clock_timestamp() where reserva_id=v.id
  returning * into c;
 return jsonb_build_object('estado','enviar','reserva_id',v.id,'intento',lease,'datos',c.datos);
end $$;

create or replace function public.whatsapp_voz_sin_correo(p_reserva uuid,p_hash text,p_accion text)
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
 snap:=jsonb_build_object('gestion_contador',(select contador from contactia_privado.codigos_gestion_voz where reserva_id=r.id),'peticion_id',r.peticion_id,'slug',rest.slug,'nombre',r.nombre,'restaurante',rest.nombre,'fecha',to_char(r.inicio at time zone rest.zona_horaria,'YYYY-MM-DD'),
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
 snap:=jsonb_build_object('gestion_contador',(select contador from contactia_privado.codigos_gestion_voz where reserva_id=r.id),'peticion_id',r.peticion_id,'slug',rest.slug,'nombre',r.nombre,'restaurante',rest.nombre,'fecha',to_char(r.inicio at time zone rest.zona_horaria,'YYYY-MM-DD'),
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
