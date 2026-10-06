# Cadenza — design contract

Visual thesis: **the black-box theatre.** A pitch-black stage where the only
thing lit is the page. The subject is literary — long-form fiction, italic
actions, quoted dialogue — so the **story text is the hero** and every piece of
chrome recedes to hairlines.

Reference the tokens in `src/app/globals.css`. Read it before you touch a file.

---

## 1. Hard rules (non-negotiable)

1. **Black is black.** In dark, page and card backgrounds are `#000000`. Never
   introduce a grey panel (`bg-zinc-800`, `bg-[#18181b]`, `bg-white/[0.04]`,
   `bg-[#151518]`, …) to separate content. Structure comes from a 1px hairline.
   The only permitted non-black dark fill is `--surface-raised` (`#0a0a0a`) for
   things that physically overlay the page: menus, sheets, modals, the dock.
2. **No literal colours.** Never write `bg-…`, `text-…`, `border-…` with a hex, a
   `zinc/neutral/slate/gray-*` scale, or a named Tailwind colour
   (`purple-*`, `blue-*`, `emerald-*`, `amber-*`, `rose-*`, `sky-*`, `indigo-*`,
   `violet-*`, `teal-*`, `red-*`, `white`, `black`). Use the tokens below.
   Exceptions: `transparent`, `currentColor`, and the semantic status tokens.
3. **One accent.** Gilt. It appears on the primary action, the active state, the
   streaming caret and dialogue emphasis. It is never a gradient, never a glow,
   never a large fill, never used to tint an icon decoratively.
4. **Colour is status, never decoration.** `danger` / `warn` / `ok` only.
   Icons are `--ink-2` or `--ink-3`. No rainbow icon tints.
5. **No gradients, no glows, no `shadow-[0_0_Npx_rgba(...)]`.** Shadows only via
   `shadow-raised` / `shadow-float`.
6. **No all-caps labels.** Sentence case everywhere. No tracked-out uppercase
   eyebrows. Section titles are `.type-sec`.
7. **No middle-dot meta strings** (`A · B · C`). Separate with a comma, or a
   `.chip` each.
8. **No `transition: all` / `transition-all`.** Name the properties. Prefer
   `transition-[transform,opacity] duration-150` or the `.btn` / `.icon-btn`
   helpers, which are already correct.
9. **Radii nest.** Child radius ≤ parent radius. Use the scale below.
10. **Copy is plain and specific.** Active voice, sentence case, second person.
    Buttons say what happens: "Save API key", not "Continue". Loading and saving
    states end in `…` (ellipsis character), e.g. `Saving…`. Empty states are an
    invitation to act, not a mood.

## 2. Token reference

| Purpose | Class / var | Dark | Light |
| --- | --- | --- | --- |
| Page & card canvas | `bg-background` / `bg-surface` | `#000000` | `#ffffff` |
| Overlay layer | `bg-raised` | `#0a0a0a` | `#ffffff` |
| Inset well | `bg-sunken` | `#060606` | `#ecece8` |
| Hairline | `border-line` | `rgba(255,255,255,.09)` | `rgba(23,23,26,.11)` |
| Strong hairline | `border-line-strong` | `rgba(255,255,255,.2)` | `rgba(23,23,26,.24)` |
| Primary text | `text-ink` | `#f2f2f0` | `#17171a` |
| Secondary text | `text-ink-2` | `#a1a1a0` | `#5a5a58` |
| Metadata text | `text-ink-3` | `#6b6b6a` | `#8a8a86` |
| Accent fill | `bg-accent` | `#cfa961` | `#a07f33` |
| Text on accent | `text-accent-ink` | `#17130a` | `#ffffff` |
| Accent as text | `text-accent-text` | `#d9b673` | `#7a5c1a` |
| Accent border | `border-accent-line` | | |
| Accent wash | `bg-accent-wash` | | |
| Danger / warn / ok | `text-danger` `text-warn` `text-ok` (+ `-line` `-wash`) | dulled | dulled |

Radius: `rounded-xs 4` · `rounded-sm 6` · `rounded-md 10` · `rounded-lg 14` ·
`rounded-xl 20` · `rounded-2xl 28` · `rounded-3xl 36`.
Cards `rounded-xl`; modals & sheets `rounded-2xl`; buttons & chips fully round;
icon buttons fully round; inner images one step below their container.

Type roles (all provided in `globals.css`):
`.type-display` (serif wordmark/hero) · `.type-page` (page title) ·
`.type-sec` (section title) · `.type-label` (form label) · `.type-meta` ·
`.type-code` · `.prose-rp` (the reading surface).

Components (all provided in `globals.css`):
`.surface` · `.panel` · `.well` · `.field` · `.btn` · `.btn-ghost` ·
`.btn-quiet` · `.btn-primary` · `.btn-danger` · `.icon-btn` · `.chip` ·
`.chip-accent` `.chip-danger` `.chip-warn` `.chip-ok`.

Motion: `.animate-in` + `.fade-in` / `.slide-in-from-bottom` /
`.slide-in-from-top-1` / `.slide-in-from-right-2` / `.zoom-in-95`. Enter 180ms,
exit faster. Never animate from `scale(0)`. Never animate a keyboard-triggered
action. No ambient loops (no `animate-ping`, `animate-bounce`, `animate-pulse`
on chrome — use `.pulse-soft` at most, for the streaming state only).

## 3. Typography

- **Newsreader** (serif) = the story. All roleplay narrative, the wordmark, page
  titles, character names, quoted content.
- **Instrument Sans** = the machine. Buttons, labels, tabs, inputs, metadata.
- Mono (`font-mono` / `.type-code`) is reserved for regex patterns, JSON, model
  params and numeric telemetry. Never for decoration.

Narrative measure is **62ch** and left-aligned. Serif body text gets slightly
more line-height than sans (already set at 1.78).

## 4. Accessibility floor

- Icon-only buttons need `aria-label`; form controls need a `<label>` or
  `aria-label`; decorative icons get `aria-hidden`.
- `<button>` for actions, `<Link>`/`<a>` for navigation. Never `<div onClick>`.
- Visible `:focus-visible` ring (globally set — do not remove with `outline-none`
  unless you replace it).
- `touch-action: manipulation` on pressables (`.btn` / `.icon-btn` already do it).
- `overscroll-behavior: contain` on overlays (`.panel` does it).
- Placeholders end in `…` and show an example pattern.
- Numbers in comparison columns use `tabular-nums` (`.type-meta` / `.type-code`).
- Long user content: `truncate`, `line-clamp-*`, or `break-words`; flex children
  that hold text need `min-w-0`.
- Handle empty states; never render broken UI for empty strings/arrays.
- `<meta name="theme-color">` and `color-scheme` are already handled — don't
  override them.

## 5. Layout

- Page content: `max-w-5xl` or narrower, `px-4 sm:px-6`, generous vertical rhythm.
- The chat transcript measure is `max-w-3xl` with `.prose-rp` inside it.
- Structure with hairlines and space. Avoid "content chopped into identical
  rounded cards" — use a list with hairline dividers, or a portrait plate with a
  caption beneath, not a grid of equal glowing boxes.
- Alignment is left. Centred is reserved for empty states and the mobile dock.

## 6. Files you own

Do not edit files outside your assigned list. Do **not** edit
`src/app/globals.css`, `src/app/layout.tsx`, `src/components/theme-provider.tsx`
— if you need a token that doesn't exist, compose it from the existing ones
(`color-mix(in oklab, var(--ink) 6%, transparent)` is fine for a hover fill).
