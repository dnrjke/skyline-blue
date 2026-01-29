/**
 * VisualFreshnessKeeper - "Post-Load Live Phase" 검증 모듈
 *
 * 가설: Chrome의 104ms throttle은 "Visual Staleness" 감지로 발생
 *       → 의미있는 시각적 변화가 지속되면 throttle이 풀리거나 방지됨
 *
 * 이 모듈은 로딩 완료 후 의도적으로 미세한 시각적 변화를 유지하여
 * Chrome이 "이 페이지는 살아있다"고 판단하도록 유도합니다.
 *
 * 핵심 원칙 (사용자 제안):
 * "아무 일도 안 일어나는 시간은 플레이의 일부일 수 있지만,
 *  아무 의미 없으면 안 된다"
 *
 * Usage:
 *   const keeper = new VisualFreshnessKeeper(scene, camera);
 *   keeper.start();
 *   // Later...
 *   keeper.stop();
 *
 * Debug flag: ?blackhole-visual-freshness
 */

import * as BABYLON from '@babylonjs/core';

export interface VisualFreshnessConfig {
    /** 카메라 breath 활성화 */
    cameraBreath: boolean;
    /** 카메라 breath 진폭 (units) */
    cameraBreathAmplitude: number;
    /** 카메라 breath 주기 (ms) */
    cameraBreathPeriod: number;

    /** 조명 pulse 활성화 */
    lightPulse: boolean;
    /** 조명 pulse 진폭 (0-1) */
    lightPulseAmplitude: number;
    /** 조명 pulse 주기 (ms) */
    lightPulsePeriod: number;

    /** 디버그 로깅 */
    debug: boolean;
}

const DEFAULT_CONFIG: VisualFreshnessConfig = {
    cameraBreath: true,
    cameraBreathAmplitude: 0.02, // 매우 미세함 - 거의 인지 불가
    cameraBreathPeriod: 4000,    // 4초 주기 (자연스러운 호흡)

    lightPulse: false,           // 기본 비활성 (카메라만 테스트)
    lightPulseAmplitude: 0.03,
    lightPulsePeriod: 5000,

    debug: true,
};

export class VisualFreshnessKeeper {
    private scene: BABYLON.Scene;
    private camera: BABYLON.Camera | null;
    private config: VisualFreshnessConfig;

    private isRunning: boolean = false;
    private startTime: number = 0;
    private frameCount: number = 0;

    // Camera breath state
    private originalCameraPosition: BABYLON.Vector3 | null = null;
    private cameraBreathObserver: BABYLON.Nullable<BABYLON.Observer<BABYLON.Scene>> = null;

    // Light pulse state
    private targetLight: BABYLON.Light | null = null;
    private originalLightIntensity: number = 0;
    private lightPulseObserver: BABYLON.Nullable<BABYLON.Observer<BABYLON.Scene>> = null;

    // Metrics
    private lastLogTime: number = 0;
    private rafDeltas: number[] = [];
    private lastRAFTime: number = 0;

    constructor(
        scene: BABYLON.Scene,
        camera: BABYLON.Camera | null = null,
        config: Partial<VisualFreshnessConfig> = {}
    ) {
        this.scene = scene;
        this.camera = camera || scene.activeCamera;
        this.config = { ...DEFAULT_CONFIG, ...config };
    }

    /**
     * Start maintaining visual freshness
     */
    start(): void {
        if (this.isRunning) {
            console.warn('[VisualFreshness] Already running');
            return;
        }

        this.isRunning = true;
        this.startTime = performance.now();
        this.frameCount = 0;
        this.lastRAFTime = performance.now();

        console.log('');
        console.log('🌊🌊🌊🌊🌊🌊🌊🌊🌊🌊🌊🌊🌊🌊🌊🌊🌊🌊🌊🌊');
        console.log('[VisualFreshness] POST-LOAD LIVE PHASE STARTED');
        console.log(`  Camera breath: ${this.config.cameraBreath ? 'ON' : 'OFF'}`);
        console.log(`  Light pulse: ${this.config.lightPulse ? 'ON' : 'OFF'}`);
        console.log(`  Purpose: Maintain visual freshness to prevent Chrome stale-page throttle`);
        console.log('🌊🌊🌊🌊🌊🌊🌊🌊🌊🌊🌊🌊🌊🌊🌊🌊🌊🌊🌊🌊');
        console.log('');

        // Start camera breath
        if (this.config.cameraBreath && this.camera) {
            this.startCameraBreath();
        }

        // Start light pulse
        if (this.config.lightPulse) {
            this.startLightPulse();
        }

        // Start RAF monitoring (to verify if throttle is prevented)
        this.startRAFMonitoring();
    }

