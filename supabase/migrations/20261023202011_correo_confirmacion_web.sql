begin;
create table contactia_privado.correos_reserva_web (
 reserva_id uuid primary key references public.reservas(id) on delete cascade,
 enlace_hash text not null references contactia_privado.enlaces_gestion(hash),
 datos jsonb not null,
 inicio_reserva timestamptz not null,
 estado text not null default 'pendiente' check(estado in ('pendiente','aceptado','rechazado','revision')),
 creado_en timestamptz not null default clock_timestamp(),
 actualizado_en timestamptz not null default clock_timestamp(),
 intentos integer not null default 0 check(intentos between 0 and 6),
 intento uuid,
 bloqueado_hasta timestamptz,
 id_proveedor text check(length(id_proveedor)<=100)
);
alter table contactia_privado.correos_reserva_web enable row level security;
revoke all on contactia_privado.correos_reserva_web from public,anon,authenticated;
grant all on contactia_privado.correos_reserva_web to service_role;
create index correos_reserva_por_enlace on contactia_privado.correos_reserva_web(enlace_hash);

-- Solo el servidor puede reclamar un envío. La dirección procede de la reserva,
-- y el enlace continúa almacenado únicamente como hash, nunca como credencial.
create function public.preparar_correo_reserva_web(p_slug text,p_peticion uuid,p_hash text,
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
  datos:=jsonb_build_object('version',1,'slug',r.slug,'restaurante',r.nombre,'nombre',v.nombre,'email',v.email,
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

create function public.finalizar_correo_reserva_web(p_reserva uuid,p_intento uuid,p_estado text,p_id_proveedor text default null)
returns boolean language plpgsql security invoker set search_path='' as $$
begin
 if p_estado is null or p_estado not in ('pendiente','aceptado','rechazado','revision') or
  (p_estado='aceptado' and (p_id_proveedor is null or length(p_id_proveedor) not between 1 and 100)) or
  (p_estado<>'aceptado' and p_id_proveedor is not null) then raise exception 'DATOS_INVALIDOS' using errcode='22023';end if;
 update contactia_privado.correos_reserva_web set estado=p_estado,id_proveedor=p_id_proveedor,actualizado_en=clock_timestamp()
 where reserva_id=p_reserva and intento=p_intento and estado='pendiente';
 return found;
end $$;
revoke all on function public.preparar_correo_reserva_web(text,uuid,text,text,text,text[]) from public,anon,authenticated,service_role;
revoke all on function public.finalizar_correo_reserva_web(uuid,uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function public.preparar_correo_reserva_web(text,uuid,text,text,text,text[]) to service_role;
grant execute on function public.finalizar_correo_reserva_web(uuid,uuid,text,text) to service_role;
commit;
