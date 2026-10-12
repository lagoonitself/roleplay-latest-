-- Duo scenes: two agents talk without a human turn.
-- character_id stays null on duo rows so deleting a character does not
-- cascade-delete the transcript. Solo chats are unchanged.

alter table public.chats alter column character_id drop not null;

alter table public.chats
  add column if not exists mode text not null default 'solo';

alter table public.chats drop constraint if exists chats_mode_check;
alter table public.chats
  add constraint chats_mode_check check (mode in ('solo', 'duo'));

create index if not exists chats_user_mode_idx
  on public.chats (user_id, mode, last_message_at desc);
