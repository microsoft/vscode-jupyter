import sizeOf from 'image-size';
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

            // If we did find a PNG wrap it in an SVG element so that we can display it
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

// Wrap our PNG data into an SVG element so what we can display it in the current plot viewer
function convertPngToSvg(pngOutput: NotebookCellOutputItem): string {
    const imageBuffer = Buffer.from(pngOutput.data);
    const imageData = imageBuffer.toString('base64');
    const dims = sizeOf(imageBuffer);

    // Of note here, we want the dims on the SVG element, and the image at 100% this is due to how the SVG control
    // in the plot viewer works. The injected svg is sized down to 100px x 100px on the plot selection list so if
    // dims are set on the image then it scales out of bounds
    return `<svg height="${dims.height}" width="${dims.width}">
    <g>
        <image xmlns="http://www.w3.org/2000/svg" x="0" y="0" height="100%" width="100%" xmlns:xlink="http://www.w3.org/1999/xlink" xlink:href="data:image/png;base64,${imageData}"/>
    </g>
</svg>`;
}
