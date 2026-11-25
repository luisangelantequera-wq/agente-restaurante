begin;
do $$
declare i uuid:='eeeeeeee-1111-4222-8333-444444444444'; h text:=repeat('a',64); p text:='CA'||repeat('1',32); e text:='CA'||repeat('2',32);
begin
 if has_function_privilege('anon','public.vincular_recepcion_llamada_prueba(text,text)','EXECUTE')
 or has_function_privilege('authenticated','public.vincular_recepcion_llamada_prueba(text,text)','EXECUTE') then raise exception 'Acceso público';end if;
 if not has_function_privilege('service_role','public.vincular_recepcion_llamada_prueba(text,text)','EXECUTE') then raise exception 'Servidor bloqueado';end if;
 perform public.crear_sesion_llamada_prueba(i,h,clock_timestamp()+interval '1 minute');
 if public.vincular_recepcion_llamada_prueba(p,e) is not null then raise exception 'Sesión no consumida';end if;
 perform public.usar_sesion_llamada_prueba(i,h,p);
 if public.vincular_recepcion_llamada_prueba(p,e) is distinct from i then raise exception 'No vinculada';end if;
 if public.consultar_recepcion_llamada_prueba(i,h) is distinct from e then raise exception 'Coste recepción';end if;
 if public.consultar_recepcion_llamada_prueba(i,repeat('b',64)) is not null then raise exception 'Coste ajeno';end if;
 if public.vincular_recepcion_llamada_prueba(p,e) is distinct from i then raise exception 'Reenvío';end if;
 if public.vincular_recepcion_llamada_prueba(p,'CA'||repeat('3',32)) is not null then raise exception 'Otra entrada';end if;
 update contactia_privado.llamadas_prueba set caduca=clock_timestamp()-interval '1 second' where id=i;
 if public.vincular_recepcion_llamada_prueba(p,e) is not null then raise exception 'Caducada';end if;
end $$;
rollback;
