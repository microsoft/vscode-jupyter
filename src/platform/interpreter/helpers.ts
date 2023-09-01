// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { EnvironmentType, PythonEnvironment } from '../pythonEnvironments/info';
import { getTelemetrySafeVersion } from '../telemetry/helpers';
import { basename } from '../../platform/vscode-path/resources';
import { Environment, KnownEnvironmentTools, KnownEnvironmentTypes } from '../api/pythonApiTypes';

export function getPythonEnvDisplayName(interpreter: PythonEnvironment | Environment) {
    if ('executable' in interpreter) {
        const versionParts: string[] = [];
        if (typeof interpreter.version?.major === 'number') {
            versionParts.push(interpreter.version.major.toString());
            if (typeof interpreter.version.minor === 'number') {
                versionParts.push(interpreter.version.minor.toString());
                if (typeof interpreter.version.micro === 'number') {
                    versionParts.push(interpreter.version.micro.toString());
                }
            }
        }
        const version = versionParts.length ? versionParts.join('.') : '';
        const envName = interpreter.environment ? basename(interpreter.environment?.folderUri) : '';
        const nameWithVersion = version ? `Python ${version}` : 'Python';
        if (isCondaEnvironmentWithoutPython(interpreter) && envName) {
            return envName;
        }
        if (envName) {
            return `${envName} (${nameWithVersion})`;
        }
        return nameWithVersion;
    }
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

const environmentTypes = [
    EnvironmentType.Unknown,
    EnvironmentType.Conda,
    EnvironmentType.Pipenv,
    EnvironmentType.Poetry,
    EnvironmentType.Pyenv,
    EnvironmentType.Venv,
    EnvironmentType.VirtualEnv,
    EnvironmentType.VirtualEnvWrapper
];

export function getEnvironmentType(env: Environment): EnvironmentType {
    if ((env.environment?.type as KnownEnvironmentTypes) === 'Conda') {
        return EnvironmentType.Conda;
    }

    // Map the Python env tool to a Jupyter environment type.
    const orderOrEnvs: [pythonEnvTool: KnownEnvironmentTools, JupyterEnv: EnvironmentType][] = [
        ['Conda', EnvironmentType.Conda],
        ['Pyenv', EnvironmentType.Pyenv],
        ['Pipenv', EnvironmentType.Pipenv],
        ['Poetry', EnvironmentType.Poetry],
        ['VirtualEnvWrapper', EnvironmentType.VirtualEnvWrapper],
        ['VirtualEnv', EnvironmentType.VirtualEnv],
        ['Venv', EnvironmentType.Venv]
    ];
    for (const [pythonEnvTool, JupyterEnv] of orderOrEnvs) {
        if (env.tools.includes(pythonEnvTool)) {
            return JupyterEnv;
        }
    }

    for (const type of environmentTypes) {
        if (env.tools.some((tool) => tool.toLowerCase() === type.toLowerCase())) {
            return type;
        }
    }
    return EnvironmentType.Unknown;
}

export function isCondaEnvironmentWithoutPython(env: Environment) {
    return getEnvironmentType(env) === EnvironmentType.Conda && !env.executable.uri;
}
