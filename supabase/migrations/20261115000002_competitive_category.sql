-- Adds the "competitive" event category alongside community/charity/corporate/school/social.
alter table competitions drop constraint if exists competitions_category_check;
alter table competitions add constraint competitions_category_check
  check (category in ('community', 'competitive', 'charity', 'corporate', 'school', 'social'));
