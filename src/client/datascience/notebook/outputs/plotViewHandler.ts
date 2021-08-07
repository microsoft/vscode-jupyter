import { inject, injectable } from 'inversify';
import { NotebookCellOutputItem, NotebookEditor } from 'vscode';
import { traceError } from '../../../common/logger';
import { IPlotViewerProvider } from '../../types';

const svgMimeType = 'image/svg+xml';

@injectable()
export class PlotViewHandler {
    constructor(@inject(IPlotViewerProvider) private readonly plotViewProvider: IPlotViewerProvider) {}

    public async openPlot(editor: NotebookEditor, outputId: string) {
        if (editor.document.isClosed) {
            return;
        }
        const outputItem = getOutputItem(editor, outputId, svgMimeType);
        if (!outputItem) {
            return traceError(`No SVG Plot to open ${editor.document.uri.toString()}, id: ${outputId}`);
        }
        const svg = new TextDecoder().decode(outputItem.data);
        await this.plotViewProvider.showPlot(svg);
    }
}

function getOutputItem(editor: NotebookEditor, outputId: string, mimeType: string): NotebookCellOutputItem | undefined {
    for (const cell of editor.document.getCells()) {
        for (const output of cell.outputs) {
            if (output.id !== outputId) {
                continue;
            }
            return output.items.find((item) => item.mime === mimeType);
        }
    }
}
