/**
 * Assets - design/system layer에서 접근하는 리소스 경로.
 *
 * docs/arcana_ui_rules.md §3.1 요구:
 * - Assets.ts에서 모든 리소스 경로를 단일 관리한다.
 *
 * Phase 2.3 요구:
 * - PathConstants.ts를 통해 baseURL-aware 경로를 생성한다.
 *
 * => 이 파일은 PathConstants/PATH를 "디자인 시스템 측 표준 진입점"으로 재노출한다.
 */
export { PATH as ASSETS_PATH, PathConstants } from '../config/PathConstants';

