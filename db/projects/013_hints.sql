-- Projects tile: hints under a clause (owner, 2026-11-05: "proceed with next steps and complete the implementation" - the
-- "Not Applicable?" and "In Contractor's Scope?" hints after the simulation on a real specification). The compliance is
-- answered as the manufacturer for the contractor and the consultant; the hints are worked out in the browser
-- (assets/pr-hints.js) from word lists the reviewers keep on Matching rules > Hints: hint_scope, hint_absent (yes / no),
-- scope_parts (Part numbers), scope_words, scope_sections, scope_manufacturer (word lists), absent_rules (the rules).
-- Only the settings check changes. Touches only: schema projects. Run after 012_vocab_types.sql.

create or replace function projects.settings_check(p_key text, v jsonb)
returns text language plpgsql immutable as $$
declare
  nums constant jsonb := '{"near_words":[0,30],"max_clauses":[1,10],"keep_share":[0,100],"heading_words":[1,30],"label_chars":[10,200],
                           "figure_words":[1,40],"option_values":[1,300],"candidates_shown":[1,100],"choose_listed":[1,20],"vocab_types":[1,10]}';
  fams constant text[] := array['length','mass','areal_mass','density','u_value','pressure','flow','power','velocity','time','temperature'];
  idre constant text := '^[a-z][a-z0-9_]{0,29}$';
  e jsonb; x jsonb; i integer := 0; n numeric; k text;
