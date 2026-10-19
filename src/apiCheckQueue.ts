/**
 * Shared, throttled queue for background API checks (airing pointer, season refill):
 * at most `maxParallel` tasks at once, task starts at least `gapMs` apart.
 */
export class ApiCheckQueue {
	private pending: Array<() => void> = [];
	private running = 0;
	private lastStart = 0;
	private timer: number | null = null;

	constructor(private readonly maxParallel = 2, private readonly gapMs = 250) {}

	enqueue<T>(task: () => Promise<T>): Promise<T> {
		return new Promise<T>((resolve, reject) => {
			this.pending.push(() => {
				this.running++;
				task().then(resolve, reject).finally(() => {
					this.running--;
					this.pump();
				});
			});
			this.pump();
		});
	}

	private pump(): void {
		if (this.timer !== null) return;
		while (this.pending.length > 0 && this.running < this.maxParallel) {
			// capped, so a clock that jumped back cannot stall the queue
			const wait = Math.min(this.gapMs, this.lastStart + this.gapMs - Date.now());
			if (wait > 0) {
				this.timer = window.setTimeout(() => {
					this.timer = null;
					this.pump();
				}, wait);
				return;
			}
			this.lastStart = Date.now();
			this.pending.shift()?.();
		}
	}
}
