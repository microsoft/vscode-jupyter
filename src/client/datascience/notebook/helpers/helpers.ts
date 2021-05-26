// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import * as fastDeepEqual from 'fast-deep-equal';
import { nbformat } from '@jupyterlab/coreutils';
import {
    NotebookCellOutput,
    NotebookCellOutputItem,
    NotebookCell,
    NotebookCellData,
    NotebookCellMetadata,
    NotebookData,
    NotebookDocument,
    NotebookCellKind,
    NotebookDocumentMetadata,
    NotebookCellExecutionState,
    notebook,
    NotebookCellExecutionStateChangeEvent,
    NotebookCellExecutionSummary
} from 'vscode';
import { concatMultilineString, splitMultilineString } from '../../../../datascience-ui/common';
import { IVSCodeNotebook } from '../../../common/application/types';
import { MARKDOWN_LANGUAGE, PYTHON_LANGUAGE } from '../../../common/constants';
import '../../../common/extensions';
import { traceError, traceInfo, traceInfoIf, traceWarning } from '../../../common/logger';
import { isUntitledFile } from '../../../common/utils/misc';
import { sendTelemetryEvent } from '../../../telemetry';
import { Telemetry } from '../../constants';
import { KernelConnectionMetadata, NotebookCellRunState } from '../../jupyter/kernels/types';
import { updateNotebookMetadata } from '../../notebookStorage/baseModel';
import { CellState, IJupyterKernelSpec } from '../../types';
import { JupyterNotebookView } from '../constants';
// eslint-disable-next-line @typescript-eslint/no-require-imports
import { KernelMessage } from '@jupyterlab/services';
// eslint-disable-next-line @typescript-eslint/no-require-imports
import cloneDeep = require('lodash/cloneDeep');
import { Uri } from 'vscode';
import { IDisposable, Resource } from '../../../common/types';
import { IFileSystem } from '../../../common/platform/types';
import { CellOutputMimeTypes } from '../types';
import { disposeAllDisposables } from '../../../common/helpers';

/**
 * Whether this is a Notebook we created/manage/use.
 * Remember, there could be other notebooks such as GitHub Issues nb by VS Code.
 */
export function isJupyterNotebook(document: NotebookDocument): boolean;
// eslint-disable-next-line @typescript-eslint/unified-signatures
export function isJupyterNotebook(viewType: string): boolean;
export function isJupyterNotebook(option: NotebookDocument | string) {
    if (typeof option === 'string') {
        return option === JupyterNotebookView;
    } else {
        return option.viewType === JupyterNotebookView;
    }
}

const kernelInformationForNotebooks = new WeakMap<
    NotebookDocument,
    { metadata?: KernelConnectionMetadata | undefined; kernelInfo?: Partial<KernelMessage.IInfoReplyMsg['content']> }
>();

export function isResourceNativeNotebook(resource: Resource, notebooks: IVSCodeNotebook, fs: IFileSystem) {
    if (!resource) {
        return false;
    }
    return notebooks.notebookDocuments.some((item) => fs.arePathsSame(item.uri, resource));
}
export function getNotebookMetadata(document: NotebookDocument): nbformat.INotebookMetadata | undefined {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let notebookContent: Partial<nbformat.INotebookContent> = document.metadata.custom as any;

    // If language isn't specified in the metadata, at least specify that
    if (!notebookContent?.metadata?.language_info?.name) {
        const content = notebookContent || {};
        const metadata = content.metadata || { orig_nbformat: 3, language_info: {} };
        const language_info = { ...metadata.language_info };
        // Fix nyc compiler not working.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        notebookContent = { ...content, metadata: { ...metadata, language_info } } as any;
    }
    notebookContent = cloneDeep(notebookContent);
    const data = kernelInformationForNotebooks.get(document);
    if (data && data.metadata) {
        updateNotebookMetadata(notebookContent.metadata, data.metadata, data.kernelInfo);
    }

    traceInfoIf(
        !!process.env.VSC_JUPYTER_LOG_KERNEL_OUTPUT,
        `Notebook metadata for ${document.uri.toString()} is ${data?.metadata?.id}`
    );

    return notebookContent.metadata;
}

