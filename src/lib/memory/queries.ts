/**
 * Shared column lists for memory queries.
 *
 * `memories.embedding` is a halfvec(384) column that no application code reads —
 * selecting it drags ~2KB per row over the wire on every list/recall query.
 * Use MEMORY_COLUMNS instead of `select('*')` everywhere memories are read.
 */
export const MEMORY_COLUMNS =
  'id, chat_id, user_id, content, kind, entities, importance, pinned, source_message_ids, superseded_by, access_count, last_accessed_at, created_at, updated_at';

/** Safety cap for "load the memory bank" queries. */
export const MEMORY_LIST_LIMIT = 500;
