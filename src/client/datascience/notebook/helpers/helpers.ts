// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { nbformat } from '@jupyterlab/coreutils';
import {
    NotebookCellOutput,
    NotebookCellOutputItem,
    NotebookCell,
    NotebookCellData,
    NotebookCellMetadata,
    NotebookCellRunState,
    NotebookData,
    NotebookDocument,
    NotebookEditor,
    NotebookKernel as VSCNotebookKernel
} from 'vscode';
import { concatMultilineString, splitMultilineString } from '../../../../datascience-ui/common';
import { IVSCodeNotebook } from '../../../common/application/types';
import { MARKDOWN_LANGUAGE, PYTHON_LANGUAGE } from '../../../common/constants';
import '../../../common/extensions';
import { traceError, traceInfo, traceWarning } from '../../../common/logger';
import { isUntitledFile } from '../../../common/utils/misc';
import { sendTelemetryEvent } from '../../../telemetry';
import { Telemetry } from '../../constants';
import { KernelConnectionMetadata } from '../../jupyter/kernels/types';
import { updateNotebookMetadata } from '../../notebookStorage/baseModel';
import { CellState, IJupyterKernelSpec } from '../../types';
import { JupyterNotebookView } from '../constants';
// eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
const vscodeNotebookEnums = require('vscode') as typeof import('vscode-proposed');
// eslint-disable-next-line @typescript-eslint/no-require-imports
import { KernelMessage } from '@jupyterlab/services';
// eslint-disable-next-line @typescript-eslint/no-require-imports
import cloneDeep = require('lodash/cloneDeep');
import { Uri } from 'vscode';
import { VSCodeNotebookKernelMetadata } from '../kernelWithMetadata';
import { chainWithPendingUpdates } from './notebookUpdater';
import { Resource } from '../../../common/types';
import { IFileSystem } from '../../../common/platform/types';

// This is the custom type we are adding into nbformat.IBaseCellMetadata
export interface IBaseCellVSCodeMetadata {
    end_execution_time?: string;
    start_execution_time?: string;
}

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

export function isJupyterKernel(kernel?: VSCNotebookKernel): kernel is VSCodeNotebookKernelMetadata {
    if (!kernel) {
        return false;
    }
    return kernel instanceof VSCodeNotebookKernelMetadata;
}

const kernelInformationForNotebooks = new WeakMap<
    NotebookDocument,
    { metadata?: KernelConnectionMetadata | undefined; kernelInfo?: KernelMessage.IInfoReplyMsg['content'] }
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
        const language_info = { ...metadata.language_info, name: document.languages[0] };
        // Fix nyc compiler not working.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        notebookContent = { ...content, metadata: { ...metadata, language_info } } as any;
    }
    notebookContent = cloneDeep(notebookContent);
    const data = kernelInformationForNotebooks.get(document);
    if (data && data.metadata) {
        updateNotebookMetadata(notebookContent.metadata, data.metadata, data.kernelInfo);
    }

    return notebookContent.metadata;
}

