// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type * as nbformat from '@jupyterlab/nbformat';
import { NotebookCellOutput, NotebookCellOutputItem, NotebookCell, NotebookCellExecutionState, Position, Range } from 'vscode';
// eslint-disable-next-line @typescript-eslint/no-require-imports
import type { KernelMessage } from '@jupyterlab/services';
import fastDeepEqual from 'fast-deep-equal';
import * as path from '../../platform/vscode-path/path';
import * as uriPath from '../../platform/vscode-path/resources';
import { PYTHON_LANGUAGE } from '../../platform/common/constants';
import { concatMultilineString, splitMultilineString } from '../../platform/common/utils';
import { traceInfoIfCI, traceError, traceWarning } from '../../platform/logging';
import { sendTelemetryEvent, Telemetry } from '../../telemetry';
import { createOutputWithErrorMessageForDisplay } from '../../platform/errors/errorUtils';
import { CellExecutionCreator } from './cellExecutionCreator';
import { IKernelController, KernelConnectionMetadata } from '../types';
import {
    isPythonKernelConnection,
    getInterpreterFromKernelConnectionMetadata,
    kernelConnectionMetadataHasKernelModel,
    getKernelRegistrationInfo
} from '../helpers';
import { StopWatch } from '../../platform/common/utils/stopWatch';
import { getExtensionSpecifcStack } from '../../platform/errors/errors';
import { getCachedEnvironment, getVersion } from '../../platform/interpreter/helpers';
import { base64ToUint8Array, uint8ArrayToBase64 } from '../../platform/common/utils/string';

