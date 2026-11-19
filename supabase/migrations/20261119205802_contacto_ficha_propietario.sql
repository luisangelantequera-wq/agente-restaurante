begin;

create function contactia_privado.contacto_ficha_propietario(
  p_restaurante bigint, p_version text, p_contacto jsonb
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  usuario uuid := auth.uid();
  registro public.restaurantes;
  interna jsonb;
  contacto jsonb;
  nuevo jsonb;
  campo text;
begin
  if usuario is null or not exists (
    select 1 from public.restaurante_usuarios
    where restaurante_id=p_restaurante and usuario_id=usuario and activo and rol='propietario'
  ) then
    raise exception 'ACCESO_NO_PERMITIDO' using errcode='42501';
  end if;

  if p_contacto is not null then
    -- Comparte el orden de bloqueo de la edición interna para conservar todos los datos.
    select * into strict registro from public.restaurantes where id=p_restaurante for update;
    perform 1 from public.restaurante_usuarios
    where restaurante_id=p_restaurante and usuario_id=usuario and activo and rol='propietario' for share;
    if not found then raise exception 'ACCESO_NO_PERMITIDO' using errcode='42501'; end if;
  end if;

  select datos into interna from contactia_privado.configuracion_interna_restaurantes
    where restaurante_id=p_restaurante;
  interna := coalesce(interna,'{}');
  contacto := jsonb_build_object(
    'contacto_nombre', coalesce(interna->>'contacto_nombre',''),
    'contacto_telefono', coalesce(interna->>'contacto_telefono',''),
    'contacto_email', coalesce(interna->>'contacto_email','')
  );
  if p_contacto is null then
    return jsonb_build_object('contacto',contacto,'version',md5(contacto::text));
  end if;
  if p_version is distinct from md5(contacto::text) then
    raise exception 'VERSION_DISTINTA' using errcode='40001';
  end if;

  if jsonb_typeof(p_contacto) is distinct from 'object' or
     (p_contacto - array['contacto_nombre','contacto_telefono','contacto_email']) <> '{}' then
    raise exception 'CONTACTO_INVALIDO' using errcode='22023';
  end if;
  foreach campo in array array['contacto_nombre','contacto_telefono','contacto_email'] loop
    if jsonb_typeof(p_contacto->campo) is distinct from 'string' or
       (p_contacto->>campo) ~ '[[:cntrl:]]' then
      raise exception 'CONTACTO_INVALIDO' using errcode='22023';
    end if;
  end loop;
  nuevo := jsonb_build_object(
    'contacto_nombre',btrim(p_contacto->>'contacto_nombre'),
    'contacto_telefono',btrim(p_contacto->>'contacto_telefono'),
    'contacto_email',btrim(p_contacto->>'contacto_email')
  );
  if length(nuevo->>'contacto_nombre')>200 or length(nuevo->>'contacto_email')>254 or
     ((nuevo->>'contacto_email')<>'' and (nuevo->>'contacto_email') !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') or
     ((nuevo->>'contacto_telefono')<>'' and ((nuevo->>'contacto_telefono') !~ '^\+?[0-9 ().-]{7,40}$'
       or length(regexp_replace(nuevo->>'contacto_telefono','[^0-9]','','g'))<7)) then
    raise exception 'CONTACTO_INVALIDO' using errcode='22023';
  end if;

  if nuevo is distinct from contacto then
    insert into contactia_privado.configuracion_interna_restaurantes(restaurante_id,datos)
      values(p_restaurante,interna||nuevo)
      on conflict(restaurante_id) do update set datos=excluded.datos,actualizado_en=now();
    insert into contactia_privado.historial_interno_restaurantes(restaurante_id,editor,antes,despues)
      values(p_restaurante,'Propietario · '||usuario::text,
        jsonb_build_object('datos',to_jsonb(registro),'configuracion',interna),
        jsonb_build_object('datos',to_jsonb(registro),'configuracion',interna||nuevo));
  end if;
  return jsonb_build_object('contacto',nuevo,'version',md5(nuevo::text));
end;
$$;
revoke all on function contactia_privado.contacto_ficha_propietario(bigint,text,jsonb) from public,anon;
grant execute on function contactia_privado.contacto_ficha_propietario(bigint,text,jsonb) to authenticated;

create function public.contacto_ficha_restaurante(
  p_restaurante bigint, p_version text default null, p_contacto jsonb default null
)
returns jsonb language sql security invoker set search_path = '' as $$
  select contactia_privado.contacto_ficha_propietario(p_restaurante,p_version,p_contacto);
$$;
revoke all on function public.contacto_ficha_restaurante(bigint,text,jsonb) from public,anon;
grant execute on function public.contacto_ficha_restaurante(bigint,text,jsonb) to authenticated;

commit;
