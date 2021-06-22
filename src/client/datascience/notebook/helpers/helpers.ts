// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { nbformat } from '@jupyterlab/coreutils';
import {
    NotebookCellOutput,
    NotebookCellOutputItem,
    NotebookCell,
    NotebookCellData,
    NotebookData,
    NotebookDocument,
    NotebookCellKind,
    NotebookCellExecutionState,
    notebooks,
    NotebookCellExecutionStateChangeEvent,
    NotebookCellExecutionSummary,
    WorkspaceEdit
} from 'vscode';
import { concatMultilineString, splitMultilineString } from '../../../../datascience-ui/common';
import { IVSCodeNotebook } from '../../../common/application/types';
import { MARKDOWN_LANGUAGE, PYTHON_LANGUAGE } from '../../../common/constants';
import '../../../common/extensions';
import { traceError, traceInfo, traceWarning } from '../../../common/logger';
import { sendTelemetryEvent } from '../../../telemetry';
import { Telemetry } from '../../constants';
import { KernelConnectionMetadata } from '../../jupyter/kernels/types';
import { updateNotebookMetadata } from '../../notebookStorage/baseModel';
import { IJupyterKernelSpec } from '../../types';
import { InteractiveWindowView, JupyterNotebookView } from '../constants';
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
        return option === JupyterNotebookView || option === InteractiveWindowView;
    } else {
        return option.notebookType === JupyterNotebookView || option.notebookType === InteractiveWindowView;
    }
}

export function isResourceNativeNotebook(resource: Resource, notebooks: IVSCodeNotebook, fs: IFileSystem) {
    if (!resource) {
        return false;
    }
    return notebooks.notebookDocuments.some((item) => fs.arePathsSame(item.uri, resource));
}
export function getNotebookMetadata(document: NotebookDocument | NotebookData): nbformat.INotebookMetadata | undefined {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const notebookContent: undefined | Partial<nbformat.INotebookContent> = document.metadata?.custom as any;
    // Create a clone.
    return JSON.parse(JSON.stringify(notebookContent?.metadata || {}));
}

