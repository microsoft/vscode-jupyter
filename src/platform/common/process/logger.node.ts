// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable, named } from 'inversify';
import { isCI, isTestExecution, STANDARD_OUTPUT_CHANNEL } from '../constants';
import { traceInfo } from '../../logging';
import { IOutputChannel } from '../types';
import { Logging } from '../utils/localize';
import { IProcessLogger, SpawnOptions } from './types.node';
import { removeHomeFromFile } from '../platform/fs-paths.node';

/***
 * Logs the running of a new process. Does not log stdout/stderr.
 */
@injectable()
export class ProcessLogger implements IProcessLogger {
    constructor(
        @inject(IOutputChannel) @named(STANDARD_OUTPUT_CHANNEL) private readonly outputChannel: IOutputChannel
    ) {}

    public logProcess(file: string, args: string[], options?: SpawnOptions) {
        if (!isTestExecution() && isCI && process.env.UITEST_DISABLE_PROCESS_LOGGING) {
            // Added to disable logging of process execution commands during UI Tests.
            // Used only during UI Tests (hence this setting need not be exposed as a valid setting).
            return;
        }
        const argsList = args.reduce((accumulator, current, index) => {
            let formattedArg = removeHomeFromFile(current).toCommandArgument();
            if (current[0] === "'" || current[0] === '"') {
                formattedArg = `${current[0]}${removeHomeFromFile(current.substr(1))}`;
            }

            return index === 0 ? formattedArg : `${accumulator} ${formattedArg}`;
        }, '');

        const info = [`> ${removeHomeFromFile(file)} ${argsList}`];
        if (options && options.cwd) {
            info.push(`${Logging.currentWorkingDirectory} ${removeHomeFromFile(options.cwd.toString())}`);
        }

        info.forEach((line) => {
            traceInfo(`Process Execution: ${line}`);
            this.outputChannel.appendLine(line);
        });
    }
}
