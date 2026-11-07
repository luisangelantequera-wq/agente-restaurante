-- Motor de reservas de desarrollo. Las escrituras solo se permiten al servidor.
begin;
create extension if not exists btree_gist;

create table public.combinaciones_mesas (
 id uuid primary key default gen_random_uuid(),
 restaurante_id bigint not null references public.restaurantes(id),
 zona_id uuid not null,
 nombre text not null check(length(trim(nombre)) between 1 and 100),
 min_personas integer not null check(min_personas > 0),
 max_personas integer not null check(max_personas >= min_personas),
 activa boolean not null default true,
 unique(restaurante_id,id),
 foreign key(restaurante_id,zona_id) references public.zonas(restaurante_id,id)
);
create index combinaciones_por_zona on public.combinaciones_mesas(restaurante_id,zona_id);
create table public.combinacion_mesas (
 restaurante_id bigint not null,
 combinacion_id uuid not null,
 mesa_id uuid not null,
 primary key(combinacion_id,mesa_id),
 foreign key(restaurante_id,combinacion_id) references public.combinaciones_mesas(restaurante_id,id) on delete cascade,
 foreign key(restaurante_id,mesa_id) references public.mesas(restaurante_id,id)
);
create index combinacion_por_mesa on public.combinacion_mesas(restaurante_id,mesa_id);

create table public.reservas (
 id uuid primary key default gen_random_uuid(),
 restaurante_id bigint not null references public.restaurantes(id),
 zona_id uuid not null,
 peticion_id uuid not null,
 inicio timestamptz not null check(isfinite(inicio)),
 fin timestamptz not null check(isfinite(fin) and fin > inicio),
 personas integer not null check(personas between 1 and 1000),
 nombre text not null check(length(trim(nombre)) between 1 and 200),
 email text not null default '' check(length(email)<=254),
 telefono text not null default '' check(length(telefono)<=40),
 observaciones text not null default '' check(length(observaciones)<=4000),
 estado text not null default 'confirmada' check(estado in ('confirmada','ocupada','con retraso','cobrada','cancelada')),
 creado_en timestamptz not null default now(),
 unique(restaurante_id,id),
 unique(restaurante_id,peticion_id),
 foreign key(restaurante_id,zona_id) references public.zonas(restaurante_id,id)
);
create index reservas_por_fecha on public.reservas(restaurante_id,inicio);
create index reservas_por_zona on public.reservas(restaurante_id,zona_id);
create table public.reserva_mesas (
 restaurante_id bigint not null,
 reserva_id uuid not null,
 mesa_id uuid not null,
 periodo tstzrange not null,
 activa boolean not null,
 primary key(reserva_id,mesa_id),
 foreign key(restaurante_id,reserva_id) references public.reservas(restaurante_id,id) on delete cascade,
 foreign key(restaurante_id,mesa_id) references public.mesas(restaurante_id,id),
 constraint mesa_sin_solapamiento exclude using gist (mesa_id with =, periodo with &&) where (activa)
);
create index ocupacion_por_mesa on public.reserva_mesas(restaurante_id,mesa_id);

-- La ocupación siempre deriva de la reserva, nunca de valores enviados por el cliente.
create function contactia_privado.derivar_ocupacion() returns trigger
language plpgsql security invoker set search_path='' as $$
declare r public.reservas; z uuid;
begin
 select * into strict r from public.reservas where id=new.reserva_id and restaurante_id=new.restaurante_id for share;
 select zona_id into strict z from public.mesas where id=new.mesa_id and restaurante_id=new.restaurante_id for share;
 if z<>r.zona_id then raise exception 'La mesa pertenece a otra zona' using errcode='22023'; end if;
 new.periodo:=tstzrange(r.inicio,r.fin,'[)');
 new.activa:=r.estado<>'cancelada';
 return new;
end $$;
create trigger derivar_ocupacion before insert or update on public.reserva_mesas
 for each row execute function contactia_privado.derivar_ocupacion();

create function contactia_privado.actualizar_ocupacion() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 update public.reserva_mesas set periodo=tstzrange(new.inicio,new.fin,'[)'),activa=new.estado<>'cancelada'
 where reserva_id=new.id and restaurante_id=new.restaurante_id;
 return new;
end $$;
create trigger actualizar_ocupacion after update of inicio,fin,estado,zona_id on public.reservas
 for each row execute function contactia_privado.actualizar_ocupacion();

