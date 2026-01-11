/**
 * LoadingRegistry - LoadUnit 관리 레지스트리.
 *
 * 역할:
 * - 씬별 LoadUnit 등록/조회
 * - Phase별 Unit 그룹화
 * - Required/Optional Unit 구분
 * - 로딩 상태 추적
 *
 * 각 씬(NavigationScene, FlightScene 등)은 자신만의 LoadUnit들을 등록하고,
 * LoadingProtocol이 Registry를 사용하여 순차적으로 로딩을 수행한다.
 */

import { LoadUnit, LoadUnitStatus } from './LoadUnit';
import { LoadingPhase, PHASE_ORDER } from '../protocol/LoadingPhase';

/**
 * Registry 이벤트 콜백
 */
export interface RegistryCallbacks {
    onUnitStatusChange?: (unit: LoadUnit, oldStatus: LoadUnitStatus, newStatus: LoadUnitStatus) => void;
    onPhaseComplete?: (phase: LoadingPhase, units: LoadUnit[]) => void;
}

/**
 * Registry 상태 스냅샷
 */
export interface RegistrySnapshot {
    totalUnits: number;
    requiredUnits: number;
    byPhase: Map<LoadingPhase, LoadUnit[]>;
    byStatus: Map<LoadUnitStatus, LoadUnit[]>;
    progress: number; // 0~1
}

/**
 * LoadingRegistry
 */
export class LoadingRegistry {
    private units: Map<string, LoadUnit> = new Map();
    // Reserved for future event notifications
    private _callbacks: RegistryCallbacks = {};

    /**
     * LoadUnit 등록
     * @param unit 등록할 Unit
     * @throws 중복 ID 등록 시 에러
     */
    register(unit: LoadUnit): void {
        if (this.units.has(unit.id)) {
            throw new Error(`[LoadingRegistry] Duplicate unit ID: ${unit.id}`);
        }
        this.units.set(unit.id, unit);
        console.log(
            `[LoadingRegistry] Registered: ${unit.id} (phase=${unit.phase}, required=${unit.requiredForReady})`
        );
    }

    /**
     * 여러 LoadUnit 일괄 등록
     */
    registerAll(units: LoadUnit[]): void {
        for (const unit of units) {
            this.register(unit);
        }
    }

    /**
     * LoadUnit 등록 해제
     */
    unregister(unitId: string): boolean {
        const unit = this.units.get(unitId);
        if (unit) {
            unit.dispose?.();
            this.units.delete(unitId);
            return true;
        }
        return false;
    }

    /**
     * 모든 Unit 제거 및 dispose
     */
    clear(): void {
        for (const unit of this.units.values()) {
            unit.dispose?.();
        }
        this.units.clear();
    }

    /**
     * ID로 Unit 조회
     */
    getUnit(unitId: string): LoadUnit | undefined {
        return this.units.get(unitId);
    }

    /**
     * 모든 Unit 조회
     */
    getAllUnits(): LoadUnit[] {
        return Array.from(this.units.values());
    }

    /**
     * 특정 Phase의 Unit들 조회
     */
    getUnitsByPhase(phase: LoadingPhase): LoadUnit[] {
        return this.getAllUnits().filter((u) => u.phase === phase);
    }

    /**
     * READY 판정에 필수인 Unit들 조회
     */
    getRequiredUnits(): LoadUnit[] {
        return this.getAllUnits().filter((u) => u.requiredForReady);
    }

    /**
     * Optional Unit들 조회
     */
    getOptionalUnits(): LoadUnit[] {
        return this.getAllUnits().filter((u) => !u.requiredForReady);
    }

    /**
     * 특정 상태의 Unit들 조회
     */
    getUnitsByStatus(status: LoadUnitStatus): LoadUnit[] {
        return this.getAllUnits().filter((u) => u.status === status);
    }

