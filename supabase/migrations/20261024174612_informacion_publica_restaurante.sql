begin;
alter table public.restaurantes
 add column telefono_publico text not null default '',
 add column direccion text not null default '',
 add column web text not null default '',
 add column informacion_publica jsonb not null default '{}',
 add column datos_version integer not null default 0,
 add column datos_modificado_por uuid references auth.users(id) on delete set null,
 add column datos_modificado_en timestamptz;
create index restaurantes_por_editor_datos on public.restaurantes(datos_modificado_por) where datos_modificado_por is not null;

create function contactia_privado.guardar_datos_desde_panel(p_restaurante bigint,p_version integer,p_datos jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare usuario uuid:=auth.uid(); r public.restaurantes; k text; v text;
 campos text[]:=array['nombre','telefono_publico','direccion','web','informacion'];
 temas text[]:=array['aparcamiento','accesibilidad','mascotas','infancia','grupos','pagos','gastronomia'];
begin
 if usuario is null then raise exception 'ACCESO_NO_PERMITIDO' using errcode='42501';end if;
 perform 1 from public.restaurante_usuarios where restaurante_id=p_restaurante and usuario_id=usuario and activo and rol in ('propietario','encargado') for share;
 if not found then raise exception 'ACCESO_NO_PERMITIDO' using errcode='42501';end if;
 if p_version is null or p_version<0 or p_version>2147483646 or jsonb_typeof(p_datos) is distinct from 'object' then
  raise exception 'DATOS_INVALIDOS' using errcode='22023';end if;
 if exists(select 1 from jsonb_object_keys(p_datos) x where not (x=any(campos))) or
  (select count(*) from jsonb_object_keys(p_datos))<>5 then raise exception 'DATOS_INVALIDOS' using errcode='22023';end if;
 foreach k in array campos[1:4] loop
  if jsonb_typeof(p_datos->k) is distinct from 'string' then raise exception 'DATOS_INVALIDOS' using errcode='22023';end if;
  v:=p_datos->>k;
  if v ~ '[[:cntrl:]]' or length(v)>(case k when 'nombre' then 200 when 'telefono_publico' then 40 else 300 end) then
   raise exception 'DATOS_INVALIDOS' using errcode='22023';end if;
 end loop;
 if length(trim(p_datos->>'nombre'))=0 or (p_datos->>'telefono_publico'<>'' and p_datos->>'telefono_publico' !~ '^\+?[0-9 ()-]{7,40}$') or
  (p_datos->>'web'<>'' and p_datos->>'web' !~ '^https?://[^/?#@[:space:]]+([/?#][^[:space:]]*)?$') or
  jsonb_typeof(p_datos->'informacion') is distinct from 'object' then raise exception 'DATOS_INVALIDOS' using errcode='22023';end if;
 if exists(select 1 from jsonb_object_keys(p_datos->'informacion') x where not (x=any(temas))) then raise exception 'DATOS_INVALIDOS' using errcode='22023';end if;
 for k,v in select key,value#>>'{}' from jsonb_each(p_datos->'informacion') loop
  if jsonb_typeof(p_datos->'informacion'->k) is distinct from 'string' or length(v)>1000 or
   regexp_replace(v,E'[\n\t\r]','','g') ~ '[[:cntrl:]]' then raise exception 'DATOS_INVALIDOS' using errcode='22023';end if;
 end loop;
 select * into r from public.restaurantes where id=p_restaurante for update;
 if not found then raise exception 'ACCESO_NO_PERMITIDO' using errcode='42501';end if;
 if r.datos_version<>p_version then raise exception 'DATOS_MODIFICADOS' using errcode='40001';end if;
 if r.nombre=trim(p_datos->>'nombre') and r.telefono_publico=trim(p_datos->>'telefono_publico') and
  r.direccion=trim(p_datos->>'direccion') and r.web=trim(p_datos->>'web') and r.informacion_publica=p_datos->'informacion' then
  return jsonb_build_object('version',r.datos_version,'cambiado',false);end if;
 update public.restaurantes set nombre=trim(p_datos->>'nombre'),telefono_publico=trim(p_datos->>'telefono_publico'),
  direccion=trim(p_datos->>'direccion'),web=trim(p_datos->>'web'),informacion_publica=p_datos->'informacion',
  datos_version=datos_version+1,datos_modificado_por=usuario,datos_modificado_en=clock_timestamp() where id=p_restaurante;
 return jsonb_build_object('version',r.datos_version+1,'cambiado',true);
end $$;
revoke all on function contactia_privado.guardar_datos_desde_panel(bigint,integer,jsonb) from public,anon,authenticated,service_role;
grant execute on function contactia_privado.guardar_datos_desde_panel(bigint,integer,jsonb) to authenticated;
create function public.guardar_datos_restaurante_panel(p_restaurante bigint,p_version integer,p_datos jsonb)
returns jsonb language sql security invoker set search_path='' as $$
 select contactia_privado.guardar_datos_desde_panel(p_restaurante,p_version,p_datos);
$$;
revoke all on function public.guardar_datos_restaurante_panel(bigint,integer,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.guardar_datos_restaurante_panel(bigint,integer,jsonb) to authenticated;
commit;