-- No se puede confirmar una reserva sin bloquear al menos una mesa.
create function contactia_privado.exigir_ocupacion() returns trigger
language plpgsql security invoker set search_path='' as $$
declare rid uuid;
begin
 if tg_table_name='reservas' then rid:=new.id;
 elsif tg_op='DELETE' then rid:=old.reserva_id;
 else rid:=new.reserva_id; end if;
 if exists(select 1 from public.reservas r where r.id=rid and r.estado<>'cancelada'
   and not exists(select 1 from public.reserva_mesas m where m.reserva_id=r.id and m.activa)) then
   raise exception 'Reserva activa sin ocupación' using errcode='23514';
 end if;
 if tg_table_name='reserva_mesas' then
 if tg_op='UPDATE' and old.reserva_id<>new.reserva_id then
   if exists(select 1 from public.reservas r where r.id=old.reserva_id and r.estado<>'cancelada'
     and not exists(select 1 from public.reserva_mesas m where m.reserva_id=r.id and m.activa)) then
     raise exception 'Reserva activa sin ocupación' using errcode='23514';
   end if;
 end if;
 end if;
 return null;
end $$;
create constraint trigger reserva_con_mesas after insert or update on public.reservas
 deferrable initially deferred for each row execute function contactia_privado.exigir_ocupacion();
create constraint trigger mantener_ocupacion after insert or update or delete on public.reserva_mesas
 deferrable initially deferred for each row execute function contactia_privado.exigir_ocupacion();

create function public.crear_reserva(
 p_restaurante bigint,p_peticion uuid,p_mesas uuid[],p_inicio timestamptz,p_personas integer,
 p_nombre text,p_email text default '',p_telefono text default '',p_observaciones text default ''
) returns uuid language plpgsql security invoker set search_path='' as $$
declare r public.restaurantes; z uuid; cantidad integer; capacidad integer; minimo integer;
 rid uuid; anterior public.reservas; ids uuid[]; combo uuid;
begin
 if p_mesas is null or cardinality(p_mesas) not between 1 and 20 or p_inicio is null
   or not isfinite(p_inicio) or p_peticion is null or p_personas is null
   or p_personas not between 1 and 1000 or p_nombre is null or length(trim(p_nombre)) not between 1 and 200
   or p_email is null or p_telefono is null or p_observaciones is null then
   raise exception 'Solicitud no válida' using errcode='22023'; end if;
 select array_agg(x order by x) into ids from unnest(p_mesas) x;
 if cardinality(ids)<>(select count(distinct x) from unnest(ids) x) then
   raise exception 'Mesas repetidas o nulas' using errcode='22023'; end if;
 select * into strict r from public.restaurantes where id=p_restaurante for share;
 -- Reintentos: misma solicitud y mismo contenido devuelven el mismo identificador.
 select * into anterior from public.reservas where restaurante_id=p_restaurante and peticion_id=p_peticion;
 if found then
   if anterior.inicio<>p_inicio or anterior.personas<>p_personas or anterior.nombre<>p_nombre
      or anterior.email<>p_email or anterior.telefono<>p_telefono or anterior.observaciones<>p_observaciones
      or ids<>(select array_agg(mesa_id order by mesa_id) from public.reserva_mesas where reserva_id=anterior.id) then
     raise exception 'Identificador de petición reutilizado con otros datos' using errcode='22023'; end if;
   return anterior.id;
 end if;
 if p_inicio < clock_timestamp()+make_interval(mins=>r.antelacion_minima_reserva_minutos) then
   raise exception 'No se cumple la antelación mínima' using errcode='22023'; end if;
 perform 1 from public.mesas where restaurante_id=p_restaurante and id=any(ids) order by id for share;
 select count(*),sum(m.capacidad),min(m.min_personas) into cantidad,capacidad,minimo
 from public.mesas m where m.restaurante_id=p_restaurante and m.id=any(ids) and m.estado='libre';
 if cantidad<>cardinality(ids) then raise exception 'Mesa no disponible' using errcode='22023'; end if;
 select zona_id into z from public.mesas where id=ids[1];
 if exists(select 1 from public.mesas where id=any(ids) and zona_id<>z) then
   raise exception 'No se pueden combinar zonas distintas' using errcode='22023'; end if;
 perform 1 from public.zonas where restaurante_id=p_restaurante and id=z and estado='activo' for share;
 if not found then raise exception 'Zona cerrada' using errcode='22023'; end if;
 if cardinality(ids)=1 then
   if p_personas<minimo or p_personas>capacidad then raise exception 'Capacidad no válida' using errcode='22023'; end if;
 else
   select c.id into combo from public.combinaciones_mesas c
   where c.restaurante_id=p_restaurante and c.zona_id=z and c.activa
    and p_personas between c.min_personas and c.max_personas and p_personas<=capacidad
    and ids=(select array_agg(cm.mesa_id order by cm.mesa_id) from public.combinacion_mesas cm where cm.combinacion_id=c.id)
   order by c.id limit 1 for share;
   if combo is null then raise exception 'Combinación no autorizada' using errcode='22023'; end if;
   perform 1 from public.combinacion_mesas where combinacion_id=combo order by mesa_id for share;
 end if;
 insert into public.reservas(restaurante_id,zona_id,peticion_id,inicio,fin,personas,nombre,email,telefono,observaciones)
 values(p_restaurante,z,p_peticion,p_inicio,p_inicio+make_interval(mins=>r.duracion_reserva_minutos),p_personas,p_nombre,p_email,p_telefono,p_observaciones)
 on conflict(restaurante_id,peticion_id) do nothing returning id into rid;
 if rid is null then
   -- La otra transacción pudo confirmar la misma petición mientras esperábamos.
   return public.crear_reserva(p_restaurante,p_peticion,ids,p_inicio,p_personas,p_nombre,p_email,p_telefono,p_observaciones);
 end if;
 insert into public.reserva_mesas(restaurante_id,reserva_id,mesa_id,periodo,activa)
 select p_restaurante,rid,x,tstzrange(p_inicio,p_inicio+make_interval(mins=>r.duracion_reserva_minutos),'[)'),true from unnest(ids) x;
 return rid;
