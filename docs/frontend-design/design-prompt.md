# Solace — Frontend Design Prompt

> **Build target: Paper** (https://paper.design). All screens are built on Paper's HTML/CSS canvas via the Paper MCP server (artboards, flex containers, DOM nodes). Design-to-code is one language — the canvas IS CSS, so what you build in Paper ships as Tailwind/inline-style JSX. Keep every layout in **flex containers** with named artboards so the agent (opencode) can read, write, and translate cleanly.

## 1.0 Agent Build Workflow (opencode + Paper MCP)

Build this design in **Paper Desktop** from opencode using the **Paper MCP** server (`http://127.0.0.1:29979/mcp`). Prereqs: Paper Desktop running with the Solace design file open (MCP auto-starts). Loop:

1. **Read the canvas** — `get_basic_info` (file/artboards), `get_selection`, `get_tree_summary`, `get_screenshot` to see what's on the board.
2. **Build** — `create_artboard` for each screen (§3), then `write_html` to drop in flex-container DOM. Start from the token roots in §2 so colors/types stay consistent.
3. **Refine** — `update_styles`, `set_text_content`, `move_nodes`, `duplicate_nodes`, `rename_nodes` for iteration. Keep components as one named node with all states (see §4 state list).
4. **Verify** — `get_jsx` (Tailwind/inline) and `get_computed_styles` to confirm it exports as clean, code-ready markup. `get_screenshot`/`export` to eyeball.
5. **Ship** — the same CSS feeds the frontend (Next.js/Tailwind in `frontend/`). Paper is the source of truth; when translating, keep the design's structure (flex, tokens) so the code matches the canvas.

Each "Paper / Gen-AI visual prompt (labeled PAPER)" block below doubles as the brief to feed `write_html` for that screen — paste the description, and the canvas gets the moodful frame.

---

## 1. Overview

**One-liner:** Solace is an ambient lofi co-listening room — an anonymous, peer-synced space on the web where a few friends share the same quiet evening, the same warm glow, the same track, together.

**Core state:** `state.activity` (capped append-only log, last 50 entries), `state.playback`, `state.wallpaper`, `state.title`, `state.timer`.

**Socket events:**
- **Client → Server:** `activity:send { text }`, `timer:start { minutes }`, `timer:pause`, `timer:reset`, `playback:play|pause|seek|set_track`, `wallpaper:set`, `room:set_title`, `room:create|join|leave|get_state`, `rtc:*`.
- **Server → Client:** `room:activity { entry }` (append-only broadcast), `timer:state { status, durationMs, endsAt, remainingMs }`, `timer:complete`, `playback:state`, `wallpaper:state`, `room:title_state`, `room:created|joined|member_joined|member_left|error`.

**Activity entry shape:** `{ id, type, actor: { socketId, displayName }, detail, at }` — type in `chat|playback|wallpaper|title|media|timer|system`.

**Mood keywords:** calm-cozy-lofi-evening, warm-dusk, vinyl-warmth, soft-glow, breathing-space.

**Five design principles:**

1. **The room IS the app.** Every surface — wallpaper, player, presence — belongs to one shared canvas. The room renders first and everything else orbits it. No chrome that steals from the ambience.
2. **Dark-first, warm, never neon.** Deep charcoal base lit from within. Amber/violet/rose as warm accents. Avoid saturated screens, harsh borders, corporate grays. Light feels like a lamp, not a monitor.
3. **Glass over boxes.** Translucency, blur, and depth replace hard cards. Panels float with gentle radius and hairline light edges. The wallpaper glows through everything.
4. **Glow, not shadow.** Depth is expressed as luminous bleed (soft outer glow from warm sources), not drop-shadows. Light spills up from the player, footsteps into the room code.
5. **Breathing space, minimal chrome.** Every element earns its place. Plenty of negative space. Animations are slow, eased, ambient. Nothing blinks or dings. The UI recedes so the lofi can breathe.

---

## 2. Design System (Paper-first)

### Color tokens

Model all tokens as **CSS custom properties** on the `:root`, so they sync straight to the Paper canvas and export as Tailwind/inline CSS. Define them in Paper and reuse via `update_styles`.

**Background depth scale** (charcoal, near-black, lit from warm):
| Token (`--*`) | Value (suggested base) | Role |
|---|---|---|
| `--bg-depth-0` | `#14110F` | deepest backdrop behind everything |
| `--bg-depth-1` | `#1A1614` | raised surfaces, scrim-adjacent panels |
| `--bg-depth-2` | `#211C19` | active surfaces, player bar base |
| `--bg-depth-3` | `#29211D` | hovered / elevated surfaces |

**Warm accents:**
| Token (`--*`) | Value (suggested base) | Role |
|---|---|---|
| `--accent-amber` | `#E0A458` | primary warmth, play state, highlights |
| `--accent-violet` | `#9B7BB8` | secondary accent, chat tint, badges |
| `--accent-rose` | `#C98A8A` | tertiary warmth, mic/video pulse |
| `--accent-bone` | `#EDE0D2` | primary text (warm off-white, not pure white) |

**Status colors** (desaturated warm to fit the mood, not alarm-neon):
| Token (`--*`) | Value (suggested base) | Role |
|---|---|---|
| `--status-success` | `#7FAE8B` | connected, muted-mic-off, presence ok |
| `--status-warning` | `#C9A05A` | room nearly full, degraded sync |
| `--status-error` | `#C97C6E` | room not found, invalid code, connection lost |
| `--status-info` | `#8FA6C9` | informational notes, system chat |

**Wallpaper scrim** (so full-bleed art stays readable behind glass):
| Token (`--*`) | Value (suggested base) | Role |
|---|---|---|
| `--scrim-base` | `#14110F @ 55%` | overall dim over wallpaper |
| `--scrim-panel` | `#14110F @ 72%` | behind glass panels for text contrast |

### Typography

**Pairing — warm, analog, human:**
- **Display / large headings:** a soft serif or rounded humanist face with warmth (e.g. *Fraunces* or *Gambetta* at light/regular weights with tempered `letter-spacing`). Used rarely — titles, big moments, the room welcome.
- **Body / UI:** a readable humanist sans (e.g. *Inter*, *Public Sans*, or *Sora*) at comfortable sizes with generous `line-height`. Carries all controls, labels, chat.
- **Utility / data:** a mono or tabular face (e.g. *JetBrains Mono*, *IBM Plex Mono*) for the room code (`S8DK2F`), timestamps, track duration. Mono reads as "machine that's definitely working right."

**Sizes:**
| Element | Size (suggested) | Face |
|---|---|---|
| Room code | 40–48 / mono, wide tracking | mono / utility |
| Screen title | 28–32 | display |
| Member name | 14 | body, medium |
| Chat message | 14 | body |
| Player track name | 16–18 | body, semibold |
| Player track artist/meta | 13 | body, muted |
| Caption / eyebrow | 12 | utility, uppercase, wide tracking |

### Spacing / Radius
- **Radius:** gentle, not pills. Base `12px`, panels `16px`, `rounded-full` reserved only for circular media toggles and avatars. Room code chip `10px`.
- **Spacing scale:** 4-based (`4,8,12,16,24,32,48,64`). Generous breathing space between clusters; tight inside controls.

### Motion language — "glow, not shadow"
- **Slow, eased, ambient.** Primary feel: `ease-out` 300–500ms fades and 150–250ms micro-transitions.
- **Glow pulse:** the play state and presence indicators breathe with a soft radial glow (low-opacity amber/violet halo), not a hard flashing dot.
- **Float-in:** panels and modals rise softly with a light vertical drift + fade + backdrop blur settle.
- **Presence sway:** member tiles sway/tilt imperceptibly (like candlelight) — 8–10s loop, very low amplitude.
- **Respect `prefers-reduced-motion`:** collapse all sway/pulse, keep only essential fades.
- **No** bounce, no spring-pop, no neon flashes, no confetti anywhere.

### Component list WITH states

**Buttons**
- `PrimaryButton` — `bg/amber`, `text/depth/0`, rounded `12px`, `24px` tall. States: default / hover (brightened, slight glow) / pressed (dimmed) / focus-visible (amber outline ring) / loading (throbber) / disabled (muted 35%).
- `GhostButton` — transparent, bone text, hairline `rgba(bone,0.18)` border on hover. States: default / hover (glow tint) / active / disabled.
- `IconButton` — circular, glass. Used for player controls / picker triggers / close. States: default / hover (glow) / active (amber or filled) / disabled / `aria-pressed` visual for mute.

**Code input**
- `RoomCodeInput` — single visual field, 6 slots for `S8DK2F`, mono, centered, large. States: idle (hairline, `--scrim-panel` backing) / focused (amber underline/glow) / filled (all slots, warm bone) / error (`--status-error` ring + shiver) / disabled. Paste accepted in one shot (fits 6 slots).

**Member row (hero presence)**
- `MemberRow` — hero presence entry: small avatar circle (34) + name. Vertical stack top-right. Rest state: ~35% opacity grey so media shows through. Speaking: amber ring + glow + full-bright name + tiny green speaking dot. Muted: dimmed name, rose dot in info card. Variants: idle-grey / speaking-amber / muted. (Rich `MemberTile` pill w/ mic-video badges remains the **chat panel** member list style.)

**Player controls (bottom-left, hover-expand)**
- `PlayerMiniPill` — compact pill (glass, radius 999): prev / amber play / next + truncated track name. Hover expands into `TrackCard`.
- `TrackCard` — artwork thumb (44, rounded), track title + artist, seek slider, mono elapsed/duration times.
- `SeekSlider` — states: idle / hovered (rail brightens) / dragging / at-end.

**Track row**
- `TrackRow` — catalog list item. States: default / hover (amber left-glow or highlight) / selected (amber tick + dim artwork) / loading (dim + spinner on artwork) / currently-playing (animated equalizer bars, amber).

**Chat bubble**
- `ChatMessage` — body text, meta (name + timestamp, mono, muted). States: default / system (centered, `--status-info`, italic) / own (subtle self-tint) / new (brief amber fade-in highlight). Container is collapsed/expanded.

**Wallpaper chip**
- `WallpaperChip` — small thumbnail tile. States: default / hover (border lightens) / selected (amber ring + check) / token-loading (shimmer on thumb).

**Modals**
- `ModalPanel` — glass, `--scrim-panel` backing, centered float. Variants: picker sheet (track, wallpaper), error dialog, confirm. States: open (fade + rise + blur settle) / closing (reverse) / dismiss-on-scrim-click. Focus trapped, `Esc` closes.

**Error banner**
- `ErrorBanner` — slim top-of-room strip, `--status-error` tint on glass. States: show (slide down + fade) / auto-dismiss after N s / persistent-guide (room lost) / contains actionable retry link.

---

## 3. Screen Inventory WITH prompts

### a. Landing / Entry

**Purpose:** First impression. Two decisions: create a room, or join one by code. Zero friction, anonymous, no auth.

**Paper / Gen-AI visual prompt (labeled PAPER):**

> An ambient fictional UI concept screen on a deep charcoal evening backdrop (`#14110F`). Centered, small, warm off-white logotype "solace" in a soft humanist serif, slightly below center, with a tiny amber candle-flame icon. Behind it, a barely-visible dusk wallpaper gradient bleeding violet-to-rose at the edges, dimmed under a 55% charcoal scrim. Below the wordmark, two quiet rounded rectangular controls side by side: a filled warm-amber primary button reading "Create a room" and a translucent glass ghost button reading "Join with code". Below all of it, dim warm-gray mono text of a sample room code "S8DK2F" as decoration. The whole scene is soft, film-grain, gently glowing from the amber, calm, cozy, breathing; no neon, no corporate gradient chrome, no game-like UI. Rendered as a warm serene brand moodboard, shallow dark room ambience, dusk light leaking at the edges.

**Paper canvas structure:**
- `Artboard` `landing` (full-bleed, 1440×900). Built with `create_artboard` + `write_html` (flex container):
  - `WallpaperLayer` — full-bleed image / gradient, fixed, object-fit cover.
  - `ScrimLayer` — `--scrim-base` full-bleed, `position:fixed`.
  - `CenterStack` (flex column, gap 24, centered):
    - `LogoMark` (icon 24 + wordmark, display face)
    - `PrimaryButton` "Create a room"
    - `GhostButton` "Join with code"
    - `DecorativeCode` (mono, 'S8DK2F', muted)
- States: `PrimaryButton` [default/hover/pressed]; `GhostButton` [default/hover].
- Edge/empty:
  - Both CTAs present always (no empty state needed).
  - If `Join with code` pressed with empty code → focus error on code input (moved to Name step).
  - Reduced-motion: static.

### b. Name Entry step

**Purpose:** Anonymous display name (≤24 chars). Named once, remembered in session. No account.

**Paper / Gen-AI visual prompt (labeled PAPER):**

> An ambient fictional UI screen continuing the same deep-charcoal lofi evening. Centered warm off-white text reads "What should we call you?" in a soft serif. Directly beneath, a single generous monospace text field with a hairline border over a translucent dark glass panel, warm bone placeholder text "e.g. Juniper", cursor glowing soft amber. Beneath the field, a single filled warm-amber primary button reading "Continue". Around the field, faint film grain and a blurred dusk wallpaper glow bleeding violet to rose at the edges, everything under a charcoal scrim. Calm, minimal chrome, cozy breathing space, no auth fields, no email, no password; a quiet warm inviting form. Soft glow from below, gentle radius, no neon.

**Paper canvas structure:**
- `Artboard` `name-entry` (full-bleed): `WallpaperLayer`, `ScrimLayer`, `CenterStack` (flex column, gap):
  - `TitleText` (display)
  - `NameField` (text input)
  - `PrimaryButton` "Continue"
- `NameField` states: [idle / focused / filled / error(>24 too long)].
- Edge/error:
  - Empty submit → field error "Give yourself a name to join" (no navigation).
  - >24 chars → inline counter + error, input fails/trims; shows `14/24` style mono counter in a corner.
  - Whitespace-only name rejected; trimmed on submit.

### c. Room — THE HERO SCREEN

**Purpose:** The whole product. Fullscreen media background (user-uploaded **image or silent looping video**) is the star; everything else waits for the cursor. A room title is always visible. People, song controls, and room details only appear while the mouse moves and expand on hover; they idle-hide (~2 s) so the media stays clean.

**Paper / Gen-AI visual prompt (labeled PAPER):**

> A wide cinematic lofi room screen where the entire 1440×900 canvas is one full-bleed shared wallpaper — a warm dusk gradient softly blurred violet, amber, and rose, like a sunset photograph, slightly dimmed for readability (film-grain throughout). Top-left: the room title "Golden Hour" in a warm serif with a small pulsing rose "live" dot, and the mono room code "S8DK2F" beneath it in soft amber — the ONLY permanent element, with a faint drop shadow. Everything else appears only while the mouse moves, fading back out after ~2 s idle. Top-right: a vertical stack of three member rows (tiny avatar circle + name), the non-speakers dimmed to faint grey ghosts so the wallpaper shows through, speakers glowing with a soft amber ring and bright warm name, a tiny green dot on the actively talking avatar. Bottom-left: a small dark-glass pill with prev / amber play / next and a truncated track name; hovering expands it into a small card with album art, track/artist, and a slender amber-to-rose seek line with times. Bottom-right: a small dark-glass circle labeled "i"; hovering opens a compact dark card listing room name, code, host, and each member with a status dot (green live / rose muted / grey away). The scene is serene, cinematic, gallery-like, glassy but ultra-minimal, warm amber and violet on deep charcoal, no neon, no bars, no dashboards. Rendered as a calm lofi film still.

**Paper canvas structure:**
- `Artboard` `room-hero` (hovered UI state, full-bleed 1440×900). Layers via `write_html`:
  - `MediaLayer` — full-bleed user media (image cover; **video = silent loop, muted, playsInline, cover**). Artboard shows a still/proxy image.
  - `TitleBlock` (top-left, absolute, always on): `RoomTitle` (display serif, 20px, drop shadow) + `LiveDot` + `RoomCode` (mono, amber, letter-spaced 2px).
  - `PeopleStack` (top-right, absolute, flex column, gap 10, right-aligned): `MemberRow` ×3 — each `Avatar`(34 circle) + `Name`(12px). Rest state: ~35% opacity, grey into the media. Speaking state: amber ring + glow + full-bright name + green speaking dot.
  - `PlayerMiniPill` (bottom-left, absolute): prev / amber play / next (Feather SVGs) + truncated `TrackTitle`. Hover → expands.
  - `TrackCard` (absolute above pill): `Artwork`(44 rounded), `TrackTitle`/`Artist`, `SeekBar` (gradient amber→rose fill + thumb), mono `Times`.
  - `InfoButton` (bottom-right, absolute "i" circle). Hover → opens `InfoCard` (absolute): room name/code/host rows + `MemberRow` ×3 with status dots [live/muted/away].
- `Artboard` `room-hero-idle` (clean state): `MediaLayer` + `TitleBlock` only — documents the default view.
- Interaction model: pointer-move shows UI (fade ~250 ms); 2 s idle hides everything except `TitleBlock`. `PlayerMiniPill` and `InfoButton` expand their cards on hover.
- Component states: `MemberRow` [idle-grey / speaking-amber / muted]; `PlayerMiniPill` [collapsed / expanded]; `InfoButton` [closed / open]; `TrackCard` [paused/playing]; `SeekBar` [idle/hover/drag/end].
- Edge/error states:
  - **0 others:** `PeopleStack` empty; a faint dashes placeholder row "waiting for friends…" while media stays clean. Room persists when empty.
  - **Room lost / peer dropped:** `InfoCard` shows error line "Your room went quiet" + reconnect; member rows grey out.
  - **Everyone muted, you only:** media still plays; status dots all grey, no alarm.
  - **No track:** `TrackCard` artwork placeholder + "Nothing playing yet — pick a track"; mini pill shows only play button.
  - **No upload / first run:** `MediaLayer` falls back to the default `Dusk` gradient (artifact `Wallpaper Picker` presets).

### d. Track Picker

**Purpose:** Choose what plays for everyone. Two modes: browse a small catalog (with metadata) or paste an external URL.

**Paper / Gen-AI visual prompt (labeled PAPER):**

> An ambient fictional UI modal as a translucent dark glass sheet floating over a dim warm dusk wallpaper, film-grain. At the top, warm off-white heading "Now playing" in a soft serif, with a small monospace subtab row: "Catalog" and "Paste a link". In catalog mode, a calm vertical list of three or four rounded track rows, each with a small rounded album-art thumb of warm abstract dusk art, a track title and artist in warm text, a mono duration, and a small amber play-indicator equalizer bar on the currently-playing row. A faint amber highlight glows the left edge of the hovered row. In the paste field (shown faintly behind, blurred vignette), a single mono text field over glass with placeholder "Paste a link to any track". Everything under a charcoal scrim, soft amber and violet glow, gentle radius, cozy minimal chrome, no neon. Rendered as a warm lofi picker sheet.

**Paper canvas structure:**
- `Artboard` `track-picker` (centered modal, width ~420, glass, radius 16):
  - `Header` (title + close).
  - `TabRow` — `SegmentedControl`: [Catalog / Paste].
  - `CatalogMode`: `TrackList` (flex column) → `TrackRow` ×N [default/hover/selected/playing].
  - `PasteMode`: `PasteField` (mono input [idle/focused/error/loading]) + `PrimaryButton` "Play".
- Edge/error:
  - Paste invalid/unsupported URL → field error "That link didn't resolve. Try a direct audio link."
  - Catalog empty (no seeded items) → empty state "No tracks yet — paste a link to start the evening."
  - Loading track → row `loading` (dim + spinner), player shows throbber until metadata resolved.
  - Duplicate selection → re-selected, just plays, no error.

### e. Wallpaper Picker

**Purpose:** Change the shared room wallpaper (full-bleed image URL). Gallery presets + paste-URL mode.

**Paper / Gen-AI visual prompt (labeled PAPER):**

> An ambient fictional UI modal as a translucent dark glass sheet over a dim dusk backdrop, film-grain. Warm off-white heading "Room wallpaper" in a soft serif, with a small monospace tab row "Gallery" / "Paste a link". In gallery mode, a calm horizontal strip of rounded square thumbnails, each a different dusk art — violet field, amber dusk, rose horizon, deep charcoal smoke, soft moon — with a warm amber ring + tiny check on the currently chosen thumb. A faint amber glow border on the hovered thumb. Behind the modal, the live room wallpaper faintly previews the selection. Shown faintly blurred in the corner, a mono paste field with placeholder "Paste a link to any image". Everything under a charcoal scrim, warm amber and violet, gentle radius, cozy minimal chrome, no neon. Rendered as a warm lofi selection sheet.

**Paper canvas structure:**
- `Artboard` `wallpaper-picker`: `Header` ("Room wallpaper") + `TabRow` [Gallery / Paste].
  - `GalleryMode`: `WallpaperGrid` (flex wrap) → `WallpaperChip` ×N [default/hover/selected/token-loading]. Selected updates `WallpaperLayer` live behind.
  - `PasteMode`: `PasteField` (mono [idle/focused/error/loading]) + `PrimaryButton` "Set wallpaper".
- Edge/error:
  - Paste invalid image URL → field error "That image couldn't load. Try a direct .jpg / .png / .webp link."
  - Image fails to load live → keep previous wallpaper, show `ErrorBanner` "Couldn't load that wallpaper", revert chip.
  - Gallery seeds fail (no network) → still allow paste-URL mode + "Degraded — using default dusk".

### f. Chat Panel

**Purpose:** Peer-to-peer text, last 50 messages. Sits alongside the room; collapsible.

**Paper / Gen-AI visual prompt (labeled PAPER):**

> An ambient fictional UI side panel sliding in over a dim warm dusk wallpaper, translucent dark glass with a soft charcoal scrim, film-grain. A narrow vertical glass panel on the right edge holds a warm off-white header "Chat" in a soft serif with a small monospace live count. Below, a calm scrolling stack of rounded chat bubbles: thin dark glass messages with a tiny muted name and a small mono timestamp above each, warm off-white message text; one centered italic muted system line reading "Juniper joined the room"; near the bottom a faint warm-amber highlight on the newest message. At the very bottom, a single mono text field over glass with placeholder "Say something warm…" and a small amber send glyph. Everything under charcoal scrim, amber and violet glow at the edges, gentle radius, cozy, minimal chrome, no neon. Rendered as a warm lofi chat rail.

**Paper canvas structure:**
- `Artboard` `chat-panel` (right rail, glass `--scrim-panel`, width ~320):
  - `Header` (title + collapse close).
  - `MessageList` (flex column, overflow-y scroll) → `ChatMessage` [default/system/own/new]:
    - `MessageMeta` (name + mono timestamp)
    - `MessageBody`
  - `ChatInput` (mono field [idle/focused/disabled]) + `SendButton`.
- Edge/error:
  - Empty history → centered hint "The room is quiet — say hi."
  - Rollover past 50 → older messages drop; a system line "Earlier messages folded away" appears once.
  - Send fails (peer unreachable) → message stays dim + "…" retry affordance on that bubble.
  - Connected-elsewhere → `--status-info` system line "Not connected live — chat kept locally" (rare WebRTC fallback).

### g. Room Full / Room Not Found / Invalid Code

**Purpose:** Guard states for join-by-code failures.

**Paper / Gen-AI visual prompt (labeled PAPER):**

> An ambient fictional error screen on the shared deep-charcoal dusk backdrop, film-grain, scrimmed. Centered, a subtle warm rose-tinted soft serif phrase reads "This room is full" in one variant — with a muted warm line "Try another room, or start your own". Above it, a faint, faded room-code chip in muted mono showing "S8DK2F". In a parallel faint ghost variant blurred behind: "We couldn't find that room" and "The code doesn't match any open room — check it and try again." Everything quiet, warm, gentle, no harsh red alert, calm dark UI, small amber "Create a room" ghost button below, cozy lofi error mood, no neon.

**Paper canvas structure:**
- `Artboard` `guard-error` (full-bleed): `WallpaperLayer`, `ScrimLayer`, `CenterStack` (flex column):
  - `FadedCodeChip` (muted mono)
  - `ErrorTitle` (display, rose-tinted)
  - `ErrorDesc` (muted body)
  - `GhostButton` "Create a room" (+ optional "Back").
- Variants (three frames, one per guard):
  1. **Room full** — copy "This room is full", desc "4's the warmest it gets. Start your own."
  2. **Room not found** — copy "We couldn't find that room", desc "It may have drifted away. Check the code."
  3. **Invalid code** — copy "That code didn't work", desc "Codes are 6 letters + numbers, like S8DK2F." (field-level error on Name input too).
- Edge: expired code error message distinguishes "room is full" vs "room not found" vs "invalid format" to guide the fix.

### h. Loading / Connecting States

**Purpose:** Feedback during joins, track resolution, WebRTC linkup.

**Paper / Gen-AI visual prompt (labeled PAPER):**

> An ambient fictional loading screen on a deep charcoal dusk background under a charcoal scrim, film-grain. Center, a single small circular dial outlined in soft amber, gently rotating like a slow vinyl platter, trailing a faint warm glow. Beneath it, quiet warm off-white mono text cycles softly: "Joining room…", "Tuning in…", "Warming up the lamp…". At the edges, a dim violet-to-rose dusk glow breathes very slowly. Everything calm, slow, cozy, no spinner noise, no progress bars racing, no neon; a serene waiting moment with warm amber light. Rendered as a warm lofi connection moment.

**Paper canvas structure:**
- `Artboard` `loading` : `ScrimLayer` + `CenterStack` (flex column):
  - `VinylSpinner` (slow rotation, amber glow trail) — spin keyframe 1.6s linear infinite.
  - `StatusText` (mono, swaps via states).
  - Optional `Progress` (thin glow line, ambiguous/indeterminate).
- `StatusText` states: [joining, tuning-in, resolving-track, warming-up, connecting-peer-N-of-M]. `VinylSpinner` [rotating/paused-on-error/error-tint].
- Edge/error:
  - Timeout (join > N s) → auto-swap to `Room NotFound` variant with "Taking a while — the room may be gone."
  - Peer connect partial → "Connecting 2 of 3" mono status; if a peer never links, member tile stays as ghost slot (not error).
  - Track resolve hang → player shows throbber + status "Resolving track…", auto-fail to paste error copy.

### i. Mobile / Responsive Notes

- **Breakpoint stack:** desktop ≥ 900 wide; tablet ~600–900; mobile < 600. Room code size scales from 40px → 28px on mobile.
- **Mobile adaptation:**
  - `PeopleStack` collapses into a horizontally scrollable avatar strip (or a single "3 friends" chip that expands a small sheet).
  - `PlayerMiniPill` re-stacks: expanded `TrackCard` shows artwork + meta top, seek + controls bottom; controls remain one-thumb reachable.
  - `ChatPanel` becomes full-width bottom sheet (not a right rail) with taller input and larger hit targets.
  - All hover-reveal becomes **tap-reveal**: tap on media toggles UI visibility (idle-hide stays), tap pill/info to expand cards.
  - Picker modals become full-screen bottom sheets with grabber handle; thumbnails scroll horizontally.
  - Tap targets ≥ 44px. `prefers-reduced-motion` respected across all.
- **Sync note:** wallpaper and track state are peer-driven, so layout reflow must never block playback — keep player control affordances pinned regardless of panel open/close.

---

## 4. Paper Scaffolding

**File structure** (one Paper file, artboards top-down):
1. **Foundations** — color token swatches (bg depth, warm accents, status, scrim), type scale specimen, spacing/radius.
2. **Components** — a named node each for the list in §2, with all states and computed styles.
3. **Screens** — one artboard per screen in §3 (a–h), composed from components.
4. **Room Directions** — the three Room variants (§5, A/B/C) laid side by side.

**How to build (via Paper MCP):**
- Create artboards with `create_artboard` (name + size).
- Author each screen with `write_html` so it lands as a **flex-container DOM** — not absolutely-positioned boxes. Paper's canvas is real HTML/CSS, so flex layouts translate cleanly to Tailwind/inline JSX when the agent ships the UI.
- Keep tokens as `:root` CSS custom properties (see §2). Reuse them across artboards via `update_styles` rather than re-declaring hex values everywhere.
- Inspect/verify with `get_tree_summary`, `get_screenshot`, `get_jsx`, `get_computed_styles`. Export frames with `export`.

**Flex-layout guidance:**
- Corners use absolute positioning with explicit px (`position:absolute; top/bottom/left/right` — Paper honors these). Everything inside a surface is flex (row/column, explicit `gap` + `padding`).
- `CenterStack`, `TitleBlock`, `PeopleStack`, `PlayerMiniPill`, `TrackCard`, `InfoCard`, `TrackList`, `MessageList`, `WallpaperGrid` are flex containers; children use explicit px sizes (no percentages — Paper drops `width:100%`).
- Scroll only inside `MessageList` (column, `overflow-y`) and `WallpaperGrid` (wrap).

**Component state list (names):**
- `PrimaryButton / State` [default, hover, pressed, focus, loading, disabled]
- `GhostButton / State` [default, hover, active, disabled]
- `IconButton / Kind` [mic, video, chat, close, copy, prev, play, pause, next, volume]
- `RoomCodeInput / State` [idle, focused, filled, error, disabled]
- `MemberRow / Status` [idle-grey, speaking-amber, muted]
- `PlayerMiniPill / State` [collapsed, expanded] ; `TrackCard / State` [playing, paused]
- `SeekSlider / State` [idle, hover, dragging, end]
- `TrackRow / State` [default, hover, selected, playing, loading]
- `ChatMessage / Kind` [default, system, own, new]
- `WallpaperChip / State` [default, hover, selected, token-loading]
- `ModalPanel / Kind` [track-picker, wallpaper-picker, error, confirm]
- `ErrorBanner / State` [show, persistent]
- `SegmentedControl / Selected` [catalog, paste]
- `VinylSpinner / State` [rotating, error]
- `StatusText / Text` [joining, tuning-in, resolving-track, warming-up, peer-N-of-M]

**Token naming** (`:root` CSS custom properties in Paper):
- `--bg-depth-{0|1|2|3}`
- `--accent-{amber|violet|rose|bone}`
- `--status-{success|warning|error|info}`
- `--scrim-{base|panel}`
- `--radius-{8|12|16|24}`
- `--space-{4|8|12|16|24|32|48|64}`
- `--font-{display|body|mono}` + size roles (`--fontsize-roomCode`, `--fontsize-chat`, `--fontsize-player`)

---

## 5. Sequencing

**Design order:**
1. **Room screen first** (the hero, §3c). It defines the canvas: media + always-on title + hover-reveal corners (people / player / info). Everything else inherits from it.
2. **Foundations** derived from the Room: lock the 4-accent warm palette, type pairing, glow language *after* Room feels right (not before — the Room proves the tokens).
3. **Components** that the Room uses day-one: `PlayerMiniPill`, `TrackCard`, `MemberRow`, `RoomCodeInput`, `IconButton`, `PrimaryButton`.
4. **Modals & pickers** (Track, Wallpaper) reusing the same glass sheet language.
5. **Room Full / Not Found / Invalid** guard screens.
6. **Loading/Connecting** states last (they're glue, cheap once components exist).
7. **Mobile pass** as a final QA sweep across all screens.

**Sketch-vs-Paper flow:**
> Terminology note: "wireframe sketch" = cheap hand-drawn pencil sketch used to protect mood. "Paper" = the design tool (paper.design) where screens are built to fidelity.

- **Phase 1 (wireframe sketch):** present the three Room directions A/B/C (§5, Room screen only, brief) plus the landing screen. Get the human to pick a direction here — cheap to change on a sketch, costlier once built in Paper.
- **Phase 2 (Paper):** build only the chosen Room direction to fidelity (agent-driven via the Paper MCP), derive the token roots, then the remaining screens reusing built components.
- Keep the two unpicked Room directions as a reference section on the "Room Directions" artboard — do not delete; they inform the picker/lot of future variants.
- Iterate: design the Room in Paper → light wireframe sketch of each new screen → build in Paper from components → critique → refine. Never skip the sketch for a brand-new screen type; it keeps mood honest.

---

## Out of scope (explicitly)

Excluded by design for the anonymous v1 (YAGNI):
- **Authentication / accounts / login / signup** — no auth; anonymous display name only. Adding accounts would contradict the drop-in, no-friction co-listening promise.
- **Pricing / billing / plans.**
- **Onboarding / tutorial tours.**
- **Settings / preferences.**
- **Profiles / avatars beyond the anonymous name + media badges.**
- **Server-backed persistence, history, or friend lists** (rooms are peer-synced; only last-50 activity entries and room existence persist, minimal).

Keep the surface to: enter anonymous name → create/join → room (wallpaper, player, presence, chat). Everything else is future scope and would dilute the calm.
