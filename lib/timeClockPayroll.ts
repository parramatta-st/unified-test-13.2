/** Combine the original, mutually exclusive minute buckets before formatting. */
export function combinedPremiumMinutes(row: { after7Minutes: number; saturdayMinutes: number }) {
  return row.after7Minutes + row.saturdayMinutes;
}

export function combinedPremiumHours(row: { after7Minutes: number; saturdayMinutes: number }) {
  return combinedPremiumMinutes(row) / 60;
}

type PayrollExportRow = {
  tutorName: string;
  normalMinutes: number;
  after7Minutes: number;
  saturdayMinutes: number;
  unclassifiedMinutes: number;
  shifts: number;
  reviewCount: number;
};

function csvCell(value: unknown) {
  let text = String(value ?? '');
  // Protect spreadsheet users from formula-like tutor names, including leading whitespace.
  if (/^\s*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export function payrollCsv(rows: PayrollExportRow[]) {
  const headers = ['Tutor', 'Normal Hours', 'After 7 PM + Saturday Hours',
    'Sunday / Unclassified Hours', 'Completed Shifts', 'Shifts Needing Review'];
  return '\ufeff' + [headers, ...rows.map((row) => [
    row.tutorName, (row.normalMinutes / 60).toFixed(2), combinedPremiumHours(row).toFixed(2),
    (row.unclassifiedMinutes / 60).toFixed(2), row.shifts, row.reviewCount,
  ])].map((row) => row.map(csvCell).join(',')).join('\r\n');
}
