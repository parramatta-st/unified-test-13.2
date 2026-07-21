export type PronounSet = 'she/her'|'he/him'|'they/them'|'';

type PronounTokens = {
  they: string; them: string; their: string; theirs: string;
  is: string; has: string; does: string;
};

function pick(pronouns: PronounSet): PronounTokens {
  switch (pronouns) {
    case 'she/her': return { they:'she', them:'her', their:'her', theirs:'hers', is:'is', has:'has', does:'does' };
    case 'he/him':  return { they:'he',  them:'him', their:'his', theirs:'his', is:'is', has:'has', does:'does' };
    case 'they/them': return { they:'they', them:'them', their:'their', theirs:'theirs', is:'are', has:'have', does:'do' };
    default: return { they:'they', them:'them', their:'their', theirs:'theirs', is:'is', has:'has', does:'does' };
  }
}

export function applyTokens(template: string, params: {
  name?: string; topic?: string; year?: string; tutor?: string; subject?: string; lesson?: string;
  pronouns?: PronounSet;
}) {
  const p = pick(params.pronouns || '');
  const caps = (s:string) => s.charAt(0).toUpperCase() + s.slice(1);
  const map: Record<string,string> = {
    name: params.name || '',
    topic: params.topic || '',
    subject: params.subject || '',
    lesson: params.lesson || '',
    year: params.year || '',
    tutor: params.tutor || '',
    they: p.they,
    them: p.them,
    their: p.their,
    theirs: p.theirs,
    They: caps(p.they),
    Them: caps(p.them),
    Their: caps(p.their),
    Theirs: caps(p.theirs),
    THEY: p.they.toUpperCase(),
    THEM: p.them.toUpperCase(),
    THEIR: p.their.toUpperCase(),
    THEIRS: p.theirs.toUpperCase(),
    is_are: p.is,
    has_have: p.has,
    does_do: p.does,
    IS_ARE: p.is.toUpperCase(),
    HAS_HAVE: p.has.toUpperCase(),
    DOES_DO: p.does.toUpperCase(),
  };
  // Unknown tokens are left as-is (e.g. a typo like {naem}) so the tutor can
  // spot and fix them in the preview instead of words silently disappearing.
  return template.replace(/\{([A-Za-z_]+)\}/g, (match, key) => (key in map ? map[key] : match));
}

export function defaultClosing(campusName?: string) {
  // Multi-site safe: no hardcoded centre name or phone number. The phone is
  // configured per centre via NEXT_PUBLIC_CONTACT_PHONE; when it is not set,
  // parents are invited to reply to the email instead of being shown another
  // centre's number.
  const name = (campusName || process.env.NEXT_PUBLIC_CAMPUS_NAME || 'Success Tutoring').trim();
  const phone = (process.env.NEXT_PUBLIC_CONTACT_PHONE || '').trim();
  const contactLine = phone
    ? `If you have any queries, feel free to contact us on ${phone}.`
    : 'If you have any queries, feel free to reply to this email.';
  return `Kind regards,\n${name}\n${contactLine}`;
}
