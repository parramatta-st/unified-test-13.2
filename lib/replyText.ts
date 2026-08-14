export function cleanReplyText(value: any) {
  let text = String(value ?? '').replace(/\r\n?/g, '\n').replace(/\u00a0/g, ' ').trim();
  if (!text) return '';

  text = text.replace(/^.{1,220}?\s+replied to the feedback email\.\s*\n+/i, '');

  const cutAt = (patterns: RegExp[]) => {
    let cut = -1;
    for (const pattern of patterns) {
      const index = text.search(pattern);
      if (index >= 0 && (cut < 0 || index < cut)) cut = index;
    }
    if (cut >= 0) text = text.slice(0, cut).trim();
  };

  cutAt([
    /\n\s*-{3,}\s*\n\s*Original subject:/i,
    /\n\s*Reply normally to this email\.[\s\S]*$/i,
    /\n\s*On[\s\S]{0,1200}?\bwrote:\s*(?:\n|$)/i,
    /\n\s*-{2,}\s*Original Message\s*-{2,}[\s\S]*$/i,
    /\n\s*From:\s*[^\n]+\n\s*(?:Sent|Date):\s*[^\n]+\n\s*To:\s*[^\n]+\n\s*Subject:\s*[^\n]+/i,
    /\n\s*_{5,}\s*\n/,
  ]);

  return text
    .split('\n')
    .filter((line) => !/^\s*>/.test(line))
    .join('\n')
    .replace(/<https?:\/\/[^>\s]{180,}>/gi, '')
    .replace(/https?:\/\/\S{250,}/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function cleanReplySubject(value: any) {
  let subject = String(value ?? '')
    .replace(/\[ST-RELAY:[^\]]+\]\s*/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

  let previous = '';
  while (subject && subject !== previous) {
    previous = subject;
    subject = subject.replace(/^(?:re|fw|fwd)\s*:\s*/i, '').trim();
  }
  return subject;
}
