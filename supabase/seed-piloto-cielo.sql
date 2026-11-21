-- Solo contactia-desarrollo. El piloto se crea como borrador sin reservas web activas.
-- Un segundo uso no cambia restaurantes existentes ni repone mesas eliminadas.
begin;
with nuevo as (
 insert into public.restaurantes
  (slug,nombre,zona_horaria,duracion_reserva_minutos,antelacion_minima_reserva_minutos,
   intervalo_minutos,horario_reservas,dias_cierre,reservas_web_activas)
 values ('prueba-cielo','Restaurante Cielo (PRUEBA)','Europe/Madrid',90,45,15,
  '{"lunes":[],"martes":["13:00-16:00","20:00-23:00"],"miércoles":["13:00-16:00","20:00-23:00"],"jueves":["13:00-16:00","20:00-23:00"],"viernes":["13:00-16:00","20:00-23:00"],"sábado":["13:00-16:00","20:00-23:00"],"domingo":["13:00-16:00"]}',
  '["lunes"]',false)
 on conflict (slug) do nothing returning id
), zonas as (
 insert into public.zonas(restaurante_id,nombre)
 select n.id,v.nombre from nuevo n cross join (values ('INTERIOR'),('TERRAZA')) v(nombre)
 returning id,restaurante_id,nombre
)
insert into public.mesas(restaurante_id,zona_id,nombre,capacidad)
select z.restaurante_id,z.id,v.mesa,v.capacidad from zonas z
join (values ('INTERIOR','I1',2),('INTERIOR','I2',4),('TERRAZA','T1',2),('TERRAZA','T2',4))
 v(zona,mesa,capacidad) on v.zona=z.nombre;
commit;
