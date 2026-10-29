# customizing Luna

Everything about how Luna talks, thinks, looks and behaves lives in plain files. This is the map: what you want to change, and where.

The easiest way is to **ask Luna herself** ("make your replies shorter", "add a pomodoro timer", "rename yourself to Mochi"). She edits her own files or code. Code changes go through the careful self-improvement loop: snapshot, tests, one-tap undo. Use this guide when you'd rather do it by hand or with Claude Code.

## quick map

| I want to change... | Where |
|---|---|
| Her name, my name, emoji, time zone, quiet hours | Settings → General (saved in `.luna-prefs.json`, mirrored into `me/identity.md`) |
| How she talks (tone, length, formatting, cards) | `CLAUDE.md` → "how you talk" |
| Her personality and values | `me/soul.md` (made from `templates/soul.md` on first run; edit either) |
| What she does without asking vs asks first | `CLAUDE.md` → "acting without asking" and "safety rules" |
| Which actions always need my tap (money, deleting, posting...) | `lib/rules.js` and `tools/sentinel.js` (the fixed rules, guarded from self-changes) |
| Which apps or tools she tries first | `CLAUDE.md` → "always find a way" |
| What she knows about me | the `me/` folder (Settings → Memory shows and edits it) |
| My own rules (work, school, people, nicknames) | add any `.md` file to `me/`, e.g. `me/my-rules.md`. She reads every file there |
| Routines (morning brief, weekly review) | ask her, or the 🦎 menu → routines (saved in `.luna-prefs.json`) |
| Proactive check-ins (how often, what she looks at) | 🦎 menu → check in every; the prompt is `pulse()` in `main.js` |
| Daily little reminders (lunch, wind down) | Settings → General → reminders |
| Her look (character, size, walking, climbing) | Settings → Character (any picture, GIF or .glb), 🦎 menu for roaming |
| Chat colors, dark mode, font | Settings → Appearance (theme in `.luna-prefs.json`, styles in `index.html`) |
| Her brain (model, speed, other AI providers) | Settings → Brain, or 🦎 menu → quick / smart / genius brain |
| Her self-improvement model | `improveModel` in `.luna-prefs.json` (default `opus`) |
| WhatsApp (linking, notifications, chat from phone) | Settings → Connections |
| Hotkey (default option + space) | Settings → General |
| New background tools (WhatsApp, iMessage, Mail...) | `tools/luna-mcp.js` (add to `TOOLS`), plus a line in `CLAUDE.md` |
| Skills she can reuse | `skills/<name>/SKILL.md` + a script (see `skills/make-a-skill/SKILL.md`) |
| The startup personality new users get | `templates/soul.md` and `CLAUDE.md` (these ship in the repo) |

## how her instructions fit together
Every chat turn runs Claude Code in this folder. Claude Code reads, in order:
1. `CLAUDE.md`: her standing instructions (personality, rules, tools, tags).
2. A short "about you" note from `selfAware()` in `main.js`: her version, model, folder, skills, and how to change herself.
3. Whatever she reads from `me/`: who you are, your people, deadlines, goals, `soul.md`.

So:
- **Rules for everyone who uses Luna** → `CLAUDE.md` (and `templates/soul.md`).
- **Rules just for you** → a file in `me/` (never in git, never shared).
- **Hard safety rules** → `lib/rules.js` (code, not prompts, so a clever email can't talk her out of them).

## the tags she uses
Luna ends replies with small commands the app acts on (parsed in `lib/tags.js`):
- `[[do: label | instruction]]`: a tap-to-run button
- `[[job: title | instructions]]`: a background job; results land in `outputs/`
- `[[routine: when | title | instructions]]` and `[[unroutine: title]]`: recurring jobs
- `[[watch: contact | minutes | how to reply]]` and `[[unwatch]]`: WhatsApp auto-reply
- `[[improve: title | what and why]]`: change her own code (an approve card first)

To add a new tag:
1. Parse it in `lib/tags.js` and add a test in `test/tags.test.js`.
2. Handle it in `handleTags()` in `main.js`.
3. Explain it in `CLAUDE.md`.

## changing the code (agentic engineering)
- Read `HOW-I-WORK.md` first. It's the map of every file.
- Put pure logic in `lib/` and test it in `test/` (style: `test('name', () => assert...)`).
- Run `npm run check` before keeping anything. It covers syntax, JSON, the code map and the tests.
- Run `npm run doctor` for the safety check-up.
- Don't weaken safety:
  - the approvals stay
  - `me/` stays private
  - the local API stays on 127.0.0.1 with its token
  - only your own WhatsApp self-chat can instruct her
- With Claude Code, a good prompt is: *"Read HOW-I-WORK.md and CUSTOMIZE.md. I want Luna to ___. Discuss options first, then build it with a test, run npm run check, and update the docs."*

## sharing
- **Characters:** the **share** button makes a `.lunachar` file.
- **Code:** this repo. `.gitignore` keeps everything personal out. Check before pushing:
  `git status` should never show `me/`, `.whatsapp/`, `.luna-prefs.json`, `browser-profile/`, `characters/` or `skills/<yours>`.