    /**
     * Phase 순서대로 정렬된 Unit 목록
     */
    getUnitsInPhaseOrder(): LoadUnit[] {
        const phaseIndex = new Map(PHASE_ORDER.map((p, i) => [p, i]));
        return this.getAllUnits().sort((a, b) => {
            const aIdx = phaseIndex.get(a.phase) ?? 999;
            const bIdx = phaseIndex.get(b.phase) ?? 999;
            return aIdx - bIdx;
        });
    }

    /**
     * 모든 Required Unit이 VALIDATED 상태인지 확인
     */
    areAllRequiredValidated(): boolean {
        return this.getRequiredUnits().every(
            (u) => u.status === LoadUnitStatus.VALIDATED || u.status === LoadUnitStatus.SKIPPED
        );
    }

    /**
     * 실패한 Required Unit이 있는지 확인
     */
    hasFailedRequiredUnit(): boolean {
        return this.getRequiredUnits().some((u) => u.status === LoadUnitStatus.FAILED);
    }

    /**
     * 전체 진행률 계산 (0~1)
     */
    calculateProgress(): number {
        const required = this.getRequiredUnits();
        if (required.length === 0) return 1;

        const weights: Record<LoadUnitStatus, number> = {
            [LoadUnitStatus.PENDING]: 0,
            [LoadUnitStatus.LOADING]: 0.5,
            [LoadUnitStatus.LOADED]: 0.8,
            [LoadUnitStatus.VALIDATED]: 1,
            [LoadUnitStatus.FAILED]: 0,
            [LoadUnitStatus.SKIPPED]: 1,
        };

        const totalWeight = required.reduce((sum, u) => sum + weights[u.status], 0);
        return totalWeight / required.length;
    }

    /**
     * 현재 상태 스냅샷
     */
    getSnapshot(): RegistrySnapshot {
        const allUnits = this.getAllUnits();
        const byPhase = new Map<LoadingPhase, LoadUnit[]>();
        const byStatus = new Map<LoadUnitStatus, LoadUnit[]>();

        for (const unit of allUnits) {
            // By phase
            const phaseUnits = byPhase.get(unit.phase) || [];
            phaseUnits.push(unit);
            byPhase.set(unit.phase, phaseUnits);

            // By status
            const statusUnits = byStatus.get(unit.status) || [];
            statusUnits.push(unit);
            byStatus.set(unit.status, statusUnits);
        }

        return {
            totalUnits: allUnits.length,
            requiredUnits: this.getRequiredUnits().length,
            byPhase,
            byStatus,
            progress: this.calculateProgress(),
        };
    }

    /**
     * 콜백 조회 (미래 확장용)
     */
    getCallbacks(): RegistryCallbacks {
        return this._callbacks;
    }

    /**
     * 콜백 설정 (미래 확장용)
     */
    setCallbacks(callbacks: RegistryCallbacks): void {
        this._callbacks = callbacks;
    }

    /**
     * 모든 Unit 상태 리셋 (재로딩 시)
     */
    resetAll(): void {
        for (const unit of this.units.values()) {
            if ('reset' in unit && typeof unit.reset === 'function') {
                (unit as any).reset();
            } else {
                unit.status = LoadUnitStatus.PENDING;
            }
        }
    }

    /**
     * 디버그 출력
     */
    debugPrint(): void {
        console.group('[LoadingRegistry] Status');
        for (const phase of PHASE_ORDER) {
            const units = this.getUnitsByPhase(phase);
            if (units.length === 0) continue;
            console.group(`Phase: ${phase}`);
            for (const u of units) {
                console.log(
                    `  ${u.requiredForReady ? '⭐' : '  '} ${u.id}: ${u.status}` +
                        (u.elapsedMs ? ` (${Math.round(u.elapsedMs)}ms)` : '')
                );
            }
            console.groupEnd();
        }
        console.log(`Progress: ${Math.round(this.calculateProgress() * 100)}%`);
        console.groupEnd();
    }
}
