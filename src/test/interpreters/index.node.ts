// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as path from '../../platform/vscode-path/path';
import { traceError } from '../../platform/logging';
import { PythonEnvInfo } from '../../platform/interpreter/internal/scripts/index.node';
import { ProcessService } from '../../platform/common/process/proc.node';
import { PythonEnvironment } from '../../platform/pythonEnvironments/info';
import { parsePythonVersion } from '../../platform/pythonEnvironments/info/pythonVersion.node';
import { EXTENSION_ROOT_DIR_FOR_TESTS } from '../constants.node';
import { isCondaEnvironment } from './condaLocator.node';
import { getCondaEnvironment, getCondaFile, isCondaAvailable } from './condaService.node';
import { getComparisonKey } from '../../platform/vscode-path/resources';
import { Uri } from 'vscode';
import { getOSType, OSType } from '../../platform/common/utils/platform';
import { fileToCommandArgument } from '../../platform/common/helpers';

const executionTimeout = 30_000;
const SCRIPTS_DIR = path.join(EXTENSION_ROOT_DIR_FOR_TESTS, 'pythonFiles');
const defaultShells = {
    [OSType.Windows]: 'cmd',
    [OSType.OSX]: 'bash',
    [OSType.Linux]: 'bash',
    [OSType.Unknown]: undefined
};

const defaultShell = defaultShells[getOSType()];

const interpreterInfoCache = new Map<string, Promise<PythonEnvironment | undefined>>();
export async function getInterpreterInfo(pythonPath: Uri | undefined): Promise<PythonEnvironment | undefined> {
    if (!pythonPath) {
        return undefined;
    }
    const key = getComparisonKey(pythonPath);
    if (interpreterInfoCache.has(key)) {
        return interpreterInfoCache.get(key);
    }

    const promise = (async () => {
        try {
            const cli = await getPythonCli(pythonPath);
            const processService = new ProcessService();
            const argv = [...cli, fileToCommandArgument(path.join(SCRIPTS_DIR, 'interpreterInfo.py'))];
            const cmd = argv.reduce((p, c) => (p ? `${p} "${c}"` : `"${c.replace('\\', '/')}"`), ''); // CodeQL [SM02383] Replace just the first occurrence of \\ as this could be a UNC path.
            const result = await processService.shellExec(cmd, {
                timeout: executionTimeout,
                env: process.env,
                shell: defaultShell
            });
            if (result.stderr && result.stderr.length) {
                traceError(`Failed to parse interpreter information for ${argv} stderr: ${result.stderr}`);
                return;
            }
            const json: PythonEnvInfo = JSON.parse(result.stdout.trim());
            const rawVersion = `${json.versionInfo.slice(0, 3).join('.')}-${json.versionInfo[3]}`;
            return {
                id: json.exe,
                uri: Uri.file(json.exe),
                displayName: `Python${rawVersion}`,
                version: parsePythonVersion(rawVersion),
                sysVersion: json.sysVersion,
                sysPrefix: json.sysPrefix
            };
        } catch (ex) {
            traceError('Failed to get Activated env Variables: ', ex);
            return undefined;
        }
    })();
    interpreterInfoCache.set(key, promise);
    return promise;
}

const envVariables = new Map<string, Promise<NodeJS.ProcessEnv | undefined>>();
export async function getActivatedEnvVariables(pythonPath: Uri): Promise<NodeJS.ProcessEnv | undefined> {
    const key = getComparisonKey(pythonPath);
    if (envVariables.has(key)) {
        return envVariables.get(key);
    }
    const promise = (async () => {
        const cli = await getPythonCli(pythonPath);
        const processService = new ProcessService();
        const separator = 'e976ee50-99ed-4aba-9b6b-9dcd5634d07d';
        const argv = [...cli, path.join(SCRIPTS_DIR, 'printEnvVariables.py')];
        const cmd = argv.reduce((p, c) => (p ? `${p} "${c}"` : `"${c.replace('\\', '/')}"`), '');
        const result = await processService.shellExec(cmd, {
            timeout: executionTimeout,
            maxBuffer: 1000 * 1000,
            throwOnStdErr: false,
            env: process.env,
            shell: defaultShell
        });
        if (result.stderr && result.stderr.length) {
            traceError(`Failed to get env vars for shell ${defaultShell} with ${argv} stderr: ${result.stderr}`);
            return;
        }
        try {
            // Sometimes when environments get activated, we get a lot of noise in the output.
            // Having a separator allows us to filter out the noise.
            const output = result.stdout;
            return JSON.parse(output.substring(output.indexOf(separator) + separator.length).trim());
        } catch (ex) {
            traceError(`Failed to get env vars for shell ${defaultShell} with ${argv}`, ex);
        }
    })();
    envVariables.set(key, promise);
    return promise;
}

async function getPythonCli(pythonPath: Uri | undefined) {
    const isConda = await isCondaEnvironment(pythonPath);
    if (isConda) {
        try {
            const available = isCondaAvailable();
            if (!available) {
                throw new Error('No conda but using conda interpreter');
            }
            const condaInfo = await getCondaEnvironment(pythonPath);
            const runArgs = ['run'];
            if (!condaInfo) {
                throw new Error('No conda info');
            } else if (condaInfo.name === '') {
                runArgs.push('-p', condaInfo.path.fsPath);
            } else {
                runArgs.push('-n', condaInfo.name);
            }

            const condaFile = await getCondaFile();
            return [fileToCommandArgument(condaFile), ...runArgs, 'python'];
        } catch {
            // Noop.
        }
        traceError('Using Conda Interpreter, but no conda');
    }
    return pythonPath ? [fileToCommandArgument(pythonPath.fsPath)] : [];
}
