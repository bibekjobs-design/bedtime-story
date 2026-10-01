-- Lets the backend read live Postgres database size + Supabase Storage bucket
-- sizes through a normal RPC call (supabase-py can't run raw SQL directly -
-- this function is the bridge). Powers the admin dashboard's "DB & Storage"
-- section. Run this once in the Supabase SQL editor, same as 001/002.

create or replace function admin_db_storage_stats()
returns table (
    db_size_bytes bigint,
    bucket_id text,
    storage_bytes bigint,
    file_count bigint
)
language plpgsql
security definer
set search_path = public
as $$
begin
    return query
    select
        pg_database_size(current_database()) as db_size_bytes,
        o.bucket_id,
        coalesce(sum((o.metadata->>'size')::bigint), 0)::bigint as storage_bytes,
        count(*) as file_count
    from storage.objects o
    group by o.bucket_id;
end;
$$;

grant execute on function admin_db_storage_stats() to authenticated, anon, service_role;