export function isPythonNotebook(metadata?: nbformat.INotebookMetadata) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const kernelSpec = (metadata?.kernelspec as any) as IJupyterKernelSpec | undefined;
    if (metadata?.language_info?.name && metadata.language_info.name !== PYTHON_LANGUAGE) {
        return false;
    }

    if (kernelSpec?.name.includes(PYTHON_LANGUAGE)) {
        return true;
    }

    // Valid notebooks will have a language information in the metadata.
    return kernelSpec?.language === PYTHON_LANGUAGE || metadata?.language_info?.name === PYTHON_LANGUAGE;
}
/**
 * No need to update the notebook metadata just yet.
 * When users open a blank notebook and a kernel is auto selected, document is marked as dirty. Hence as soon as you create a blank notebook it is dr ity.
 * Similarly, if you open an existing notebook, it is marked as dirty.
 *
 * Solution: Store the metadata in some place, when saving, take the metadata & store in the file.
 * Thus this method doesn't update it, we merely keep track of the kernel information, and when saving we retrieve the information from the tracked location (map).
 *
 * If `kernelConnection` is empty, then when saving the notebook we will not update the
 * metadata in the notebook with any kernel information (we can't as its empty).
 *
 * @param {(KernelConnectionMetadata | undefined)} kernelConnection
 * This can be undefined when a kernels contributed by other VSC extensions is selected.
 * E.g. .NET extension can contribute their own extension. At this point they could
 * end up updating the notebook metadata themselves. We should not blow this metadata away. The way we achieve that is by clearing this stored kernel information & not updating the metadata.
 */
export function trackKernelInNotebookMetadata(
    document: NotebookDocument,
    kernelConnection: KernelConnectionMetadata | undefined
) {
    const data = { ...(kernelInformationForNotebooks.get(document) || {}) };
    data.metadata = kernelConnection;
    let language: string | undefined;
    switch (kernelConnection?.kind) {
        case 'connectToLiveKernel':
            language = kernelConnection.kernelModel.language;
            break;
        case 'startUsingKernelSpec':
            language = kernelConnection.kernelSpec.language;
            break;
        case 'startUsingPythonInterpreter':
            language = PYTHON_LANGUAGE;
            break;
        default:
            break;
    }
    if (language) {
        data.kernelInfo = {
            language_info: {
                name: language,
                version: ''
            }
        };
    } else {
        data.kernelInfo = undefined;
    }

    kernelInformationForNotebooks.set(document, data);
}
/**
 * Whether the kernel connection information tracked against the document is the same as the one provided.
 */
export function isSameAsTrackedKernelInNotebookMetadata(
    document: NotebookDocument,
    kernelConnection: KernelConnectionMetadata
) {
    const data = { ...(kernelInformationForNotebooks.get(document) || {}) };
    const expectedData: typeof data = { metadata: kernelConnection };
    let language: string | undefined;
    switch (kernelConnection?.kind) {
        case 'connectToLiveKernel':
            language = kernelConnection.kernelModel.language;
            break;
        case 'startUsingKernelSpec':
            language = kernelConnection.kernelSpec.language;
            break;
        case 'startUsingPythonInterpreter':
            language = PYTHON_LANGUAGE;
            break;
        default:
            break;
    }
    if (language) {
        expectedData.kernelInfo = {
            language_info: {
                name: language,
                version: ''
            }
        };
    } else {
        expectedData.kernelInfo = undefined;
    }
    return fastDeepEqual(data, expectedData);
}
/**
 * Thus this method doesn't update it the notebook metadata, we merely keep track of the information.
 * When saving we retrieve the information from the tracked location (map).
 * @see {trackKernelInNotebookMetadata} That function does something similar.
 */
