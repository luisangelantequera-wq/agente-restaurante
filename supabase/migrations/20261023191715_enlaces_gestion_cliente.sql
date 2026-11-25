begin;
-- Solo se almacena SHA-256 del secreto del enlace; nunca el enlace completo.
create table contactia_privado.enlaces_gestion (
 hash text primary key check(hash ~ '^[a-f0-9]{64}$'),
 restaurante_id bigint not null,
 reserva_id uuid not null,
 creado_en timestamptz not null default now(),
 expira_en timestamptz not null default (now()+interval '400 days'),
 revocado boolean not null default false,
 foreign key(restaurante_id,reserva_id) references public.reservas(restaurante_id,id) on delete cascade
);
create index enlaces_por_reserva on contactia_privado.enlaces_gestion(restaurante_id,reserva_id);
create table contactia_privado.operaciones_gestion (
 id uuid primary key,
 enlace_hash text not null references contactia_privado.enlaces_gestion(hash) on delete cascade,
 solicitud jsonb not null,
 creado_en timestamptz not null default now()
);
create index operaciones_por_enlace on contactia_privado.operaciones_gestion(enlace_hash);
alter table contactia_privado.enlaces_gestion enable row level security;
alter table contactia_privado.operaciones_gestion enable row level security;
revoke all on contactia_privado.enlaces_gestion,contactia_privado.operaciones_gestion from public,anon,authenticated;
grant all on contactia_privado.enlaces_gestion,contactia_privado.operaciones_gestion to service_role;

-- Reserva y autorización del enlace se confirman en la misma transacción.
create function public.reservar_web_con_gestion(p_slug text,p_peticion uuid,p_zona uuid,p_fecha date,p_hora time,
 p_personas integer,p_nombre text,p_email text,p_telefono text,p_observaciones text,p_hash text)
returns uuid language plpgsql security invoker set search_path='' as $$
declare rid uuid; restaurante bigint;
begin
 if p_hash is null or p_hash !~ '^[a-f0-9]{64}$' then raise exception 'DATOS_INVALIDOS' using errcode='22023';end if;
 rid:=public.reservar_web(p_slug,p_peticion,p_zona,p_fecha,p_hora,p_personas,p_nombre,p_email,p_telefono,p_observaciones);
 select restaurante_id into strict restaurante from public.reservas where id=rid;
 insert into contactia_privado.enlaces_gestion(hash,restaurante_id,reserva_id) values(p_hash,restaurante,rid)
 on conflict(hash) do nothing;
 if not exists(select 1 from contactia_privado.enlaces_gestion where hash=p_hash and restaurante_id=restaurante and reserva_id=rid) then
  raise exception 'ENLACE_INVALIDO' using errcode='22023';end if;
 return rid;
