// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { injectable } from 'inversify';
import { isCI, isTestExecution } from '../constants';
import { traceInfo } from '../../logging';
import { Logging } from '../utils/localize';
import { IProcessLogger, SpawnOptions } from './types.node';
import { removeHomeFromFile } from '../platform/fs-paths.node';
import { toCommandArgument } from '../helpers';

/***
 * Logs the running of a new process. Does not log stdout/stderr.
 */
@injectable()
export class ProcessLogger implements IProcessLogger {
    public logProcess(file: string, args: string[], options?: SpawnOptions) {
        if (!isTestExecution() && isCI && process.env.UITEST_DISABLE_PROCESS_LOGGING) {
            // Added to disable logging of process execution commands during UI Tests.
            // Used only during UI Tests (hence this setting need not be exposed as a valid setting).
            return;
        }
        const argsList = args.reduce((accumulator, current, index) => {
            let formattedArg = toCommandArgument(removeHomeFromFile(current));
            if (current[0] === "'" || current[0] === '"') {
                formattedArg = `${current[0]}${removeHomeFromFile(current.substr(1))}`;
            }

            return index === 0 ? formattedArg : `${accumulator} ${formattedArg}`;
        }, '');

        traceInfo(`Process Execution: ${removeHomeFromFile(file)} ${argsList}`);
        if (options && options.cwd) {
            traceInfo(`${Logging.currentWorkingDirectory} ${removeHomeFromFile(options.cwd.toString())}`);
        }
    }
}
