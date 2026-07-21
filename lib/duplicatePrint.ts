export type DuplicatePrintKind = 'print' | 'print-topic';

export type DuplicatePrintIdentity = {
  kind?: string;
  folder?: string;
  ids?: string[];
  names?: string[];
  paths?: string[];
  ok?: boolean;
};

export type DuplicatePrintMatch = {
  matches: boolean;
  reason?: 'material-path' | 'material-id' | 'material-name' | 'folder-set' | 'folder-fallback';
};

function norm(value: unknown) {
  return String(value ?? '').trim().toLowerCase();
}

function normalizeKind(value: unknown): DuplicatePrintKind {
  const v = norm(value);
  return v === 'print-topic' || v === 'print_topic' || v === 'print-folder' || v === 'print_folder'
    ? 'print-topic'
    : 'print';
}

function normalizedSet(values?: string[]) {
  return new Set((values || []).map(norm).filter(Boolean));
}

function overlaps(a: Set<string>, b: Set<string>) {
  if (!a.size || !b.size) return false;
  for (const value of a) if (b.has(value)) return true;
  return false;
}

function setsEqual(a: Set<string>, b: Set<string>) {
  if (!a.size || !b.size || a.size !== b.size) return false;
  for (const value of a) if (!b.has(value)) return false;
  return true;
}

/**
 * Determines whether a prior successful print is the same print operation.
 *
 * Important behaviour:
 * - An individual print is NOT a duplicate merely because another file from
 *   the same topic/folder was printed.
 * - An individual print matches by exact material path or material ID.
 * - Name matching is only a legacy fallback and must also share the folder.
 * - A folder print only matches another folder print with the same material set
 *   (or the same folder when old logs do not contain a material set).
 * - Failed print rows never count as duplicates.
 */
export function matchDuplicatePrint(
  request: DuplicatePrintIdentity,
  candidate: DuplicatePrintIdentity,
): DuplicatePrintMatch {
  if (candidate.ok === false) return { matches: false };

  const requestKind = normalizeKind(request.kind);
  const candidateKind = normalizeKind(candidate.kind);
  const sameFolder = !!norm(request.folder) && norm(request.folder) === norm(candidate.folder);

  const requestPaths = normalizedSet(request.paths);
  const candidatePaths = normalizedSet(candidate.paths);
  const requestIds = normalizedSet(request.ids);
  const candidateIds = normalizedSet(candidate.ids);
  const requestNames = normalizedSet(request.names);
  const candidateNames = normalizedSet(candidate.names);

  if (requestKind === 'print') {
    if (overlaps(requestPaths, candidatePaths)) return { matches: true, reason: 'material-path' };
    if (overlaps(requestIds, candidateIds)) return { matches: true, reason: 'material-id' };

    // Legacy rows may not contain stable IDs/paths. Only use the human-readable
    // name when it is in the same folder. Never use same-folder by itself.
    const requestHasStableIdentity = requestPaths.size > 0 || requestIds.size > 0;
    const candidateHasStableIdentity = candidatePaths.size > 0 || candidateIds.size > 0;
    if ((!requestHasStableIdentity || !candidateHasStableIdentity) && sameFolder && overlaps(requestNames, candidateNames)) {
      return { matches: true, reason: 'material-name' };
    }

    return { matches: false };
  }

  // A full-folder request should not be blocked because a single file in that
  // folder was printed. Compare it only with previous full-folder requests.
  if (candidateKind !== 'print-topic') return { matches: false };

  if (setsEqual(requestPaths, candidatePaths)) return { matches: true, reason: 'folder-set' };
  if (setsEqual(requestIds, candidateIds)) return { matches: true, reason: 'folder-set' };
  if (sameFolder && setsEqual(requestNames, candidateNames)) return { matches: true, reason: 'folder-set' };

  const requestHasSet = requestPaths.size > 0 || requestIds.size > 0 || requestNames.size > 0;
  const candidateHasSet = candidatePaths.size > 0 || candidateIds.size > 0 || candidateNames.size > 0;
  if (sameFolder && (!requestHasSet || !candidateHasSet)) return { matches: true, reason: 'folder-fallback' };

  return { matches: false };
}