begin
  if p_key in ('near_words','max_clauses','keep_share','heading_words','label_chars','figure_words','option_values','candidates_shown','choose_listed','vocab_types') then
    if jsonb_typeof(v) <> 'number' then return 'a whole number'; end if;
    n := v::text::numeric;
    if n <> trunc(n) or n < (nums -> p_key ->> 0)::numeric or n > (nums -> p_key ->> 1)::numeric then
      return 'a whole number from ' || (nums -> p_key ->> 0) || ' to ' || (nums -> p_key ->> 1);
    end if;
    return '';
  end if;

  if p_key = 'topics' then
    if jsonb_typeof(v) <> 'array' or jsonb_array_length(v) not between 1 and 40 then return '1 to 40 topics'; end if;
    for e in select a.value from jsonb_array_elements(v) a loop
      i := i + 1;
      if jsonb_typeof(e) <> 'object' or jsonb_typeof(e -> 'id') <> 'string' or (e ->> 'id') !~ idre then return 'topic ' || i || ': a short name'; end if;
      if jsonb_typeof(e -> 'words') <> 'array' or jsonb_array_length(e -> 'words') not between 1 and 80 then return 'topic ' || i || ': 1 to 80 words'; end if;
      if exists (select 1 from jsonb_array_elements(e -> 'words') w
                  where jsonb_typeof(w.value) <> 'string' or char_length(w.value #>> '{}') > 60
                     or (w.value #>> '{}') !~ '^[a-z0-9]+\*?( [a-z0-9]+\*?)*$') then
        return 'topic ' || i || ': words of small letters and digits, "*" only at a word end';
      end if;
    end loop;
    if (select count(distinct a.value ->> 'id') from jsonb_array_elements(v) a) <> jsonb_array_length(v) then return 'a topic is listed twice'; end if;
    return '';
  end if;

  if p_key = 'general_topics' then
    if jsonb_typeof(v) <> 'array' or jsonb_array_length(v) > 40
       or exists (select 1 from jsonb_array_elements(v) a where jsonb_typeof(a.value) <> 'string' or (a.value #>> '{}') !~ idre) then return 'topic names'; end if;
    return '';
  end if;

  if p_key = 'section_topics' then
    if jsonb_typeof(v) <> 'array' or jsonb_array_length(v) > 60 then return 'at most 60 lines'; end if;
    for e in select a.value from jsonb_array_elements(v) a loop
      i := i + 1;
      if jsonb_typeof(e) <> 'object' or jsonb_typeof(e -> 'section') <> 'string' or char_length(e ->> 'section') > 80
         or (e ->> 'section') !~ '^[a-z0-9]+( [a-z0-9]+)*$' then return 'line ' || i || ': the section name'; end if;
      if coalesce(e ->> 'how', '') not in ('is', 'starts') then return 'line ' || i || ': is or starts with'; end if;
      if jsonb_typeof(e -> 'topics') <> 'array' or jsonb_array_length(e -> 'topics') not between 1 and 20
         or exists (select 1 from jsonb_array_elements(e -> 'topics') t where jsonb_typeof(t.value) <> 'string' or (t.value #>> '{}') !~ idre) then
        return 'line ' || i || ': one or more topics';
      end if;
    end loop;
    return '';
  end if;

  if p_key = 'parts' then
    if jsonb_typeof(v) <> 'array' or jsonb_array_length(v) not between 1 and 5
       or exists (select 1 from jsonb_array_elements(v) a where jsonb_typeof(a.value) <> 'number' or (a.value::text) !~ '^[1-9]$')
       or (select count(distinct a.value) from jsonb_array_elements(v) a) <> jsonb_array_length(v) then
      return '1 to 5 different Part numbers from 1 to 9';
    end if;
    return '';
  end if;

  if p_key = 'heading_verbs' then
    if jsonb_typeof(v) <> 'array' or jsonb_array_length(v) > 20
       or exists (select 1 from jsonb_array_elements(v) a where jsonb_typeof(a.value) <> 'string' or (a.value #>> '{}') !~ '^[a-z]{2,20}$') then
      return 'single words of small letters';
    end if;
    return '';
  end if;

  if p_key = 'properties' then
    if jsonb_typeof(v) <> 'array' or jsonb_array_length(v) not between 1 and 80 then return '1 to 80 properties'; end if;
    for e in select a.value from jsonb_array_elements(v) a loop
      i := i + 1;
      if jsonb_typeof(e) <> 'object' or jsonb_typeof(e -> 'name') <> 'string' or trim(e ->> 'name') = '' or char_length(e ->> 'name') > 80 then
        return 'property ' || i || ': a name up to 80 characters';
      end if;
      if jsonb_typeof(e -> 'terms') <> 'array' or jsonb_array_length(e -> 'terms') not between 1 and 30
         or exists (select 1 from jsonb_array_elements(e -> 'terms') t
                     where jsonb_typeof(t.value) <> 'string' or char_length(t.value #>> '{}') not between 1 and 60
                        or (t.value #>> '{}') <> lower(t.value #>> '{}') or (t.value #>> '{}') <> trim(t.value #>> '{}')) then
        return 'property ' || i || ': 1 to 30 words in small letters';
      end if;
      if coalesce(e ->> 'direction', '') not in ('higher', 'lower', 'exact') then return 'property ' || i || ': higher, lower or exact'; end if;
      if jsonb_typeof(e -> 'unit') <> 'string' or ((e ->> 'unit') <> '' and not (e ->> 'unit') = any (fams)) then return 'property ' || i || ': a kind of figure from the list'; end if;
      if jsonb_typeof(e -> 'scale') <> 'array' or jsonb_array_length(e -> 'scale') > 30
         or exists (select 1 from jsonb_array_elements(e -> 'scale') c where jsonb_typeof(c.value) <> 'string' or (c.value #>> '{}') !~ '^[A-Z]{1,3}[0-9]{1,2}$') then
        return 'property ' || i || ': classes such as G4, F7, TB2';
      end if;
    end loop;
    return '';
  end if;

  if p_key = 'vocab_fallback' then           -- 011: keywords for a covered row the vocabulary finds nothing for
    if jsonb_typeof(v) <> 'boolean' then return 'yes or no'; end if;
    return '';
  end if;

  if p_key = 'vocab_products' then           -- 011: the products matched by the vocabulary
    if jsonb_typeof(v) <> 'array' or jsonb_array_length(v) > 20
       or exists (select 1 from jsonb_array_elements(v) a where jsonb_typeof(a.value) <> 'string' or (a.value #>> '{}') !~ '^[a-z0-9_-]{1,40}$')
       or (select count(distinct a.value) from jsonb_array_elements(v) a) <> jsonb_array_length(v) then
      return 'product ids';
    end if;
    return '';
  end if;

  if p_key in ('hint_scope', 'hint_absent') then        -- 013
    if jsonb_typeof(v) <> 'boolean' then return 'yes or no'; end if;
    return '';
  end if;

  if p_key = 'scope_parts' then
    if jsonb_typeof(v) <> 'array' or jsonb_array_length(v) > 5
       or exists (select 1 from jsonb_array_elements(v) a where jsonb_typeof(a.value) <> 'number' or (a.value::text) !~ '^[1-9]$')
       or (select count(distinct a.value) from jsonb_array_elements(v) a) <> jsonb_array_length(v) then
      return 'up to 5 different Part numbers from 1 to 9';
    end if;
    return '';
  end if;

  if p_key in ('scope_words', 'scope_sections', 'scope_manufacturer') then
    if jsonb_typeof(v) <> 'array' or jsonb_array_length(v) > 200
       or exists (select 1 from jsonb_array_elements(v) a where jsonb_typeof(a.value) <> 'string' or char_length(a.value #>> '{}') > 60
                     or (a.value #>> '{}') !~ '^[a-z0-9]+\*?( [a-z0-9]+\*?)*$') then
      return 'words of small letters and digits';
    end if;
    return '';
  end if;

  if p_key = 'absent_rules' then
    if jsonb_typeof(v) <> 'array' or jsonb_array_length(v) > 100 then return 'at most 100 rules'; end if;
    for e in select a.value from jsonb_array_elements(v) a loop
      i := i + 1;
      if jsonb_typeof(e) <> 'object' or jsonb_typeof(e -> 'label') <> 'string' or trim(e ->> 'label') = '' or char_length(e ->> 'label') > 120 then return 'rule ' || i || ': the text'; end if;
      if jsonb_typeof(e -> 'products') <> 'array' or jsonb_array_length(e -> 'products') > 20
         or exists (select 1 from jsonb_array_elements(e -> 'products') x where jsonb_typeof(x.value) <> 'string' or (x.value #>> '{}') !~ '^[a-z0-9_-]{1,40}$') then
        return 'rule ' || i || ': products';
      end if;
      foreach k in array array['clause', 'has', 'lacks'] loop
        n := case when k = 'clause' then 60 else 40 end;
        if jsonb_typeof(e -> k) <> 'array' or jsonb_array_length(e -> k) > n
           or exists (select 1 from jsonb_array_elements(e -> k) x where jsonb_typeof(x.value) <> 'string' or char_length(x.value #>> '{}') > 60
                         or (x.value #>> '{}') !~ '^[a-z0-9]+\*?( [a-z0-9]+\*?)*$') then
          return 'rule ' || i || ': ' || k;
        end if;
      end loop;
      if jsonb_array_length(e -> 'clause') = 0 then return 'rule ' || i || ': clause words'; end if;
      if jsonb_array_length(e -> 'has') = 0 and jsonb_array_length(e -> 'lacks') = 0 then return 'rule ' || i || ': has or lacks'; end if;
    end loop;
    return '';
  end if;

  return 'unknown setting';
end $$;

select core.applied('projects', '013_hints');
