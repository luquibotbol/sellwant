-- Photos on a listing.
--
-- listings.image_urls already existed and was already writable by any signed-in
-- client, with nothing bounding it: no limit on how many entries, and no check
-- on what they point at. A listing could carry a hundred images, or images
-- hosted anywhere at all -- which is worth closing while adding the feature
-- that finally writes to the column, because these render in the app and are
-- read by anything that scrapes a listing.

-- Storage. Public read, because these appear on a page a logged-out visitor is
-- meant to see; writes are pinned to a folder named after the caller so one
-- person cannot overwrite or delete another's photos. Same shape as `avatars`.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'listing-photos', 'listing-photos', true, 5242880,
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "listing photos are readable by anyone" on storage.objects;
create policy "listing photos are readable by anyone" on storage.objects
for select using (bucket_id = 'listing-photos');

-- (storage.foldername(name))[1] is the first path segment. Pinning it to the
-- caller's id is what stops someone writing into another person's folder.
drop policy if exists "listing photos are written by their owner" on storage.objects;
create policy "listing photos are written by their owner" on storage.objects
for insert to authenticated
with check (
  bucket_id = 'listing-photos'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "listing photos are replaced by their owner" on storage.objects;
create policy "listing photos are replaced by their owner" on storage.objects
for update to authenticated
using (
  bucket_id = 'listing-photos'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "listing photos are removed by their owner" on storage.objects;
create policy "listing photos are removed by their owner" on storage.objects
for delete to authenticated
using (
  bucket_id = 'listing-photos'
  and (storage.foldername(name))[1] = auth.uid()::text
);

-- The column itself. Three is the product limit, and it belongs here as well
-- as in the picker: the picker is a convenience, this is the rule. Each entry
-- must live in our own bucket -- otherwise image_urls is an arbitrary-URL field
-- that renders wherever a listing renders, which is a tracking pixel at best.
alter table public.listings drop constraint if exists listings_image_urls_bounded;
alter table public.listings add constraint listings_image_urls_bounded check (
  image_urls is null
  or (
    array_length(image_urls, 1) is null
    or (
      array_length(image_urls, 1) <= 3
      and not exists (
        select 1 from unnest(image_urls) as u
        where u !~ '^https://[a-z0-9]+\.supabase\.co/storage/v1/object/public/listing-photos/'
      )
    )
  )
);
