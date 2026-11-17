-- Phase 5, step 2: other players' profiles are read only through public_profiles (name, photo, cover,
-- visibility). The profiles table itself becomes readable for your own row only, so birth year, gender, area,
-- location and the rest are never visible to other users. The API's service role is unaffected.
--
-- APPLY ONLY AFTER the API and web that read other people through public_profiles are live: the older code reads
-- names straight from profiles, which this would hide.
drop policy if exists profiles_read on profiles;
create policy profiles_read on profiles for select using (auth.uid() = id);