end $$;

create function public.cancelar_reserva(p_restaurante bigint,p_reserva uuid) returns boolean
language plpgsql security invoker set search_path='' as $$
begin
 update public.reservas set estado='cancelada' where restaurante_id=p_restaurante and id=p_reserva;
 return found;
end $$;
create function public.reprogramar_reserva(p_restaurante bigint,p_reserva uuid,p_inicio timestamptz) returns boolean
language plpgsql security invoker set search_path='' as $$
declare antelacion integer; reserva public.reservas;
begin
 select antelacion_minima_reserva_minutos into strict antelacion from public.restaurantes where id=p_restaurante for share;
 if p_inicio is null or not isfinite(p_inicio) or p_inicio<clock_timestamp()+make_interval(mins=>antelacion) then
   raise exception 'No se cumple la antelación mínima' using errcode='22023'; end if;
 select * into reserva from public.reservas where restaurante_id=p_restaurante and id=p_reserva and estado='confirmada' for update;
 if not found then return false; end if;
 perform 1 from public.zonas where id=reserva.zona_id and estado='activo' for share;
 if not found then raise exception 'Zona cerrada' using errcode='22023'; end if;
 perform 1 from public.mesas where id in (select mesa_id from public.reserva_mesas where reserva_id=p_reserva) order by id for share;
 if exists(select 1 from public.mesas m join public.reserva_mesas rm on rm.mesa_id=m.id where rm.reserva_id=p_reserva and m.estado<>'libre') then
   raise exception 'Mesa no disponible' using errcode='22023'; end if;
 update public.reservas set fin=p_inicio+(fin-inicio),inicio=p_inicio
 where restaurante_id=p_restaurante and id=p_reserva and estado='confirmada';
 return found;
end $$;

-- Las operaciones de escritura son internas: no son endpoints públicos de reservas.
grant usage on schema contactia_privado to service_role;
revoke all on function contactia_privado.derivar_ocupacion(),contactia_privado.actualizar_ocupacion(),contactia_privado.exigir_ocupacion() from public,anon,authenticated;
grant execute on function contactia_privado.derivar_ocupacion(),contactia_privado.actualizar_ocupacion(),contactia_privado.exigir_ocupacion() to service_role;
revoke all on function public.crear_reserva(bigint,uuid,uuid[],timestamptz,integer,text,text,text,text),public.cancelar_reserva(bigint,uuid),public.reprogramar_reserva(bigint,uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.crear_reserva(bigint,uuid,uuid[],timestamptz,integer,text,text,text,text),public.cancelar_reserva(bigint,uuid),public.reprogramar_reserva(bigint,uuid,timestamptz) to service_role;

alter table public.combinaciones_mesas enable row level security;
alter table public.combinacion_mesas enable row level security;
alter table public.reservas enable row level security;
alter table public.reserva_mesas enable row level security;
revoke all on public.combinaciones_mesas,public.combinacion_mesas,public.reservas,public.reserva_mesas from public,anon,authenticated;
grant select on public.combinaciones_mesas,public.combinacion_mesas,public.reservas,public.reserva_mesas to authenticated;
grant all on public.combinaciones_mesas,public.combinacion_mesas,public.reservas,public.reserva_mesas to service_role;
create policy leer_combinaciones_propias on public.combinaciones_mesas for select to authenticated using(contactia_privado.es_miembro(restaurante_id));
create policy leer_componentes_propios on public.combinacion_mesas for select to authenticated using(contactia_privado.es_miembro(restaurante_id));
create policy leer_reservas_propias on public.reservas for select to authenticated using(contactia_privado.es_miembro(restaurante_id));
create policy leer_ocupaciones_propias on public.reserva_mesas for select to authenticated using(contactia_privado.es_miembro(restaurante_id));
commit;
