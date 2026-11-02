-- Entity images: profile cover, team cover, circle photo + cover.
-- Public URLs of files in the existing public `avatars` bucket.
alter table profiles add column if not exists cover_url text;
alter table teams add column if not exists cover_url text;
alter table circles add column if not exists photo_url text;
alter table circles add column if not exists cover_url text;