export enum CellOutputMimeTypes {
    error = 'application/vnd.code.notebook.error',
    stderr = 'application/vnd.code.notebook.stderr',
    stdout = 'application/vnd.code.notebook.stdout'
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
    'image/png',
    'image/svg+xml',
    'image/jpeg',
    'application/json',
    'text/plain'
];
function isEmptyVendoredMimeType(outputItem: NotebookCellOutputItem) {
    if (outputItem.mime.startsWith('application/vnd.')) {
        try {
            return new TextDecoder().decode(outputItem.data).length === 0;
        } catch {}
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
export class NotebookCellStateTracker {
    private static cellStates = new WeakMap<
        NotebookCell,
        { stateTransition: string[]; state: NotebookCellExecutionState; start: StopWatch }
    >();
    public static getCellState(cell: NotebookCell): NotebookCellExecutionState | undefined {
        return NotebookCellStateTracker.cellStates.get(cell)?.state;
    }
    public static getCellStatus(cell: NotebookCell): string {
        return (NotebookCellStateTracker.cellStates.get(cell)?.stateTransition || []).join(', ') || '';
    }
    public static setCellState(cell: NotebookCell, state: NotebookCellExecutionState) {
        const stopWatch = NotebookCellStateTracker.cellStates.get(cell)?.start || new StopWatch();
        const previousState = NotebookCellStateTracker.cellStates.get(cell)?.stateTransition || [];
        previousState.push(`${state} ${previousState.length === 0 ? '@ start' : `After ${stopWatch.elapsedTime}ms`}`);
        NotebookCellStateTracker.cellStates.set(cell, { stateTransition: previousState, state, start: stopWatch });
    }
}

export function traceCellMessage(cell: NotebookCell, message: string | (() => string)) {
    let messageToLog = typeof message === 'string' ? () => message : message;
    traceInfoIfCI(
        () =>
            `Cell Index:${cell.index}, of document ${uriPath.basename(
                cell.notebook.uri
            )} with state:${NotebookCellStateTracker.getCellStatus(cell)}, exec: ${cell.executionSummary
                ?.executionOrder}. ${messageToLog()}. called from ${getExtensionSpecifcStack()}`
    );
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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        metadata.transient = output.transient as any;
    }

    switch (output.output_type as nbformat.OutputType) {
        case 'display_data':
        case 'execute_result':
        case 'update_display_data': {
            metadata.executionCount = output.execution_count;
            metadata.metadata = output.metadata ? JSON.parse(JSON.stringify(output.metadata)) : {};
            break;
        }
        default:
            break;
    }

    return metadata;
}

export function getNotebookCellOutputMetadata(output: {
    items: NotebookCellOutputItem[];
    metadata?: { [key: string]: unknown };
}): CellOutputMetadata | undefined {
    return output.metadata as CellOutputMetadata | undefined;
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
    // If we have SVG or PNG, then add special metadata to indicate whether to display `open plot`
    if ('image/svg+xml' in output.data || 'image/png' in output.data) {
        metadata.__displayOpenPlotIcon = true;
    }
    const items: NotebookCellOutputItem[] = [];
    if (output.data) {
        // eslint-disable-next-line no-restricted-syntax
        for (const key in output.data) {
            items.push(convertJupyterOutputToBuffer(key, output.data[key]));
        }
    }

    return new NotebookCellOutput(sortOutputItemsBasedOnDisplayOrder(items), metadata);
}

function translateStreamOutput(output: nbformat.IStream): NotebookCellOutput {
    const value = concatMultilineString(output.text);
    const factoryFn = output.name === 'stderr' ? NotebookCellOutputItem.stderr : NotebookCellOutputItem.stdout;
    return new NotebookCellOutput([factoryFn(value)], getOutputMetadata(output));
}

// Output stream can only have stderr or stdout so just check the first output. Undefined if no outputs
function getOutputStreamType(output: NotebookCellOutput): string | undefined {
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
 * Metadata we store in VS Code cell output items.
 * This contains the original metadata from the Jupyuter Outputs.
 */
interface CellOutputMetadata {
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
    };
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
    /**
     * Whether to display the open plot icon.
     */
    __displayOpenPlotIcon?: boolean;
}

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
    const value: Error = JSON.parse(new TextDecoder().decode(firstItem.data));
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
const textDecoder = new TextDecoder();
const textMimeTypes = ['text/plain', 'text/markdown', CellOutputMimeTypes.stderr, CellOutputMimeTypes.stdout];
function convertOutputMimeToJupyterOutput(mime: string, value: Uint8Array) {
    if (!value) {
        return '';
    }
    try {
        if (mime === CellOutputMimeTypes.error) {
            const stringValue = textDecoder.decode(value);
            return JSON.parse(stringValue);
        } else if (mime.startsWith('text/') || textMimeTypes.includes(mime)) {
            const stringValue = textDecoder.decode(value);
            return splitMultilineString(stringValue);
        } else if (mime.startsWith('image/') && mime !== 'image/svg+xml') {
            // Images in Jupyter are stored in base64 encoded format.
            // VS Code expects bytes when rendering images.
            return uint8ArrayToBase64(value);
        } else if (
            mime.toLowerCase().startsWith('application/vnd.holoviews_load.v') &&
            mime.toLowerCase().endsWith('+json')
        ) {
            const stringValue = textDecoder.decode(value);
            try {
                // Holoviews mimetype isn't a json.
                // Lets try to parse it as json & if it fails, treat it as a string.
                // This is to allow backwards compat.
                return stringValue.length > 0 ? JSON.parse(stringValue) : stringValue;
            } catch {
                return stringValue;
            }
        } else if (mime.toLowerCase().includes('json')) {
            const stringValue = textDecoder.decode(value);
            return stringValue.length > 0 ? JSON.parse(stringValue) : stringValue;
        } else {
            const stringValue = textDecoder.decode(value);
            return stringValue;
        }
    } catch (ex) {
        traceError(`Failed to convert ${mime} output from a buffer ${typeof value}, ${value}`, ex);
        return '';
    }
}
function convertJupyterOutputToBuffer(mime: string, value: unknown): NotebookCellOutputItem {
    if (!value) {
        return NotebookCellOutputItem.text('', mime);
    }
    try {
        if (
            (mime.startsWith('text/') || textMimeTypes.includes(mime)) &&
            (Array.isArray(value) || typeof value === 'string')
        ) {
            const stringValue = Array.isArray(value) ? concatMultilineString(value) : value;
            return NotebookCellOutputItem.text(stringValue, mime);
        } else if (mime.startsWith('image/') && typeof value === 'string' && mime !== 'image/svg+xml') {
            // Images in Jupyter are stored in base64 encoded format.
            // VS Code expects bytes when rendering images.
            return new NotebookCellOutputItem(base64ToUint8Array(value), mime);
        } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
            return NotebookCellOutputItem.text(JSON.stringify(value), mime);
        } else {
            // For everything else, treat the data as strings (or multi-line strings).
            value = Array.isArray(value) ? concatMultilineString(value) : value;
            return NotebookCellOutputItem.text(value as string, mime);
        }
    } catch (ex) {
        traceError(`Failed to convert ${mime} output to a buffer ${typeof value}, ${value}`, ex);
        return NotebookCellOutputItem.text('');
    }
}
function convertStreamOutput(output: NotebookCellOutput): JupyterOutput {
    const outputs: string[] = [];
    output.items
        .filter((opit) => opit.mime === CellOutputMimeTypes.stderr || opit.mime === CellOutputMimeTypes.stdout)
        .map((opit) => textDecoder.decode(opit.data))
        .forEach((value) => {
            // Ensure each line is a seprate entry in an array (ending with \n).
            const lines = value.split('\n');
            // If the last item in `outputs` is not empty and the first item in `lines` is not empty, then concate them.
            // As they are part of the same line.
            if (outputs.length && lines.length && lines[0].length > 0) {
                outputs[outputs.length - 1] = `${outputs[outputs.length - 1]}${lines.shift()!}`;
            }
            for (const line of lines) {
                outputs.push(line);
            }
        });

    for (let index = 0; index < outputs.length - 1; index++) {
        outputs[index] = `${outputs[index]}\n`;
    }

    // Skip last one if empty (it's the only one that could be length 0)
    if (outputs.length && outputs[outputs.length - 1].length === 0) {
        outputs.pop();
    }

    const streamType = getOutputStreamType(output) || 'stdout';

    return {
        output_type: 'stream',
        name: streamType,
        text: outputs
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
                data: output.items.reduce((prev: any, curr) => {
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
                data: output.items.reduce((prev: any, curr) => {
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
                data: output.items.reduce((prev: any, curr) => {
                    prev[curr.mime] = convertOutputMimeToJupyterOutput(curr.mime, curr.data as Uint8Array);
                    return prev;
                }, {}),
                metadata: customMetadata?.metadata || {} // This can never be undefined.
            };
            break;
        }
        default: {
            const isError =
                output.items.length === 1 && output.items.every((item) => item.mime === CellOutputMimeTypes.error);
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
                outputType
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
                unknownOutput.data = output.items.reduce((prev: any, curr) => {
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
function translateErrorOutput(output?: nbformat.IError): NotebookCellOutput {
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
    const items =
        output?.items?.filter(
            (opit) =>
                opit.mime === CellOutputMimeTypes.stdout ||
                opit.mime === CellOutputMimeTypes.stderr ||
                opit.mime === 'text/plain' ||
                opit.mime === 'text/markdown'
        ) || [];

    return items.map((item) => convertOutputMimeToJupyterOutput(item.mime, item.data as Uint8Array)).join('');
}
export function getTextOutputValues(cell: NotebookCell): string {
    return cell.outputs.map(getTextOutputValue).join('');
}
export function hasErrorOutput(outputs: readonly NotebookCellOutput[]) {
    const errorOutput = outputs.find(
        (op) => op.items.length && !op.items.some((opit) => opit.mime !== CellOutputMimeTypes.error)
    );

    return !!errorOutput;
}

// eslint-disable-next-line complexity
export async function updateNotebookMetadataWithSelectedKernel(
    metadata?: nbformat.INotebookMetadata,
    kernelConnection?: KernelConnectionMetadata,
    kernelInfo?: Partial<KernelMessage.IInfoReplyMsg['content']>
) {
    let changed = false;
    let kernelId: string | undefined;
    if (!metadata) {
        return { changed, kernelId };
    }

    // If language isn't specified in the metadata, ensure we have that.
    if (!metadata?.language_info?.name) {
        metadata.language_info = metadata.language_info || { name: '' };
    }

    let language: string | undefined;
    switch (kernelConnection?.kind) {
        case 'connectToLiveRemoteKernel':
            language = kernelConnection.kernelModel.language;
            break;
        case 'startUsingRemoteKernelSpec':
        case 'startUsingLocalKernelSpec':
            language = kernelConnection.kernelSpec.language;
            break;
        case 'startUsingPythonInterpreter':
            language = PYTHON_LANGUAGE;
            break;
        default:
            break;
    }
    if (metadata.language_info.name !== language && language) {
        metadata.language_info.name = language;
        changed = true;
    }

    if (kernelInfo && 'language_info' in kernelInfo && kernelInfo.language_info) {
        if (!fastDeepEqual(metadata.language_info, kernelInfo.language_info)) {
            metadata.language_info = JSON.parse(JSON.stringify(kernelInfo.language_info));
            changed = true;
        }
    } else {
        // Get our kernel_info and language_info from the current notebook
        const isPythonConnection = isPythonKernelConnection(kernelConnection);
        const interpreter = isPythonConnection
            ? getInterpreterFromKernelConnectionMetadata(kernelConnection)
            : undefined;
        const versionInfo = await getVersion(interpreter);
        const version = versionInfo ? `${versionInfo.major}.${versionInfo.minor}.${versionInfo.micro}` : '';
        if (
            interpreter &&
            versionInfo &&
            metadata &&
            metadata.language_info &&
            metadata.language_info.version !== version
        ) {
            metadata.language_info.version = version;
            changed = true;
        } else if (!interpreter && metadata?.language_info && isPythonConnection) {
            // It's possible, such as with raw kernel and a default kernelspec to not have interpreter info
            // for this case clear out old invalid language_info entries as they are related to the previous execution
            // However we should clear previous language info only if language is python, else just leave it as is.
            metadata.language_info = undefined;
            changed = true;
        }
    }

    const kernelSpecOrModel =
        kernelConnection && kernelConnectionMetadataHasKernelModel(kernelConnection)
            ? kernelConnection.kernelModel
            : kernelConnection && 'kernelSpec' in kernelConnection
            ? kernelConnection.kernelSpec
            : undefined;
    if (kernelConnection?.kind === 'startUsingPythonInterpreter') {
        // Store interpreter name, we expect the kernel finder will find the corresponding interpreter based on this name.
        const kernelSpec = kernelConnection.kernelSpec;
        let displayName =
            kernelSpec.display_name || getCachedEnvironment(kernelConnection.interpreter)?.environment?.name || '';

        // If kernel spec is generated by us, then always store `python3` in the notebook (so that its portable).
        // However if we've created a kernelspec that points to a real kernelspec in a Python environment, then use the name of that spec.
        let name = '';
        switch (getKernelRegistrationInfo(kernelSpec)) {
            case 'registeredByOldVersionOfExt':
            case 'registeredByNewVersionOfExt':
                name = 'python3';
                break;
            case 'registeredByNewVersionOfExtForCustomKernelSpec': {
                const originalNameFromOriginalSpecFile = kernelSpec.metadata?.vscode?.originalSpecFile
                    ? path.basename(path.dirname(kernelSpec.metadata.vscode.originalSpecFile))
                    : undefined;

                name = originalNameFromOriginalSpecFile || kernelSpec.name;
                displayName = kernelSpec.metadata?.vscode?.originalDisplayName || displayName;
                break;
            }
            default:
                name = kernelSpec.name;
                break;
        }

        if (metadata.kernelspec?.name !== name) {
            changed = true;
            metadata.kernelspec = {
                name,
                language: PYTHON_LANGUAGE,
                display_name: displayName
            };
            if ('vscode' in metadata) {
                delete metadata['vscode'];
            }
            if ('interpreter' in metadata) {
                delete metadata['interpreter'];
            }
        }
    } else if (kernelSpecOrModel && !metadata.kernelspec) {
        const originalNameFromOriginalSpecFile = kernelSpecOrModel.metadata?.vscode?.originalSpecFile
            ? path.basename(path.dirname(kernelSpecOrModel.metadata.vscode.originalSpecFile))
            : undefined;
        // Add a new spec in this case
        metadata.kernelspec = {
            name: originalNameFromOriginalSpecFile || kernelSpecOrModel.name || kernelSpecOrModel.display_name || '',
            display_name:
                kernelSpecOrModel.metadata?.vscode?.originalDisplayName ||
                kernelSpecOrModel.display_name ||
                kernelSpecOrModel.name ||
                ''
        };
        if (kernelSpecOrModel.language) {
            metadata.kernelspec.language = kernelSpecOrModel.language;
        }
        kernelId = kernelSpecOrModel.id;
        changed = true;
    } else if (kernelSpecOrModel && metadata.kernelspec) {
        const originalNameFromOriginalSpecFile = kernelSpecOrModel.metadata?.vscode?.originalSpecFile
            ? path.basename(path.dirname(kernelSpecOrModel.metadata.vscode.originalSpecFile))
            : undefined;
        // Spec exists, just update name and display_name
        const name = originalNameFromOriginalSpecFile || kernelSpecOrModel.name || kernelSpecOrModel.display_name || '';
        const displayName =
            kernelSpecOrModel.metadata?.vscode?.originalDisplayName ||
            kernelSpecOrModel.display_name ||
            kernelSpecOrModel.name ||
            '';
        const language = kernelSpecOrModel.language || kernelSpecOrModel.language || '';
        if (
            metadata.kernelspec.name !== name ||
            metadata.kernelspec.language !== language ||
            metadata.kernelspec.display_name !== displayName ||
            kernelId !== kernelSpecOrModel.id
        ) {
            changed = true;
            metadata.kernelspec.name = name;
            metadata.kernelspec.display_name = displayName;
            metadata.kernelspec.language = language;
            kernelId = kernelSpecOrModel.id;
        }
        try {
            // This is set only for when we select an interpreter.
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            delete (metadata.kernelspec as any).metadata;
        } catch {
            // Noop.
        }
    }
    return { changed, kernelId };
}

export async function endCellAndDisplayErrorsInCell(
    cell: NotebookCell,
    controller: IKernelController,
    errorMessage: string,
    isCancelled: boolean
) {
    const output = createOutputWithErrorMessageForDisplay(errorMessage);
    if (!output) {
        const execution = CellExecutionCreator.get(cell);
        if (isCancelled && execution?.started) {
            execution.end(isCancelled ? undefined : false, cell.executionSummary?.timing?.endTime);
        }
        return;
    }
    if (!CellExecutionCreator.get(cell)) {
        // If we don't have an execution, then we can end the execution that we end up creating
        isCancelled = true;
    }

    // Start execution if not already (Cell execution wrapper will ensure it won't start twice)
    const execution = CellExecutionCreator.getOrCreate(cell, controller);
    if (!execution.started) {
        execution.start(cell.executionSummary?.timing?.endTime);
        execution.executionOrder = cell.executionSummary?.executionOrder;
    }
    await execution.appendOutput(output);
    execution.end(isCancelled ? undefined : false, cell.executionSummary?.timing?.endTime);
}

export function parseStackTrace(traceback: string[], cell: NotebookCell) {
    const cellRegex =
        /(?<prefix>Cell\s+(?:\u001b\[.+?m)?In\s*\[(?<executionCount>\d+)\],\s*)(?<lineLabel>line (?<lineNumber>\d+)).*/;
    // older versions of IPython ~8.3.0
    const inputRegex =
        /(?<prefix>Input\s+?(?:\u001b\[.+?m)(?<cellLabel>In\s*\[(?<executionCount>\d+)\]))(?<postfix>.*)/;
    let lineNumber: number | undefined = undefined;
    for (const line of traceback) {
        const lineMatch = cellRegex.exec(line) ?? inputRegex.exec(line);
        if (lineMatch && lineMatch.groups) {
            lineNumber = parseInt(lineMatch.groups['lineNumber']);
            break;
        }
    }

    let range: Range | undefined = undefined;
    if (lineNumber && lineNumber > 0 && lineNumber <= cell.document.lineCount) {
        const line = cell.document.lineAt(lineNumber - 1);
        const end = line.text.split('#')[0].trimEnd().length;

        range = new Range(
            new Position(line.lineNumber, line.firstNonWhitespaceCharacterIndex),
            new Position(line.lineNumber, end)
        );
    }

    return range;
}
