-- Datos ficticios de desarrollo. No crea cuentas ni contraseñas.
-- Ejecutar solo en contactia-desarrollo. No sobrescribe restaurantes existentes.
begin;
do $$
declare restaurante_id bigint; zona_id uuid; etiqueta text;
begin
  foreach etiqueta in array array['sol', 'luna'] loop
    if not exists(select 1 from public.restaurantes where slug = 'prueba-' || etiqueta) then
      insert into public.restaurantes(slug,nombre,duracion_reserva_minutos)
        values ('prueba-' || etiqueta, 'Restaurante ' || initcap(etiqueta) || ' (PRUEBA)',90)
        returning id into restaurante_id;
      insert into public.zonas(restaurante_id,nombre)
        values (restaurante_id,'INTERIOR') returning id into zona_id;
      insert into public.mesas(restaurante_id,zona_id,nombre,capacidad)
        values (restaurante_id,zona_id,'Mesa 1',4);
    end if;
  end loop;
end $$;
commit;
