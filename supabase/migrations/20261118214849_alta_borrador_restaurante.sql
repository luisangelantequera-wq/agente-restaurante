begin;
create function public.alta_borrador_restaurante_contactia(p_slug text,p_datos jsonb,p_configuracion jsonb,p_zonas jsonb default '[]')
returns jsonb language plpgsql security invoker set search_path='' as $$
declare r public.restaurantes; zona jsonb; mesa jsonb; zid uuid; ficha jsonb;
begin
 if current_user <> 'service_role' then raise exception 'ACCESO_NO_PERMITIDO' using errcode='42501'; end if;
 if p_slug is null or length(p_slug)>80 or p_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or
    jsonb_typeof(p_datos) is distinct from 'object' or length(btrim(coalesce(p_datos->>'nombre',''))) not between 1 and 200 or
    jsonb_typeof(p_configuracion) is distinct from 'object' or jsonb_typeof(p_zonas) is distinct from 'array' then
  raise exception 'DATOS_INVALIDOS' using errcode='22023';
 end if;
 if jsonb_array_length(p_zonas)>12 then raise exception 'DATOS_INVALIDOS' using errcode='22023';end if;
 insert into public.restaurantes(slug,nombre,duracion_reserva_minutos)
 values(p_slug,btrim(p_datos->>'nombre'),90) returning * into r;
 for zona in select value from jsonb_array_elements(p_zonas) loop
  if jsonb_typeof(zona) is distinct from 'object' or length(btrim(coalesce(zona->>'nombre',''))) not between 1 and 80 or
     jsonb_typeof(zona->'mesas') is distinct from 'array' then raise exception 'DATOS_INVALIDOS' using errcode='22023';end if;
  if jsonb_array_length(zona->'mesas')>30 then raise exception 'DATOS_INVALIDOS' using errcode='22023';end if;
  insert into public.zonas(restaurante_id,nombre) values(r.id,zona->>'nombre') returning id into zid;
  for mesa in select value from jsonb_array_elements(zona->'mesas') loop
   if length(btrim(coalesce(mesa->>'nombre',''))) not between 1 and 80 or
      jsonb_typeof(mesa->'capacidad') is distinct from 'number' or (mesa->>'capacidad')::integer not between 1 and 1000 then
    raise exception 'DATOS_INVALIDOS' using errcode='22023';end if;
   insert into public.mesas(restaurante_id,zona_id,nombre,capacidad) values(r.id,zid,mesa->>'nombre',(mesa->>'capacidad')::integer);
  end loop;
 end loop;
 ficha:=public.administrar_restaurantes_contactia('detalle',r.id);
 return public.administrar_restaurantes_contactia(p_accion=>'guardar',p_id=>r.id,p_version=>ficha->>'version',
  p_datos=>p_datos||'{"reservas_web_activas":false}'::jsonb,
  p_configuracion=>p_configuracion||'{"estado_servicio":"borrador","estado_activacion":"pendiente"}'::jsonb);
end $$;
revoke all on function public.alta_borrador_restaurante_contactia(text,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.alta_borrador_restaurante_contactia(text,jsonb,jsonb,jsonb) to service_role;
commit;
