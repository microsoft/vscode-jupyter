import { inject, injectable } from 'inversify';
import { NotebookCellOutputItem, NotebookEditor } from 'vscode';
import { traceError } from '../../../common/logger';
import { IPlotViewerProvider } from '../../types';

const svgMimeType = 'image/svg+xml';
const pngMimeType = 'image/png';

@injectable()
export class PlotViewHandler {
    constructor(@inject(IPlotViewerProvider) private readonly plotViewProvider: IPlotViewerProvider) {}

    public async openPlot(editor: NotebookEditor, outputId: string) {
        if (editor.document.isClosed) {
            return;
        }
        const outputItem = getOutputItem(editor, outputId, svgMimeType);
        let svgString: string | undefined;
        if (!outputItem) {
            // Didn't find svg, see if we have png we can convert
            const pngOutput = getOutputItem(editor, outputId, pngMimeType);

            if (!pngOutput) {
                return traceError(`No SVG or PNG Plot to open ${editor.document.uri.toString()}, id: ${outputId}`);
            }

            svgString = convertPngToSvg(pngOutput);
        } else {
            svgString = new TextDecoder().decode(outputItem.data);
        }
        if (svgString) {
            await this.plotViewProvider.showPlot(svgString);
        }
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

function convertPngToSvg(_pngOutput: NotebookCellOutputItem): string {
    return `<svg height="500" width="500">
    <circle cx="250" cy="250" r="50" fill="#123456" />
</svg>`;
}
