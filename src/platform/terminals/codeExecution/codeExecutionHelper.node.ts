// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { Uri } from 'vscode';

import { traceError } from '../../logging';
import * as internalScripts from '../../interpreter/internal/scripts/index.node';
import { createDeferred } from '../../common/utils/async';
import { getFilePath } from '../../common/platform/fs-paths';
import { CodeExecutionHelperBase } from './codeExecutionHelper';
import { IProcessServiceFactory } from '../../common/process/types.node';
import { IInterpreterService } from '../../interpreter/contracts';
import { IServiceContainer } from '../../ioc/types';
import { splitLines } from '../../common/helpers';

/**
 * Node version of the code execution helper. Node version is necessary because we can't create processes in the web version.
 */
@injectable()
export class CodeExecutionHelper extends CodeExecutionHelperBase {
    private readonly interpreterService: IInterpreterService;
    private readonly processServiceFactory: IProcessServiceFactory;

    constructor(@inject(IServiceContainer) serviceContainer: IServiceContainer) {
        super(serviceContainer);
        this.processServiceFactory = serviceContainer.get<IProcessServiceFactory>(IProcessServiceFactory);
        this.interpreterService = serviceContainer.get<IInterpreterService>(IInterpreterService);
    }

    public override async normalizeLines(code: string, resource?: Uri): Promise<string> {
        try {
            const codeTrimmed = code.trim();
            if (codeTrimmed.length === 0) {
                return '';
            }
            // On windows cr is not handled well by python when passing in/out via stdin/stdout.
            // So just remove cr from the input.
            code = code.replace(new RegExp('\\r', 'g'), '');
            if (codeTrimmed.indexOf('\n') === -1) {
                // the input is a single line, maybe indented, without terminator
                return codeTrimmed + '\n';
            }

            const interpreter = await this.interpreterService.getActiveInterpreter(resource);
            const processService = await this.processServiceFactory.create(resource);

            const [args, parse] = internalScripts.normalizeSelection();
            const observable = processService.execObservable(getFilePath(interpreter?.uri) || 'python', args, {
                throwOnStdErr: true
            });
            const normalizeOutput = createDeferred<string>();

            // Read result from the normalization script from stdout, and resolve the promise when done.
            let normalized = '';
            observable.out.subscribe({
                next: (output) => {
                    if (output.source === 'stdout') {
                        normalized += output.out;
                    }
                },
                complete: () => {
                    normalizeOutput.resolve(normalized);
                }
            });

            // The normalization script expects a serialized JSON object, with the selection under the "code" key.
            // We're using a JSON object so that we don't have to worry about encoding, or escaping non-ASCII characters.
            const input = JSON.stringify({ code });
            observable.proc?.stdin?.write(input);
            observable.proc?.stdin?.end();

            // We expect a serialized JSON object back, with the normalized code under the "normalized" key.
            const result = await normalizeOutput.promise;
            const object = JSON.parse(result);

            const normalizedLines = parse(object.normalized);
            // Python will remove leading empty spaces, add them back.
            const indexOfFirstNonEmptyLineInOriginalCode = splitLines(code, {
                trim: true,
                removeEmptyEntries: false
            }).findIndex((line) => line.length);
            const indexOfFirstNonEmptyLineInNormalizedCode = splitLines(normalizedLines, {
                trim: true,
                removeEmptyEntries: false
            }).findIndex((line) => line.length);
            if (indexOfFirstNonEmptyLineInOriginalCode > indexOfFirstNonEmptyLineInNormalizedCode) {
                // Some white space has been trimmed, add them back.
                const trimmedLineCount =
                    indexOfFirstNonEmptyLineInOriginalCode - indexOfFirstNonEmptyLineInNormalizedCode;
                return `${'\n'.repeat(trimmedLineCount)}${normalizedLines}`;
            }
            return normalizedLines;
        } catch (ex) {
            traceError(ex, 'Python: Failed to normalize code for execution in Interactive Window');
            return code;
        }
    }
}
