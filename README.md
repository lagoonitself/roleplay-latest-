# Cadenza — AI Roleplay Studio

A private stage for long-form AI roleplay: layered memory, SillyTavern-style
prompt control, and character-card import from Janitor AI and Chub.

## Design

Read [`DESIGN.md`](./DESIGN.md) before changing any UI. The house style is
**the black-box theatre** — a pitch-black stage where the only thing lit is the
page. The story text is the hero; every piece of chrome recedes to hairlines.

Three rules cover most of it:

1. **Black is black.** Dark surfaces are `#000000`. Structure comes from 1px
   hairlines, never grey panels.
2. **One accent.** Gilt. Low chroma. Primary action, active state, streaming
   caret. Never a gradient, never a glow.
3. **Colour is status.** `danger` / `warn` / `ok` only. Never decoration.

All tokens live in `src/app/globals.css`. Dark is the default theme; light is a
first-class alternative and must always be verified alongside it.

## Stack

- Next.js 16 (App Router) · React 19 · TypeScript
- Tailwind CSS v4 (design tokens via `@theme inline` — see `globals.css`)
- Supabase (auth, characters, chats, messages, memories, summaries, usage)
- `next-themes` · `sonner` · `lucide-react` · `react-markdown`
- Fonts: Newsreader (the voice: prose, wordmark, titles) and Instrument Sans
  (the machine: controls, labels, metadata)

> **Note on Tailwind v4:** this project relies on the `@theme inline` block in
> `globals.css` to generate colour, radius and font utilities. Without it,
> classes like `bg-background`, `text-ink` and `rounded-xl` compile to nothing.
> Do not remove it.

## Prompt & memory

The prompt is assembled in `src/lib/prompt/`; the story's memory is maintained by
`src/lib/memory/`. Both follow SillyTavern's model.

**Prompt order** (`prompt/assembler.ts`): system prompt → world info → persona →
character sheet → example dialogue → history → in-chat injections → scene state, the
live message, and the post-history reminder. Recall is injected at SillyTavern's depths:
summary at 2, memories at 2, author's note at 4 (depth 0 is the slot immediately before
the reply).

The card's own system prompt is sent as `<creator_directives>` (SillyTavern's `{{original}}`
splices the default main prompt back in). Style presets are layered *under* the card as
`<style_direction>` — they never replace it, and the content rating always wins.

**Continue** and **Write for me** (impersonate) are SillyTavern generation types, not chat
messages: Continue keeps the last reply in history and sends a hidden OOC nudge, then appends
the result to that reply in place; Write for me drafts your next turn into the composer.
Regenerate trims the reply being replaced out of the history the model sees.

**Budgets are dynamic** (`prompt/tokens.ts`): the static prefix is measured, recall
blocks are capped, and the remainder goes to history — capped at 16k tokens, because
past that the summary and recall carry the arc and re-sending the transcript only costs
money.

**Memory** (`memory/engine.ts`): one background pass regenerates the running story
summary (SillyTavern's `[Summary: …]`), the fact bank, and the scene state *together*.
It runs every N messages (default 10, tunable per chat), when the un-summarised stretch
gets long, or when the conversation is about to push older turns out of the prompt —
never on every single turn. Facts are recalled per turn (`memory/vectors.ts`, using
SillyTavern's `protect: 5 / insert: 3 / query: 2` defaults) and pinned facts are always
in context. Writer-added memories live in the Memory tab of the chat inspector; pinned
memories are never auto-rewritten or superseded.

**Macros** (`prompt/macros.ts`) are SillyTavern-compatible, including `{{random::…}}`,
`{{pick::…}}` and `{{roll 1d20}}`. Volatile macros are only expanded in live content —
stored history is never re-rolled, so the past stays the past.

## Model providers

Pick one in **Settings → Model provider**:

- **OpenCode Go** — paste your OpenCode Go key (or set `OPENCODE_GO_API_KEY` on the server).
- **ChatGPT** — *Sign in with ChatGPT* uses your Plus/Pro/Team subscription through the
  same device-code login as the Codex CLI (`src/app/api/auth/chatgpt/route.ts`). Tokens stay
  in the browser and are refreshed automatically; requests go to the Codex backend's
  Responses API and are translated back to Chat Completions SSE (`src/lib/llm/chatgpt.ts`).
  If the code is rejected, enable device code sign-in for Codex in ChatGPT's security settings.

## Develop

```bash
npm install
npm run dev      # http://localhost:3000
npm run build    # production build
npm run lint
```

Environment variables are documented in `.env.example`.

## Layout

```
src/
  app/            routes: / (explore · chats · create · profile), /chat/[chatId],
                  /c/new, /c/[id], /personas, /lorebooks, /logs, /profile,
                  /duo, /duo/new, /duo/[chatId], /api/*
  components/     UI, including chat/ and profile/ subfolders
  lib/            prompt assembly, memory, lorebook, duo engine, card parsing,
                  regex engine, chat manager, Supabase clients, usage ledger
public/           PWA manifest, service worker, icon
```

## Before you open a PR

- `npm run build` passes.
- Checked in **both** themes, at desktop and mobile widths.
- Icon-only buttons have `aria-label`; form controls have labels.
- Visible `:focus-visible` ring preserved.
- `prefers-reduced-motion` respected.
- No literal colours in class strings — use the tokens in `globals.css`.
