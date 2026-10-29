// shared safety rules (used by tools/sentinel.js for claude, and by lib/agent.js for every other model)
const RULES = [
  [/checkout|place[ _-]?order|purchase|buy now|\bpay(ment)?\b|credit card|card number|gcash|maya|bank transfer|subscribe/i, 'money'],
  [/delete|trash|remove|unpublish|archive|empty[_ ]?trash|drop table|rm -/i, 'deleting'],
  [/create_post|publish_post|share_post|tweet|story|post_to_(feed|page)|comment_on|reply_to_comment/i, 'posting publicly'],
  [/share_file|permissions|make_public|anyone with the link/i, 'sharing files'],
  [/publish_workflow|activate_workflow|update_workflow|archive_workflow|publish_agent/i, 'changing an automation'],
  [/send_bulk|bulk_|mass_/i, 'bulk sending']
];
// rules look at what the action is (tool, url, button, command), not the words inside a message
const MSG_FIELDS = new Set(['text', 'body', 'message', 'content', 'html', 'markdown', 'caption', 'description', 'notes']);

function needsApproval(tool, input) {
  const blob = JSON.stringify(Object.fromEntries(Object.entries(input || {}).filter(([k]) => !MSG_FIELDS.has(k)))).slice(0, 4000);
  const hay = tool + ' ' + blob;
  for (const [re, why] of RULES) if (re.test(hay)) return why;
  return null;
}

module.exports = { RULES, MSG_FIELDS, needsApproval };
