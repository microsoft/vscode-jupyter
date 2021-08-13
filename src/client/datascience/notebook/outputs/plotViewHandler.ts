import { inject, injectable } from 'inversify';
import { NotebookCellOutputItem, NotebookEditor } from 'vscode';
import { traceError } from '../../../common/logger';
import { IFileSystem } from '../../../common/platform/types';
import { IDisposableRegistry } from '../../../common/types';
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

function convertPngToSvg(pngOutput: NotebookCellOutputItem): string {
    const imageData = getImageData(pngOutput);
    const loadImage = new Image();
    loadImage.src = `data:image/png;base64,${imageData}`;
    return `<svg height="500" width="500">
    <g>
        <image xmlns="http://www.w3.org/2000/svg" x="0" y="0" height="auto" width="auto" xmlns:xlink="http://www.w3.org/1999/xlink" xlink:href="data:image/png;base64,${imageData}"/>
    </g>
</svg>`;
    return `<svg height="500" width="500">
    <g>
        <image xmlns="http://www.w3.org/2000/svg" x="0" y="0" height="500" width="500" xmlns:xlink="http://www.w3.org/1999/xlink" xlink:href="data:image/png;base64,${imageData}"/>
    </g>
</svg>`;
}

function getImageData(pngOutput: NotebookCellOutputItem): string {
    const testBuffer = Buffer.from(pngOutput.data);
    return testBuffer.toString('base64');
}
