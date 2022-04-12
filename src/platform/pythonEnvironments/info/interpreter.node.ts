// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { sha256 } from 'hash.js';
import { Uri } from 'vscode';
import * as uriPath from '../../vscode-path/resources';
import { InterpreterInformation, PythonEnvironment } from '.';
import { interpreterInfo as getInterpreterInfoCommand, PythonEnvInfo } from '../../common/process/internal/scripts/index.node';
import { getOSType, OSType } from '../../common/utils/platform';
import { copyPythonExecInfo, PythonExecInfo } from '../exec';
import { parsePythonVersion } from './pythonVersion';

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

type ShellExecResult = {
    stdout: string;
    stderr?: string;
};
type ShellExecFunc = (command: string, timeout: number) => Promise<ShellExecResult>;

type Logger = {
    info(msg: string): void;
    error(msg: string): void;
};

/**
 * Collect full interpreter information from the given Python executable.
 *
 * @param python - the information to use when running Python
 * @param shellExec - the function to use to exec Python
 * @param logger - if provided, used to log failures or other info
 */
export async function getInterpreterInfo(
    python: PythonExecInfo,
    shellExec: ShellExecFunc,
    logger?: Logger,
): Promise<InterpreterInformation | undefined> {
    const [args, parse] = getInterpreterInfoCommand();
    const info = copyPythonExecInfo(python, args);
    const argv = [info.command, ...info.args];

    // Concat these together to make a set of quoted strings
    const quoted = argv.reduce((p, c) => (p ? `${p} "${c}"` : `"${c.replace('\\', '\\\\')}"`), '');

    // Try shell execing the command, followed by the arguments. This will make node kill the process if it
    // takes too long.
    // Sometimes the python path isn't valid, timeout if that's the case.
    // See these two bugs:
    // https://github.com/microsoft/vscode-python/issues/7569
    // https://github.com/microsoft/vscode-python/issues/7760
    const result = await shellExec(quoted, 15000);
    if (result.stderr) {
        if (logger) {
            logger.error(`Failed to parse interpreter information for ${argv} stderr: ${result.stderr}`);
        }
        return;
    }
    const json = parse(result.stdout);
    if (logger) {
        logger.info(`Found interpreter for ${argv}`);
    }
    return extractInterpreterInfo(Uri.file(python.pythonExecutable), json);
}

export function getInterpreterHash(interpreter: PythonEnvironment | {uri: Uri}){
    const interpreterPath = getNormalizedInterpreterPath(interpreter.uri);
    return sha256().update(interpreterPath.path).digest('hex');
}

export function areInterpretersSame(i1: PythonEnvironment | undefined, i2: PythonEnvironment | undefined) {
    return areInterpreterPathsSame(i1?.uri, i2?.uri) && i1?.displayName == i2?.displayName;
}

/**
 * Sometimes on CI, we have paths such as (this could happen on user machines as well)
 *  - /opt/hostedtoolcache/Python/3.8.11/x64/python
 *  - /opt/hostedtoolcache/Python/3.8.11/x64/bin/python
 *  They are both the same.
 * This function will take that into account.
 */
export function areInterpreterPathsSame(path1: Uri = Uri.file(''), path2:Uri = Uri.file(''), ostype = getOSType(), forceLowerCase: boolean = false){
    const norm1 = getNormalizedInterpreterPath(path1, ostype, ostype == OSType.Windows || forceLowerCase);
    const norm2 = getNormalizedInterpreterPath(path2, ostype, ostype == OSType.Windows || forceLowerCase);
    return norm1 === norm2 || uriPath.isEqual(norm1, norm2, true);
}
/**
 * Sometimes on CI, we have paths such as (this could happen on user machines as well)
 *  - /opt/hostedtoolcache/Python/3.8.11/x64/python
 *  - /opt/hostedtoolcache/Python/3.8.11/x64/bin/python
 *  They are both the same.
 * This function will take that into account.
 */
 export function getNormalizedInterpreterPath(path:Uri = Uri.file(''), ostype = getOSType(), forceLowerCase: boolean = false){
    let fsPath = path.fsPath;
    if (forceLowerCase) {
        fsPath = fsPath.toLowerCase();
    }

    // No need to generate hashes, its unnecessarily slow.
    if (!fsPath.endsWith('/bin/python')) {
        return Uri.file(fsPath);
    }
    // Sometimes on CI, we have paths such as (this could happen on user machines as well)
    // - /opt/hostedtoolcache/Python/3.8.11/x64/python
    // - /opt/hostedtoolcache/Python/3.8.11/x64/bin/python
    // They are both the same.
    // To ensure we treat them as the same, lets drop the `bin` on unix.
    if ([OSType.Linux, OSType.OSX].includes(ostype)){
        // We need to exclude paths such as `/usr/bin/python`
        return fsPath.endsWith('/bin/python') && fsPath.split('/').length > 4 ? Uri.file(fsPath.replace('/bin/python', '/python')) : Uri.file(fsPath);
    }
    return Uri.file(fsPath);
}

/**
 * Generates a unique id for an intepreter
 * @param interpreter 
 * @returns 
 */
export function getInterpreterId(interpreter: PythonEnvironment) {
    return getInterpreterHash(interpreter);
}