export function trackKernelInfoInNotebookMetadata(
    document: NotebookDocument,
    kernelInfo: KernelMessage.IInfoReplyMsg['content']
) {
    if (kernelInformationForNotebooks.get(document)?.kernelInfo === kernelInfo) {
        return;
    }
    const data = { ...(kernelInformationForNotebooks.get(document) || {}) };
    data.kernelInfo = kernelInfo;
    kernelInformationForNotebooks.set(document, data);
}

export function deleteKernelMetadataForTests(document: NotebookDocument) {
    kernelInformationForNotebooks.delete(document);
}
/**
 * Converts a NotebookModel into VSCode friendly format.
 */
export function notebookModelToVSCNotebookData(
    isNotebookTrusted: boolean,
    notebookContentWithoutCells: Exclude<Partial<nbformat.INotebookContent>, 'cells'>,
    notebookUri: Uri,
    nbCells: nbformat.IBaseCell[],
    preferredLanguage: string,
    originalJson: Partial<nbformat.INotebookContent>
): NotebookData {
    const cells = nbCells
        .map((cell) => createVSCNotebookCellDataFromCell(preferredLanguage, cell))
        .filter((item) => !!item)
        .map((item) => item!);

    if (cells.length === 0 && (isUntitledFile(notebookUri) || Object.keys(originalJson).length === 0)) {
        cells.push(new NotebookCellData(NotebookCellKind.Code, '', preferredLanguage));
    }
    return new NotebookData(
        cells,
        new NotebookDocumentMetadata().with({
            custom: notebookContentWithoutCells, // Include metadata in VSC Model (so that VSC can display these if required)
            trusted: isNotebookTrusted
        })
    );
}
export function cellRunStateToCellState(cellRunState?: NotebookCellRunState): CellState {
    switch (cellRunState) {
        case NotebookCellRunState.Running:
            return CellState.executing;
        case NotebookCellRunState.Error:
            return CellState.error;
        default:
            return CellState.init;
    }
}
export function createJupyterCellFromVSCNotebookCell(
    vscCell: NotebookCell
): nbformat.IRawCell | nbformat.IMarkdownCell | nbformat.ICodeCell {
    let cell: nbformat.IRawCell | nbformat.IMarkdownCell | nbformat.ICodeCell;
    if (vscCell.kind === NotebookCellKind.Markup) {
        cell = createMarkdownCellFromNotebookCell(vscCell);
    } else if (vscCell.document.languageId === 'raw') {
        cell = createRawCellFromNotebookCell(vscCell);
    } else {
        cell = createCodeCellFromNotebookCell(vscCell);
    }
    return cell;
}

/**
 * Identifies Jupyter Cell metadata that are to be stored in VSCode Cells.
 * This is used to facilitate:
 * 1. When a user copies and pastes a cell, then the corresponding metadata is also copied across.
 * 2. Diffing (VSC knows about metadata & stuff that contributes changes to a cell).
 */
export function getNotebookCellMetadata(cell: nbformat.IBaseCell): CellMetadata {
    // We put this only for VSC to display in diff view.
    // Else we don't use this.
    const propertiesToClone: (keyof CellMetadata)[] = ['metadata', 'attachments'];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const custom: CellMetadata = {};
    propertiesToClone.forEach((propertyToClone) => {
        if (cell[propertyToClone]) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            custom[propertyToClone] = cloneDeep(cell[propertyToClone]) as any;
        }
    });
    return custom;
}

function createRawCellFromNotebookCell(cell: NotebookCell): nbformat.IRawCell {
    const cellMetadata = cell.metadata.custom as CellMetadata | undefined;
    const rawCell: nbformat.IRawCell = {
        cell_type: 'raw',
        source: splitMultilineString(cell.document.getText()),
        metadata: cellMetadata?.metadata || {} // This cannot be empty.
    };
    if (cellMetadata?.attachments) {
        rawCell.attachments = cellMetadata.attachments;
    }
    return rawCell;
}

