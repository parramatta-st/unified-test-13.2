type ArchiveRow = Record<string, unknown>;
export function selectContentDownloads(rows: ArchiveRow[], signedCampus: string) {
  const campus = signedCampus.trim().toLowerCase();
  if (!campus) return [];
  return rows.filter(r => String(r.campus || '').trim().toLowerCase() === campus && /^[A-Za-z0-9_-]+$/.test(String(r.drive_id || '')))
    .map(r => ({filename:String(r.filename || ''),created_at:String(r.created_at || ''),files:Number(r.files)||0,bytes:Number(r.bytes)||0,sha256:String(r.sha256 || ''),url:`https://drive.google.com/file/d/${encodeURIComponent(String(r.drive_id))}/view`}))
    .sort((a,b)=>b.created_at.localeCompare(a.created_at));
}
