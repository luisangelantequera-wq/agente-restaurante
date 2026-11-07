begin;
create table contactia_privado.correos_gestion_reserva (
 id uuid primary key references contactia_privado.operaciones_gestion(id) on delete cascade,
 secuencia bigint generated always as identity unique,
 reserva_id uuid not null references public.reservas(id) on delete cascade,
 restaurante_id bigint not null references public.restaurantes(id),
 enlace_hash text not null references contactia_privado.enlaces_gestion(hash) on delete cascade,
 datos jsonb not null, creado_en timestamptz not null default clock_timestamp(),
 estado text not null default 'pendiente' check(estado in ('pendiente','aceptado','omitido','rechazado','revision')),
 intentos integer not null default 0 check(intentos between 0 and 6),
 intento uuid, bloqueado_hasta timestamptz, id_proveedor text,
 entrega_estado text check(entrega_estado in ('aceptado','entregado','demorado','rechazado')),
 revisado_en timestamptz, actualizado_en timestamptz not null default clock_timestamp()
);
create index correos_gestion_por_reserva on contactia_privado.correos_gestion_reserva(reserva_id,secuencia desc);
create index correos_gestion_por_restaurante on contactia_privado.correos_gestion_reserva(restaurante_id,secuencia desc);
create index correos_gestion_por_enlace on contactia_privado.correos_gestion_reserva(enlace_hash);
alter table contactia_privado.correos_gestion_reserva enable row level security;
revoke all on contactia_privado.correos_gestion_reserva from public,anon,authenticated;
grant all on contactia_privado.correos_gestion_reserva to service_role;
grant usage,select on sequence contactia_privado.correos_gestion_reserva_secuencia_seq to service_role;