function createCodeCellFromNotebookCell(cell: NotebookCell): nbformat.ICodeCell {
    const cellMetadata = cell.metadata.custom as CellMetadata | undefined;
    const code = cell.document.getText();
    return {
        cell_type: 'code',
        execution_count: cell.executionSummary?.executionOrder ?? null,
        source: splitMultilineString(code),
        outputs: cell.outputs.map(translateCellDisplayOutput),
        metadata: cellMetadata?.metadata || {} // This cannot be empty.
    };
}

function createNotebookCellDataFromRawCell(cell: nbformat.IRawCell): NotebookCellData {
    const notebookCellMetadata = new NotebookCellMetadata().with({
        custom: getNotebookCellMetadata(cell)
    });
    return new NotebookCellData(
        NotebookCellKind.Code,
        concatMultilineString(cell.source),
        'raw',
        [],
        notebookCellMetadata
    );
}
function createMarkdownCellFromNotebookCell(cell: NotebookCell): nbformat.IMarkdownCell {
    const cellMetadata = cell.metadata.custom as CellMetadata | undefined;
    const markdownCell: nbformat.IMarkdownCell = {
        cell_type: 'markdown',
        source: splitMultilineString(cell.document.getText()),
        metadata: cellMetadata?.metadata || {} // This cannot be empty.
    };
    if (cellMetadata?.attachments) {
        markdownCell.attachments = cellMetadata.attachments;
    }
    return markdownCell;
}
function createNotebookCellDataFromMarkdownCell(cell: nbformat.IMarkdownCell): NotebookCellData {
    const notebookCellMetadata = new NotebookCellMetadata().with({
        custom: getNotebookCellMetadata(cell)
    });
    return new NotebookCellData(
        NotebookCellKind.Markup,
        concatMultilineString(cell.source),
        MARKDOWN_LANGUAGE,
        [],
        notebookCellMetadata
    );
}
function createNotebookCellDataFromCodeCell(cell: nbformat.ICodeCell, cellLanguage: string): NotebookCellData {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cellOutputs: nbformat.IOutput[] = Array.isArray(cell.outputs) ? cell.outputs : [];
    const outputs = createVSCCellOutputsFromOutputs(cellOutputs);
    const hasExecutionCount = typeof cell.execution_count === 'number' && cell.execution_count > 0;

    const notebookCellMetadata = new NotebookCellMetadata().with({
        custom: getNotebookCellMetadata(cell)
    });

    const source = concatMultilineString(cell.source);

    const executionSummary: NotebookCellExecutionSummary = hasExecutionCount
        ? { executionOrder: cell.execution_count as number }
        : {};
    return new NotebookCellData(
        NotebookCellKind.Code,
        source,
        cellLanguage,
        outputs,
        notebookCellMetadata,
        executionSummary
    );
}
const orderOfMimeTypes = [
    'application/vnd.*',
    'application/vdom.*',
    'application/geo+json',
    'application/x-nteract-model-debug+json',
    'text/html',
    'application/javascript',
    'image/gif',
    'text/latex',
    'text/markdown',
    'image/svg+xml',
    'image/png',
    'image/jpeg',
    'application/json',
    'text/plain'
];
function sortOutputItemsBasedOnDisplayOrder(outputItems: NotebookCellOutputItem[]): NotebookCellOutputItem[] {
    return outputItems.sort((outputItemA, outputItemB) => {
        const isMimeTypeMatch = (value: string, compareWith: string) => {
            if (value.endsWith('.*')) {
                value = value.substr(0, value.indexOf('.*'));
            }
            return compareWith.startsWith(value);
        };
        const indexOfMimeTypeA = orderOfMimeTypes.findIndex((mime) => isMimeTypeMatch(outputItemA.mime, mime));
        const indexOfMimeTypeB = orderOfMimeTypes.findIndex((mime) => isMimeTypeMatch(outputItemB.mime, mime));
        return indexOfMimeTypeA - indexOfMimeTypeB;
    });
}

