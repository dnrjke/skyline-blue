import * as GUI from '@babylonjs/gui';
import { COLORS, FONT, Z_INDEX, LAYOUT } from '../design';

interface ConsoleEntry {
    type: 'log' | 'warn' | 'error' | 'info';
    message: string;
    timestamp: number;
}

/**
 * MobileDebugConsole
 *
 * 모바일(특히 아이폰)에서 개발자 도구 없이 콘솔 로그를 확인할 수 있는 디버그 UI.
 * - 화면 상단 12시 방향에 토글 버튼 배치
 * - 버튼 터치 시 콘솔 패널 표시/숨김
 * - console.log, console.error, console.warn, console.info 가로채기
 *
 * Layer: SKIP (1100) - 항상 최상위에 표시
 */
export class MobileDebugConsole {
    private root: GUI.Rectangle;
    private toggleButton: GUI.Button;
    private consolePanel: GUI.Rectangle;
    private scrollViewer: GUI.ScrollViewer;
    private logContainer: GUI.StackPanel;
    private clearButton: GUI.Button;

    private isOpen: boolean = false;
    private entries: ConsoleEntry[] = [];
    private maxEntries: number = 100;

    private originalConsole: {
        log: typeof console.log;
        warn: typeof console.warn;
        error: typeof console.error;
        info: typeof console.info;
    };

