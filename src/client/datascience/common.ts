// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import type { nbformat } from '@jupyterlab/coreutils';
import * as os from 'os';
import { parse, SemVer } from 'semver';
import { Uri } from 'vscode';
import { splitMultilineString } from '../../datascience-ui/common';
import { traceError, traceInfo } from '../common/logger';
import { IFileSystem } from '../common/platform/types';
import { IPythonExecutionFactory } from '../common/process/types';
import { DataScience } from '../common/utils/localize';
import { sendTelemetryEvent } from '../telemetry';
import { KnownKernelLanguageAliases, KnownNotebookLanguages, Telemetry } from './constants';
import { ICell } from './types';

// Can't figure out a better way to do this. Enumerate
// the allowed keys of different output formats.
const dummyStreamObj: nbformat.IStream = {
    output_type: 'stream',
    name: 'stdout',
    text: ''
};
const dummyErrorObj: nbformat.IError = {
    output_type: 'error',
    ename: '',
    evalue: '',
    traceback: ['']
};
const dummyDisplayObj: nbformat.IDisplayData = {
    output_type: 'display_data',
    data: {},
    metadata: {}
};
const dummyExecuteResultObj: nbformat.IExecuteResult = {
    output_type: 'execute_result',
    name: '',
    execution_count: 0,
    data: {},
    metadata: {}
};
export const AllowedCellOutputKeys = {
    ['stream']: new Set(Object.keys(dummyStreamObj)),
    ['error']: new Set(Object.keys(dummyErrorObj)),
    ['display_data']: new Set(Object.keys(dummyDisplayObj)),
    ['execute_result']: new Set(Object.keys(dummyExecuteResultObj))
};

function fixupOutput(output: nbformat.IOutput): nbformat.IOutput {
    let allowedKeys: Set<string>;
    switch (output.output_type) {
        case 'stream':
        case 'error':
        case 'execute_result':
        case 'display_data':
            allowedKeys = AllowedCellOutputKeys[output.output_type];
            break;
        default:
            return output;
    }
    const result = { ...output };
    for (const k of Object.keys(output)) {
        if (!allowedKeys.has(k)) {
            delete result[k];
        }
    }
    return result;
}

export function pruneCell(cell: nbformat.ICell): nbformat.ICell {
    // Source is usually a single string on input. Convert back to an array
    const result = ({
        ...cell,
        source: splitMultilineString(cell.source)
        // tslint:disable-next-line: no-any
    } as any) as nbformat.ICell; // nyc (code coverage) barfs on this so just trick it.

    // Remove outputs and execution_count from non code cells
    if (result.cell_type !== 'code') {
        // Map to any so nyc will build.
        // tslint:disable-next-line: no-any
        delete (<any>result).outputs;
        // tslint:disable-next-line: no-any
        delete (<any>result).execution_count;
    } else {
        // Clean outputs from code cells
        result.outputs = result.outputs ? (result.outputs as nbformat.IOutput[]).map(fixupOutput) : [];
    }

    return result;
}

export function traceCellResults(prefix: string, results: ICell[]) {
    if (results.length > 0 && results[0].data.cell_type === 'code') {
        const cell = results[0].data as nbformat.ICodeCell;
        const error = cell.outputs && cell.outputs[0] ? cell.outputs[0].evalue : undefined;
        if (error) {
            traceError(`${prefix} Error : ${error}`);
        } else if (cell.outputs && cell.outputs[0]) {
            if (cell.outputs[0].output_type.includes('image')) {
                traceInfo(`${prefix} Output: image`);
            } else {
                const data = cell.outputs[0].data;
                const text = cell.outputs[0].text;
                traceInfo(`${prefix} Output: ${text || JSON.stringify(data)}`);
            }
        }
    } else {
        traceInfo(`${prefix} no output.`);
    }
}

export function translateKernelLanguageToMonaco(kernelLanguage: string): string {
    // At the moment these are the only translations.
    // python, julia, r, javascript, powershell, etc can be left as is.
    switch (kernelLanguage.toLowerCase()) {
        case 'c#':
            return 'csharp';
        case 'f#':
            return 'fsharp';
        default:
            return kernelLanguage.toLowerCase();
    }
}

export function generateNewNotebookUri(
    counter: number,
    rootFolder: string | undefined,
    title?: string,
    forVSCodeNotebooks?: boolean
): Uri {
    // However if there are files already on disk, we should be able to overwrite them because
    // they will only ever be used by 'open' editors. So just use the current counter for our untitled count.
    const fileName = title ? `${title}-${counter}.ipynb` : `${DataScience.untitledNotebookFileName()}-${counter}.ipynb`;
    // Turn this back into an untitled
    if (forVSCodeNotebooks) {
        return Uri.file(fileName).with({ scheme: 'untitled', path: fileName });
    } else {
        return Uri.joinPath(rootFolder ? Uri.file(rootFolder) : Uri.file(os.tmpdir()), fileName).with({
            scheme: 'untitled'
        });
    }
}

export async function getRealPath(
    fs: IFileSystem,
    execFactory: IPythonExecutionFactory,
    pythonPath: string,
    expectedPath: string
): Promise<string | undefined> {
    if (await fs.localDirectoryExists(expectedPath)) {
        return expectedPath;
    }
    if (await fs.localFileExists(expectedPath)) {
        return expectedPath;
    }

    // If can't find the path, try turning it into a real path.
    const pythonRunner = await execFactory.create({ pythonPath });
    const result = await pythonRunner.exec(
        ['-c', `import os;print(os.path.realpath("${expectedPath.replace(/\\/g, '\\\\')}"))`],
        {
            throwOnStdErr: false,
            encoding: 'utf-8'
        }
    );
    if (result && result.stdout) {
        const trimmed = result.stdout.trim();
        if (await fs.localDirectoryExists(trimmed)) {
            return trimmed;
        }
        if (await fs.localFileExists(trimmed)) {
            return trimmed;
        }
    }
}

// For the given string parse it out to a SemVer or return undefined
export function parseSemVer(versionString: string): SemVer | undefined {
    const versionMatch = /^\s*(\d+)\.(\d+)\.(.+)\s*$/.exec(versionString);
    if (versionMatch && versionMatch.length > 2) {
        const major = parseInt(versionMatch[1], 10);
        const minor = parseInt(versionMatch[2], 10);
        const build = parseInt(versionMatch[3], 10);
        return parse(`${major}.${minor}.${build}`, true) ?? undefined;
    }
}

export function sendNotebookOrKernelLanguageTelemetry(
    telemetryEvent: Telemetry.SwitchToExistingKernel | Telemetry.NotebookLanguage,
    language: string = 'unknown'
) {
    language = (language || 'unknown').toLowerCase();
    language = KnownKernelLanguageAliases.get(language) || language;
    if (!KnownNotebookLanguages.includes(language)) {
        language = 'unknown';
    }
    sendTelemetryEvent(telemetryEvent, undefined, { language });
}
