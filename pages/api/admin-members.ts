import type { NextApiRequest, NextApiResponse } from "next";
import { requireAdmin } from "../../lib/adminAuth";
import {
  appendMember,
  cleanMemberInput,
  findDuplicateMember,
  generateMemberId,
  loadMembers,
  saveMemberRow,
  saveMembers,
  type Member,
} from "../../lib/members";
import {
  privateSheetsConfigured,
  privateSheetsConfigSummary,
} from "../../lib/googleSheets";

function norm(v: any) {
  return String(v ?? "").trim();
}
function sameId(a: any, b: any) {
  return norm(a) && norm(a) === norm(b);
}
function importId(row: any) {
  return norm(
    row?.id || row?.ID || row?.memberId || row?.MemberID || row?.["Member ID"],
  );
}
function isPrivateSource(source: any) {
  return String(source || "") === "private-sheet";
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  res.setHeader("Cache-Control", "no-store");
  const admin = await requireAdmin(req);
  if (!admin.isAdmin)
    return res.status(403).json({ ok: false, error: "Admin access required" });

  if (req.method === "GET") {
    try {
      const loaded = await loadMembers();
      return res.status(200).json({
        ok: true,
        members: loaded.members,
        source: loaded.source,
        privateSheetsConfigured: privateSheetsConfigured(),
        privateSheets: privateSheetsConfigSummary(),
        warning: (loaded as any).warning || "",
      });
    } catch (e: any) {
      return res
        .status(500)
        .json({ ok: false, error: e?.message || "Could not load members" });
    }
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    const action = norm(req.body?.action || "");
    const loaded = await loadMembers();
    let members = loaded.members || [];
    const sourceWasPrivate = isPrivateSource(loaded.source);

    if (action === "create") {
      const candidate = cleanMemberInput({
        ...req.body?.member,
        id: generateMemberId(),
        active: true,
      });
      const duplicate = findDuplicateMember(members, candidate);
      if (duplicate && !req.body?.force)
        return res.status(409).json({
          ok: false,
          error: "A matching active/inactive member already exists.",
          duplicate,
        });
      members = [...members, candidate];
      // If the list came from the old CSV fallback, save the full list once so the private sheet catches up.
      if (sourceWasPrivate) await appendMember(candidate);
      else await saveMembers(members);
      return res.status(200).json({
        ok: true,
        member: candidate,
        members,
        source: "private-sheet",
      });
    }

    if (action === "update") {
      const id = norm(req.body?.id || req.body?.member?.id);
      const idx = members.findIndex((m) => m.id === id);
      if (idx < 0)
        return res.status(404).json({ ok: false, error: "Member not found" });
      const updated = cleanMemberInput(req.body?.member || {}, id);
      const duplicate = findDuplicateMember(members, updated, id);
      if (duplicate && !req.body?.force)
        return res.status(409).json({
          ok: false,
          error: "A matching active/inactive member already exists.",
          duplicate,
        });
      members[idx] = updated;
      if (sourceWasPrivate) await saveMemberRow(updated);
      else await saveMembers(members);
      return res
        .status(200)
        .json({ ok: true, member: updated, members, source: "private-sheet" });
    }

    if (action === "deactivate" || action === "reactivate") {
      const id = norm(req.body?.id);
      const idx = members.findIndex((m) => m.id === id);
      if (idx < 0)
        return res.status(404).json({ ok: false, error: "Member not found" });
      members[idx] = { ...members[idx], active: action === "reactivate" };
      if (sourceWasPrivate) await saveMemberRow(members[idx]);
      else await saveMembers(members);
      return res.status(200).json({
        ok: true,
        member: members[idx],
        members,
        source: "private-sheet",
      });
    }

    if (action === "import") {
      const incoming = Array.isArray(req.body?.rows) ? req.body.rows : [];
      if (!incoming.length)
        return res.status(400).json({ ok: false, error: "No rows supplied" });
      let created = 0;
      let updated = 0;
      const errors: string[] = [];
      const next = [...members];
      for (let i = 0; i < incoming.length; i++) {
        try {
          const raw = incoming[i] || {};
          const rawId = importId(raw);
          const existingById = rawId ? next.find((m) => m.id === rawId) : null;
          const baseId = existingById?.id || rawId || generateMemberId();
          const candidate = cleanMemberInput({ ...raw, id: baseId }, baseId);
          const existingIdx = existingById
            ? next.findIndex((m) => sameId(m.id, existingById.id))
            : next.findIndex(
                (m) =>
                  `${m.firstName} ${m.lastName}`.trim().toLowerCase() ===
                    `${candidate.firstName} ${candidate.lastName}`
                      .trim()
                      .toLowerCase() &&
                  m.parentEmail.toLowerCase() ===
                    candidate.parentEmail.toLowerCase(),
              );
          if (existingIdx >= 0) {
            next[existingIdx] = { ...candidate, id: next[existingIdx].id };
            updated++;
          } else {
            next.push(candidate);
            created++;
          }
        } catch (err: any) {
          errors.push(`Row ${i + 2}: ${err?.message || "invalid row"}`);
        }
      }
      if (errors.length && !req.body?.saveValidRows)
        return res
          .status(400)
          .json({ ok: false, error: "Import has invalid rows.", errors });
      await saveMembers(next);
      return res.status(200).json({
        ok: true,
        created,
        updated,
        errors,
        members: next,
        source: "private-sheet",
      });
    }

    return res.status(400).json({ ok: false, error: "Unknown action" });
  } catch (e: any) {
    return res
      .status(500)
      .json({ ok: false, error: e?.message || "Could not save members" });
  }
}
