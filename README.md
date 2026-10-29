# Luna 🦎

A personal AI agent that lives on your Mac desktop as a little character. She walks around your screen, you tap her to chat, and she actually does things for you: plans your day, checks your deadlines and messages, sends texts and files, runs routines, and taps you when something matters.

Luna runs on **your own Claude account** (Pro or Max) through Claude Code. No API key, no extra cost.

## What she can do

- **Knows you.** Brings over what your Claude account remembers about you, reads your Claude Code notes, can learn from your past Claude chats, and keeps learning as you talk.
- **Uses your stuff.** Every app you connected on claude.ai (Gmail, Calendar, Drive, Notion, Slack...) and every tool you added to the Claude desktop app (like Canvas) works automatically.
- **Does the work in the background.** WhatsApp (link once with a QR), iMessage and SMS, email with attachments, finding any file on your Mac and sending it, your calendar, your browser. Nothing types on your screen.
- **Plans with you.** Your day shows up as an agenda card, to-dos as a checklist, files as tap-to-open chips.
- **Proactive.** Check-ins, routines ("every weekday at 7:30, brief me"), deadline radar, a tap when someone messages you.
- **Safe.** An independent checker (Sentinel) asks before anything risky: payments, deleting, posting publicly, sharing files, bulk sends. Every action is logged.
- **Make her yours.** Pick any picture or GIF and she scans it, finds the face, eyes, mouth, arms and legs, and brings it to life (blinks, talks, walks, waves, dances). Or a 3D model (.glb).
- **Share characters.** Tap **share** on any character to save it as one small `.lunachar` file (picture, scan and animation). Friends add it with **+ add character** and it's ready, no rescan.
- **On your phone too.** Message yourself on WhatsApp and Luna answers in that chat, even voice notes and photos. Reply with a number to pick one of her suggestions. Only your own self-chat can give her instructions.
- **Has a soul.** Her personality and values live in `me/soul.md`, in her own words, and she grows it over time (and tells you when she does). She follows up on the things that matter ("how did the pitch go?").
- **Safety check-up.** One tap checks for open network doors, readable login files, approvals switched off, small easy-to-trick models, and private files in git. It fixes file permissions itself.
- **Claude-style app.** Light and dark mode, a full-screen window, a little chat by your character, voice typing.

## Built with agentic engineering

Luna can change her own code. Ask her for a feature ("add a pomodoro timer", "make the chat bubble bigger") and she rebuilds herself, the way a careful engineer would rather than by vibe coding:

1. **She knows herself.** Every session she's told her version, her model, her folder and her skills. `HOW-I-WORK.md` is her map of her own code.
2. **You approve first.** A tap on the approve card starts it. A message or a web page alone can't make her rewrite herself.
3. **She snapshots everything** (the last 5 snapshots are kept).
4. **A separate engineering session (Opus) makes the change.** It reads the code, makes the smallest change in the existing style, adds a test, runs the local checks, then asks itself *"now that it's built, what would I refactor?"* and updates the docs.
5. **The app checks the work itself.** The checks run again in a fresh process, and the safety files must be byte-for-byte unchanged. If anything fails, everything goes back automatically.
6. **One tap to restart, see what changed, or undo.** The history is in `me/self-changes.md`.

She also **writes skills for herself**. When she figures out something she'll need again, she saves it as a small tested script plus a one-line description. Only the one-liners sit in her context, so it stays fast as she learns.

Run the checks yourself any time with `npm run check` (syntax, the code map, 20+ tests), or run `npm run doctor` for the safety check-up.

## Install (Mac)

You need: a Mac, a Claude Pro or Max plan, and [Node.js 20+](https://nodejs.org).

```bash
git clone https://github.com/janellereonal/luna-starter ~/Documents/luna
cd ~/Documents/luna && bash install.sh
```

The installer adds Claude Code if you don't have it, signs you in to Claude, and starts Luna.

## First run

Luna opens **Get started**:

1. **Your name.**
2. **Your Claude.** She checks you're signed in and lists the apps and tools she found.
3. **Your memory.**
   - Claude Code notes on your Mac sync on their own.
   - **Bring my Claude memory**: she opens Claude with the question ready; press enter and copy the answer. She catches it from your clipboard.
   - **Put me inside the Claude app**: adds Luna's tools to the Claude desktop app, so in any Claude chat you can say *"save everything you remember about me to luna"* or *"remind me every morning through luna"*.
   - **Learn from your past Claude chats**: drop in your Claude data export (Claude → Settings → Privacy → Export data).
4. **Let me get to know you.** A read-only look through your memory, calendar, email, school/work apps, chats and recent files. She writes down who you are, your people, deadlines and projects.
5. **Make me yours.** Character, WhatsApp, Mac permissions.

Why not fully automatic for memory? Claude doesn't offer a way for other apps to read your Claude memory, so Luna uses the official routes above (they take a few seconds).

## Mac permissions

For Luna to work in your apps, allow **Electron** (and Terminal) in System Settings → Privacy & Security: Accessibility, Automation, Screen Recording. Settings → Mac access in Luna has shortcuts.

## Privacy

Everything Luna knows lives in the `me/` folder on your Mac, in plain text you can read and edit (Settings → Memory). Nothing personal is in this repo (see `.gitignore`). Your messages go only to your own Claude account and the apps you connected.

WhatsApp: Luna links as a linked device using an unofficial library. It's your own account and you can unlink any time, but WhatsApp doesn't officially support it.

## Other AI models

Prefer GPT, Gemini, OpenRouter or a local model (Ollama)? Settings → Brain. Claude gets the most features.

## Make it yours

See [CUSTOMIZE.md](CUSTOMIZE.md): where every instruction, rule and setting lives. For the code, see [HOW-I-WORK.md](HOW-I-WORK.md).

## License

MIT
