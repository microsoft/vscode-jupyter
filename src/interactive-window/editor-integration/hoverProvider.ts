// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable, named } from 'inversify';

import * as vscode from 'vscode';
import { IExtensionSyncActivationService } from '../../platform/activation/types';
import { raceCancellation } from '../../platform/common/cancellation';
import { Identifiers, InteractiveWindowView, PYTHON, Telemetry } from '../../platform/common/constants';
import { logger } from '../../platform/logging';
import { IDisposableRegistry } from '../../platform/common/types';
import { Delayer, raceTimeout } from '../../platform/common/utils/async';
import { StopWatch } from '../../platform/common/utils/stopWatch';
import { sendTelemetryEvent } from '../../telemetry';
import { IKernel, IKernelProvider } from '../../kernels/types';
import { IJupyterVariables } from '../../kernels/variables/types';
import { IInteractiveWindowProvider } from '../types';
import { getInteractiveCellMetadata } from '../helpers';
import {
    notebookCellExecutions,
    type NotebookCellExecutionStateChangeEvent
} from '../../platform/notebooks/cellExecutionStateService';
import { noop } from '../../platform/common/utils/misc';

/**
 * Provides hover support in python files based on the state of a jupyter kernel. Files that are
 * sent to the Interactive Window have hover support added when hovering over variables.
 */
@injectable()
export class HoverProvider implements IExtensionSyncActivationService, vscode.HoverProvider {
    private runFiles = new Set<string>();
    private hoverProviderRegistration: vscode.Disposable | undefined;
    private stopWatch = new StopWatch();
    private delayer = new Delayer<void>(300);
    private onDidChangeNotebookCellExecutionStateHandler: vscode.Disposable;
    constructor(
        @inject(IJupyterVariables) @named(Identifiers.KERNEL_VARIABLES) private variableProvider: IJupyterVariables,
        @inject(IInteractiveWindowProvider) private interactiveProvider: IInteractiveWindowProvider,
        @inject(IDisposableRegistry) private readonly disposables: IDisposableRegistry,
        @inject(IKernelProvider) private readonly kernelProvider: IKernelProvider
    ) {}
    public activate() {
        this.onDidChangeNotebookCellExecutionStateHandler =
            notebookCellExecutions.onDidChangeNotebookCellExecutionState(
                (e) => this.delayer.trigger(() => this.onDidChangeNotebookCellExecutionState(e)).catch(noop),
                this
            );
        this.kernelProvider.onDidRestartKernel(() => this.runFiles.clear(), this, this.disposables);
    }
    public dispose() {
        this.delayer.dispose();
        this.onDidChangeNotebookCellExecutionStateHandler.dispose();
        if (this.hoverProviderRegistration) {
            this.hoverProviderRegistration.dispose();
        }
    }
    private async onDidChangeNotebookCellExecutionState(e: NotebookCellExecutionStateChangeEvent): Promise<void> {
        try {
            if (e.cell.notebook.notebookType !== InteractiveWindowView) {
                return;
            }
            const size = this.runFiles.size;
            const metadata = getInteractiveCellMetadata(e.cell);
            if (metadata !== undefined) {
                this.runFiles.add(metadata.interactive.uristring);
            }
            if (size !== this.runFiles.size) {
                this.initializeHoverProvider();
                // Once we have created the hover provider, no need to listen to this event anymore
                // The executionStateChange event is very (very) chatty, so we don't want to keep listening to it
                this.onDidChangeNotebookCellExecutionStateHandler.dispose();
            }
        } catch (exc) {
            // Don't let exceptions in a preExecute mess up normal operation
            logger.error(exc);
        }
    }

    public async provideHover(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken
    ): Promise<vscode.Hover | undefined> {
        this.stopWatch.reset();
        const result = await raceTimeout(300, this.getVariableHover(document, position, token));
        sendTelemetryEvent(
            Telemetry.InteractiveFileTooltipsPerf,
            { duration: this.stopWatch.elapsedTime },
            {
                isResultNull: !!result
            }
        );
        return result;
    }

    private initializeHoverProvider() {
        if (!this.hoverProviderRegistration) {
            this.hoverProviderRegistration = vscode.languages.registerHoverProvider(PYTHON, this);
        }
    }

    private async getVariableHover(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken
    ): Promise<vscode.Hover | undefined> {
        // Make sure to fail as soon as the cancel token is signaled
        const range = document.getWordRangeAtPosition(position);
        if (range) {
            const word = document.getText(range);
            if (word) {
                // See if we have any matching notebooks
                const notebooks = this.getMatchingKernels(document);
                if (notebooks.length) {
                    // Just use the first one to reply if more than one.
                    const attributes = await raceCancellation(
                        token,
                        {},
                        // Note, getVariableProperties is non null here because we are specifically
                        // injecting kernelVariables, which does define this interface method
                        ...notebooks.map((n) => this.variableProvider.getVariableProperties!(word, n, token))
                    );
                    const entries = Object.entries(attributes || {});
                    if (entries.length > 0) {
                        const asMarkdown =
                            entries.reduce((accum, entry) => accum + `${entry[0]}: ${entry[1]}\n`, '```\n') + '```';
                        const result = {
                            contents: [new vscode.MarkdownString(asMarkdown)]
                        };
                        return result;
                    }
                }
            }
        }
        return;
    }

    private getMatchingKernels(document: vscode.TextDocument): IKernel[] {
        // First see if we have an interactive window who's owner is this document
        let notebookUri = this.interactiveProvider.get(document.uri)?.notebookUri;
        if (!notebookUri) {
            return [];
        }
        const kernels = new Set<IKernel>();
        vscode.workspace.notebookDocuments
            .filter((item) => notebookUri?.toString() === item.uri.toString())
            .forEach((item) => {
                const kernel = this.kernelProvider.get(item);
                if (kernel) {
                    kernels.add(kernel);
                }
            });
        return Array.from(kernels);
    }
}
