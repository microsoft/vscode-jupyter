// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { nbformat } from '@jupyterlab/coreutils';
import type {
    CellDisplayOutput,
    CellErrorOutput,
    CellOutput,
    NotebookCell,
    NotebookCellData,
    NotebookCellMetadata,
    NotebookData,
    NotebookDocument,
    NotebookEditor
} from 'vscode-proposed';
import { NotebookCellRunState } from '../../../../../typings/vscode-proposed';
import { concatMultilineString, splitMultilineString } from '../../../../datascience-ui/common';
import { MARKDOWN_LANGUAGE, PYTHON_LANGUAGE } from '../../../common/constants';
import '../../../common/extensions';
import { traceError, traceWarning } from '../../../common/logger';
import { isUntitledFile } from '../../../common/utils/misc';
import { sendTelemetryEvent } from '../../../telemetry';
import { Telemetry } from '../../constants';
import { KernelConnectionMetadata } from '../../jupyter/kernels/types';
import { updateNotebookMetadata } from '../../notebookStorage/baseModel';
import { CellState, IJupyterKernelSpec } from '../../types';
import { JupyterNotebookView } from '../constants';
// tslint:disable-next-line: no-var-requires no-require-imports
const vscodeNotebookEnums = require('vscode') as typeof import('vscode-proposed');
// tslint:disable-next-line: no-require-imports
import { KernelMessage } from '@jupyterlab/services';
// tslint:disable-next-line: no-require-imports
import cloneDeep = require('lodash/cloneDeep');
import { Uri } from 'vscode';

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
// tslint:disable-next-line: unified-signatures
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
    { metadata?: KernelConnectionMetadata | undefined; kernelInfo?: KernelMessage.IInfoReplyMsg['content'] }
>();

