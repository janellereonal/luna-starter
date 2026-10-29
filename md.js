// turns luna's replies into friendly formatting: headings, lists, bold, links, tables, code,
// and special cards: ```agenda (your day / calendar), ```tasks (checklist), ```files (tap to open)
(function () {
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const bridge = () => window.luna || {};

  function inline(parent, text) {
    // order matters: code, links, bold, italic
    const re = /(`[^`]+`)|\[([^\]]+)\]\((https?:\/\/[^\s)]+|file:\/\/[^\s)]+|\/[^\s)]+)\)|(https?:\/\/[^\s<>()]+[^\s<>().,!?;:'"])|(\*\*[^*]+\*\*)|(__[^_]+__)|(\*[^*\s][^*]*\*)|(~~[^~]+~~)/g;
    let last = 0, m;
    while ((m = re.exec(text))) {
      if (m.index > last) parent.appendChild(document.createTextNode(text.slice(last, m.index)));
      if (m[1]) parent.appendChild(el('code', null, m[1].slice(1, -1)));
      else if (m[2]) parent.appendChild(link(m[2], m[3]));
      else if (m[4]) parent.appendChild(link(m[4].replace(/^https?:\/\/(www\.)?/, '').slice(0, 48), m[4]));
      else if (m[5] || m[6]) inline(parent.appendChild(el('strong')), (m[5] || m[6]).slice(2, -2));
      else if (m[7]) inline(parent.appendChild(el('em')), m[7].slice(1, -1));
      else if (m[8]) inline(parent.appendChild(el('s')), m[8].slice(2, -2));
      last = re.lastIndex;
    }
    if (last < text.length) parent.appendChild(document.createTextNode(text.slice(last)));
  }
  function link(label, href) {
    const a = el('a', null, label); a.href = '#'; a.title = href;
    a.onclick = (e) => { e.preventDefault(); openThing(href); };
    return a;
  }
  function openThing(href) {
    const b = bridge();
    if (/^https?:\/\//.test(href)) b.openUrl ? b.openUrl(href) : window.open(href);
    else b.openFile && b.openFile(href.replace(/^file:\/\//, ''));
  }

  // ---------- cards ----------
  function agenda(lines) {
    const card = el('div', 'card agenda');
    let title = 'your day';
    const items = [];
    for (const raw of lines) {
      const l = raw.trim(); if (!l) continue;
      if (/^title:/i.test(l)) { title = l.replace(/^title:\s*/i, ''); continue; }
      const parts = l.split('|').map((x) => x.trim());
      let time = parts[0], what = parts[1] || '', where = parts[2] || '';
      if (parts.length === 1) { const mm = l.match(/^(\S+(?:\s*[-–]\s*\S+)?)\s+(.*)$/); time = mm ? mm[1] : ''; what = mm ? mm[2] : l; }
      items.push({ time, what, where, important: /^!/.test(what) || /^!/.test(time) });
    }
    card.appendChild(el('div', 'card-h', '📅 ' + title));
    const now = new Date(), mins = now.getHours() * 60 + now.getMinutes();
    const toMin = (s) => { const m = String(s).match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i); if (!m) return null; let h = +m[1]; const mi = +(m[2] || 0); if (m[3]) { if (/pm/i.test(m[3]) && h < 12) h += 12; if (/am/i.test(m[3]) && h === 12) h = 0; } return h * 60 + mi; };
    items.forEach((it, i) => {
      const row = el('div', 'ag-row' + (it.important ? ' imp' : ''));
      const [a, b] = String(it.time).replace(/^!/, '').split(/\s*[-–]\s*/);
      const s = toMin(a), e = b ? toMin(b) : (items[i + 1] ? toMin(String(items[i + 1].time).split(/\s*[-–]\s*/)[0]) : null);
      if (s != null && mins >= s && (e == null ? mins < s + 60 : mins < e)) row.classList.add('now');
      else if (e != null && mins >= e) row.classList.add('past');
      row.appendChild(el('div', 'ag-time', String(it.time).replace(/^!/, '')));
      const body = el('div', 'ag-body'); inline(body.appendChild(el('div', 'ag-what')), it.what.replace(/^!\s*/, ''));
      if (it.where) inline(body.appendChild(el('div', 'ag-where')), it.where);
      row.appendChild(body); card.appendChild(row);
    });
    if (!items.length) card.appendChild(el('div', 'ag-where', 'nothing scheduled 🎉'));
    return card;
  }
  function tasks(lines) {
    const card = el('div', 'card tasks');
    let title = null;
    for (const raw of lines) {
      const l = raw.trim(); if (!l) continue;
      if (/^title:/i.test(l)) { title = l.replace(/^title:\s*/i, ''); continue; }
      const done = /^\[x\]/i.test(l), text = l.replace(/^(?:[-*]\s*)?\[[ x]?\]\s*/i, '');
      const [what, note] = text.split('|').map((x) => x.trim());
      const row = el('label', 'task' + (done ? ' done' : ''));
      const cb = el('input'); cb.type = 'checkbox'; cb.checked = done; cb.onchange = () => row.classList.toggle('done', cb.checked);
      row.appendChild(cb);
      const t = el('span'); inline(t, what || ''); row.appendChild(t);
      if (note) row.appendChild(el('em', null, note));
      card.appendChild(row);
    }
    if (title) card.prepend(el('div', 'card-h', '✅ ' + title));
    return card;
  }
  const ICON = { pdf: '📕', doc: '📘', docx: '📘', pages: '📘', xls: '📗', xlsx: '📗', csv: '📗', numbers: '📗', ppt: '📙', pptx: '📙', key: '📙', png: '🖼️', jpg: '🖼️', jpeg: '🖼️', heic: '🖼️', mp4: '🎬', mov: '🎬', zip: '🗜️' };
  function files(lines) {
    const card = el('div', 'files');
    for (const raw of lines) {
      const p = raw.trim().replace(/^[-*]\s*/, '').split('|')[0].trim(); if (!p) continue;
      const name = p.split('/').pop(), ext = (name.split('.').pop() || '').toLowerCase();
      const chip = el('button', 'file'); chip.type = 'button'; chip.title = p;
      chip.appendChild(el('span', 'fi', ICON[ext] || '📄')); chip.appendChild(el('span', 'fn', name));
      chip.onclick = () => openThing(p);
      card.appendChild(chip);
    }
    return card;
  }

  // ---------- blocks ----------
  function render(target, text) {
    target.textContent = '';
    target.classList.add('md');
    const lines = String(text || '').replace(/\r/g, '').split('\n');
    let i = 0, para = null;
    const endPara = () => { para = null; };
    while (i < lines.length) {
      const line = lines[i];
      const fence = line.match(/^\s*```\s*([\w-]*)\s*$/);
      if (fence) {
        const kind = fence[1].toLowerCase(), body = [];
        i++; while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) body.push(lines[i++]);
        i++; endPara();
        if (kind === 'agenda' || kind === 'calendar' || kind === 'schedule') target.appendChild(agenda(body));
        else if (kind === 'tasks' || kind === 'todo') target.appendChild(tasks(body));
        else if (kind === 'files') target.appendChild(files(body));
        else { const pre = el('pre'); pre.appendChild(el('code', null, body.join('\n'))); target.appendChild(pre); }
        continue;
      }
      if (!line.trim()) { endPara(); i++; continue; }
      let m;
      if ((m = line.match(/^(#{1,4})\s+(.*)$/))) { endPara(); inline(target.appendChild(el('h' + Math.min(4, m[1].length + 2))), m[2]); i++; continue; }
      if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { endPara(); target.appendChild(el('hr')); i++; continue; }
      if (/^\s*>/.test(line)) { endPara(); const q = el('blockquote'); while (i < lines.length && /^\s*>/.test(lines[i])) { inline(q, lines[i].replace(/^\s*>\s?/, '') + ' '); i++; } target.appendChild(q); continue; }
      if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
        endPara();
        const row = (l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
        const wrap = el('div', 'tablewrap'), table = el('table'), thead = el('thead'), tr = el('tr');
        row(line).forEach((c) => inline(tr.appendChild(el('th')), c)); thead.appendChild(tr); table.appendChild(thead);
        i += 2; const tb = el('tbody');
        while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) { const r = el('tr'); row(lines[i]).forEach((c) => inline(r.appendChild(el('td')), c)); tb.appendChild(r); i++; }
        table.appendChild(tb); wrap.appendChild(table); target.appendChild(wrap); continue;
      }
      if (/^\s*([-*•]|\d+[.)])\s+/.test(line)) {
        endPara();
        const ordered = /^\s*\d+[.)]/.test(line), list = el(ordered ? 'ol' : 'ul');
        while (i < lines.length && /^\s*([-*•]|\d+[.)])\s+/.test(lines[i])) {
          const t = lines[i].replace(/^\s*([-*•]|\d+[.)])\s+/, ''), li = el('li');
          const cb = t.match(/^\[([ xX])\]\s*(.*)$/);
          if (cb) { li.className = 'check' + (cb[1] !== ' ' ? ' done' : ''); li.appendChild(el('span', 'box', cb[1] !== ' ' ? '✓' : '')); inline(li, cb[2]); }
          else inline(li, t);
          list.appendChild(li); i++;
          while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !/^\s*([-*•]|\d+[.)])\s+/.test(lines[i])) { inline(li, ' ' + lines[i].trim()); i++; }
        }
        target.appendChild(list); continue;
      }
      if (!para) { para = target.appendChild(el('p')); inline(para, line); }
      else { para.appendChild(document.createElement('br')); inline(para, line); }
      i++;
    }
  }
  window.LunaMD = { render };
})();
