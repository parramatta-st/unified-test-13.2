/* Pure DOM reader. No requests, clicks, credentials or account changes. */
function createHapanaReader() {
  const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
  const normal = value => clean(value).replace(/[–—−]/g, '-');
  const months = ['january','february','march','april','may','june','july','august','september','october','november','december'];
  const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '') && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
  function dateFromHeading(text) {
    const match = clean(text).match(/(?:[A-Za-z]+,\s*)?([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})$/);
    if (!match) return null;
    const month = months.indexOf(match[1].toLowerCase());
    if (month < 0) return null;
    const date = `${match[3]}-${String(month + 1).padStart(2, '0')}-${match[2].padStart(2, '0')}`;
    return validDate(date) ? date : null;
  }
  function timeMinutes(text) {
    const match = clean(text).match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
    if (!match) return null;
    const h = Number(match[1]), m = Number(match[2]);
    if (h < 1 || h > 12 || m > 59) return null;
    return (h % 12 + (match[3].toUpperCase() === 'PM' ? 12 : 0)) * 60 + m;
  }
  function sessionRef(href) {
    try {
      const u = new URL(href, 'https://core.hapana.com/');
      const p = u.searchParams;
      if (u.origin !== 'https://core.hapana.com' || u.pathname !== '/index.php' || p.get('route') !== 'dashboard/schedule' || !/^\d+$/.test(p.get('seid') || '') || !/^\d+$/.test(p.get('eid') || '') || !validDate(p.get('dt')) || p.get('curr') !== p.get('dt')) return null;
      // Rebuild a narrow, known read-only URL. Never replay arbitrary query fields.
      const safe = new URL('/index.php', u.origin);
      for (const key of ['route','seid','dt','eid','curr']) safe.searchParams.set(key, p.get(key));
      return {id: `${p.get('dt')}:${p.get('seid')}:${p.get('eid')}`, date: p.get('dt'), seid: p.get('seid'), eid: p.get('eid'), url: safe.href};
    } catch { return null; }
  }
  function excluded(name) {
    const text = normal(name).toLowerCase();
    return /ass+e+s+ment|diagnostic|one\s*-?\s*(?:on\s*-?\s*)?one|1\s*[:\-]\s*1|1\s*-?\s*(?:on|to)\s*-?\s*1|one\s*to\s*one/.test(text);
  }
  function dateOnPage(doc) {
    return [...doc.querySelectorAll('h2')].map(e => dateFromHeading(e.textContent)).find(Boolean) || null;
  }
  function readDay(doc, pageUrl) {
    if (doc.querySelector('input[type="password"]') && /login/.test(pageUrl)) throw new Error('Sign in to Hapana in your own Chrome, then open the selected day again.');
    const date = dateOnPage(doc);
    const list = doc.querySelector('#getdaymyEvents');
    if (!date || !list) throw new Error('Open Hapana Schedule and select Day view for the date you want.');
    if (/Loading\s*\.{0,3}/i.test(list.textContent)) throw new Error('Hapana is still loading the day. Please wait, then try again.');
    const refs = new Map();
    for (const a of list.querySelectorAll('a[href]')) {
      const ref = sessionRef(a.getAttribute('href'));
      if (!ref) continue;
      if (ref.date !== date) throw new Error('The calendar date and class list disagree. Wait for Hapana to finish changing dates.');
      const text = normal(a.textContent);
      const match = text.match(/^(\d{1,2}:\d{2}\s*[AP]M)\s+(.+?)(?:\((\d+)\))?$/i);
      if (!match || timeMinutes(match[1]) === null) throw new Error('A class title could not be read. Please keep Hapana in Day view.');
      refs.set(ref.id, {...ref, name: clean(match[2]), start: timeMinutes(match[1]), displayedBooked: match[3] === undefined ? null : Number(match[3]), excluded: excluded(match[2])});
    }
    const all = [...refs.values()];
    if (!all.length) throw new Error('No class links were found for this date. Check that the day has loaded and that no schedule filters are hiding classes.');
    return {date, sessions: all.filter(s => !s.excluded), excluded: all.filter(s => s.excluded), total: all.length};
  }
  function readSession(doc, pageUrl, expected) {
    const current = sessionRef(pageUrl);
    if (!current || current.id !== expected.id) throw new Error('Waiting for the requested session to open.');
    if (dateOnPage(doc) !== expected.date) throw new Error('Waiting for the selected date.');
    const panel = doc.querySelector('#eventLoad');
    const heading = panel?.querySelector('h4');
    const title = normal(heading?.textContent);
    const m = title.match(/^(.*?)\s*-\s*(\d{1,2}:\d{2}\s*[AP]M)\s*-\s*(\d{1,2}:\d{2}\s*[AP]M)$/i);
    if (!m || normal(m[1]) !== normal(expected.name) || timeMinutes(m[2]) !== expected.start) throw new Error('Waiting for matching class details.');
    const start = timeMinutes(m[2]), end = timeMinutes(m[3]);
    if (start === null || end === null || end <= start) throw new Error('The class times need checking in Hapana.');
    const props = {};
    for (const strong of panel.querySelectorAll('li strong')) {
      const row = strong.closest('li');
      const cols = [...row.children].filter(e => e.tagName === 'DIV');
      if (cols.length === 2) props[clean(strong.textContent).replace(/:$/, '')] = clean(cols[1].textContent);
    }
    if (!props.Instructor) throw new Error('The instructor name has not loaded.');
    if (!props.Location || !/parramatta/i.test(props.Location)) throw new Error('This extension is configured for Parramatta. The session location needs checking.');
    const identity = panel.querySelector('[title="Edit Session Instructor"][data-eid]');
    if (identity && (identity.getAttribute('data-eid') !== expected.eid || identity.getAttribute('data-bstd') !== expected.date)) throw new Error('The session identity does not match the selected booking.');
    const countNode = [...doc.querySelectorAll('div,span,p')].find(e => /^Total Booked:\s*\d+\s*\|\s*Capacity:/.test(clean(e.textContent)) && clean(e.textContent).length < 130);
    const counts = clean(countNode?.textContent).match(/Total Booked:\s*(\d+)\s*\|\s*Capacity:\s*(\d+)/i);
    if (!counts) throw new Error('The booking count has not loaded.');
    const booked = Number(counts[1]), capacity = Number(counts[2]);
    const list = doc.querySelector('#attendeesList');
    if (!list) throw new Error('The booked student list has not loaded.');
    const header = list.querySelector('li.heading');
    const labels = [...(header?.children || [])].map(e => clean(e.textContent));
    const phoneIndex = labels.findIndex(s => /^Phone/i.test(s));
    const paymentIndex = labels.findIndex(s => /^Payment Type$/i.test(s));
    const lateCancelIndex = labels.findIndex(s => /^Late\s*Cancel(?:led|lation(?:s)?)?$/i.test(s));
    const students = new Map();
    const cancellationStates = new Map(), cancelled = new Set();
    for (const row of list.querySelectorAll(':scope > li')) {
      const cells = [...row.children].filter(e => e.tagName === 'DIV');
      // Hapana renders each student twice (desktop + mobile). Use the structured desktop row.
      if (cells.length !== labels.length || cells.length < 5) continue;
      const a = row.querySelector('a[href*="cid="]');
      if (!a) continue;
      const id = new URL(a.getAttribute('href'), pageUrl).searchParams.get('cid');
      const name = clean(a.textContent);
      if (!id || !name) throw new Error('A booked student is missing their name or identifier.');
      // Hapana keeps late-cancelled clients in the booked-list DOM, while
      // Total Booked excludes them. Read only that labelled column: RSVP,
      // attendance, payment and row styling do not determine a booking.
      const lateCancelled = lateCancelIndex >= 0 && [...cells[lateCancelIndex].querySelectorAll('input[type="checkbox"]')].some(input => input.checked === true);
      if (cancellationStates.has(id) && cancellationStates.get(id) !== lateCancelled) throw new Error('A student’s cancellation status changed while the list was loading. Wait, then retry this class.');
      cancellationStates.set(id, lateCancelled);
      if (lateCancelled) { cancelled.add(id); continue; }
      students.set(id, {id, name, phone: phoneIndex >= 0 ? clean(cells[phoneIndex]?.textContent) : '', payment: paymentIndex >= 0 ? clean(cells[paymentIndex]?.textContent) : ''});
    }
    if (students.size !== booked) throw new Error(`Incomplete student list: read ${students.size} of ${booked} bookings. No roll will be printed for this class until they match.`);
    if (booked > 0 && !labels.includes('Client Name')) throw new Error('Hapana’s attendee layout has changed. Please report this before using the roll.');
    const warnings = [];
    if (cancelled.size) warnings.push(`${cancelled.size} late cancellation${cancelled.size === 1 ? '' : 's'} excluded from booked students.`);
    if (booked > capacity) warnings.push(`${booked} booked / ${capacity} capacity in Hapana`);
    if (expected.displayedBooked !== null && booked !== expected.displayedBooked) warnings.push('Booking count changed since the day was loaded; the opened session count was used.');
    return {...expected, name: clean(m[1]), start, end, time: `${clean(m[2])} - ${clean(m[3])}`, tutor: props.Instructor, campus: props.Location, sessionType: props['Session Type'] || '', booked, capacity, students: [...students.values()].sort((a,b) => a.name.localeCompare(b.name, 'en-AU')), warnings, room: '', collectedAt: new Date().toISOString()};
  }
  return {clean, normal, timeMinutes, validDate, dateFromHeading, sessionRef, excluded, readDay, readSession};
}
// NODE EXPORT
if (typeof module !== 'undefined' && module.exports) module.exports = createHapanaReader;
