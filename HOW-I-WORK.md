# how I work (Luna's map of her own code)

Luna reads this when she explains, debugs or improves herself. Keep it true: `node scripts/check.js` fails if a file in `lib/` isn't described here.

## the big picture
- **App:** an Electron app. `main.js` is the main process (windows, tray menu, the brain, jobs, routines, WhatsApp, approvals). The character and the little chat are web pages (`index.html`, `renderer.js`, `chat.js`); Settings is `settings.html` + `settings.js`.
- **Brain:** each chat turn runs `claude -p` (Claude Code, on the person's own Claude login) in this folder, streaming JSON. It reads `CLAUDE.md` (how to behave) and `me/` (who the person is). It gets `--append-system-prompt` with a short self-description from `selfAware()` in `main.js`: version, model, folder, skills. Other AI providers go through `lib/agent.js`.
- **Hands:** the person's Claude connectors (Gmail, Calendar, Drive, Notion, Slack...) come through Claude Code automatically. Local tools Claude Code can't reach are in `tools/luna-mcp.js` (WhatsApp, iMessage, Mail, Contacts, Spotlight file search). It calls back into the app through a token-protected HTTP API on 127.0.0.1.
- **Safety:** `tools/sentinel.js` runs before and after every tool call (a Claude Code hook). Its fixed rules (`lib/rules.js`) decide what needs the person's tap: money, deleting, public posts, sharing files, bulk sends, automation changes. Everything that changes something is logged to `me/activity.md`.
- **Memory:** plain files in `me/`. Personal, never in git. `me/soul.md` is Luna's own personality, made from `templates/soul.md` on first run.

## files
- `main.js`: everything in the main process. Search for its section headers (`// ----------`): the brain, sentinel, jobs, routines, auto-reply, proactive check-ins, characters, whatsapp + local api, phone chat, self-improvement, safety check-up, soul.
- `preload.js` / `preload-settings.js`: the only bridge from web pages to the main process (contextIsolation on).
- `chat.js`: the chat UI (small bubble chat and the full window). `md.js` renders replies, including the ```agenda / ```tasks / ```files cards.
- `renderer.js`: the 3D gecko on the desktop: walking, climbing, moods. `buddy.js` + `buddy-core.js`: custom characters (a picture or GIF turned into a soft mesh puppet, or a .glb model).
- `settings.html` / `settings.js` / `settings.css`: settings, the Get started wizard, the character editor.
- `setup-canvas.js`: copies a Canvas MCP server from the Claude desktop app.
- `lib/agent.js`: agent loop for non-Claude models (OpenAI-compatible APIs), with the same safety rules.
- `lib/connect.js`: connecting to what the person already has: Claude login status, Claude desktop app tools, Claude Code memory, the bridge into the Claude app, the memory prompt, the data export.
- `lib/wa.js`: Luna's own WhatsApp line (Baileys, a linked device): send, read, files, contacts, the self-chat, typing dots.
- `lib/phone.js`: rules for chatting with Luna from your phone (only your own "message yourself" chat counts; numbered replies).
- `lib/voice.js`: voice notes to text (a local whisper if installed, else an OpenAI key if saved).
- `lib/tags.js`: parses the `[[...]]` commands at the end of Luna's replies (job, routine, watch, improve, do) and turns replies into plain text for WhatsApp.
- `lib/schedule.js`: when a routine is due ("daily 07:30", "weekdays 09:00", "every 3h").
- `lib/charpack.js`: `.lunachar` files for sharing characters, and renaming characters.
- `lib/skills.js`: lists the skills Luna wrote for herself (`skills/<name>/SKILL.md`) as one line each.
- `lib/improve.js`: self-improvement safety net: snapshots, undo, change lists, guarded files, the engineering brief.
- `lib/doctor.js`: the safety check-up (network, secrets on disk, trust mode, model strength, git hygiene).
- `lib/rules.js`: the fixed safety rules shared by Sentinel and `lib/agent.js`. Guarded.
- `tools/sentinel.js`: the safety hook. Guarded.
- `tools/luna-mcp.js`: Luna's MCP server (background tools + the bridge tools the Claude app can use).
- `tools/*.applescript`, `tools/*.sh`: Mac control kit, screenshots, reading the WhatsApp app's database.
- `scripts/check.js`: local checks (syntax, JSON, this map, tests). Guarded. `scripts/doctor.js`: the safety check-up from a terminal.
- `test/*.test.js`: tests. Style: `test('name', () => { assert... })`, with `test` and `assert` provided by `scripts/check.js`. Pure logic goes in `lib/` so it can be tested without Electron.
- `skills/`: skills Luna saved for herself (personal, not in git) plus `skills/make-a-skill/`, which explains how to make one.
- `templates/soul.md`: the starting personality.

## how Luna changes herself (agentic engineering)
1. In chat, Luna ends a reply with `[[improve: title | what and why]]`.
2. The app shows an approve card (skipped only in full trust mode).
3. `lib/improve.js` snapshots every code file into `.luna-snapshots/` (the last 5 are kept).
4. A separate Claude Code session (Opus) gets `improve.brief()`: understand the intent, read this map, make the smallest change in the existing style, add a test, run `node scripts/check.js`, ask "what would I refactor now that it's built?", and update this map.
5. The app itself then checks:
   - the guarded files must be byte-for-byte unchanged
   - `scripts/check.js` must pass, run in a fresh process
   If either fails, everything is restored automatically.
6. When it passes, Luna offers: restart now, what changed?, undo it. The history is in `me/self-changes.md`. The 🦎 menu also has "undo my last self-change".

## conventions
- Plain CommonJS, no build step, no new npm packages.
- Short obvious names. Comments say why, not what.
- No em dashes in anything Luna says.
- Never weaken safety:
  - approvals stay
  - `me/` stays private
  - the local API stays on 127.0.0.1 with its token
  - only the person's own self-chat can instruct Luna over WhatsApp
