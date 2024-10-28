// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ExtensionContext,
    commands,
    notebooks,
    window,
    type NotebookController,
    type NotebookCell,
    type OutputChannel,
    NotebookCellOutput,
    NotebookCellOutputItem,
    workspace,
} from 'vscode';
import type { API, Metrics } from './api';

const timer = new (class {
    public metrics: Metrics = {
        preExecuteDuration: 0,
        executeDuration: 0,
        postExecuteDuration: 0,
        duration: 0,
    };
    private _startAt = Date.now();
    private _executionCompletedAt = 0;
    private _executionStartedAt = 0;
    private logger: OutputChannel;
    private outputType = '';
    constructor() {
        this.logger = window.createOutputChannel('Dummy Execution');
    }
    get executionCompleted() {
        return this._executionCompletedAt > 0;
    }
    dispose() {
        this.logger.dispose();
        if (this._timer) {
            this._timer = undefined;
            clearTimeout(this._timer);
        }
    }
    reset(outputType: string) {
        this.metrics = {
            preExecuteDuration: 0,
            executeDuration: 0,
            postExecuteDuration: 0,
            duration: 0,
        };
        this.outputType = outputType;
        this.logger.replace('');
        this._startAt = Date.now();
        this._executionStartedAt = 0;
    }
    private _timer?: NodeJS.Timeout;
    log() {
        if (this._timer) {
            clearTimeout(this._timer);
        }
        this._timer = setTimeout(() => {
            this._timer = undefined;
            this.logger.replace(this.getMessage());
        }, 1_000);
    }
    private getMessage() {
        return [
            `Output type ${this.outputType}`,
            `Time spent in VS Code before extension is notified: ${this.metrics.preExecuteDuration}`,
            `Time spent in Extension Host running all cells: ${this.metrics.executeDuration}`,
            `Time spent in VS Code updating UI after execution completed: ${this.metrics.postExecuteDuration}`,
            `Time spent in users perspective: ${this.metrics.duration}`,
        ].join('\n');
    }
    startExecution() {
        this.metrics.preExecuteDuration = Date.now() - this._startAt;
        this._executionStartedAt = Date.now();
        this.log();
    }
    endExecution() {
        this._executionCompletedAt = Date.now();
        this.metrics.executeDuration = Date.now() - this._executionStartedAt;
        this.log();
    }
    detectNotebookChanges() {
        this.metrics.duration = Date.now() - this._startAt;
        this.metrics.postExecuteDuration = Date.now() - this._executionCompletedAt;
        this.log();
    }
})();

