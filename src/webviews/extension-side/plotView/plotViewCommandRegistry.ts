// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { commands, NotebookCell, window } from 'vscode';
import { Commands } from '../../../platform/common/constants';
import { IDisposableRegistry } from '../../../platform/common/types';
import { IExtensionSyncActivationService } from '../../../platform/activation/types';
import { PlotViewHandler } from './plotViewHandler';
import { logger } from '../../../platform/logging';
import { ICommandNameArgumentTypeMapping } from '../../../commands';

@injectable()
export class PlotViewCommandRegistry implements IExtensionSyncActivationService {
    constructor(
        @inject(IDisposableRegistry) private readonly disposables: IDisposableRegistry,
        @inject(PlotViewHandler) private readonly plotViewHandler: PlotViewHandler
    ) {}

    public activate(): void {
        this.registerCommand(Commands.OpenImageInPlotViewer, this.openImageInPlotViewer.bind(this));
    }

    private registerCommand<
        E extends keyof ICommandNameArgumentTypeMapping,
        U extends ICommandNameArgumentTypeMapping[E]
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
    >(command: E, callback: (...args: U) => any) {
        const disposable = commands.registerCommand(command, callback, this);
        this.disposables.push(disposable);
    }

    private async openImageInPlotViewer(cell?: NotebookCell): Promise<void> {
        try {
            // If no cell provided, try to get the active cell
            const targetCell = cell || window.activeNotebookEditor?.notebook.cellAt(window.activeNotebookEditor.selection.start);
            
            if (!targetCell) {
                window.showInformationMessage('No active notebook cell found. Please select a cell with image output.');
                return;
            }

            // Look for image outputs in the cell
            const imageOutputs = this.findImageOutputs(targetCell);
            
            if (imageOutputs.length === 0) {
                window.showInformationMessage('No image outputs found in the selected cell.');
                return;
            }

            // If multiple images, open the first one (could be enhanced to show a picker)
            const firstImageOutput = imageOutputs[0];
            const notebook = targetCell.notebook;
            
            await this.plotViewHandler.openPlot(notebook, firstImageOutput.outputId);
            
        } catch (error) {
            logger.error('Failed to open image in plot viewer', error);
            window.showErrorMessage(`Failed to open image: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    private findImageOutputs(cell: NotebookCell): Array<{ outputId: string; mimeType: string }> {
        const imageOutputs: Array<{ outputId: string; mimeType: string }> = [];
        
        for (const output of cell.outputs) {
            if (!output.id) {
                continue;
            }
            
            for (const item of output.items) {
                if (item.mime.startsWith('image/')) {
                    imageOutputs.push({
                        outputId: output.id,
                        mimeType: item.mime
                    });
                }
            }
        }
        
        return imageOutputs;
    }
}