end $$;
revoke all on function public.reservar_web_con_gestion(text,uuid,uuid,date,time,integer,text,text,text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.reservar_web_con_gestion(text,uuid,uuid,date,time,integer,text,text,text,text,text) to service_role;

create function public.gestionar_reserva_web(p_slug text,p_hash text,p_accion text default 'consultar',p_operacion uuid default null,
 p_fecha date default null,p_hora time default null,p_inicio_anterior timestamptz default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare enlace contactia_privado.enlaces_gestion; r public.restaurantes; reserva public.reservas;
 previo contactia_privado.operaciones_gestion; solicitud jsonb; instante timestamptz; zona text;
begin
 if p_hash is null or p_hash !~ '^[a-f0-9]{64}$' or p_accion is null or p_accion not in ('consultar','cancelar','reprogramar') then
  raise exception 'DATOS_INVALIDOS' using errcode='22023';end if;
 select * into enlace from contactia_privado.enlaces_gestion where hash=p_hash;
 if not found then raise exception 'ENLACE_NO_DISPONIBLE' using errcode='P0002';end if;
 select * into r from public.restaurantes where id=enlace.restaurante_id and slug=p_slug for share;
 if not found then raise exception 'ENLACE_NO_DISPONIBLE' using errcode='P0002';end if;
 select * into strict enlace from contactia_privado.enlaces_gestion where hash=p_hash for share;
 select * into reserva from public.reservas where restaurante_id=r.id and id=enlace.reserva_id for update;
 if not found or enlace.revocado or enlace.expira_en<=clock_timestamp() or reserva.fin+interval '24 hours'<=clock_timestamp() then
  raise exception 'ENLACE_NO_DISPONIBLE' using errcode='P0002';end if;
 if p_accion='consultar' then
  if p_operacion is not null or p_fecha is not null or p_hora is not null or p_inicio_anterior is not null then
   raise exception 'DATOS_INVALIDOS' using errcode='22023';end if;
 else
  if p_accion='cancelar' and (p_fecha is not null or p_hora is not null) then raise exception 'DATOS_INVALIDOS' using errcode='22023';end if;
  if p_operacion is null or p_inicio_anterior is null or not isfinite(p_inicio_anterior) then
   raise exception 'DATOS_INVALIDOS' using errcode='22023';end if;
  solicitud:=jsonb_build_object('accion',p_accion,'fecha',p_fecha,'hora',p_hora,'inicio_anterior',p_inicio_anterior);
  select * into previo from contactia_privado.operaciones_gestion where id=p_operacion;
  if found then
   if previo.enlace_hash<>p_hash or previo.solicitud<>solicitud then raise exception 'OPERACION_REUTILIZADA' using errcode='22023';end if;
   -- Reintento de una operación ya confirmada: devolver estado actual sin volver a escribir.
  else
   if p_accion='cancelar' and reserva.estado='cancelada' then null;
   else
    if reserva.inicio<>p_inicio_anterior then raise exception 'RESERVA_MODIFICADA' using errcode='40001';end if;
    if reserva.inicio<=clock_timestamp() then raise exception 'ESTADO_NO_MODIFICABLE' using errcode='55000';end if;
    if p_accion='cancelar' then
     if reserva.estado not in ('confirmada','con retraso') then raise exception 'ESTADO_NO_MODIFICABLE' using errcode='55000';end if;
     perform public.cancelar_reserva(r.id,reserva.id);
     update public.reservas set cancelado_por=null,cancelado_en=now() where id=reserva.id;
    else
     if reserva.estado<>'confirmada' then raise exception 'ESTADO_NO_MODIFICABLE' using errcode='55000';end if;
     instante:=contactia_privado.validar_horario_reserva(r.id,p_fecha,p_hora);
     if not public.reprogramar_reserva(r.id,reserva.id,instante) then raise exception 'ESTADO_NO_MODIFICABLE' using errcode='55000';end if;
     update public.reservas set reprogramado_por=null,reprogramado_en=now() where id=reserva.id;
    end if;
   end if;
   insert into contactia_privado.operaciones_gestion(id,enlace_hash,solicitud) values(p_operacion,p_hash,solicitud);
   select * into strict reserva from public.reservas where id=reserva.id;
  end if;
 end if;
 select nombre into strict zona from public.zonas where id=reserva.zona_id;
 return jsonb_build_object('referencia','PRUEBA-'||reserva.id::text,'restaurante',r.nombre,'nombre',reserva.nombre,
  'fecha',to_char(reserva.inicio at time zone r.zona_horaria,'YYYY-MM-DD'),'hora',to_char(reserva.inicio at time zone r.zona_horaria,'HH24:MI'),
  'personas',reserva.personas,'zona',zona,'estado',reserva.estado,'inicio',reserva.inicio,
  'puede_cambiar',reserva.estado='confirmada' and reserva.inicio>clock_timestamp(),
  'puede_cancelar',reserva.estado in ('confirmada','con retraso') and reserva.inicio>clock_timestamp());
end $$;
revoke all on function public.gestionar_reserva_web(text,text,text,uuid,date,time,timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.gestionar_reserva_web(text,text,text,uuid,date,time,timestamptz) to service_role;
commit;
