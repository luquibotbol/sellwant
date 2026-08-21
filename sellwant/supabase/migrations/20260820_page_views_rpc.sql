-- Corrige 20260820_page_views.sql: anon nunca pudo escribir.
--
-- Esa migración le daba a anon un grant de INSERT por columna, para que no
-- pudiera forjar `day` y antedatar vistas. Postgres lo acepta, pero PostgREST
-- decide si una tabla es insertable mirando el permiso a nivel de tabla, que
-- con un grant por columna es false -- así que cada beacon habría recibido un
-- 401 y la tabla habría quedado vacía sin que nada fallara a la vista.
--
-- Aflojar el grant a nivel de tabla lo arreglaría y volvería a abrir lo que el
-- grant por columna cerraba: con INSERT sobre toda la tabla, cualquiera con la
-- clave anon puede escribir `day` y `created_at` y meter mil vistas fechadas la
-- semana pasada.
--
-- Así que anon deja de tocar la tabla. Escribe a través de una función que
-- decide ella misma qué se guarda, que es además donde la validación pertenece.

revoke all on public.page_views from anon;
revoke all on sequence public.page_views_id_seq from anon;

/**
 * Registra una impresión.
 *
 * SECURITY DEFINER, así que anon no necesita ningún permiso sobre la tabla.
 * Los únicos valores que el cliente controla son los tres argumentos, y cada
 * uno se valida acá: la fecha y la hora las pone el servidor, el id lo pone la
 * secuencia, y un listing_id que no exista se guarda como null en vez de
 * hacer fallar la llamada.
 *
 * Nunca lanza. Un beacon no tiene a nadie escuchando la respuesta, y que una
 * vista no se cuente no puede ser visible para la persona a la que se cuenta.
 */
create or replace function public.record_view(
  p_path text,
  p_visit_id text,
  p_listing_id uuid default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_listing uuid;
begin
  if p_path is null or p_path !~ '^/' or char_length(p_path) > 200 then
    return;
  end if;
  if p_visit_id is null or char_length(p_visit_id) not between 4 and 64 then
    return;
  end if;

  -- Un listing borrado o inventado no invalida la vista, solo deja de estar
  -- asociada: la fila sigue contando como tráfico de esa ruta.
  select id into v_listing from listings where id = p_listing_id;

  insert into page_views (path, visit_id, listing_id)
  values (p_path, p_visit_id, v_listing)
  on conflict (visit_id, path, day) do nothing;
exception
  when others then
    return;
end;
$$;

revoke all on function public.record_view(text, text, uuid) from public;
grant execute on function public.record_view(text, text, uuid) to anon, authenticated;