/**
 * This class is used to track state of cells, used in logging & tests.
 */
export class NotebookCellStateTracker implements IDisposable {
    private readonly disposables: IDisposable[] = [];
    private static cellStates = new WeakMap<NotebookCell, NotebookCellExecutionState>();
    constructor() {
        notebook.onDidChangeNotebookCellExecutionState(
            this.onDidChangeNotebookCellExecutionState,
            this,
            this.disposables
        );
    }
    dispose() {
        disposeAllDisposables(this.disposables);
    }
    public static getCellState(cell: NotebookCell): NotebookCellExecutionState | undefined {
        return NotebookCellStateTracker.cellStates.get(cell);
    }
    private onDidChangeNotebookCellExecutionState(e: NotebookCellExecutionStateChangeEvent) {
        NotebookCellStateTracker.cellStates.set(e.cell, e.executionState);
    }
}

export function traceCellMessage(cell: NotebookCell, message: string) {
    traceInfo(
        `Cell Index:${cell.index}, state:${NotebookCellStateTracker.getCellState(cell)}, exec: ${
            cell.executionSummary?.executionOrder
        }. ${message}`
    );
}

export function createVSCNotebookCellDataFromCell(
    cellLanguage: string,
    cell: nbformat.IBaseCell
): NotebookCellData | undefined {
    switch (cell.cell_type) {
        case 'raw': {
            return createNotebookCellDataFromRawCell(cell as nbformat.IRawCell);
        }
        case 'markdown': {
            return createNotebookCellDataFromMarkdownCell(cell as nbformat.IMarkdownCell);
        }
        case 'code': {
            return createNotebookCellDataFromCodeCell(cell as nbformat.ICodeCell, cellLanguage);
        }
        default: {
            traceError(`Conversion of Cell into VS Code NotebookCell not supported ${cell.cell_type}`);
        }
    }
}

export function createVSCCellOutputsFromOutputs(outputs?: nbformat.IOutput[]): NotebookCellOutput[] {
    const cellOutputs: nbformat.IOutput[] = Array.isArray(outputs) ? (outputs as []) : [];
    return cellOutputs.map(cellOutputToVSCCellOutput);
}
const cellOutputMappers = new Map<nbformat.OutputType, (output: nbformat.IOutput) => NotebookCellOutput>();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
cellOutputMappers.set('display_data', translateDisplayDataOutput as any);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
cellOutputMappers.set('error', translateErrorOutput as any);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
cellOutputMappers.set('execute_result', translateDisplayDataOutput as any);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
cellOutputMappers.set('stream', translateStreamOutput as any);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
cellOutputMappers.set('update_display_data', translateDisplayDataOutput as any);
export function cellOutputToVSCCellOutput(output: nbformat.IOutput): NotebookCellOutput {
    /**
     * Stream, `application/x.notebook.stream`
     * Error, `application/x.notebook.error-traceback`
     * Rich, { mime: value }
     *
     * outputs: [
            new vscode.NotebookCellOutput([
                new vscode.NotebookCellOutputItem('application/x.notebook.stream', 2),
                new vscode.NotebookCellOutputItem('application/x.notebook.stream', 3),
            ]),
            new vscode.NotebookCellOutput([
                new vscode.NotebookCellOutputItem('text/markdown', '## header 2'),
                new vscode.NotebookCellOutputItem('image/svg+xml', [
                    "<svg baseProfile=\"full\" height=\"200\" version=\"1.1\" width=\"300\" xmlns=\"http://www.w3.org/2000/svg\">\n",
                    "  <rect fill=\"blue\" height=\"100%\" width=\"100%\"/>\n",
                    "  <circle cx=\"150\" cy=\"100\" fill=\"green\" r=\"80\"/>\n",
                    "  <text fill=\"white\" font-size=\"60\" text-anchor=\"middle\" x=\"150\" y=\"125\">SVG</text>\n",
                    "</svg>"
                    ]),
            ]),
        ]
     *
     */
    const fn = cellOutputMappers.get(output.output_type as nbformat.OutputType);
    let result: NotebookCellOutput;
    if (fn) {
        result = fn(output);
    } else {
        traceWarning(`Unable to translate cell from ${output.output_type} to NotebookCellData for VS Code.`);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        result = translateDisplayDataOutput(output as any);
    }
    return result;
}