    /**
     * Stop maintaining visual freshness
     */
    stop(): void {
        if (!this.isRunning) {
            return;
        }

        this.isRunning = false;
        const duration = performance.now() - this.startTime;

        // Cleanup camera breath
        if (this.cameraBreathObserver) {
            this.scene.onBeforeRenderObservable.remove(this.cameraBreathObserver);
            this.cameraBreathObserver = null;

            // Restore original position
            if (this.camera && this.originalCameraPosition) {
                this.camera.position.copyFrom(this.originalCameraPosition);
            }
        }

        // Cleanup light pulse
        if (this.lightPulseObserver) {
            this.scene.onBeforeRenderObservable.remove(this.lightPulseObserver);
            this.lightPulseObserver = null;

            // Restore original intensity
            if (this.targetLight) {
                this.targetLight.intensity = this.originalLightIntensity;
            }
        }

        // Calculate RAF statistics
        const avgRAF = this.rafDeltas.length > 0
            ? this.rafDeltas.reduce((a, b) => a + b, 0) / this.rafDeltas.length
            : 0;
        const throttledFrames = this.rafDeltas.filter(d => d > 50).length;
        const throttle104Frames = this.rafDeltas.filter(d => d >= 100 && d <= 110).length;

        console.log('');
        console.log('🌊🌊🌊🌊🌊🌊🌊🌊🌊🌊🌊🌊🌊🌊🌊🌊🌊🌊🌊🌊');
        console.log('[VisualFreshness] POST-LOAD LIVE PHASE STOPPED');
        console.log(`  Duration: ${(duration / 1000).toFixed(1)}s`);
        console.log(`  Frames: ${this.frameCount}`);
        console.log(`  Avg RAF: ${avgRAF.toFixed(1)}ms`);
        console.log(`  Throttled frames (>50ms): ${throttledFrames} (${(throttledFrames / this.frameCount * 100).toFixed(1)}%)`);
        console.log(`  104ms pattern frames: ${throttle104Frames}`);
        if (throttle104Frames === 0) {
            console.log('  ✅ NO 104ms THROTTLE DETECTED - Visual freshness may be working!');
        } else {
            console.log('  ⚠️ 104ms throttle still occurred - need different approach');
        }
        console.log('🌊🌊🌊🌊🌊🌊🌊🌊🌊🌊🌊🌊🌊🌊🌊🌊🌊🌊🌊🌊');
        console.log('');
    }

    /**
     * Camera "breath" - 미세한 상하 또는 전후 oscillation
     * 자연스러운 "살아있는" 느낌 + Chrome에 시각 변화 신호
     */
    private startCameraBreath(): void {
        if (!this.camera) {
            console.warn('[VisualFreshness] No camera for breath animation');
            return;
        }

        // Store original position
        this.originalCameraPosition = this.camera.position.clone();

        const amplitude = this.config.cameraBreathAmplitude;
        const period = this.config.cameraBreathPeriod;

        this.cameraBreathObserver = this.scene.onBeforeRenderObservable.add(() => {
            if (!this.camera || !this.originalCameraPosition) return;

            const elapsed = performance.now() - this.startTime;

            // Smooth sine wave oscillation
            // Y축 (상하) + Z축 (전후) 미세 움직임
            const phase = (elapsed / period) * Math.PI * 2;
            const yOffset = Math.sin(phase) * amplitude;
            const zOffset = Math.cos(phase * 0.7) * amplitude * 0.5; // 다른 주기로 전후

            this.camera.position.y = this.originalCameraPosition.y + yOffset;
            this.camera.position.z = this.originalCameraPosition.z + zOffset;
        });

        if (this.config.debug) {
            console.log(`[VisualFreshness] Camera breath started: amplitude=${amplitude}, period=${period}ms`);
        }
    }

