export type PrintItem = {
  student: string;
  studentId?: string;
  label: string;
  materialId: number;
  path: string;
  plannedKey?: string;
  payload: Record<string, any>;
  log: Record<string, any>;
};
export type PrintBatch = {
  id: string;
  label: string;
  source: 'manual' | 'automatic';
  items: PrintItem[];
  state: 'queued' | 'sending' | 'sent' | 'attention' | 'cancelled';
  sent: number;
  current: string;
  error: string;
  hidden?: boolean;
};
type Request = (url: string, body: any) => Promise<any>;
type Change = () => void;

function itemKey(item: PrintItem) {
  return [item.studentId || item.student.trim().toLowerCase(), item.path || item.materialId].join('|');
}

/** One FIFO per browser tab. Owned by _app, not by the page that submitted it.
 * A reload never replays a request: a lost response may still have printed.
 */
export class PrintActivityQueue {
  batches: PrintBatch[] = [];
  private running = false;
  private stopped = false;
  private sentAutomatic = new Set<string>();
  constructor(private request: Request, private changed: Change) {}

  enqueue(input: Pick<PrintBatch, 'label' | 'source' | 'items'>): string {
    if (this.stopped) throw new Error('Sign in again before printing.');
    if (!input.items.length) throw new Error('Choose at least one worksheet.');
    const items: PrintItem[] = JSON.parse(JSON.stringify(input.items));
    const keys = new Set<string>();
    for (const item of items) {
      const key = itemKey(item);
      if (keys.has(key)) throw new Error('This batch contains the same worksheet twice.');
      keys.add(key);
      if (this.batches.some(batch => ['queued', 'sending'].includes(batch.state) && batch.items.some(other => itemKey(other) === key))) {
        throw new Error(`${item.student} · ${item.label} is already queued or sending.`);
      }
      if (input.source === 'automatic' && this.sentAutomatic.has(key)) {
        throw new Error('Some selected worksheets were already sent in this tab. Check print history; use Manual Print if a reprint is needed.');
      }
    }
    const id = globalThis.crypto.randomUUID();
    this.batches = [...this.batches, { ...input, items, id, state: 'queued', sent: 0, current: '', error: '' }];
    this.changed();
    void this.pump();
    return id;
  }

  cancel(id: string) {
    const batch = this.batches.find(item => item.id === id);
    if (batch?.state === 'queued') { batch.state = 'cancelled'; batch.hidden = true; this.changed(); }
  }
  hide(id: string) {
    const batch = this.batches.find(item => item.id === id);
    if (batch && !['queued', 'sending'].includes(batch.state)) { batch.hidden = true; this.changed(); }
  }
  stop() {
    this.stopped = true;
    for (const batch of this.batches) if (batch.state === 'queued') batch.state = 'cancelled';
    this.changed();
  }

  private async checkFolders(items: PrintItem[]) {
    const plannedKeys = items.map(item => item.plannedKey);
    if (plannedKeys.some(key => !key)) throw new Error('A material has no planned queue identity. Refresh the queue before printing.');
    for (let i = 0; i < plannedKeys.length; i += 200) {
      const result = await this.request('/api/folder-check-guard', { plannedKeys: plannedKeys.slice(i, i + 200) });
      if (result.blockedKeys?.length) throw new Error(`${result.blockedKeys.length} material(s) were just confirmed in student folders. Refresh the queue before printing again. Nothing else in this batch was sent.`);
    }
  }

  private async pump() {
    if (this.running || this.stopped) return;
    this.running = true;
    try {
      let batch: PrintBatch | undefined;
      while (!this.stopped && (batch = this.batches.find(item => item.state === 'queued'))) {
        batch.state = 'sending';
        batch.current = 'Checking print jobs…';
        this.changed();
        let transmitting = false;
        try {
          // Run AFTER waiting in the FIFO, not just when the page was opened.
          if (batch.source === 'automatic') await this.checkFolders(batch.items);
          for (const item of batch.items) {
            if (this.stopped) throw new Error('Printing stopped because the signed-in session changed.');
            if (batch.source === 'automatic') await this.checkFolders([item]);
            if (this.stopped) throw new Error('Printing stopped because the signed-in session changed.');
            batch.current = `${item.student} · ${item.label}`;
            transmitting = true;
            this.changed();
            const result = await this.request('/api/print-proxy?action=print', {
              ...item.payload,
              portalLog: { ...item.log, batchId: batch.id, batchLabel: batch.label, batchSize: batch.items.length, batchStudentSize: batch.items.filter(other => (other.studentId || other.student) === (item.studentId || item.student)).length, sourceForm: batch.source === 'manual' ? 'manual-print' : 'rolling-print-queue' },
            });
            transmitting = false;
            batch.sent++;
            // Reserve successful sends even when history fails; never retry ink
            // merely to repair a missing log entry.
            this.sentAutomatic.add(itemKey(item));
            if (result.logWarning) throw new Error(`Sent to printer, but history could not be saved. ${result.logWarning} Check the printer before sending more of this batch.`);
            this.changed();
          }
          batch.state = 'sent';
          batch.current = '';
        } catch (error: any) {
          batch.state = 'attention';
          batch.error = `${error?.message || 'Could not send this job.'}${transmitting ? ' The last file may have reached the printer. Check it before reprinting; this job will not retry automatically.' : ''}`;
        }
        this.changed();
      }
    } finally { this.running = false; }
  }
}

/** Bound every network wait. A timeout is an unknown print outcome, never an
 * instruction to retry automatically. */
export async function printRequest(url: string, body: any) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000);
  try {
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: controller.signal });
    const json = await response.json();
    if (!response.ok || !json?.ok) throw new Error(json?.error || 'The print service did not confirm this request.');
    return json;
  } finally { clearTimeout(timer); }
}
