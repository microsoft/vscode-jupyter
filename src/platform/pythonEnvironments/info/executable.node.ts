// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Uri } from 'vscode';
import { getExecutable as getPythonExecutableCommand } from '../../interpreter/internal/python.node';
import { copyPythonExecInfo, PythonExecInfo } from '../exec';

type ExecResult = {
    stdout: string;
};
type ExecFunc = (command: string, args: string[]) => Promise<ExecResult>;

/**
 * Find the filename for the corresponding Python executable.
 *
 * Effectively, we look up `sys.executable`.
 *
 * @param python - the information to use when running Python
 * @param exec - the function to use to run Python
 */
export async function getExecutablePath(python: PythonExecInfo, exec: ExecFunc): Promise<Uri> {
    const [args, parse] = getPythonExecutableCommand();
    const info = copyPythonExecInfo(python, args);
    const result = await exec(info.command, info.args);
    return Uri.file(parse(result.stdout));
}
