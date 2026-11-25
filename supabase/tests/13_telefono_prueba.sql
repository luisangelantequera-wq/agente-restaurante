begin;
set local role service_role;
do $$
declare sesion_id uuid:=gen_random_uuid(); h text:=repeat('a',64); s text:='CA'||repeat('1',32);
begin
 if not public.crear_sesion_llamada_prueba(sesion_id,h,clock_timestamp()+interval '2 minutes') then raise exception 'No crea pase';end if;
 if public.crear_sesion_llamada_prueba(sesion_id,h,clock_timestamp()+interval '2 minutes') then raise exception 'Sobrescribe pase';end if;
 if public.usar_sesion_llamada_prueba(sesion_id,repeat('b',64),s) then raise exception 'Acepta hash ajeno';end if;
 if public.consultar_llamada_prueba(sesion_id,h) is not null then raise exception 'Inventa SID';end if;
 if not public.usar_sesion_llamada_prueba(sesion_id,h,s) then raise exception 'No vincula SID';end if;
 if not public.usar_sesion_llamada_prueba(sesion_id,h,s) then raise exception 'Rechaza reenvío del mismo webhook';end if;
 if public.usar_sesion_llamada_prueba(sesion_id,h,'CA'||repeat('2',32)) then raise exception 'Permite otra llamada con el mismo pase';end if;
 if public.consultar_llamada_prueba(sesion_id,h)<>s then raise exception 'Consulta equivocada';end if;
 if public.consultar_llamada_prueba(sesion_id,repeat('b',64)) is not null then raise exception 'Filtra SID';end if;
 update contactia_privado.llamadas_prueba set caduca=clock_timestamp()-interval '1 second' where llamadas_prueba.id=sesion_id;
 if public.usar_sesion_llamada_prueba(sesion_id,h,s) then raise exception 'Acepta pase caducado';end if;
end $$;
reset role;
set local role anon;
do $$ begin
 begin perform public.consultar_llamada_prueba(gen_random_uuid(),repeat('a',64));raise exception 'Acceso anónimo';exception when insufficient_privilege then null;end;
 begin select count(*) from contactia_privado.llamadas_prueba;raise exception 'Lee pases';exception when insufficient_privilege then null;end;
end $$;
reset role;
set local role authenticated;
do $$ begin
 begin perform public.usar_sesion_llamada_prueba(gen_random_uuid(),repeat('a',64),'CA'||repeat('3',32));raise exception 'Acceso authenticated';exception when insufficient_privilege then null;end;
end $$;
reset role;
rollback;