export function isPythonNotebook(metadata?: nbformat.INotebookMetadata) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const kernelSpec = (metadata?.kernelspec as any) as IJupyterKernelSpec | undefined;
    if (metadata?.language_info?.name && metadata.language_info.name !== PYTHON_LANGUAGE) {
        return false;
    }
    if (kernelSpec?.language && kernelSpec.language !== PYTHON_LANGUAGE) {
        return false;
    }
    // All other notebooks are python notebooks.
    return true;
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
    kernelInformationForNotebooks.set(document, data);
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
        .map((cell) => createVSCNotebookCellDataFromCell(isNotebookTrusted, preferredLanguage, cell))
        .filter((item) => !!item)
        .map((item) => item!);

    if (cells.length === 0 && (isUntitledFile(notebookUri) || Object.keys(originalJson).length === 0)) {
        cells.push({
            cellKind: vscodeNotebookEnums.CellKind.Code,
            language: preferredLanguage,
            metadata: {},
            outputs: [],
            source: ''
        });
    }
    return {
        cells,
        languages: ['*'],
        metadata: {
            custom: notebookContentWithoutCells, // Include metadata in VSC Model (so that VSC can display these if required)
            cellEditable: isNotebookTrusted,
            cellRunnable: isNotebookTrusted,
            editable: isNotebookTrusted,
            cellHasExecutionOrder: true,
            runnable: isNotebookTrusted,
            displayOrder: [
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
            ]
        }
    };
}
export function cellRunStateToCellState(cellRunState?: NotebookCellRunState): CellState {
    switch (cellRunState) {
        case vscodeNotebookEnums.NotebookCellRunState.Running:
            return CellState.executing;
        case vscodeNotebookEnums.NotebookCellRunState.Error:
            return CellState.error;
        default:
            return CellState.init;
    }
}
export function createJupyterCellFromVSCNotebookCell(
    vscCell: NotebookCell
): nbformat.IRawCell | nbformat.IMarkdownCell | nbformat.ICodeCell {
    let cell: nbformat.IRawCell | nbformat.IMarkdownCell | nbformat.ICodeCell;
    if (vscCell.cellKind === vscodeNotebookEnums.CellKind.Markdown) {
        cell = createMarkdownCellFromNotebookCell(vscCell);
    } else if (vscCell.language === 'raw' || vscCell.language === 'plaintext') {
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
    const cellMetadata = cell.metadata as CellMetadata | undefined;
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
    const cellMetadata = cell.metadata as CellMetadata | undefined;
    const code = cell.document.getText();
    return {
        cell_type: 'code',
        execution_count: cell.metadata.executionOrder ?? null,
        source: splitMultilineString(code),
        outputs: createIOutputFromCellOutputs(cell.outputs),
        metadata: cellMetadata?.metadata || {} // This cannot be empty.
    };
}

function createNotebookCellDataFromRawCell(isNbTrusted: boolean, cell: nbformat.IRawCell): NotebookCellData {
    const notebookCellMetadata: NotebookCellMetadata = {
        editable: isNbTrusted,
        executionOrder: undefined,
        hasExecutionOrder: false,
        runnable: false,
        custom: getNotebookCellMetadata(cell)
    };
    return {
        cellKind: vscodeNotebookEnums.CellKind.Code,
        language: 'raw',
        metadata: notebookCellMetadata,
        outputs: [],
        source: concatMultilineString(cell.source)
    };
}
function createMarkdownCellFromNotebookCell(cell: NotebookCell): nbformat.IMarkdownCell {
    const cellMetadata = cell.metadata as CellMetadata | undefined;
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
function createNotebookCellDataFromMarkdownCell(isNbTrusted: boolean, cell: nbformat.IMarkdownCell): NotebookCellData {
    const notebookCellMetadata: NotebookCellMetadata = {
        editable: isNbTrusted,
        executionOrder: undefined,
        hasExecutionOrder: false,
        runnable: false,
        custom: getNotebookCellMetadata(cell)
    };
    return {
        cellKind: vscodeNotebookEnums.CellKind.Markdown,
        language: MARKDOWN_LANGUAGE,
        metadata: notebookCellMetadata,
        source: concatMultilineString(cell.source),
        outputs: []
    };
}
function createNotebookCellDataFromCodeCell(
    isNbTrusted: boolean,
    cell: nbformat.ICodeCell,
    cellLanguage: string
): NotebookCellData {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cellOutputs: nbformat.IOutput[] = Array.isArray(cell.outputs) ? cell.outputs : [];
    const outputs = createVSCCellOutputsFromOutputs(cellOutputs);
    const runState = vscodeNotebookEnums.NotebookCellRunState.Idle;
    const hasErrors = outputs.some((output) =>
        output.outputs.some((opit) => opit.mime === 'application/x.notebook.error-traceback')
    );
    const hasExecutionCount = typeof cell.execution_count === 'number' && cell.execution_count > 0;
    let statusMessage: string | undefined;
    if (hasExecutionCount && hasErrors) {
        // Error details are stripped from the output, get raw output.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        statusMessage = getCellStatusMessageBasedOnFirstErrorOutput(cellOutputs);
    }

    const notebookCellMetadata: NotebookCellMetadata = {
        editable: isNbTrusted,
        executionOrder: typeof cell.execution_count === 'number' ? cell.execution_count : undefined,
        hasExecutionOrder: true,
        runState,
        runnable: isNbTrusted,
        statusMessage,
        custom: getNotebookCellMetadata(cell)
    };

    // If not trusted, then clear the output in VSC Cell (for untrusted notebooks we do not display output).
    // At this point we have the original output in the ICell.
    if (!isNbTrusted) {
        while (outputs.length) {
            outputs.shift();
        }
    }

    const source = concatMultilineString(cell.source);

    return {
        cellKind: vscodeNotebookEnums.CellKind.Code,
        language: cellLanguage,
        metadata: notebookCellMetadata,
        source,
        outputs
    };
}

export function createIOutputFromCellOutputs(cellOutputs: readonly NotebookCellOutput[]): nbformat.IOutput[] {
    return cellOutputs
        .map((output) => {
            if (!output.outputs.some((opit) => opit.mime !== 'application/x.notebook.stream')) {
                // every output item is `application/x.notebook.stream`
                return;
            } else if (!output.outputs.some((opit) => opit.mime !== 'application/x.notebook.error-traceback')) {
                return translateCellErrorOutput(output);
            } else {
                return translateCellDisplayOutput(output);
            }
        })
        .filter((output) => !!output)
        .map((output) => output!!);
}

export async function clearCellForExecution(editor: NotebookEditor, cell: NotebookCell) {
    await chainWithPendingUpdates(editor.document, (edit) => {
        edit.replaceNotebookCellMetadata(editor.document.uri, cell.index, {
            ...cell.metadata,
            statusMessage: undefined,
            executionOrder: undefined,
            lastRunDuration: undefined,
            runStartTime: undefined
        });
        edit.replaceNotebookCellOutput(editor.document.uri, cell.index, []);
    });
    await updateCellExecutionTimes(editor, cell);
}

export function traceCellMessage(cell: NotebookCell, message: string) {
    traceInfo(
        `Cell Index:${cell.index}, state:${cell.metadata.runState}, exec: ${cell.metadata.executionOrder}. ${message}`
    );
}

/**
 * Store execution start and end times.
 * Stored as ISO for portability.
 */
export async function updateCellExecutionTimes(
    editor: NotebookEditor,
    cell: NotebookCell,
    times?: { startTime?: number; lastRunDuration?: number }
) {
    if (!times || !times.lastRunDuration || !times.startTime) {
        return;
    }
    const lastRunDuration = times.lastRunDuration ?? cell.metadata.lastRunDuration;
    await chainWithPendingUpdates(editor.document, (edit) => {
        traceCellMessage(cell, 'Update run duration');
        edit.replaceNotebookCellMetadata(editor.document.uri, cell.index, {
            ...cell.metadata,
            // custom: customMetadata,
            lastRunDuration
        });
    });
}

export function createVSCNotebookCellDataFromCell(
    isNbTrusted: boolean,
    cellLanguage: string,
    cell: nbformat.IBaseCell
): NotebookCellData | undefined {
    switch (cell.cell_type) {
        case 'raw': {
            return createNotebookCellDataFromRawCell(isNbTrusted, cell as nbformat.IRawCell);
        }
        case 'markdown': {
            return createNotebookCellDataFromMarkdownCell(isNbTrusted, cell as nbformat.IMarkdownCell);
        }
        case 'code': {
            return createNotebookCellDataFromCodeCell(isNbTrusted, cell as nbformat.ICodeCell, cellLanguage);
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
        outputType: output.output_type,
        transient: output.transient
    };

    switch (output.output_type as nbformat.OutputType) {
        case 'display_data':
        case 'execute_result':
        case 'update_display_data': {
            metadata.executionCount = output.execution_count;
            metadata.metadata = output.metadata ? cloneDeep(output.metadata) : {};
            break;
        }
        case 'stream': {
            metadata.streamName = output.name as string;
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
    // Metadata will be as follows:
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
    const items: NotebookCellOutputItem[] = [];
    // eslint-disable-next-line
    const data: Record<string, any> = output.data || {};
    // eslint-disable-next-line
    for (const key in data) {
        // Add metadata to all (its the same)
        // When we re-construct the nbformat.IDisplayData back we'll take the metadata from the first item.
        // We can optionally remove metadata that belongs to other mime types (feels like over optimization, hence not doing that).
        items.push(new NotebookCellOutputItem(key, data[key], getOutputMetadata(output)));
    }

    return new NotebookCellOutput(items);
}

function translateStreamOutput(output: nbformat.IStream): NotebookCellOutput {
    return new NotebookCellOutput([
        new NotebookCellOutputItem(
            'application/x.notebook.stream',
            concatMultilineString(output.text),
            getOutputMetadata(output)
        )
    ]);
}

export function isStreamOutput(output: NotebookCellOutput, expectedStreamName: string): boolean {
    if (!output.outputs.length) {
        return false;
    }

    if (output.outputs.find((opit) => opit.mime !== 'application/x.notebook.stream')) {
        return false;
    }

    // Logic of metadata can be found here translateStreamOutput.
    // That function adds the vscode metadata.
    const firstOutputItem = output.outputs[0]!;
    const metadata = firstOutputItem.metadata as CellOutputMetadata | undefined;
    if (metadata && metadata.outputType !== 'stream') {
        return false;
    }

    if (expectedStreamName && metadata && metadata.streamName !== expectedStreamName) {
        return false;
    }

    return true;
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
    transient?: any;
    /**
     * Original cell output type
     */
    outputType: nbformat.OutputType | string;
    /**
     * Name of the stream (for text output).
     */
    streamName?: string;
    executionCount?: nbformat.IExecuteResult['ExecutionCount'];
};

function translateCellDisplayOutput(output: NotebookCellOutput): JupyterOutput | undefined {
    // Each NotebookCellOutputItem will contain all of the metadata associated with the original Jupyter output.
    // If we don't have it, exit from here (some other extension probably added an output).
    if (output.outputs.length === 0) {
        return;
    }
    // When we create cells, all of the output items will contain the original metadata
    const customMetadata = output.outputs[0]!.metadata as CellOutputMetadata | undefined;
    // Possible some other extension added some output.
    if (!customMetadata) {
        return;
    }

    let result: JupyterOutput;
    switch (customMetadata.outputType) {
        case 'stream':
            {
                result = {
                    output_type: 'stream',
                    name: customMetadata.streamName || '',
                    text: splitMultilineString(
                        output.outputs
                            .filter(
                                (opit) => opit.mime === 'text/plain' || opit.mime === 'application/x.notebook.stream'
                            )
                            .map((opit) => opit.value as string | string[])
                            .reduceRight((prev, curr) => {
                                return [...prev, ...curr];
                            }, [])
                    )
                };
            }
            break;
        case 'display_data':
            {
                result = {
                    output_type: 'display_data',
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    data: output.outputs.reduceRight((prev: any, curr) => {
                        prev[curr.mime] = curr.value;
                        return prev;
                    }, {}),
                    metadata: customMetadata.metadata || {} // This can never be undefined.
                };
            }
            break;
        case 'execute_result':
            {
                result = {
                    output_type: 'execute_result',
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    data: output.outputs.reduceRight((prev: any, curr) => {
                        prev[curr.mime] = curr.value;
                        return prev;
                    }, {}),
                    metadata: customMetadata.metadata || {}, // This can never be undefined.
                    execution_count: customMetadata.executionCount ?? null // This can never be undefined, only a number or `null`.
                };
            }
            break;
        case 'update_display_data':
            {
                result = {
                    output_type: 'update_display_data',
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    data: output.outputs.reduceRight((prev: any, curr) => {
                        prev[curr.mime] = curr.value;
                        return prev;
                    }, {}),
                    metadata: customMetadata.metadata || {} // This can never be undefined.
                };
            }
            break;
        default:
            {
                const outputType = customMetadata.outputType;
                sendTelemetryEvent(Telemetry.VSCNotebookCellTranslationFailed, undefined, {
                    isErrorOutput: outputType === 'error'
                });
                const unknownOutput: nbformat.IUnrecognizedOutput = {
                    output_type: outputType
                };
                if (customMetadata.metadata) {
                    unknownOutput.metadata = customMetadata.metadata;
                }
                if (output.outputs.length > 0) {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    unknownOutput.data = output.outputs.reduceRight((prev: any, curr) => {
                        prev[curr.mime] = curr.value;
                        return prev;
                    }, {});
                }
                result = unknownOutput;
            }
            break;
    }

    // Account for transient data as well
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
    // Add on transient data if we have any. This should be removed by our save functions elsewhere.
    const metadata: CellOutputMetadata = {
        outputType: output.output_type,
        transient: output.transient
    };

    return new NotebookCellOutput([
        new NotebookCellOutputItem(
            'application/x.notebook.error-traceback',
            {
                ename: output.ename,
                evalue: output.evalue,
                traceback: output.traceback
            },
            metadata
        )
    ]);
}

export function hasErrorOutput(output: NotebookCellOutput) {
    return output.outputs.some((item) => item.mime === 'application/x.notebook.error-traceback');
}

export function translateCellErrorOutput(output: NotebookCellOutput): nbformat.IError {
    // it should have at least one output item
    const firstItem = output.outputs[0];

    return {
        output_type: 'error',
        ename: (firstItem.value as nbformat.IError).ename,
        evalue: (firstItem.value as nbformat.IError).evalue,
        traceback: (firstItem.value as nbformat.IError).traceback
    };
}

export function getCellStatusMessageBasedOnFirstErrorOutput(outputs?: nbformat.IOutput[]): string {
    if (!Array.isArray(outputs)) {
        return '';
    }
    const errorOutput = (outputs.find((output) => output.output_type === 'error') as unknown) as
        | nbformat.IError
        | undefined;
    if (!errorOutput) {
        return '';
    }
    return `${errorOutput.ename}${errorOutput.evalue ? ': ' : ''}${errorOutput.evalue}`;
}

export function hasErrorOutputs(outputs: readonly NotebookCellOutput[]) {
    const errorOutput = outputs.find(
        (op) => op.outputs.length && !op.outputs.some((opit) => opit.mime !== 'application/x.notebook.error-traceback')
    );

    return !!errorOutput;
}

export function getCellStatusMessageBasedOnFirstCellErrorOutput(outputs?: readonly NotebookCellOutput[]): string {
    if (!Array.isArray(outputs)) {
        return '';
    }

    const errorOutput = outputs.find(
        (op) =>
            op.outputs.length &&
            !op.outputs.some((opit: NotebookCellOutputItem) => opit.mime !== 'application/x.notebook.error-traceback')
    );

    if (!errorOutput) {
        return '';
    }

    const firstItem = errorOutput.outputs[0];

    if (!firstItem) {
        return '';
    }

    const errorValue = firstItem.value as nbformat.IError;

    return `${errorValue.ename}${errorValue.evalue ? ': ' : ''}${errorValue.evalue}`;
}

/**
 * Updates a notebook document as a result of trusting it.
 */
export async function updateVSCNotebookAfterTrustingNotebook(
    editor: NotebookEditor,
    document: NotebookDocument,
    originalCells: nbformat.IBaseCell[]
) {
    const areAllCellsEditableAndRunnable = document.cells.every((cell) => {
        if (cell.cellKind === vscodeNotebookEnums.CellKind.Markdown) {
            return cell.metadata.editable;
        } else {
            return cell.metadata.editable && cell.metadata.runnable;
        }
    });
    const isDocumentEditableAndRunnable =
        document.metadata.cellEditable &&
        document.metadata.cellRunnable &&
        document.metadata.editable &&
        document.metadata.runnable;

    // If already trusted, then nothing to do.
    if (isDocumentEditableAndRunnable && areAllCellsEditableAndRunnable) {
        return;
    }

    await chainWithPendingUpdates(editor.document, (edit) => {
        edit.replaceNotebookMetadata(document.uri, {
            ...document.metadata,
            cellEditable: true,
            cellRunnable: true,
            editable: true,
            runnable: true
        });
        document.cells.forEach((cell, index) => {
            if (cell.cellKind === vscodeNotebookEnums.CellKind.Markdown) {
                edit.replaceNotebookCellMetadata(document.uri, index, { ...cell.metadata, editable: true });
            } else {
                edit.replaceNotebookCellMetadata(document.uri, index, {
                    ...cell.metadata,
                    editable: true,
                    runnable: true
                });
                // Restore the output once we trust the notebook.
                edit.replaceNotebookCellOutput(
                    document.uri,
                    index,
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    createVSCCellOutputsFromOutputs(originalCells[index].outputs as any)
                );
            }
        });
    });
}

export function findAssociatedNotebookDocument(cellUri: Uri, vscodeNotebook: IVSCodeNotebook, fs: IFileSystem) {
    return vscodeNotebook.notebookDocuments.find((item) =>
        item.cells.some((cell) => fs.arePathsSame(cell.uri, cellUri))
    );
}
