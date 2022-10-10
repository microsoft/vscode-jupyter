// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Uri } from 'vscode';
import { InterpreterInformation } from '.';
import { PythonEnvInfo } from '../../common/process/internal/scripts/index.node';
import { parsePythonVersion } from './pythonVersion.node';


/**
 * Compose full interpreter information based on the given data.
 *
 * The data format corresponds to the output of the `interpreterInfo.py` script.
 *
 * @param python - the path to the Python executable
 * @param raw - the information returned by the `interpreterInfo.py` script
 */
export function extractInterpreterInfo(python: Uri, raw: PythonEnvInfo): InterpreterInformation {
    const rawVersion = `${raw.versionInfo.slice(0, 3).join('.')}-${raw.versionInfo[3]}`;
    return {
        uri: python,
        version: parsePythonVersion(rawVersion),
        sysVersion: raw.sysVersion,
        sysPrefix: raw.sysPrefix,
    };
}

