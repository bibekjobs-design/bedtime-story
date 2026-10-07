-- Narration languages: English, Hindi, Bengali, Kannada, Telugu, Odia (safe to run more than once)
insert into languages (id, code, label, is_active)
select
  (select coalesce(max(id), 0) from languages) + row_number() over (order by v.code),
  v.code, v.label, true
from (values
  ('en','English'),
  ('hi','Hindi'),
  ('bn','Bengali'),
  ('kn','Kannada'),
  ('te','Telugu'),
  ('or','Odia')
) as v(code, label)
where not exists (select 1 from languages l where l.code = v.code);

update languages set is_active = true  where code in ('en','hi','bn','kn','te','or');