    constructor(parentLayer: GUI.Rectangle) {
        // Store original console methods
        this.originalConsole = {
            log: console.log.bind(console),
            warn: console.warn.bind(console),
            error: console.error.bind(console),
            info: console.info.bind(console),
        };

        // Root container
        this.root = new GUI.Rectangle('MobileDebugConsoleRoot');
        this.root.width = '100%';
        this.root.height = '100%';
        this.root.thickness = 0;
        this.root.zIndex = Z_INDEX.SKIP + 50; // Above other skip layer elements
        this.root.isHitTestVisible = false;
        this.root.isVisible = true;

        // Toggle Button (top center - 12 o'clock position)
        this.toggleButton = GUI.Button.CreateSimpleButton('DebugToggle', 'DBG');
        this.toggleButton.widthInPixels = 56;
        this.toggleButton.heightInPixels = 28;
        this.toggleButton.cornerRadius = 4;
        this.toggleButton.thickness = 1;
        this.toggleButton.color = 'rgba(255,255,255,0.6)';
        this.toggleButton.background = 'rgba(0,0,0,0.5)';
        this.toggleButton.horizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;
        this.toggleButton.verticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_TOP;
        this.toggleButton.topInPixels = LAYOUT.SAFE_AREA.TOP + 8;
        this.toggleButton.isHitTestVisible = true;
        this.toggleButton.isPointerBlocker = true;
        this.toggleButton.onPointerClickObservable.add(() => {
            this.toggle();
        });

        // Button text style
        const btnText = this.toggleButton.textBlock;
        if (btnText) {
            btnText.fontFamily = FONT.FAMILY.MONOSPACE;
            btnText.fontSizeInPixels = 12;
            btnText.color = 'rgba(255,255,255,0.8)';
        }

        this.root.addControl(this.toggleButton);

        // Console Panel (hidden by default)
        this.consolePanel = new GUI.Rectangle('DebugConsolePanel');
        this.consolePanel.widthInPixels = 360;
        this.consolePanel.heightInPixels = 400;
        this.consolePanel.thickness = 2;
        this.consolePanel.cornerRadius = 8;
        this.consolePanel.color = 'rgba(0,255,200,0.4)';
        this.consolePanel.background = 'rgba(0,0,0,0.92)';
        this.consolePanel.horizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;
        this.consolePanel.verticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_TOP;
        this.consolePanel.topInPixels = LAYOUT.SAFE_AREA.TOP + 44;
        this.consolePanel.isVisible = false;
        this.consolePanel.isHitTestVisible = true;
        this.consolePanel.isPointerBlocker = true;
        this.root.addControl(this.consolePanel);

        // Header
        const header = new GUI.Rectangle('DebugConsoleHeader');
        header.width = '100%';
        header.heightInPixels = 32;
        header.thickness = 0;
        header.background = 'rgba(0,255,200,0.15)';
        header.verticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_TOP;
        this.consolePanel.addControl(header);

        const headerText = new GUI.TextBlock('DebugConsoleHeaderText');
        headerText.text = 'Debug Console';
        headerText.fontFamily = FONT.FAMILY.MONOSPACE;
        headerText.fontSizeInPixels = 14;
        headerText.color = COLORS.HUD_NEON;
        headerText.horizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
        headerText.leftInPixels = 12;
        header.addControl(headerText);

        // Header button container (right-aligned)
        const headerButtons = new GUI.StackPanel('HeaderButtons');
        headerButtons.isVertical = false;
        headerButtons.horizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_RIGHT;
        headerButtons.widthInPixels = 100;
        headerButtons.heightInPixels = 28;
        headerButtons.paddingRightInPixels = 4;
        header.addControl(headerButtons);

        // Close Button
        const closeButton = GUI.Button.CreateSimpleButton('CloseBtn', 'X');
        closeButton.widthInPixels = 28;
        closeButton.heightInPixels = 24;
        closeButton.cornerRadius = 4;
        closeButton.thickness = 1;
        closeButton.color = 'rgba(255,255,255,0.6)';
        closeButton.background = 'rgba(50,50,50,0.6)';
        closeButton.isHitTestVisible = true;
        closeButton.isPointerBlocker = true;
        closeButton.onPointerClickObservable.add(() => {
            this.hide();
        });
        const closeText = closeButton.textBlock;
        if (closeText) {
            closeText.fontFamily = FONT.FAMILY.MONOSPACE;
            closeText.fontSizeInPixels = 12;
        }
        headerButtons.addControl(closeButton);

        // Clear Button
        this.clearButton = GUI.Button.CreateSimpleButton('ClearBtn', 'CLR');
        this.clearButton.widthInPixels = 48;
        this.clearButton.heightInPixels = 24;
        this.clearButton.cornerRadius = 4;
        this.clearButton.thickness = 1;
        this.clearButton.color = 'rgba(255,100,100,0.8)';
        this.clearButton.background = 'rgba(100,0,0,0.4)';
        this.clearButton.isHitTestVisible = true;
        this.clearButton.isPointerBlocker = true;
        this.clearButton.onPointerClickObservable.add(() => {
            this.clear();
        });
        const clearText = this.clearButton.textBlock;
        if (clearText) {
            clearText.fontFamily = FONT.FAMILY.MONOSPACE;
            clearText.fontSizeInPixels = 10;
        }
        headerButtons.addControl(this.clearButton);

        // Scroll Viewer for logs
        this.scrollViewer = new GUI.ScrollViewer('DebugConsoleScroll');
        this.scrollViewer.width = '100%';
        this.scrollViewer.heightInPixels = 360;
        this.scrollViewer.thickness = 0;
        this.scrollViewer.verticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_BOTTOM;
        this.scrollViewer.barColor = COLORS.HUD_NEON;
        this.scrollViewer.barBackground = 'rgba(0,0,0,0.3)';
        this.consolePanel.addControl(this.scrollViewer);

        // Log Container (StackPanel)
        this.logContainer = new GUI.StackPanel('DebugLogContainer');
        this.logContainer.width = '100%';
        this.logContainer.isVertical = true;
        this.logContainer.spacing = 2;
        this.scrollViewer.addControl(this.logContainer);

        parentLayer.addControl(this.root);

        // Intercept console methods
        this.interceptConsole();
    }

