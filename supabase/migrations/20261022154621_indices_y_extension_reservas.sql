begin;
-- Mantener las funciones auxiliares de la extensión fuera de la API pública.
create schema if not exists extensions;
alter extension btree_gist set schema extensions;
create index componentes_por_combinacion on public.combinacion_mesas(restaurante_id,combinacion_id);
create index ocupacion_por_reserva on public.reserva_mesas(restaurante_id,reserva_id);
commit;