function getOutputMetadata(output: nbformat.IOutput): CellOutputMetadata {
    // Add on transient data if we have any. This should be removed by our save functions elsewhere.
    const metadata: CellOutputMetadata = {
        outputType: output.output_type
    };
    if (output.transient) {
        metadata.transient = output.transient;
    }

    switch (output.output_type as nbformat.OutputType) {
        case 'display_data':
        case 'execute_result':
        case 'update_display_data': {
            metadata.executionCount = output.execution_count;
            metadata.metadata = output.metadata ? cloneDeep(output.metadata) : {};
            break;
        }
        default:
            break;
    }

    return metadata;
}

/**
 * Converts a Jupyter display cell output into a VSCode cell output format.
 * Handles sizing, adding backgrounds to images and the like.
 * E.g. Jupyter cell output contains metadata to add backgrounds to images.
 */
function translateDisplayDataOutput(
    output: nbformat.IDisplayData | nbformat.IDisplayUpdate | nbformat.IExecuteResult
): NotebookCellOutput {
    // Metadata could be as follows:
    // We'll have metadata specific to each mime type as well as generic metadata.
    /*
    IDisplayData = {
        output_type: 'display_data',
        data: {
            'image/jpg': '/////'
            'image/png': '/////'
            'text/plain': '/////'
        },
        metadata: {
            'image/png': '/////',
            'background': true,
            'xyz': '///
        }
    }
    */
    const metadata = getOutputMetadata(output);
    const items: NotebookCellOutputItem[] = [];
    // eslint-disable-next-line
    const data: Record<string, any> = output.data || {};
    // eslint-disable-next-line
    for (const key in data) {
        // Add metadata to all (its the same)
        // We can optionally remove metadata that belongs to other mime types (feels like over optimization, hence not doing that).
        items.push(new NotebookCellOutputItem(convertJupyterOutputToBuffer(key, data[key]), key, metadata));
    }

    return new NotebookCellOutput(sortOutputItemsBasedOnDisplayOrder(items), metadata);
}

function translateStreamOutput(output: nbformat.IStream): NotebookCellOutput {
    const value = concatMultilineString(output.text);
    const factoryFn = output.name === 'stderr' ? NotebookCellOutputItem.stderr : NotebookCellOutputItem.stdout;
    return new NotebookCellOutput([factoryFn(value)], getOutputMetadata(output));
}

export function isStreamOutput(output: NotebookCellOutput, expectedStreamName: string): boolean {
    const metadata = output.metadata as CellOutputMetadata | undefined;
    return metadata?.outputType === 'stream' && getOutputStreamType(output) === expectedStreamName;
}

// Output stream can only have stderr or stdout so just check the first output. Undefined if no outputs
export function getOutputStreamType(output: NotebookCellOutput): string | undefined {
    if (output.outputs.length > 0) {
        return output.outputs[0].mime === CellOutputMimeTypes.stderr ? 'stderr' : 'stdout';
    }
}

type JupyterOutput =
    | nbformat.IUnrecognizedOutput
    | nbformat.IExecuteResult
    | nbformat.IDisplayData
    | nbformat.IStream
    | nbformat.IError;

/**
 * Metadata we store in VS Code cells.
 * This contains the original metadata from the Jupyuter cells.
 */
export type CellMetadata = {
    /**
     * Stores attachments for cells.
     */
    attachments?: nbformat.IAttachments;
    /**
     * Stores cell metadata.
     */
    metadata?: Partial<nbformat.ICellMetadata>;
};
/**
 * Metadata we store in VS Code cell output items.
 * This contains the original metadata from the Jupyuter Outputs.
 */
