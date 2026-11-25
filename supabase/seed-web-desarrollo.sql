-- Solo los restaurantes ficticios de contactia-desarrollo.
-- No sobrescribe un horario que ya haya editado la administración.
begin;
update public.restaurantes set
 horario_reservas='{"lunes":[],"martes":["13:00-16:00","20:00-23:00"],"miércoles":["13:00-16:00","20:00-23:00"],"jueves":["13:00-16:00","20:00-23:00"],"viernes":["13:00-16:00","20:00-23:30"],"sábado":["13:00-16:00","20:00-23:30"],"domingo":["13:00-16:00"],"_contactia":{"especiales":[{"fecha":"12-25","rangos":[]}]}}',
 dias_cierre='["lunes"]', intervalo_minutos=15, reservas_web_activas=true
 where slug in ('prueba-sol','prueba-luna') and horario_reservas='{}'::jsonb;
commit;
