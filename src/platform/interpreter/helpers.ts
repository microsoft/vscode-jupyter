// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { EnvironmentType, PythonEnvironment } from '../pythonEnvironments/info';
import { getTelemetrySafeVersion } from '../telemetry/helpers';
import { basename } from '../../platform/vscode-path/resources';
import { Environment, KnownEnvironmentTools, KnownEnvironmentTypes, PythonExtension } from '@vscode/python-extension';
import { traceWarning } from '../logging';
import { getDisplayPath } from '../common/platform/fs-paths';

export function getPythonEnvDisplayName(interpreter: PythonEnvironment | Environment | { id: string }) {
    const env = getCachedEnvironment(interpreter);
    if (env) {
        const versionParts: string[] = [];
        if (typeof env.version?.major === 'number') {
            versionParts.push(env.version.major.toString());
            if (typeof env.version.minor === 'number') {
                versionParts.push(env.version.minor.toString());
                if (typeof env.version.micro === 'number') {
                    versionParts.push(env.version.micro.toString());
                }
            }
        }
        const version = versionParts.length ? versionParts.join('.') : '';
        const envName = env.environment ? basename(env.environment?.folderUri) : '';
        const nameWithVersion = version ? `Python ${version}` : 'Python';
        if (isCondaEnvironmentWithoutPython(interpreter) && envName) {
            return envName;
        }
        if (envName) {
            return `${envName} (${nameWithVersion})`;
        }
        return nameWithVersion;
    }
    if (Object.keys(interpreter).length === 1 && interpreter.id) {
        return interpreter.id;
    }

    const pythonVersion = getTelemetrySafeVersion(getCachedVersion(interpreter) || '').trim();
    // If this is a conda environment without Python, then don't display `Python` in it.
    const isCondaEnvWithoutPython = isCondaEnvironmentWithoutPython(interpreter);
    const nameWithVersion = pythonVersion ? `Python ${pythonVersion}` : 'Python';
    const envName = getPythonEnvironmentName(interpreter as PythonEnvironment);
    if (isCondaEnvWithoutPython && envName) {
        return envName;
    }
    const details: string[] = [];
    if (envName) {
        details.push(envName);
    }
    const envType = getEnvironmentType(interpreter);
    if (envType && envType !== EnvironmentType.Unknown) {
        details.push(envType);
    }
    return [nameWithVersion, details.length ? `(${details.join(': ')})` : ''].join(' ').trim();
}

export function getPythonEnvironmentName(pythonEnv: PythonEnvironment) {
    // Sometimes Python extension doesn't detect conda environments correctly (e.g. conda env create without a name).
    // In such cases the envName is empty, but it has a path.
    const env = getCachedEnvironment(pythonEnv);
    let envName = env?.environment?.name;
    if (!envName && env?.environment?.folderUri && getEnvironmentType(pythonEnv) === EnvironmentType.Conda) {
        envName = basename(env?.environment?.folderUri);
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

export function getEnvironmentType(interpreter: { id: string }): EnvironmentType {
    const env = getCachedEnvironment(interpreter);
    return env ? getEnvironmentTypeImpl(env) : EnvironmentType.Unknown;
}
function getEnvironmentTypeImpl(env: Environment): EnvironmentType {
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
    if (env.environment?.type === 'VirtualEnvironment') {
        return EnvironmentType.VirtualEnv;
    }

    for (const type of environmentTypes) {
        if (env.tools.some((tool) => tool.toLowerCase() === type.toLowerCase())) {
            return type;
        }
    }
    return EnvironmentType.Unknown;
}

export async function getInterpreterInfo(interpreter?: { id: string }) {
    if (!interpreter?.id) {
        return;
    }
    const api = await PythonExtension.api();
    return api.environments.resolveEnvironment(interpreter.id);
}

let pythonApi: PythonExtension;
export function setPythonApi(api: PythonExtension) {
    pythonApi = api;
}

export function isCondaEnvironmentWithoutPython(interpreter?: { id: string }) {
    if (!interpreter) {
        return false;
    }
    if (!pythonApi) {
        return false;
    }

    const env = getCachedEnvironment(interpreter);
    return env && getEnvironmentType(env) === EnvironmentType.Conda && !env.executable.uri;
}

export function getCachedEnvironment(interpreter?: { id: string }) {
    if (!interpreter) {
        return;
    }
    if (!pythonApi) {
        throw new Error('Python API not initialized');
    }
    return pythonApi.environments.known.find((i) => i.id === interpreter.id);
}

export async function getSysPrefix(interpreter?: { id: string }) {
    if (!interpreter?.id) {
        return;
    }
    if (pythonApi) {
        const cachedInfo = pythonApi.environments.known.find((i) => i.id === interpreter.id);
        if (cachedInfo?.executable?.sysPrefix) {
            return cachedInfo.executable.sysPrefix;
        }
    }

    const api = await PythonExtension.api();
    const sysPrefix = await api.environments.resolveEnvironment(interpreter.id).then((i) => i?.executable?.sysPrefix);
    if (!sysPrefix) {
        traceWarning(`Unable to find sysPrefix for interpreter ${getDisplayPath(interpreter.id)}`);
    }
    return sysPrefix;
}

export function getCachedSysPrefix(interpreter?: { id: string }) {
    if (!interpreter?.id) {
        return;
    }
    if (!pythonApi) {
        throw new Error('Python API not initialized');
    }
    const cachedInfo = pythonApi.environments.known.find((i) => i.id === interpreter.id);
    return cachedInfo?.executable?.sysPrefix;
}
export async function getVersion(interpreter?: { id?: string }) {
    if (!interpreter?.id) {
        return;
    }
    if (pythonApi) {
        const cachedInfo = pythonApi.environments.known.find((i) => i.id === interpreter.id);
        if (cachedInfo?.version) {
            return cachedInfo.version;
        }
    }

    const api = await PythonExtension.api();
    const info = await api.environments.resolveEnvironment(interpreter.id);
    if (!info?.version) {
        traceWarning(`Unable to find Version for interpreter ${getDisplayPath(interpreter.id)}`);
    }
    return info?.version;
}

export function getCachedVersion(interpreter?: { id?: string }) {
    if (!interpreter?.id) {
        return;
    }
    if (!pythonApi) {
        throw new Error('Python API not initialized');
    }
    const cachedInfo = pythonApi.environments.known.find((i) => i.id === interpreter.id);
    return cachedInfo?.version;
}
