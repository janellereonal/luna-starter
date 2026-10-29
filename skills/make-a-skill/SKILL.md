---
name: make-a-skill
description: how to save something you just figured out as a reusable skill (a small tested script plus one line describing it)
---
# making a skill

Make a skill when you worked out how to do something you'll likely need again: a site you had to click through, a file conversion, an API, a report you build the same way every week. Don't make one for a one-off.

1. Pick a short, obvious name in kebab-case (the name you'd search for later): `skills/<name>/`.
2. Write the work as a small script in that folder (`run.js` with plain Node, or `run.sh` / `run.py`). It should:
   - take inputs as command-line arguments, print plain text or JSON to stdout, and exit non-zero with a clear message on failure
   - never contain passwords, tokens or personal data (read them from the app's existing tools or ask)
   - do one thing; compose skills with each other instead of growing one script forever
3. Run it once for real and fix it until it works.
4. Write `skills/<name>/SKILL.md`:
   ```
   ---
   name: <name>
   description: <one line: what it does and when to use it>
   ---
   how to run it (exact command), what it needs, what it prints, gotchas you hit
   ```
5. Tell your human in one line: "saved this as a skill, next time it's instant".

Run skills with `node skills/<name>/run.js ...` (or `bash` / `python3`). Sentinel still checks every command, so skills can't skip approvals.
To fix a skill, edit its files. To remove one, ask your human first (deleting needs a yes).