export type CellOutputMetadata = {
    /**
     * Cell output metadata.
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    metadata?: any;
    /**
     * Transient data from Jupyter.
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    transient?: {
        /**
         * This is used for updating the output in other cells.
         * We don't know of others properties, but this is definitely used.
         */
        display_id?: string;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } & any;
    /**
     * Original cell output type
     */
    outputType: nbformat.OutputType | string;
    executionCount?: nbformat.IExecuteResult['ExecutionCount'];
};

export function translateCellErrorOutput(output: NotebookCellOutput): nbformat.IError {
    // it should have at least one output item
    const firstItem = output.outputs[0];
    // Bug in VS Code.
    if (!firstItem.data) {
        return {
            output_type: 'error',
            ename: '',
            evalue: '',
            traceback: []
        };
    }
    const value: nbformat.IError = JSON.parse(Buffer.from(firstItem.data as Uint8Array).toString('utf8'));
    return {
        output_type: 'error',
        ename: value.ename,
        evalue: value.evalue,
        traceback: value.traceback
    };
}

const textMimeTypes = ['text/plain', 'text/markdown', CellOutputMimeTypes.stderr, CellOutputMimeTypes.stdout];
function convertOutputMimeToJupyterOutput(mime: string, value: Uint8Array) {
    if (!value) {
        return '';
    }
    const stringValue = Buffer.from(value as Uint8Array).toString('utf8');
    if (mime === CellOutputMimeTypes.error) {
        traceInfo(`Concerting ${mime} from ${stringValue}`);
        return JSON.parse(stringValue);
    } else if (mime.startsWith('text/') || textMimeTypes.includes(mime)) {
        return stringValue;
    } else if (mime.startsWith('image/')) {
        // Images in Jupyter are stored in base64 encoded format.
        // VS Code expects bytes when rendering images.
        return Buffer.from(stringValue, 'base64');
    } else if (mime.toLowerCase().includes('json')) {
        return JSON.parse(stringValue);
    } else {
        return stringValue;
    }
}
function convertJupyterOutputToBuffer(mime: string, value: unknown): Buffer {
    if (!value) {
        return Buffer.from('');
    }
    if ((mime.startsWith('text/') || textMimeTypes.includes(mime)) && typeof value === 'string') {
        return Buffer.from(value);
    } else if (mime.startsWith('image/') && typeof value === 'string') {
        // Images in Jupyter are stored in base64 encoded format.
        // VS Code expects bytes when rendering images.
        return Buffer.from(value, 'base64');
    } else if (mime.toLowerCase().includes('json')) {
        return Buffer.from(JSON.stringify(value));
    } else {
        return Buffer.from(value as string);
    }
}
export function translateCellDisplayOutput(output: NotebookCellOutput): JupyterOutput {
    const customMetadata = output.metadata as CellOutputMetadata | undefined;
    let result: JupyterOutput;
    // Possible some other extension added some output (do best effort to translate & save in ipynb).
    // In which case metadata might not contain `outputType`.
    const outputType = customMetadata?.outputType as nbformat.OutputType;
    switch (outputType) {
        case 'error': {
            result = translateCellErrorOutput(output);
            break;
        }
        case 'stream': {
            const outputs = output.outputs
                .filter((opit) => opit.mime === CellOutputMimeTypes.stderr || opit.mime === CellOutputMimeTypes.stdout)
                .map((opit) => convertOutputMimeToJupyterOutput(opit.mime, opit.data as Uint8Array) as string)
                .reduceRight<string[]>(
                    (prev, curr) => (Array.isArray(curr) ? prev.concat(...curr) : prev.concat(curr)),
                    []
                );

            const streamType = getOutputStreamType(output) || 'stdout';

            result = {
                output_type: 'stream',
                name: streamType,
                text: splitMultilineString(outputs.join(''))
            };
            break;
        }
        case 'display_data': {
            result = {
                output_type: 'display_data',
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                data: output.outputs.reduceRight((prev: any, curr) => {
                    prev[curr.mime] = convertOutputMimeToJupyterOutput(curr.mime, curr.data as Uint8Array);
                    return prev;
                }, {}),
                metadata: customMetadata?.metadata || {} // This can never be undefined.
            };
            break;
        }
        case 'execute_result': {
            result = {
                output_type: 'execute_result',
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                data: output.outputs.reduceRight((prev: any, curr) => {
                    prev[curr.mime] = convertOutputMimeToJupyterOutput(curr.mime, curr.data as Uint8Array);
                    return prev;
                }, {}),
                metadata: customMetadata?.metadata || {}, // This can never be undefined.
                execution_count:
                    typeof customMetadata?.executionCount === 'number' ? customMetadata?.executionCount : null // This can never be undefined, only a number or `null`.
            };
            break;
        }
        case 'update_display_data': {
            result = {
                output_type: 'update_display_data',
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                data: output.outputs.reduceRight((prev: any, curr) => {
                    prev[curr.mime] = convertOutputMimeToJupyterOutput(curr.mime, curr.data as Uint8Array);
                    return prev;
                }, {}),
                metadata: customMetadata?.metadata || {} // This can never be undefined.
            };
            break;
        }
        default: {
            const outputType = customMetadata?.outputType || 'unknown';
            sendTelemetryEvent(Telemetry.VSCNotebookCellTranslationFailed, undefined, {
                isErrorOutput: outputType === 'error'
            });
            const unknownOutput: nbformat.IUnrecognizedOutput = {
                output_type: outputType
            };
            if (customMetadata?.metadata) {
                unknownOutput.metadata = customMetadata.metadata;
            }
            if (output.outputs.length > 0) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                unknownOutput.data = output.outputs.reduceRight((prev: any, curr) => {
                    prev[curr.mime] = convertOutputMimeToJupyterOutput(curr.mime, curr.data as Uint8Array);
                    return prev;
                }, {});
            }
            result = unknownOutput;
            break;
        }
    }

    // Account for transient data as well
    // `transient.display_id` is used to update cell output in other cells, at least thats one use case we know of.
    if (result && customMetadata && customMetadata.transient) {
        result.transient = customMetadata.transient;
    }
    return result;
}

