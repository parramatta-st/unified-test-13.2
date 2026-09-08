export const reviewLabels: Record<string, string> = {
  invalid_timestamps: 'Invalid times',
  future_clock_in: 'Future clock-in',
  open_over_limit: 'Missing clock-out',
  long_shift: 'Unusually long shift',
  crosses_midnight: 'Shift crosses midnight',
  sunday_unclassified: 'Sunday hours have no pay category',
  clock_in_location_unverified: 'Clock-in location was not verified',
  clock_out_location_unverified: 'Clock-out location was not verified',
  overlapping_shift: 'Overlaps another shift',
};

export function reviewExplanation(flag: string, config: { longShiftHours?: number; openShiftAlertHours?: number } = {}) {
  const explanations: Record<string, string> = {
    invalid_timestamps: 'The stored times are missing, invalid, or in the wrong order. Use Edit times to correct them before processing payroll.',
    future_clock_in: 'The start time is in the future. Check the shift date and AM/PM using Edit times.',
    open_over_limit: `This shift is still open after ${config.openShiftAlertHours || 12} hours. Check when the tutor finished and enter the end time. Open shifts are excluded from payroll totals.`,
    long_shift: `This shift lasted at least ${config.longShiftHours || 16} hours. Check the start and end times before processing payroll.`,
    crosses_midnight: 'This shift extends into another Sydney calendar day. Check for a missed clock-out and correct the end time if needed.',
    sunday_unclassified: 'Sunday work has no configured pay category. These hours are shown separately and are excluded from Normal, After 7 PM, and Saturday totals.',
    clock_in_location_unverified: 'No verified location or admin override is recorded for clock-in. Check the clock-in audit and confirm the tutor attended.',
    clock_out_location_unverified: 'No verified location or admin override is recorded for clock-out. Check the clock-out audit and adjustment history.',
    overlapping_shift: 'This tutor has another shift covering some of the same time. Compare the entries, then correct the times or void the duplicate to avoid paying those hours twice.',
  };
  return explanations[flag] || `Review the recorded issue: ${flag.replace(/_/g, ' ')}.`;
}