export async function updateNotebookDocumentMetadata(
    document: NotebookDocument,
    kernelConnection?: KernelConnectionMetadata,
    kernelInfo?: Partial<KernelMessage.IInfoReplyMsg['content']>
) {
    let metadata = getNotebookMetadata(document) || { orig_nbformat: 3 };
    const { changed } = updateNotebookMetadata(metadata, kernelConnection, kernelInfo);
    if (changed) {
        const edit = new WorkspaceEdit();
        // Create a clone.
        const docMetadata = JSON.parse(
            JSON.stringify(
                (document.metadata as {
                    custom?: Exclude<Partial<nbformat.INotebookContent>, 'cells'>;
                }) || { custom: {} }
            )
        );

        docMetadata.custom = docMetadata.custom || {};
        docMetadata.custom.metadata = metadata;
        await edit.replaceNotebookMetadata(document.uri, { ...(document.metadata || {}), custom: docMetadata.custom });
    }
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
 * Converts a NotebookModel into VSCode friendly format.
 */
export function notebookModelToVSCNotebookData(
    notebookContentWithoutCells: Exclude<Partial<nbformat.INotebookContent>, 'cells'>,
    nbCells: nbformat.IBaseCell[],
    preferredLanguage: string,
    originalJson: Partial<nbformat.INotebookContent>
): NotebookData {
    const cells = nbCells
        .map((cell) => createVSCNotebookCellDataFromCell(preferredLanguage, cell))
        .filter((item) => !!item)
        .map((item) => item!);

    if (cells.length === 0 && Object.keys(originalJson).length === 0) {
        cells.push(new NotebookCellData(NotebookCellKind.Code, '', preferredLanguage));
    }
    const notebookData = new NotebookData(cells);
    notebookData.metadata = { custom: notebookContentWithoutCells };
    return notebookData;
}

export function createJupyterCellFromVSCNotebookCell(
    vscCell: NotebookCell | NotebookCellData
): nbformat.IRawCell | nbformat.IMarkdownCell | nbformat.ICodeCell {
    let cell: nbformat.IRawCell | nbformat.IMarkdownCell | nbformat.ICodeCell;
    if (vscCell.kind === NotebookCellKind.Markup) {
        cell = createMarkdownCellFromNotebookCell(vscCell);
    } else if (
        ('document' in vscCell && vscCell.document.languageId === 'raw') ||
        ('languageId' in vscCell && vscCell.languageId === 'raw')
    ) {
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

function createRawCellFromNotebookCell(cell: NotebookCell | NotebookCellData): nbformat.IRawCell {
    const cellMetadata = cell.metadata?.custom as CellMetadata | undefined;
    const rawCell: nbformat.IRawCell = {
        cell_type: 'raw',
        source: splitMultilineString('document' in cell ? cell.document.getText() : cell.value),
        metadata: cellMetadata?.metadata || {} // This cannot be empty.
    };
    if (cellMetadata?.attachments) {
        rawCell.attachments = cellMetadata.attachments;
    }
    return rawCell;
}

function createCodeCellFromNotebookCell(cell: NotebookCell | NotebookCellData): nbformat.ICodeCell {
    const cellMetadata = cell.metadata?.custom as CellMetadata | undefined;
    const code = 'document' in cell ? cell.document.getText() : cell.value;
    const codeCell: nbformat.ICodeCell = {
        cell_type: 'code',
        execution_count: cell.executionSummary?.executionOrder ?? null,
        source: splitMultilineString(code),
        outputs: (cell.outputs || []).map(translateCellDisplayOutput),
        metadata: cellMetadata?.metadata || {} // This cannot be empty.
    };
    return codeCell;
}

function createNotebookCellDataFromRawCell(cell: nbformat.IRawCell): NotebookCellData {
    const cellData = new NotebookCellData(NotebookCellKind.Code, concatMultilineString(cell.source), 'raw');
    cellData.outputs = [];
    cellData.metadata = { custom: getNotebookCellMetadata(cell) };
    return cellData;
}
function createMarkdownCellFromNotebookCell(cell: NotebookCell | NotebookCellData): nbformat.IMarkdownCell {
    const cellMetadata = cell.metadata?.custom as CellMetadata | undefined;
    const markdownCell: nbformat.IMarkdownCell = {
        cell_type: 'markdown',
        source: splitMultilineString('document' in cell ? cell.document.getText() : cell.value),
        metadata: cellMetadata?.metadata || {} // This cannot be empty.
    };
    if (cellMetadata?.attachments) {
        markdownCell.attachments = cellMetadata.attachments;
    }
    return markdownCell;
}
function createNotebookCellDataFromMarkdownCell(cell: nbformat.IMarkdownCell): NotebookCellData {
    const cellData = new NotebookCellData(
        NotebookCellKind.Markup,
        concatMultilineString(cell.source),
        MARKDOWN_LANGUAGE
    );
    cellData.outputs = [];
    cellData.metadata = { custom: getNotebookCellMetadata(cell) };
    return cellData;
}
function createNotebookCellDataFromCodeCell(cell: nbformat.ICodeCell, cellLanguage: string): NotebookCellData {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cellOutputs: nbformat.IOutput[] = Array.isArray(cell.outputs) ? cell.outputs : [];
    const outputs = createVSCCellOutputsFromOutputs(cellOutputs);
    const hasExecutionCount = typeof cell.execution_count === 'number' && cell.execution_count > 0;

    const source = concatMultilineString(cell.source);

    const executionSummary: NotebookCellExecutionSummary = hasExecutionCount
        ? { executionOrder: cell.execution_count as number }
        : {};

    const cellData = new NotebookCellData(NotebookCellKind.Code, source, cellLanguage);

    cellData.outputs = outputs;
    cellData.metadata = { custom: getNotebookCellMetadata(cell) };
    cellData.executionSummary = executionSummary;
    return cellData;
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
function isEmptyVendoredMimeType(outputItem: NotebookCellOutputItem) {
    if (outputItem.mime.startsWith('application/vnd.')) {
        try {
            return Buffer.from(outputItem.data).toString().length === 0;
        } catch { }
    }
    return false;
}
function sortOutputItemsBasedOnDisplayOrder(outputItems: NotebookCellOutputItem[]): NotebookCellOutputItem[] {
    return outputItems.sort((outputItemA, outputItemB) => {
        const isMimeTypeMatch = (value: string, compareWith: string) => {
            if (value.endsWith('.*')) {
                value = value.substr(0, value.indexOf('.*'));
            }
            return compareWith.startsWith(value);
        };
        let indexOfMimeTypeA = orderOfMimeTypes.findIndex((mime) => isMimeTypeMatch(mime, outputItemA.mime));
        let indexOfMimeTypeB = orderOfMimeTypes.findIndex((mime) => isMimeTypeMatch(mime, outputItemB.mime));
        // Sometimes we can have mime types with empty data, e.g. when using holoview we can have `application/vnd.holoviews_load.v0+json` with empty value.
        // & in these cases we have HTML/JS and those take precedence.
        // https://github.com/microsoft/vscode-jupyter/issues/6109
        if (isEmptyVendoredMimeType(outputItemA)) {
            indexOfMimeTypeA = -1;
        }
        if (isEmptyVendoredMimeType(outputItemB)) {
            indexOfMimeTypeB = -1;
        }
        indexOfMimeTypeA = indexOfMimeTypeA == -1 ? 100 : indexOfMimeTypeA;
        indexOfMimeTypeB = indexOfMimeTypeB == -1 ? 100 : indexOfMimeTypeB;
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
        notebooks.onDidChangeNotebookCellExecutionState(
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
        NotebookCellStateTracker.cellStates.set(e.cell, e.state);
    }
}

export function traceCellMessage(cell: NotebookCell, message: string) {
    traceInfo(
        `Cell Index:${cell.index}, state:${NotebookCellStateTracker.getCellState(cell)}, exec: ${cell.executionSummary?.executionOrder
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
        items.push(new NotebookCellOutputItem(convertJupyterOutputToBuffer(key, data[key]), key));
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
    if (output.items.length > 0) {
        return output.items[0].mime === CellOutputMimeTypes.stderr ? 'stderr' : 'stdout';
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
    /**
     * Whether the original Mime data is JSON or not.
     * This properly only exists in metadata for NotebookCellOutputItems
     * (this is something we have added)
     */
    __isJson?: boolean;
};

export function translateCellErrorOutput(output: NotebookCellOutput): nbformat.IError {
    // it should have at least one output item
    const firstItem = output.items[0];
    // Bug in VS Code.
    if (!firstItem.data) {
        return {
            output_type: 'error',
            ename: '',
            evalue: '',
            traceback: []
        };
    }
    const originalError: undefined | nbformat.IError = output.metadata?.originalError;
    const value: Error = JSON.parse(Buffer.from(firstItem.data as Uint8Array).toString('utf8'));
    return {
        output_type: 'error',
        ename: value.name,
        evalue: value.message,
        // VS Code needs an `Error` object which requires a `stack` property as a string.
        // Its possible the format could change when converting from `traceback` to `string` and back again to `string`
        // When .NET stores errors in output (with their .NET kernel),
        // stack is empty, hence store the message instead of stack (so that somethign gets displayed in ipynb).
        traceback: originalError?.traceback || splitMultilineString(value.stack || value.message || '')
    };
}

const textMimeTypes = ['text/plain', 'text/markdown', CellOutputMimeTypes.stderr, CellOutputMimeTypes.stdout];
function convertOutputMimeToJupyterOutput(mime: string, value: Uint8Array) {
    if (!value) {
        return '';
    }
    try {
        const stringValue = Buffer.from(value as Uint8Array).toString('utf8');
        if (mime === CellOutputMimeTypes.error) {
            traceInfo(`Concerting ${mime} from ${stringValue}`);
            return JSON.parse(stringValue);
        } else if (mime.startsWith('text/') || textMimeTypes.includes(mime)) {
            return splitMultilineString(stringValue);
        } else if (mime.startsWith('image/') && mime !== 'image/svg+xml') {
            // Images in Jupyter are stored in base64 encoded format.
            // VS Code expects bytes when rendering images.
            return Buffer.from(value).toString('base64');
        } else if (mime.toLowerCase().includes('json')) {
            return stringValue.length > 0 ? JSON.parse(stringValue) : stringValue;
        } else {
            return stringValue;
        }
    } catch (ex) {
        traceError(`Failed to convert ${mime} output from a buffer ${typeof value}, ${value}`, ex);
        return '';
    }
}
function convertJupyterOutputToBuffer(mime: string, value: unknown): Buffer {
    if (!value) {
        return Buffer.from('');
    }
    try {
        if (
            (mime.startsWith('text/') || textMimeTypes.includes(mime)) &&
            (Array.isArray(value) || typeof value === 'string')
        ) {
            const stringValue = Array.isArray(value) ? concatMultilineString(value) : value;
            return Buffer.from(stringValue);
        } else if (mime.startsWith('image/') && typeof value === 'string' && mime !== 'image/svg+xml') {
            // Images in Jupyter are stored in base64 encoded format.
            // VS Code expects bytes when rendering images.
            return Buffer.from(value, 'base64');
        } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
            return Buffer.from(JSON.stringify(value));
        } else {
            // For everything else, treat the data as strings (or multi-line strings).
            value = Array.isArray(value) ? concatMultilineString(value) : value;
            return Buffer.from(value as string);
        }
    } catch (ex) {
        traceError(`Failed to convert ${mime} output to a buffer ${typeof value}, ${value}`, ex);
        return Buffer.from('');
    }
}
function convertStreamOutput(output: NotebookCellOutput): JupyterOutput {
    const outputs = output.items
        .filter((opit) => opit.mime === CellOutputMimeTypes.stderr || opit.mime === CellOutputMimeTypes.stdout)
        .map((opit) => convertOutputMimeToJupyterOutput(opit.mime, opit.data as Uint8Array) as string)
        .reduceRight<string[]>((prev, curr) => (Array.isArray(curr) ? prev.concat(...curr) : prev.concat(curr)), []);

    const streamType = getOutputStreamType(output) || 'stdout';

    return {
        output_type: 'stream',
        name: streamType,
        text: splitMultilineString(outputs.join(''))
    };
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
            result = convertStreamOutput(output);
            break;
        }
        case 'display_data': {
            result = {
                output_type: 'display_data',
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                data: output.items.reduceRight((prev: any, curr) => {
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
                data: output.items.reduceRight((prev: any, curr) => {
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
                data: output.items.reduceRight((prev: any, curr) => {
                    prev[curr.mime] = convertOutputMimeToJupyterOutput(curr.mime, curr.data as Uint8Array);
                    return prev;
                }, {}),
                metadata: customMetadata?.metadata || {} // This can never be undefined.
            };
            break;
        }
        default: {
            const isError =
                output.items.length == 1 && output.items.every((item) => item.mime == CellOutputMimeTypes.error);
            const isStream = output.items.every(
                (item) => item.mime === CellOutputMimeTypes.stderr || item.mime === CellOutputMimeTypes.stdout
            );

            if (isError) {
                return translateCellErrorOutput(output);
            }

            // In the case of .NET & other kernels, we need to ensure we save ipynb correctly.
            // Hence if we have stream output, save the output as Jupyter `stream` else `display_data`
            // Unless we already know its an unknown output type.
            const outputType: nbformat.OutputType =
                <nbformat.OutputType>customMetadata?.outputType || (isStream ? 'stream' : 'display_data');
            sendTelemetryEvent(Telemetry.VSCNotebookCellTranslationFailed, undefined, {
                isErrorOutput: outputType === 'error'
            });

            let unknownOutput: nbformat.IUnrecognizedOutput | nbformat.IDisplayData | nbformat.IStream;
            if (outputType === 'stream') {
                // If saving as `stream` ensure the mandatory properties are set.
                unknownOutput = convertStreamOutput(output);
            } else if (outputType === 'display_data') {
                // If saving as `display_data` ensure the mandatory properties are set.
                const displayData: nbformat.IDisplayData = {
                    data: {},
                    metadata: {},
                    output_type: 'display_data'
                };
                unknownOutput = displayData;
            } else {
                unknownOutput = {
                    output_type: outputType
                };
            }
            if (customMetadata?.metadata) {
                unknownOutput.metadata = customMetadata.metadata;
            }
            if (output.items.length > 0) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                unknownOutput.data = output.items.reduceRight((prev: any, curr) => {
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
export function translateErrorOutput(output?: nbformat.IError): NotebookCellOutput {
    output = output || { output_type: 'error', ename: '', evalue: '', traceback: [] };
    return new NotebookCellOutput(
        [
            NotebookCellOutputItem.error({
                name: output?.ename || '',
                message: output?.evalue || '',
                stack: (output?.traceback || []).join('\n')
            })
        ],
        { ...getOutputMetadata(output), originalError: output }
    );
}

export function getTextOutputValue(output: NotebookCellOutput): string {
    const item = output.items.find(
        (opit) =>
            opit.mime === CellOutputMimeTypes.stdout ||
            opit.mime === CellOutputMimeTypes.stderr ||
            opit.mime === 'text/plain' ||
            opit.mime === 'text/markdown'
    );

    if (item) {
        const value = convertOutputMimeToJupyterOutput(item.mime, item.data as Uint8Array);
        return Array.isArray(value) ? value.join('') : value;
    }
    return '';
}
export function hasErrorOutput(outputs: readonly NotebookCellOutput[]) {
    const errorOutput = outputs.find(
        (op) => op.items.length && !op.items.some((opit) => opit.mime !== CellOutputMimeTypes.error)
    );

    return !!errorOutput;
}

export function findAssociatedNotebookDocument(cellUri: Uri, vscodeNotebook: IVSCodeNotebook, fs: IFileSystem) {
    return vscodeNotebook.notebookDocuments.find((item) =>
        item.getCells().some((cell) => fs.arePathsSame(cell.document.uri, cellUri))
    );
}