/**
 * We will display the error message in the status of the cell.
 * The `ename` & `evalue` is displayed at the top of the output by VS Code.
 * As we're displaying the error in the statusbar, we don't want this dup error in output.
 * Hence remove this.
 */
export function translateErrorOutput(output: nbformat.IError): NotebookCellOutput {
    return new NotebookCellOutput(
        [
            NotebookCellOutputItem.error({
                name: output.ename,
                message: output.evalue,
                stack: output.traceback.join('\n')
            })
        ],
        getOutputMetadata(output)
    );
}

export function getTextOutputValue(output: NotebookCellOutput): string {
    const item = output.outputs.find(
        (opit) =>
            opit.mime === CellOutputMimeTypes.stdout ||
            opit.mime === CellOutputMimeTypes.stderr ||
            opit.mime === 'text/plain' ||
            opit.mime === 'text/markdown'
    );

    if (item) {
        return convertOutputMimeToJupyterOutput(item.mime, item.data as Uint8Array);
    }
    return '';
}
export function hasErrorOutput(outputs: readonly NotebookCellOutput[]) {
    const errorOutput = outputs.find(
        (op) => op.outputs.length && !op.outputs.some((opit) => opit.mime !== CellOutputMimeTypes.error)
    );

    return !!errorOutput;
}

export function findAssociatedNotebookDocument(cellUri: Uri, vscodeNotebook: IVSCodeNotebook, fs: IFileSystem) {
    return vscodeNotebook.notebookDocuments.find((item) =>
        item.getCells().some((cell) => fs.arePathsSame(cell.document.uri, cellUri))
    );
}