class NotebookKernel {
    public lastExecutionOrder = 0;
    private readonly controller: NotebookController;
    private expectedMimeType: 'text' | 'html' | 'image' = 'text';
    constructor() {
        this.controller = notebooks.createNotebookController(
            'perfController',
            'jupyter-notebook',
            'Dummy Execution',
            (cells) => {
                timer.startExecution();
                this.executionHandler(cells);
                timer.endExecution();
            },
        );
        this.controller.supportsExecutionOrder = true;
    }
    setMimeType(expectedMimeType: 'text' | 'html' | 'image' = 'text') {
        this.expectedMimeType = expectedMimeType;
    }
    dispose() {
        this.controller.dispose();
    }
    private executionHandler(cells: NotebookCell[]) {
        for (const cell of cells) {
            const execution = this.controller.createNotebookCellExecution(cell);
            const value = `${cell.document.getText()} => ${cell.index + 1}`;
            execution.start(Date.now());
            void execution.clearOutput();
            this.lastExecutionOrder = this.lastExecutionOrder + 1;
            execution.executionOrder = this.lastExecutionOrder;
            const outputItems = [NotebookCellOutputItem.text(value)];
            if (this.expectedMimeType === 'html') {
                outputItems.push(NotebookCellOutputItem.text('<div>Hello World</div>', 'text/html'));
            }
            if (this.expectedMimeType === 'image') {
                outputItems.push(
                    new NotebookCellOutputItem(
                        base64ToUint8Array(
                            'iVBORw0KGgoAAAANSUhEUgAAABgAAAAYCAYAAADgdz34AAAABHNCSVQICAgIfAhkiAAAAAlwSFlzAAAApgAAAKYB3X3/OAAAABl0RVh0U29mdHdhcmUAd3d3Lmlua3NjYXBlLm9yZ5vuPBoAAANCSURBVEiJtZZPbBtFFMZ/M7ubXdtdb1xSFyeilBapySVU8h8OoFaooFSqiihIVIpQBKci6KEg9Q6H9kovIHoCIVQJJCKE1ENFjnAgcaSGC6rEnxBwA04Tx43t2FnvDAfjkNibxgHxnWb2e/u992bee7tCa00YFsffekFY+nUzFtjW0LrvjRXrCDIAaPLlW0nHL0SsZtVoaF98mLrx3pdhOqLtYPHChahZcYYO7KvPFxvRl5XPp1sN3adWiD1ZAqD6XYK1b/dvE5IWryTt2udLFedwc1+9kLp+vbbpoDh+6TklxBeAi9TL0taeWpdmZzQDry0AcO+jQ12RyohqqoYoo8RDwJrU+qXkjWtfi8Xxt58BdQuwQs9qC/afLwCw8tnQbqYAPsgxE1S6F3EAIXux2oQFKm0ihMsOF71dHYx+f3NND68ghCu1YIoePPQN1pGRABkJ6Bus96CutRZMydTl+TvuiRW1m3n0eDl0vRPcEysqdXn+jsQPsrHMquGeXEaY4Yk4wxWcY5V/9scqOMOVUFthatyTy8QyqwZ+kDURKoMWxNKr2EeqVKcTNOajqKoBgOE28U4tdQl5p5bwCw7BWquaZSzAPlwjlithJtp3pTImSqQRrb2Z8PHGigD4RZuNX6JYj6wj7O4TFLbCO/Mn/m8R+h6rYSUb3ekokRY6f/YukArN979jcW+V/S8g0eT/N3VN3kTqWbQ428m9/8k0P/1aIhF36PccEl6EhOcAUCrXKZXXWS3XKd2vc/TRBG9O5ELC17MmWubD2nKhUKZa26Ba2+D3P+4/MNCFwg59oWVeYhkzgN/JDR8deKBoD7Y+ljEjGZ0sosXVTvbc6RHirr2reNy1OXd6pJsQ+gqjk8VWFYmHrwBzW/n+uMPFiRwHB2I7ih8ciHFxIkd/3Omk5tCDV1t+2nNu5sxxpDFNx+huNhVT3/zMDz8usXC3ddaHBj1GHj/As08fwTS7Kt1HBTmyN29vdwAw+/wbwLVOJ3uAD1wi/dUH7Qei66PfyuRj4Ik9is+hglfbkbfR3cnZm7chlUWLdwmprtCohX4HUtlOcQjLYCu+fzGJH2QRKvP3UNz8bWk1qMxjGTOMThZ3kvgLI5AzFfo379UAAAAASUVORK5CYII=',
                        ),
                        'image/png',
                    ),
                );
            }
            void execution.appendOutput(new NotebookCellOutput(outputItems));
            execution.end(true, Date.now());
        }
    }
}

export function activate(context: ExtensionContext): API {
    const controller = new NotebookKernel();
    context.subscriptions.push(timer);
    context.subscriptions.push(controller);
    const runAll = (outputType: 'text' | 'html' | 'image') => {
        const notebook = window.activeNotebookEditor?.notebook;
        if (!notebook) {
            return;
        }

        controller.lastExecutionOrder = 0;
        controller.setMimeType(outputType);
        timer.reset(outputType);
        void commands.executeCommand('notebook.cell.execute', {
            ranges: [{ start: 0, end: notebook.cellCount }],
            document: notebook.uri,
        });
    };
    context.subscriptions.push(
        commands.registerCommand('vscode-notebook-dummy-execution.runAllTextOutput', () => runAll('text')),
        commands.registerCommand('vscode-notebook-dummy-execution.runAllHtmlOutput', () => runAll('html')),
        commands.registerCommand('vscode-notebook-dummy-execution.runAllImageOutput', () => runAll('image')),
    );

    let lastUpdateTime = Date.now();
    const getTimeElapsedSinceLastUpdate = () => Date.now() - lastUpdateTime;
    context.subscriptions.push(
        workspace.onDidChangeNotebookDocument(() => {
            if (timer.executionCompleted) {
                timer.detectNotebookChanges();
                lastUpdateTime = Date.now();
            }
        }),
    );

    return {
        executeNotebook: async (outputType: 'text' | 'html' | 'image') => {
            runAll(outputType);
            await new Promise<void>(async (resolve) => {
                while (getTimeElapsedSinceLastUpdate() < 10_000) {
                    await sleep(1000);
                }
                // Looks like no more updates are coming in.
                return resolve();
            });

            return timer.metrics;
        },
    };
}

export function deactivate() {
    // no-op
}
export function base64ToUint8Array(base64: string): Uint8Array {
    if (typeof Buffer !== 'undefined' && typeof Buffer.from === 'function') {
        return Buffer.from(base64, 'base64');
    } else {
        return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    }
}

function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
