import { inject, injectable } from 'inversify';
import { NotebookCellOutput, NotebookDocument, Uri } from 'vscode';
import { IApplicationShell, IWorkspaceService } from '../../../common/application/types';
import { IFileSystem } from '../../../common/platform/types';
import { DataScience } from '../../../common/utils/localize';
import * as path from 'path';
import { saveSvgToPdf } from '../../plotting/plotViewer';
import { traceError } from '../../../common/logger';
import { getDisplayPath } from '../../../common/platform/fs-paths';

const svgMimeType = 'image/svg+xml';
const imageExtensionForMimeType: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpeg',
    'image/gif': 'gif',
    [svgMimeType]: 'svg'
};

@injectable()
export class PlotSaveHandler {
    constructor(
        @inject(IApplicationShell) private readonly shell: IApplicationShell,
        @inject(IFileSystem) private readonly fs: IFileSystem,
        @inject(IWorkspaceService) private readonly workspace: IWorkspaceService
    ) {}

    public async savePlot(notebook: NotebookDocument, outputId: string, mimeType: string) {
        if (notebook.isClosed) {
            return;
        }
        const output = getOutputItem(notebook, outputId, mimeType);
        if (!output) {
            return traceError(`Nolot to save ${getDisplayPath(notebook.uri)}, id: ${outputId} for ${mimeType}`);
        }
        if (!(mimeType.toLowerCase() in imageExtensionForMimeType)) {
            return traceError(`Unsupported MimeType ${getDisplayPath(notebook.uri)}, id: ${outputId} for ${mimeType}`);
        }

        const saveLocation = await this.getSaveTarget(output, mimeType);
        if (!saveLocation) {
            return;
        }
        if (saveLocation.fsPath.toLowerCase().endsWith('pdf')) {
            await this.saveAsPdf(output, saveLocation);
        } else {
            await this.saveAsImage(output, saveLocation);
        }
    }
    private getSaveTarget(output: NotebookCellOutput, mimeType: string) {
        const imageExtension = imageExtensionForMimeType[mimeType.toLowerCase()];
        const filters: Record<string, string[]> = {};
        // If we have an SVG, then we can export to PDF.
        if (output.items.find((item) => item.mime.toLowerCase() === svgMimeType)) {
            filters[DataScience.pdfFilter()] = ['pdf'];
            filters[DataScience.svgFilter()] = ['svg'];
        }
        if (imageExtension === 'png') {
            filters[DataScience.pngFilter()] = ['png'];
        }
        if (Object.keys(filters).length === 0) {
            filters['Images'] = [imageExtension];
        }
        const workspaceUri =
            (this.workspace.workspaceFolders?.length || 0) > 0 ? this.workspace.workspaceFolders![0].uri : undefined;
        const fileName = `output.${imageExtension}`;
        const defaultUri = workspaceUri ? Uri.joinPath(workspaceUri, fileName) : Uri.file(fileName);
        return this.shell.showSaveDialog({
            defaultUri,
            saveLabel: DataScience.exportPlotTitle(),
            filters
        });
    }
    private async saveAsImage(output: NotebookCellOutput, target: Uri) {
        const extension = path.extname(target.fsPath).substring(1);
        const correspondingMimeType = Object.keys(imageExtensionForMimeType).find(
            (mime) => imageExtensionForMimeType[mime] === extension
        );
        const data = output.items.find((item) => item.mime === correspondingMimeType);

        if (!data) {
            throw new Error(
                `Unsupported MimeType ${target.toString()}, available mime Types: ${output.items
                    .map((item) => item.mime)
                    .join(', ')}`
            );
        }

        await this.fs.writeFile(target, Buffer.from(data.data));
    }
    private async saveAsPdf(output: NotebookCellOutput, target: Uri) {
        const svgXml = Buffer.from(output.items.find((item) => item.mime === svgMimeType)!.data).toString();
        await saveSvgToPdf(svgXml, this.fs, target);
    }
}

function getOutputItem(notebook: NotebookDocument, outputId: string, mimeType: string): NotebookCellOutput | undefined {
    for (const cell of notebook.getCells()) {
        for (const output of cell.outputs) {
            if (output.id !== outputId) {
                continue;
            }
            if (output.items.find((item) => item.mime === mimeType)) {
                return output;
            }
        }
    }
}