    private interceptConsole(): void {
        console.log = (...args: unknown[]) => {
            this.originalConsole.log(...args);
            this.addEntry('log', args);
        };

        console.warn = (...args: unknown[]) => {
            this.originalConsole.warn(...args);
            this.addEntry('warn', args);
        };

        console.error = (...args: unknown[]) => {
            this.originalConsole.error(...args);
            this.addEntry('error', args);
        };

        console.info = (...args: unknown[]) => {
            this.originalConsole.info(...args);
            this.addEntry('info', args);
        };

        // Capture uncaught errors
        window.addEventListener('error', (event) => {
            this.addEntry('error', [`[Uncaught] ${event.message} at ${event.filename}:${event.lineno}`]);
        });

        window.addEventListener('unhandledrejection', (event) => {
            this.addEntry('error', [`[Unhandled Promise] ${event.reason}`]);
        });
    }

    private addEntry(type: ConsoleEntry['type'], args: unknown[]): void {
        const message = args.map(arg => {
            if (typeof arg === 'object') {
                try {
                    return JSON.stringify(arg, null, 0);
                } catch {
                    return String(arg);
                }
            }
            return String(arg);
        }).join(' ');

        const entry: ConsoleEntry = {
            type,
            message,
            timestamp: Date.now(),
        };

        this.entries.push(entry);

        // Limit entries
        if (this.entries.length > this.maxEntries) {
            this.entries.shift();
        }

        // Add to UI
        this.renderEntry(entry);
    }

    private renderEntry(entry: ConsoleEntry): void {
        const entryBlock = new GUI.TextBlock();
        entryBlock.resizeToFit = true;
        entryBlock.width = '100%';
        entryBlock.fontFamily = FONT.FAMILY.MONOSPACE;
        entryBlock.fontSizeInPixels = 11;
        entryBlock.textWrapping = true;
        entryBlock.textHorizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
        entryBlock.paddingLeftInPixels = 8;
        entryBlock.paddingRightInPixels = 8;
        entryBlock.paddingTopInPixels = 2;
        entryBlock.paddingBottomInPixels = 2;

        // Truncate long messages
        const maxLen = 200;
        const displayMsg = entry.message.length > maxLen
            ? entry.message.substring(0, maxLen) + '...'
            : entry.message;

        const time = new Date(entry.timestamp).toLocaleTimeString('en-US', {
            hour12: false,
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
        });

        entryBlock.text = `[${time}] ${displayMsg}`;

        // Color by type
        switch (entry.type) {
            case 'error':
                entryBlock.color = '#ff6b6b';
                break;
            case 'warn':
                entryBlock.color = '#ffd93d';
                break;
            case 'info':
                entryBlock.color = '#6bceff';
                break;
            default:
                entryBlock.color = 'rgba(255,255,255,0.85)';
        }

        this.logContainer.addControl(entryBlock);

        // Auto-scroll to bottom
        this.scrollViewer.verticalBar.value = 1;

        // Remove old entries from UI if exceeding limit
        if (this.logContainer.children.length > this.maxEntries) {
            const firstChild = this.logContainer.children[0];
            this.logContainer.removeControl(firstChild);
            firstChild.dispose();
        }
    }

    toggle(): void {
        if (this.isOpen) {
            this.hide();
        } else {
            this.show();
        }
    }

    show(): void {
        this.isOpen = true;
        this.consolePanel.isVisible = true;
        this.toggleButton.background = 'rgba(0,200,150,0.6)';
    }

    hide(): void {
        this.isOpen = false;
        this.consolePanel.isVisible = false;
        this.toggleButton.background = 'rgba(0,0,0,0.5)';
    }

    clear(): void {
        this.entries = [];
        // Clear UI
        const children = [...this.logContainer.children];
        for (const child of children) {
            this.logContainer.removeControl(child);
            child.dispose();
        }
    }

    dispose(): void {
        // Restore original console methods
        console.log = this.originalConsole.log;
        console.warn = this.originalConsole.warn;
        console.error = this.originalConsole.error;
        console.info = this.originalConsole.info;

        this.root.dispose();
    }
}