    /**
     * Light pulse - 미세한 조명 강도 변화
     */
    private startLightPulse(): void {
        // Find a suitable light
        const lights = this.scene.lights;
        if (lights.length === 0) {
            console.warn('[VisualFreshness] No lights for pulse animation');
            return;
        }

        // Use the first directional or hemispheric light
        this.targetLight = lights.find(l =>
            l instanceof BABYLON.DirectionalLight ||
            l instanceof BABYLON.HemisphericLight
        ) || lights[0];

        this.originalLightIntensity = this.targetLight.intensity;

        const amplitude = this.config.lightPulseAmplitude;
        const period = this.config.lightPulsePeriod;

        this.lightPulseObserver = this.scene.onBeforeRenderObservable.add(() => {
            if (!this.targetLight) return;

            const elapsed = performance.now() - this.startTime;
            const phase = (elapsed / period) * Math.PI * 2;
            const intensityOffset = Math.sin(phase) * amplitude;

            this.targetLight.intensity = this.originalLightIntensity + intensityOffset;
        });

        if (this.config.debug) {
            console.log(`[VisualFreshness] Light pulse started: light=${this.targetLight.name}, amplitude=${amplitude}`);
        }
    }

    /**
     * RAF monitoring to verify throttle prevention
     */
    private startRAFMonitoring(): void {
        const monitorFrame = () => {
            if (!this.isRunning) return;

            const now = performance.now();
            if (this.lastRAFTime > 0) {
                const delta = now - this.lastRAFTime;
                this.rafDeltas.push(delta);
                this.frameCount++;

                // Keep last 300 samples
                if (this.rafDeltas.length > 300) {
                    this.rafDeltas.shift();
                }

                // Periodic status log (every 5 seconds)
                if (this.config.debug && now - this.lastLogTime > 5000) {
                    this.lastLogTime = now;
                    const recentAvg = this.getRecentAverage(30);
                    const status = recentAvg > 50 ? '⚠️ THROTTLED' : '✅ HEALTHY';
                    console.log(
                        `[VisualFreshness] ${status} | ` +
                        `frames=${this.frameCount} | ` +
                        `avgRAF=${recentAvg.toFixed(1)}ms | ` +
                        `elapsed=${((now - this.startTime) / 1000).toFixed(1)}s`
                    );
                }
            }

            this.lastRAFTime = now;
            requestAnimationFrame(monitorFrame);
        };

        requestAnimationFrame(monitorFrame);
    }

    private getRecentAverage(count: number): number {
        const recent = this.rafDeltas.slice(-count);
        if (recent.length === 0) return 0;
        return recent.reduce((a, b) => a + b, 0) / recent.length;
    }

    /**
     * Check if currently experiencing 104ms throttle
     */
    isThrottled(): boolean {
        const recentAvg = this.getRecentAverage(10);
        return recentAvg >= 90;
    }

    /**
     * Get current statistics
     */
    getStats(): {
        frameCount: number;
        avgRAF: number;
        throttledRatio: number;
        isThrottled: boolean;
    } {
        const avgRAF = this.rafDeltas.length > 0
            ? this.rafDeltas.reduce((a, b) => a + b, 0) / this.rafDeltas.length
            : 0;
        const throttledFrames = this.rafDeltas.filter(d => d > 50).length;

        return {
            frameCount: this.frameCount,
            avgRAF,
            throttledRatio: this.frameCount > 0 ? throttledFrames / this.frameCount : 0,
            isThrottled: this.isThrottled(),
        };
    }
}

/**
 * Check URL flag and create keeper if enabled
 */
export function checkAndCreateVisualFreshnessKeeper(
    scene: BABYLON.Scene,
    camera?: BABYLON.Camera
): VisualFreshnessKeeper | null {
    const params = new URLSearchParams(window.location.search);

    if (!params.has('blackhole-visual-freshness') && !params.has('blackhole-debug')) {
        return null;
    }

    console.log('[VisualFreshness] URL flag detected - creating keeper');

    const config: Partial<VisualFreshnessConfig> = {
        debug: true,
    };

    // Parse optional config from URL
    if (params.has('vf-amplitude')) {
        config.cameraBreathAmplitude = parseFloat(params.get('vf-amplitude') || '0.02');
    }
    if (params.has('vf-period')) {
        config.cameraBreathPeriod = parseFloat(params.get('vf-period') || '4000');
    }
    if (params.has('vf-light')) {
        config.lightPulse = true;
    }

    return new VisualFreshnessKeeper(scene, camera || null, config);
}
