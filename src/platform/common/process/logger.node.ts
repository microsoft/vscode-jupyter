// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { traceInfo } from '../../logging';
import { Logging } from '../utils/localize';
import { SpawnOptions } from './types.node';
import { getDisplayPath } from '../platform/fs-paths.node';
import { toCommandArgument } from '../helpers';

/***
 * Logs the running of a new process. Does not log stdout/stderr.
 */
export function logProcess(file: string, args: string[], options?: SpawnOptions) {
    const argsList = args.reduce((accumulator, current, index) => {
        let formattedArg = toCommandArgument(current);
        if (
            (current.startsWith('"') && current.endsWith('"')) ||
            (current.startsWith("'") && current.endsWith("'") && (current.includes('/') || current.includes('\\')))
        ) {
            formattedArg = `${current[0]}${getDisplayPath(current.substr(1))}`;
        }

        return index === 0 ? formattedArg : `${accumulator} ${formattedArg}`;
    }, '');

    const message = [`Process Execution: ${getDisplayPath(file)} ${argsList}`];
    if (options && options.cwd) {
        message.push(`    > ${Logging.currentWorkingDirectory} ${getDisplayPath(options.cwd.toString())}`);
    }
    traceInfo(message.join('\n'));
}
