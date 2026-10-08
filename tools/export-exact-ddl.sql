-- export-exact-ddl.sql — READ ONLY. Run this in the JMIS Supabase SQL
-- Editor (project btnatydmfunhwgoeguus.supabase.co) and paste the single
-- text result into bluebell/db/01_schema_exact.sql, then re-run
-- tools/gen-schema.mjs with --use-exact to replace the generated DDL with the
-- byte-exact definition (defaults, indexes, constraints and all).
--
-- It never writes: SELECT only, from the catalog. The relname list below uses
-- the JMIS-side names (jmis_*), which are also the names Bluebell provisions.
select
  'create table ' || quote_ident(c.relname) || ' (' || E'
' ||
  string_agg(
    '  ' || quote_ident(a.attname) || ' ' ||
    format_type(a.atttypid, a.atttypmod) ||
    case when a.attnotnull then ' not null' else '' end ||
    coalesce(' default ' || pg_get_expr(d.adbin, d.adrelid), ''),
    ',' || E'
'
    order by a.attnum
  ) || E'
);' || E'
' ||
  coalesce(
    E'
-- indexes
' ||
    string_agg(distinct pg_get_indexdef(i.indexrelid) || ';', E'
'),
    ''
  ) || E'
' ||
  coalesce(
    E'
-- constraints
' ||
    (
      select string_agg(con.def || ';', E'
')
      from pg_constraint con
      where con.conrelid = c.oid
    ),
    ''
  ) || E'
' ||
  coalesce(
    E'
-- rls
' ||
    case when c.relrowsecurity then 'alter table ' || quote_ident(c.relname) || ' enable row level security;' else '' end ||
    E'
' ||
    (
      select string_agg(
        'drop policy if exists ' || quote_ident(s.polname) || ' on ' || quote_ident(c.relname) || ';' || E'
' ||
        'create policy ' || quote_ident(s.polname) || ' on ' || quote_ident(c.relname) || ' ' ||
        case s.polcmd
          when 'r' then 'for select'
          when 'a' then 'for insert'
          when 'u' then 'for update'
          when 'd' then 'for delete'
          else 'for all'
        end || ' to ' ||
        array_to_string(array(select pg_get_userfromuids(x) from unnest(s.polroles) x), ', ') || ' ' ||
        coalesce('using (' || pg_get_expr(s.polqual, s.polrelid) || ')', '') || ' ' ||
        coalesce('with check (' || pg_get_expr(s.polwithcheck, s.polrelid) || ')', '') || ';',
        E'
'
      )
      from pg_policies p
      join pg_policy s on s.polname = p.policyname
      where p.tablename = c.relname
    ),
    ''
  ) as ddl
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
left join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
left join pg_attrdef d on d.adrelid = c.oid and d.adnum = a.attnum
left join pg_index x on x.indrelid = c.oid
left join pg_class i on i.oid = x.indexrelid
where n.nspname = 'public'
  and c.relkind = 'r'
  and c.relname in ('devauth', 'jmis_admissions_applications', 'jmis_announcements', 'jmis_assignment_submissions', 'jmis_assignments', 'jmis_attendance', 'jmis_auditlogs', 'jmis_cbtQuestions', 'jmis_cbt_completion', 'jmis_cbt_essay', 'jmis_cbt_results', 'jmis_chat_conversations', 'jmis_chat_messages', 'jmis_class_specific_fees', 'jmis_classfees', 'jmis_disabled_accounts', 'jmis_enquiries', 'jmis_lesson_plans', 'jmis_notes', 'jmis_paymentsinfo', 'jmis_result', 'jmis_result_history', 'jmis_secretaryauth', 'jmis_settings', 'jmis_staff', 'jmis_staff_assignments', 'jmis_staff_attendance', 'jmis_staff_credentials', 'jmis_student', 'jmis_teacherauth', 'jmis_userauth')
group by c.oid, c.relname, c.relrowsecurity
order by c.relname;
