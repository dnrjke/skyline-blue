export interface LoadingStepRecord {
    name: string;
    ms: number;
}

/**
 * LoadingDebugger - Phase 2.5
 * 로딩 단계별 소요 시간을 기록하고, UI/콘솔에서 재사용 가능하도록 라인 형태로 제공한다.
 */
export class LoadingDebugger {
    private startTimes: Map<string, number> = new Map();
    private records: LoadingStepRecord[] = [];

    begin(stepName: string): void {
        this.startTimes.set(stepName, performance.now());
    }

    end(stepName: string): number {
        const start = this.startTimes.get(stepName);
        const now = performance.now();
        const ms = start ? now - start : 0;
        this.startTimes.delete(stepName);
        this.records.push({ name: stepName, ms });
        return ms;
    }

    reset(): void {
        this.startTimes.clear();
        this.records = [];
    }

    getSummaryLines(): string[] {
        return this.records.map((r) => `${r.name}: ${Math.round(r.ms)}ms`);
    }
}

