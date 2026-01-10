import type { NavigationEdge, NavigationNode } from '../types';

/**
 * NavigationGraph - data model for path-planning (Phase 2).
 *
 * 책임:
 * - 노드/엣지 저장
 * - 인접 리스트 제공
 * - 클릭/시각화 로직과 분리된 순수 데이터 계층
 */
export class NavigationGraph {
    private nodes: Map<string, NavigationNode> = new Map();
    private adjacency: Map<string, NavigationEdge[]> = new Map();

    clear(): void {
        this.nodes.clear();
        this.adjacency.clear();
    }

    addNode(node: NavigationNode): void {
        this.nodes.set(node.id, node);
        if (!this.adjacency.has(node.id)) {
            this.adjacency.set(node.id, []);
        }
    }

    addUndirectedEdge(fromId: string, toId: string, energyCost: number = 0): void {
        this.addEdge({ fromId, toId, energyCost });
        this.addEdge({ fromId: toId, toId: fromId, energyCost });
    }

    addEdge(edge: NavigationEdge): void {
        if (!this.nodes.has(edge.fromId) || !this.nodes.has(edge.toId)) {
            throw new Error(`[NavigationGraph] addEdge: missing node(s) ${edge.fromId} -> ${edge.toId}`);
        }
        const list = this.adjacency.get(edge.fromId) || [];
        list.push(edge);
        this.adjacency.set(edge.fromId, list);
    }

    getNode(id: string): NavigationNode | null {
        return this.nodes.get(id) || null;
    }

    getNodes(): NavigationNode[] {
        return [...this.nodes.values()];
    }

    getEdgesFrom(id: string): NavigationEdge[] {
        return [...(this.adjacency.get(id) || [])];
    }

    hasEdge(fromId: string, toId: string): boolean {
        return (this.adjacency.get(fromId) || []).some((e) => e.toId === toId);
    }
}

