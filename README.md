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
