// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Uri } from 'vscode';
import { PythonEnvironment } from '../../platform/pythonEnvironments/info';

/**
 * Creates a PythonInterpreter object for testing purposes, with unique name, version and path.
 * If required a custom name, version and the like can be provided.
 *
 * @export
 * @param {Partial<PythonEnvironment>} [info]
 * @returns {PythonEnvironment}
 */
export function createPythonInterpreter(info?: Partial<PythonEnvironment>): PythonEnvironment {
    const rnd = new Date().getTime().toString();
    return {
        id: Uri.file(`somePath${rnd}`).path,
        uri: Uri.file(`somePath${rnd}`),
        ...(info || {})
    };
}