export function getNotebookMetadata(document: NotebookDocument): nbformat.INotebookMetadata | undefined {
    // tslint:disable-next-line: no-any
    let notebookContent: Partial<nbformat.INotebookContent> = document.metadata.custom as any;

    // If language isn't specified in the metadata, at least specify that
    if (!notebookContent?.metadata?.language_info?.name) {
        const content = notebookContent || {};
        const metadata = content.metadata || { orig_nbformat: 3, language_info: {} };
        const language_info = { ...metadata.language_info, name: document.languages[0] };
        // Fix nyc compiler not working.
        // tslint:disable-next-line: no-any
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
    // tslint:disable-next-line: no-any
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
 */
export function updateKernelInNotebookMetadata(
    document: NotebookDocument,
    kernelConnection: KernelConnectionMetadata | undefined
) {
    const data = { ...(kernelInformationForNotebooks.get(document) || {}) };
    data.metadata = kernelConnection;
    kernelInformationForNotebooks.set(document, data);
}
export function updateKernelInfoInNotebookMetadata(
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
    preferredLanguage: string
): NotebookData {
    const cells = nbCells
        .map((cell) => createVSCNotebookCellDataFromCell(isNotebookTrusted, preferredLanguage, cell))
        .filter((item) => !!item)
        .map((item) => item!);

    if (cells.length === 0 && isUntitledFile(notebookUri)) {
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
    // Delete the `metadata.custom.vscode` property we added.
    if ('vscode' in cell.metadata) {
        const metadata = { ...cell.metadata };
        // Persisting these require us to save custom metadata in ipynb. Not sure users would like this. We'll have more changes in ipynb files.
        // tslint:disable-next-line: no-suspicious-comment
        // TODO: Discuss whether we need to persist these.
        delete metadata.vscode;
        // if (metadata.vscode && typeof metadata.vscode === 'object' && 'transient' in metadata.vscode) {
        //     delete metadata.vscode.transient;
        // }
        cell.metadata = metadata;
    }
    return cell;
}

/**
 * Identifies Jupyter Cell metadata that are to be stored in VSCode Cells.
 * This is used to facilitate:
 * 1. When a user copies and pastes a cell, then the corresponding metadata is also copied across.
 * 2. Diffing (VSC knows about metadata & stuff that contributes changes to a cell).
 */
export function getCustomNotebookCellMetadata(cell: nbformat.IBaseCell): Record<string, unknown> {
    // We put this only for VSC to display in diff view.
    // Else we don't use this.
    const propertiesToClone = ['metadata', 'attachments'];
    // tslint:disable-next-line: no-any
    const custom: Record<string, unknown> = {};
    propertiesToClone.forEach((propertyToClone) => {
        if (cell[propertyToClone]) {
            custom[propertyToClone] = cloneDeep(cell[propertyToClone]);
        }
    });
    return custom;
}

function createRawCellFromNotebookCell(cell: NotebookCell): nbformat.IRawCell {
    const rawCell: nbformat.IRawCell = {
        cell_type: 'raw',
        source: splitMultilineString(cell.document.getText()),
        metadata: cell.metadata.custom?.metadata || {}
    };
    if (cell.metadata.custom?.attachments) {
        rawCell.attachments = cell.metadata.custom?.attachments;
    }
    return rawCell;
}

function createNotebookCellDataFromRawCell(isNbTrusted: boolean, cell: nbformat.IRawCell): NotebookCellData {
    const notebookCellMetadata: NotebookCellMetadata = {
        editable: isNbTrusted,
        executionOrder: undefined,
        hasExecutionOrder: false,
        runnable: false,
        custom: getCustomNotebookCellMetadata(cell)
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
    const markdownCell: nbformat.IMarkdownCell = {
        cell_type: 'markdown',
        source: splitMultilineString(cell.document.getText()),
        metadata: cell.metadata.custom?.metadata || {}
    };
    if (cell.metadata.custom?.attachments) {
        markdownCell.attachments = cell.metadata.custom?.attachments;
    }
    return markdownCell;
}
function createNotebookCellDataFromMarkdownCell(isNbTrusted: boolean, cell: nbformat.IMarkdownCell): NotebookCellData {
    const notebookCellMetadata: NotebookCellMetadata = {
        editable: isNbTrusted,
        executionOrder: undefined,
        hasExecutionOrder: false,
        runnable: false,
        custom: getCustomNotebookCellMetadata(cell)
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
    // tslint:disable-next-line: no-any
    const cellOutputs: nbformat.IOutput[] = Array.isArray(cell.outputs) ? cell.outputs : [];
    const outputs = createVSCCellOutputsFromOutputs(cellOutputs);
    // If we have an execution count & no errors, then success state.
    // If we have an execution count &  errors, then error state.
    // Else idle state.
    const hasErrors = outputs.some((output) => output.outputKind === vscodeNotebookEnums.CellOutputKind.Error);
    const hasExecutionCount = typeof cell.execution_count === 'number' && cell.execution_count > 0;
    let runState: NotebookCellRunState;
    let statusMessage: string | undefined;
    if (!hasExecutionCount) {
        runState = vscodeNotebookEnums.NotebookCellRunState.Idle;
    } else if (hasErrors) {
        runState = vscodeNotebookEnums.NotebookCellRunState.Error;
        // Error details are stripped from the output, get raw output.
        // tslint:disable-next-line: no-any
        statusMessage = getCellStatusMessageBasedOnFirstErrorOutput(cellOutputs);
    } else {
        runState = vscodeNotebookEnums.NotebookCellRunState.Success;
    }

    const vscodeMetadata = (cell.metadata.vscode as unknown) as IBaseCellVSCodeMetadata | undefined;
    const startExecutionTime = vscodeMetadata?.start_execution_time
        ? new Date(Date.parse(vscodeMetadata.start_execution_time)).getTime()
        : undefined;
    const endExecutionTime = vscodeMetadata?.end_execution_time
        ? new Date(Date.parse(vscodeMetadata.end_execution_time)).getTime()
        : undefined;

    let runStartTime: undefined | number;
    let lastRunDuration: undefined | number;
    if (startExecutionTime && typeof endExecutionTime === 'number') {
        runStartTime = startExecutionTime;
        lastRunDuration = endExecutionTime - startExecutionTime;
    }

    const notebookCellMetadata: NotebookCellMetadata = {
        editable: isNbTrusted,
        executionOrder: typeof cell.execution_count === 'number' ? cell.execution_count : undefined,
        hasExecutionOrder: true,
        runState,
        runnable: isNbTrusted,
        statusMessage,
        runStartTime,
        lastRunDuration,
        custom: getCustomNotebookCellMetadata(cell)
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

export function createIOutputFromCellOutputs(cellOutputs: CellOutput[]): nbformat.IOutput[] {
    return cellOutputs
        .map((output) => {
            switch (output.outputKind) {
                case vscodeNotebookEnums.CellOutputKind.Error:
                    return translateCellErrorOutput(output);
                case vscodeNotebookEnums.CellOutputKind.Rich:
                    return translateCellDisplayOutput(output);
                case vscodeNotebookEnums.CellOutputKind.Text:
                    // We do not generate text output.
                    return;
                default:
                    return;
            }
        })
        .filter((output) => !!output)
        .map((output) => output!!);
}

export async function clearCellForExecution(editor: NotebookEditor, cell: NotebookCell) {
    await editor.edit((edit) => {
        edit.replaceCellMetadata(cell.index, {
            ...cell.metadata,
            statusMessage: undefined,
            executionOrder: undefined,
            lastRunDuration: undefined,
            runStartTime: undefined
        });
        edit.replaceCellOutput(cell.index, []);
    });
    await updateCellExecutionTimes(editor, cell);
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
        // Based on feedback from VSC, its best to clone these objects when updating them.
        // const cellMetadata = cloneDeep(cell.metadata);
        // let updated = false;
        // if (cellMetadata.custom?.metadata?.vscode?.start_execution_time) {
        //     delete cellMetadata.custom.metadata.vscode.start_execution_time;
        //     updated = true;
        // }
        // if (cellMetadata.custom?.metadata?.vscode?.end_execution_time) {
        //     delete cellMetadata.custom.metadata.vscode.end_execution_time;
        //     updated = true;
        // }
        // if (updated) {
        //     await editor.edit((edit) =>
        //         edit.replaceCellMetadata(cell.index, {
        //             ...cellMetadata
        //         })
        //     );
        // }
        return;
    }
    // Persisting these require us to save custom metadata in ipynb. Not sure users would like this. We'll have more changes in ipynb files.
    // tslint:disable-next-line: no-suspicious-comment
    // TODO: Discuss whether we need to persist these.
    // const startTimeISO = new Date(times.startTime).toISOString();
    // const endTimeISO = new Date(times.startTime + times.lastRunDuration).toISOString();
    // Based on feedback from VSC, its best to clone these objects when updating them.
    // const customMetadata = cloneDeep(cell.metadata.custom || {});
    // customMetadata.metadata = customMetadata.metadata || {};
    // customMetadata.metadata.vscode = customMetadata.metadata.vscode || {};
    // // We store it in the metadata (stored in ipynb) so we can display this when user opens a notebook again.
    // customMetadata.metadata.vscode.end_execution_time = endTimeISO;
    // customMetadata.metadata.vscode.start_execution_time = startTimeISO;
    const lastRunDuration = times.lastRunDuration ?? cell.metadata.lastRunDuration;
    await editor.edit((edit) =>
        edit.replaceCellMetadata(cell.index, {
            ...cell.metadata,
            // custom: customMetadata,
            lastRunDuration
        })
    );
}

function createCodeCellFromNotebookCell(cell: NotebookCell): nbformat.ICodeCell {
    const metadata = cell.metadata.custom?.metadata || {};
    const code = cell.document.getText();
    return {
        cell_type: 'code',
        execution_count: cell.metadata.executionOrder ?? null,
        source: splitMultilineString(code),
        outputs: createIOutputFromCellOutputs(cell.outputs),
        metadata
    };
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

export function createVSCCellOutputsFromOutputs(outputs?: nbformat.IOutput[]): CellOutput[] {
    const cellOutputs: nbformat.IOutput[] = Array.isArray(outputs) ? (outputs as []) : [];
    return cellOutputs.map(cellOutputToVSCCellOutput);
}
const cellOutputMappers = new Map<
    nbformat.OutputType,
    (output: nbformat.IOutput, outputType: nbformat.OutputType) => CellOutput
>();
// tslint:disable-next-line: no-any
cellOutputMappers.set('display_data', translateDisplayDataOutput as any);
// tslint:disable-next-line: no-any
cellOutputMappers.set('error', translateErrorOutput as any);
// tslint:disable-next-line: no-any
cellOutputMappers.set('execute_result', translateDisplayDataOutput as any);
// tslint:disable-next-line: no-any
cellOutputMappers.set('stream', translateStreamOutput as any);
// tslint:disable-next-line: no-any
cellOutputMappers.set('update_display_data', translateDisplayDataOutput as any);
export function cellOutputToVSCCellOutput(output: nbformat.IOutput): CellOutput {
    const fn = cellOutputMappers.get(output.output_type as nbformat.OutputType);
    let result: CellOutput;
    if (fn) {
        result = fn(output, (output.output_type as unknown) as nbformat.OutputType);
    } else {
        traceWarning(`Unable to translate cell from ${output.output_type} to NotebookCellData for VS Code.`);
        result = {
            outputKind: vscodeNotebookEnums.CellOutputKind.Rich,
            // tslint:disable-next-line: no-any
            data: output.data as any,
            metadata: { custom: { vscode: { outputType: output.output_type } } }
        };
    }

    // Add on transient data if we have any. This should be removed by our save functions elsewhere.
    if (
        output.transient &&
        result &&
        result.outputKind === vscodeNotebookEnums.CellOutputKind.Rich &&
        result.metadata
    ) {
        // tslint:disable-next-line: no-any
        result.metadata.custom = { ...result.metadata.custom, transient: output.transient };
    }
    return result;
}

export function vscCellOutputToCellOutput(output: CellOutput): nbformat.IOutput | undefined {
    switch (output.outputKind) {
        case vscodeNotebookEnums.CellOutputKind.Error: {
            return translateCellErrorOutput(output);
        }
        case vscodeNotebookEnums.CellOutputKind.Rich: {
            return translateCellDisplayOutput(output);
        }
        case vscodeNotebookEnums.CellOutputKind.Text: {
            // We do not return such output.
            return;
        }
        default: {
            return;
        }
    }
}

/**
 * Converts a Jupyter display cell output into a VSCode cell output format.
 * Handles sizing, adding backgrounds to images and the like.
 * E.g. Jupyter cell output contains metadata to add backgrounds to images, here we generate the necessary HTML.
 *
 * @export
 * @param {nbformat.IDisplayData} output
 * @returns {(CellDisplayOutput | undefined)}
 */
function translateDisplayDataOutput(
    output: nbformat.IDisplayData | nbformat.IDisplayUpdate | nbformat.IExecuteResult,
    outputType: nbformat.OutputType
): CellDisplayOutput | undefined {
    const data = { ...output.data };
    // tslint:disable-next-line: no-any
    const metadata = output.metadata ? ({ custom: cloneDeep(output.metadata) } as any) : { custom: {} };
    metadata.custom.vscode = { outputType };
    if (output.execution_count) {
        metadata.custom.vscode.execution_count = output.execution_count;
    }
    return {
        outputKind: vscodeNotebookEnums.CellOutputKind.Rich,
        data,
        metadata // Used be renderers & VS Code for diffing (it knows what has changed).
    };
}

function translateStreamOutput(output: nbformat.IStream, outputType: nbformat.OutputType): CellDisplayOutput {
    // Do not return as `CellOutputKind.Text`. VSC will not translate ascii output correctly.
    // Instead format the output as rich.
    return {
        outputKind: vscodeNotebookEnums.CellOutputKind.Rich,
        data: {
            ['text/plain']: concatMultilineString(output.text, true)
        },
        metadata: {
            custom: { vscode: { outputType, name: output.name } }
        }
    };
}

// tslint:disable-next-line: no-any
function getSanitizedCellMetadata(metadata?: { [key: string]: any }) {
    const cloned = { ...metadata };
    if ('vscode' in cloned) {
        delete cloned.vscode;
    }
    return cloned;
}

type JupyterOutput =
    | nbformat.IUnrecognizedOutput
    | nbformat.IExecuteResult
    | nbformat.IDisplayData
    | nbformat.IStream
    | nbformat.IError;

function translateCellDisplayOutput(output: CellDisplayOutput): JupyterOutput {
    const outputType: nbformat.OutputType = output.metadata?.custom?.vscode?.outputType;
    let result: JupyterOutput;
    switch (outputType) {
        case 'stream':
            {
                result = {
                    output_type: 'stream',
                    name: output.metadata?.custom?.vscode?.name,
                    text: splitMultilineString(output.data['text/plain'])
                };
            }
            break;
        case 'display_data':
            {
                const metadata = getSanitizedCellMetadata(output.metadata?.custom);
                result = {
                    output_type: 'display_data',
                    data: output.data,
                    metadata
                };
            }
            break;
        case 'execute_result':
            {
                const metadata = getSanitizedCellMetadata(output.metadata?.custom);
                result = {
                    output_type: 'execute_result',
                    data: output.data,
                    metadata,
                    execution_count: output.metadata?.custom?.vscode?.execution_count
                };
            }
            break;
        case 'update_display_data':
            {
                const metadata = getSanitizedCellMetadata(output.metadata?.custom);
                result = {
                    output_type: 'update_display_data',
                    data: output.data,
                    metadata
                };
            }
            break;
        default:
            {
                sendTelemetryEvent(Telemetry.VSCNotebookCellTranslationFailed, undefined, {
                    isErrorOutput: outputType === 'error'
                });
                const metadata = getSanitizedCellMetadata(output.metadata?.custom);
                const unknownOutput: nbformat.IUnrecognizedOutput = { output_type: outputType };
                if (Object.keys(metadata).length > 0) {
                    unknownOutput.metadata = metadata;
                }
                if (Object.keys(output.data).length > 0) {
                    unknownOutput.data = output.data;
                }
                result = unknownOutput;
            }
            break;
    }

    // Account for transient data as well
    if (result && output.metadata && output.metadata.custom?.transient) {
        result.transient = { ...output.metadata.custom?.transient };
    }
    return result;
}

/**
 * We will display the error message in the status of the cell.
 * The `ename` & `evalue` is displayed at the top of the output by VS Code.
 * As we're displaying the error in the statusbar, we don't want this dup error in output.
 * Hence remove this.
 */
export function translateErrorOutput(output: nbformat.IError): CellErrorOutput {
    return {
        ename: output.ename,
        evalue: output.evalue,
        outputKind: vscodeNotebookEnums.CellOutputKind.Error,
        traceback: output.traceback
    };
}
export function translateCellErrorOutput(output: CellErrorOutput): nbformat.IError {
    return {
        output_type: 'error',
        ename: output.ename,
        evalue: output.evalue,
        traceback: output.traceback
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
export function getCellStatusMessageBasedOnFirstCellErrorOutput(outputs?: CellOutput[]): string {
    if (!Array.isArray(outputs)) {
        return '';
    }
    const errorOutput = outputs.find((output) => output.outputKind === vscodeNotebookEnums.CellOutputKind.Error) as
        | CellErrorOutput
        | undefined;
    if (!errorOutput) {
        return '';
    }
    return `${errorOutput.ename}${errorOutput.evalue ? ': ' : ''}${errorOutput.evalue}`;
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

    await editor.edit((edit) => {
        edit.replaceMetadata({
            ...document.metadata,
            cellEditable: true,
            cellRunnable: true,
            editable: true,
            runnable: true
        });
        document.cells.forEach((cell, index) => {
            if (cell.cellKind === vscodeNotebookEnums.CellKind.Markdown) {
                edit.replaceCellMetadata(index, { ...cell.metadata, editable: true });
            } else {
                edit.replaceCellMetadata(index, {
                    ...cell.metadata,
                    editable: true,
                    runnable: true
                });
                // Restore the output once we trust the notebook.
                edit.replaceCellOutput(
                    index,
                    // tslint:disable-next-line: no-any
                    createVSCCellOutputsFromOutputs(originalCells[index].outputs as any)
                );
            }
        });
    });
}