-- Cambio y aviso se registran juntos; una operación antigua nunca genera avisos retroactivos.
create function public.gestionar_reserva_con_correo(p_slug text,p_hash text,p_accion text,p_operacion uuid,
 p_fecha date default null,p_hora time default null,p_inicio_anterior timestamptz default null,
 p_personas integer default null,p_personas_anteriores integer default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare antes jsonb; despues jsonb; existia boolean; v public.reservas; datos jsonb; contador integer;
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
  datos:=despues||jsonb_build_object('version',1,'slug',p_slug,'peticion_id',v.peticion_id,'email',v.email,
   'gestion_contador',contador,'accion',case when p_accion='cancelar' then 'cancelada' else 'modificada' end);
  insert into contactia_privado.correos_gestion_reserva(id,reserva_id,restaurante_id,enlace_hash,datos)
   values(p_operacion,v.id,v.restaurante_id,p_hash,datos);
 end if;
 return despues||jsonb_build_object('correo_gestion_id',(select id from contactia_privado.correos_gestion_reserva where id=p_operacion and enlace_hash=p_hash));
end $$;

create function public.preparar_correo_gestion(p_aviso uuid,p_hash text,p_remitente text,p_hostname text,p_permitidos text[])
returns jsonb language plpgsql security invoker set search_path='' as $$
declare c contactia_privado.correos_gestion_reserva; v public.reservas; e contactia_privado.enlaces_gestion; rid uuid;
begin
 if p_aviso is null or p_hash is null or p_hash !~ '^[a-f0-9]{64}$' or p_remitente is null or length(p_remitente) not between 3 and 300
  or p_remitente ~ E'[\\r\\n]' or p_hostname is null or p_hostname !~ '^[a-z0-9.-]+$' or p_permitidos is null or cardinality(p_permitidos) not between 1 and 20 then
  raise exception 'DATOS_INVALIDOS' using errcode='22023';end if;
 select reserva_id into rid from contactia_privado.correos_gestion_reserva where id=p_aviso and enlace_hash=p_hash;
 if not found then raise exception 'AVISO_NO_DISPONIBLE' using errcode='P0002';end if;
 select * into strict v from public.reservas where id=rid for share;
 select * into strict c from contactia_privado.correos_gestion_reserva where id=p_aviso for update;
 if c.estado in ('aceptado','rechazado','revision') then return jsonb_build_object('estado',c.estado);end if;
 select * into strict e from contactia_privado.enlaces_gestion where hash=p_hash for share;
 if e.revocado or e.expira_en<=clock_timestamp() or c.creado_en+interval '23 hours'<=clock_timestamp() or c.intentos>=6
  or c.datos->>'email'<>v.email or c.datos->>'estado'<>v.estado or (c.datos->>'inicio')::timestamptz<>v.inicio or (c.datos->>'personas')::integer<>v.personas
  or exists(select 1 from contactia_privado.correos_gestion_reserva n where n.reserva_id=v.id and n.secuencia>c.secuencia) then
  update contactia_privado.correos_gestion_reserva set estado='revision',actualizado_en=clock_timestamp() where id=c.id;
  return jsonb_build_object('estado','revision');end if;
 if v.email='' or not coalesce(lower(v.email)=any(p_permitidos),false) then
  update contactia_privado.correos_gestion_reserva set estado='omitido',actualizado_en=clock_timestamp() where id=c.id;
  return jsonb_build_object('estado','omitido');end if;
 if c.bloqueado_hasta>clock_timestamp() then return jsonb_build_object('estado','pendiente');end if;
 update contactia_privado.correos_gestion_reserva set estado='pendiente',intentos=intentos+1,intento=gen_random_uuid(),
  bloqueado_hasta=clock_timestamp()+interval '30 seconds',actualizado_en=clock_timestamp(),
  datos=case when datos ? 'remitente' then datos else datos||jsonb_build_object('remitente',p_remitente,'hostname',p_hostname) end
  where id=c.id returning * into c;
 return jsonb_build_object('estado','enviar','id',c.id,'intento',c.intento,'enlace_hash',c.enlace_hash,'datos',c.datos);
end $$;

create function public.finalizar_correo_gestion(p_aviso uuid,p_intento uuid,p_estado text,p_id_proveedor text default null)
returns boolean language plpgsql security invoker set search_path='' as $$
begin
 if p_estado is null or p_estado not in ('pendiente','aceptado','rechazado','revision') or
  (p_estado='aceptado' and (p_id_proveedor is null or length(p_id_proveedor) not between 1 and 100)) or
  (p_estado<>'aceptado' and p_id_proveedor is not null) then raise exception 'DATOS_INVALIDOS' using errcode='22023';end if;
 update contactia_privado.correos_gestion_reserva set estado=p_estado,id_proveedor=p_id_proveedor,bloqueado_hasta=null,actualizado_en=clock_timestamp()
 where id=p_aviso and intento=p_intento and estado='pendiente';return found;
end $$;

-- El panel usa Auth.getUser(); se comprueban rol, pertenencia y estado activo en SQL.
create function public.correos_gestion_panel(p_usuario uuid,p_restaurante bigint,p_accion text default 'listar_gestion',p_aviso uuid default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare c contactia_privado.correos_gestion_reserva; filas jsonb;
begin
 if p_usuario is null or not exists(select 1 from public.restaurante_usuarios where usuario_id=p_usuario and restaurante_id=p_restaurante and activo and rol in ('propietario','encargado')) then
  raise exception 'ACCESO_NO_PERMITIDO' using errcode='42501';end if;
 if p_accion='listar_gestion' and p_aviso is null then
  select coalesce(jsonb_agg(f.fila order by f.secuencia desc),'[]'::jsonb) into filas from (
   select secuencia,jsonb_build_object('aviso_id',cc.id,'nombre',cc.datos->>'nombre','tipo',cc.datos->>'accion','fecha',cc.datos->>'fecha','hora',cc.datos->>'hora','creado_en',cc.creado_en,
    'estado',coalesce(cc.entrega_estado,cc.estado),'puede_revisar',cc.id_proveedor is not null,
    'puede_reintentar',cc.estado in ('pendiente','omitido') and cc.datos->>'email'<>'' and cc.creado_en+interval '23 hours'>clock_timestamp() and cc.intentos<6
      and coalesce(cc.bloqueado_hasta<=clock_timestamp(),true) and not exists(select 1 from contactia_privado.correos_gestion_reserva n where n.reserva_id=cc.reserva_id and n.secuencia>cc.secuencia)) as fila
   from contactia_privado.correos_gestion_reserva cc where cc.restaurante_id=p_restaurante order by secuencia desc limit 50
  ) f;
  return jsonb_build_object('avisos',filas);
 end if;
 if p_accion not in ('reintentar_gestion','consultar_gestion') or p_accion is null or p_aviso is null then raise exception 'DATOS_INVALIDOS' using errcode='22023';end if;
 select * into c from contactia_privado.correos_gestion_reserva where id=p_aviso and restaurante_id=p_restaurante for update;
 if not found then raise exception 'AVISO_NO_DISPONIBLE' using errcode='P0002';end if;
 if p_accion='consultar_gestion' then
  if c.id_proveedor is null or c.revisado_en>clock_timestamp()-interval '30 seconds' then raise exception 'ESPERE_REVISION' using errcode='55000';end if;
  update contactia_privado.correos_gestion_reserva set revisado_en=clock_timestamp() where id=c.id;
 end if;
 return jsonb_build_object('aviso_id',c.id,'slug',c.datos->>'slug','enlace_hash',c.enlace_hash,'id_proveedor',c.id_proveedor,'entrega_estado',c.entrega_estado);
end $$;

create function public.entrega_correo_gestion(p_aviso uuid,p_id_proveedor text,p_estado text)
returns boolean language plpgsql security invoker set search_path='' as $$
begin
 if p_estado is null or p_estado not in ('aceptado','entregado','demorado','rechazado') then raise exception 'DATOS_INVALIDOS' using errcode='22023';end if;
 update contactia_privado.correos_gestion_reserva set entrega_estado=case when entrega_estado='entregado' and p_estado in ('aceptado','demorado') then entrega_estado else p_estado end,
  actualizado_en=clock_timestamp() where id=p_aviso and id_proveedor=p_id_proveedor and estado='aceptado';return found;
end $$;
revoke all on function public.gestionar_reserva_con_correo(text,text,text,uuid,date,time,timestamptz,integer,integer),
 public.preparar_correo_gestion(uuid,text,text,text,text[]),public.finalizar_correo_gestion(uuid,uuid,text,text),
 public.correos_gestion_panel(uuid,bigint,text,uuid),public.entrega_correo_gestion(uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function public.gestionar_reserva_con_correo(text,text,text,uuid,date,time,timestamptz,integer,integer),
 public.preparar_correo_gestion(uuid,text,text,text,text[]),public.finalizar_correo_gestion(uuid,uuid,text,text),
 public.correos_gestion_panel(uuid,bigint,text,uuid),public.entrega_correo_gestion(uuid,text,text) to service_role;
commit;
