# SellWant Design System

**Decided 2026-08-07.** Every screen built from here follows this document. If a
screen needs something not covered here, extend the primitives — do not add a
one-off colour or spacing value in a screen file.

## The constraint that shapes everything

**shadcn/ui cannot run in this app.** Its components are Radix + Tailwind +
`className`, all DOM-only. SellWant is React Native rendered to web through
`react-native-web`, so there is no DOM in the component layer. `npx shadcn add`
is not available to us.

So the design *language* is ported as tokens, not installed as a package. Values
below are taken from shadcn's default dark theme (the `zinc` scale) and Vercel's
visual language. The result looks like shadcn; the implementation is
`StyleSheet`.

NativeWind was considered and rejected. It is already a dependency and would
give Tailwind class syntax, but it needs four config files plus Babel and Metro
changes, and the visual result is identical. Not worth the build risk on the
layer every screen depends on. (It is currently dead weight and should be
removed.)

## Colour

Defined in `constants/theme.ts`. Never hardcode a hex in a screen.

| Token | Value | Use |
|---|---|---|
| `background` | `#09090B` | Page |
| `card` | `#0C0C0E` | Raised surfaces — near-identical to background by design |
| `muted` | `#27272A` | Hover, pressed, inert fills |
| `border` | `#27272A` | Hairlines |
| `borderStrong` | `#3F3F46` | Focus, emphasis |
| `foreground` | `#FAFAFA` | Primary text |
| `mutedForeground` | `#A1A1AA` | Secondary text |
| `subtleForeground` | `#71717A` | Timestamps, counts, fine print |
| `primary` | `#FAFAFA` | Primary action fill (white on black, like Vercel) |

**Surfaces are separated by borders, not shadows or lighter fills.** That
border-first treatment is the core of the look. There are no shadows anywhere.

### Market semantics

| Token | Value | Meaning |
|---|---|---|
| `sell` | `#EF4444` | A ticket **for sale** |
| `want` | `#4ADE80` | A **wanted** ad (an ask) |

This follows trading convention — the sell side is red, the buy side is green,
as in any trading terminal. It is not decoration; it is the fastest way for a
student to read which direction a listing points.

**Two rules that keep it from shouting:**

1. Red and green appear only as *small marks* — badges, prices, and the 2px left
   accent on a card. Never as large fills, never as button backgrounds. The base
   UI stays near-monochrome, which is what makes it read as Vercel rather than
   as a casino.
2. **Error red is the same hue as sell red.** Therefore error states must always
   carry an icon and text — never colour alone, which would be ambiguous. This
   is enforced by `ErrorState` and by `Input`'s error line.

## Type

**Geist** (`@expo-google-fonts/geist`), loaded in `app/_layout.tsx`, which holds
the splash screen until it resolves and degrades to the system stack if it
fails. Geist is most of what makes a UI read as Vercel-like.

Scale lives in `theme.type`. Body text is 14px — small and tight, with negative
tracking at display sizes. Access it through the `Text` primitive's `variant`
prop; do not set `fontSize` in a screen.

`display` 32 · `title` 22 · `heading` 17 · `body` 14 · `small` 13 · `caption` 12

## Metrics

- **Spacing**: 4px base scale, `theme.space[n]`. Use the scale, not raw numbers.
- **Radius**: `sm 4 · md 6 · lg 8 · xl 12 · full`. Cards are `xl`, controls `lg`.
- **Controls**: `sm 32 · md 36 · lg 44`, matching shadcn's `h-9`/`h-10`.
- **Content width**: capped at 560px and centred, so the web build doesn't
  sprawl on desktop.

## Primitives

In `components/ui/`, exported from `components/ui/index.ts`. Screens compose
these and nothing else.

| Primitive | Variants |
|---|---|
| `Text` | variant × tone (`default`/`muted`/`subtle`/`sell`/`want`/`destructive`/`inverse`) |
| `Button` | `default` `secondary` `outline` `ghost` `destructive` × `sm` `md` `lg` |
| `Card` | optional `accent="sell" \| "want"` left edge, optional `onPress` |
| `Badge` | `default` `outline` `sell` `want` `destructive` |
| `Input` | label, error, hint |
| `Skeleton` `Separator` `EmptyState` `ErrorState` | — |

`EmptyState` and `ErrorState` are separate components on purpose. The failure we
are guarding against is rendering them identically — the old app swallowed query
errors into an empty list, so "the database rejected you" and "no parties
tonight" looked the same to the user.

## Conventions

- Loading uses `Skeleton` in the shape of the eventual content, not a spinner
  where a list will be.
- Dates render relative near-term: "Tonight", "Tomorrow", then weekday, then
  a short date.
- Reputation shows observed counts only — "4 handoffs". There are no stars and
  no reviews, and no `rating` column exists to add one accidentally.
- Money is stored as integer cents and formatted at the edge.

## Open

- **Light mode.** Dark-only today. The tokens are structured to support a light
  theme, but no work has been done on it.
- **The stock Expo icon** is still the app icon. There is no brand mark.
