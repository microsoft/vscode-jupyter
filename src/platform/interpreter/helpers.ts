// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { EnvironmentType, PythonEnvironment } from '../pythonEnvironments/info';
import { getTelemetrySafeVersion } from '../telemetry/helpers';
import { basename } from '../../platform/vscode-path/resources';

export function getPythonEnvDisplayName(interpreter: PythonEnvironment) {
    const pythonVersion = (getTelemetrySafeVersion(interpreter.version?.raw || '') || '').trim();
    // If this is a conda environment without Python, then don't display `Python` in it.
    const isCondaEnvWithoutPython =
        interpreter.envType === EnvironmentType.Conda && interpreter.isCondaEnvWithoutPython === true;
    const nameWithVersion = pythonVersion.trim() ? `Python ${pythonVersion}` : 'Python';
    const envName = getPythonEnvironmentName(interpreter);
    if (isCondaEnvWithoutPython && envName) {
        return envName;
    }
    const details: string[] = [];
    if (envName) {
        details.push(envName);
    }
    if (interpreter.envType && interpreter.envType !== EnvironmentType.Unknown) {
        details.push(interpreter.envType);
    }
    return [nameWithVersion, details.length ? `(${details.join(': ')})` : ''].join(' ').trim();
}

export function getPythonEnvironmentName(pythonEnv: PythonEnvironment) {
    // Sometimes Python extension doesn't detect conda environments correctly (e.g. conda env create without a name).
    // In such cases the envName is empty, but it has a path.
    let envName = pythonEnv.envName;
    if (pythonEnv.envPath && pythonEnv.envType === EnvironmentType.Conda && !pythonEnv.envName) {
        envName = basename(pythonEnv.envPath);
    }
    return envName;
}
