// the little [[...]] commands luna can end a reply with. parsing lives here (pure, tested in test/tags.test.js);
// main.js decides what to do with them.
//   [[watch: contact | minutes | how to reply]]   [[unwatch]]
//   [[job: title | instructions]]
//   [[routine: when | title | instructions]]     [[unroutine: title]]
//   [[improve: title | what to change and why]]   (luna changes her own code, see lib/improve.js)
//   [[do: label | instruction]]                   (tap-to-run suggestions, left in the text for the chat to show)
function parseTags(text) {
  const t = String(text || '');
  const out = { watch: null, unwatch: false, jobs: [], routines: [], unroutines: [], improve: [], actions: [] };
  const w = t.match(/\[\[watch:\s*([^|\]]+?)\s*(?:\|\s*(\d+)\s*)?(?:\|\s*([^\]]*?)\s*)?\]\]/i);
  if (w) out.watch = { contact: w[1], minutes: Number(w[2] || 60), notes: w[3] || '' };
  out.unwatch = /\[\[unwatch\]\]/i.test(t);
  for (const m of t.matchAll(/\[\[job:\s*([^|\]]+?)\s*\|\s*([^\]]+?)\s*\]\]/gi)) out.jobs.push({ title: m[1], instructions: m[2] });
  for (const m of t.matchAll(/\[\[routine:\s*([^|\]]+?)\s*\|\s*([^|\]]+?)\s*\|\s*([^\]]+?)\s*\]\]/gi)) out.routines.push({ when: m[1], title: m[2], instructions: m[3] });
  for (const m of t.matchAll(/\[\[unroutine:\s*([^\]]+?)\s*\]\]/gi)) out.unroutines.push(m[1]);
  for (const m of t.matchAll(/\[\[improve:\s*([^|\]]+?)\s*(?:\|\s*([^\]]+?)\s*)?\]\]/gi)) out.improve.push({ title: m[1], details: m[2] || m[1] });
  for (const m of t.matchAll(/\[\[do:\s*([^|\]]+?)\s*\|\s*([^\]]+?)\s*\]\]/gi)) out.actions.push({ label: m[1], prompt: m[2] });
  // what the person sees: every command tag removed except [[do:]], which the chat turns into buttons
  out.clean = t.replace(/\[\[(un)?watch[^\]]*\]\]|\[\[job:[^\]]*\]\]|\[\[(un)?routine:[^\]]*\]\]|\[\[improve:[^\]]*\]\]/gi, '').trim();
  return out;
}

// plain text for places without buttons (like whatsapp): actions become a numbered list you reply to with a number
function toPlain(text) {
  const p = parseTags(text);
  let body = p.clean.replace(/\[\[do:[^\]]*\]\]/gi, '').replace(/\n{3,}/g, '\n\n').trim();
  // cards (```agenda, ```tasks, ```files) read fine as plain lines without the fences
  body = body.replace(/```(agenda|tasks|files)\n?/g, '').replace(/```/g, '').replace(/\n{3,}/g, '\n\n').trim();
  if (p.actions.length) body += '\n\n' + p.actions.slice(0, 3).map((a, i) => `${i + 1}. ${a.label}`).join('\n') + '\n(reply with a number)';
  return { text: body.trim(), actions: p.actions.slice(0, 3) };
}

module.exports = { parseTags, toPlain };
