// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';

import * as uuid from 'uuid/v4';
import * as path from 'path';
import type { Kernel } from '@jupyterlab/services';
import { IJupyterKernelSpec, INotebook } from '../../types';
import { JupyterKernelSpec } from './jupyterKernelSpec';
// eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
const NamedRegexp = require('named-js-regexp') as typeof import('named-js-regexp');
import { nbformat } from '@jupyterlab/coreutils';
// eslint-disable-next-line @typescript-eslint/no-require-imports
import cloneDeep = require('lodash/cloneDeep');
import { PYTHON_LANGUAGE } from '../../../common/constants';
import { IConfigurationService, IPathUtils, Resource } from '../../../common/types';
import { PythonEnvironment } from '../../../pythonEnvironments/info';
import {
    DefaultKernelConnectionMetadata,
    KernelConnectionMetadata,
    KernelSpecConnectionMetadata,
    LiveKernelConnectionMetadata,
    PythonKernelConnectionMetadata
} from './types';
import { PreferredRemoteKernelIdProvider } from '../../notebookStorage/preferredRemoteKernelIdProvider';
import { isPythonNotebook } from '../../notebook/helpers/helpers';
import { DataScience } from '../../../common/utils/localize';
import { Settings, Telemetry } from '../../constants';
import { concatMultilineString } from '../../../../datascience-ui/common';
import { sendTelemetryEvent } from '../../../telemetry';
import { traceInfo, traceInfoIf } from '../../../common/logger';
import { getInterpreterHash } from '../../../pythonEnvironments/info/interpreter';
import { getTelemetrySafeVersion } from '../../../telemetry/helpers';
import { IS_CI_SERVER } from '../../../../test/ciConstants';
import { trackKernelResourceInformation } from '../../telemetry/telemetry';
import { Uri } from 'vscode';
import { getResourceType } from '../../common';

// Helper functions for dealing with kernels and kernelspecs

// https://jupyter-client.readthedocs.io/en/stable/kernels.html
const connectionFilePlaceholder = '{connection_file}';

// Find the index of the connection file placeholder in a kernelspec
export function findIndexOfConnectionFile(kernelSpec: Readonly<IJupyterKernelSpec>): number {
    return kernelSpec.argv.indexOf(connectionFilePlaceholder);
}

type ConnectionWithKernelSpec =
    | KernelSpecConnectionMetadata
    | PythonKernelConnectionMetadata
    | DefaultKernelConnectionMetadata;
export function kernelConnectionMetadataHasKernelSpec(
    connectionMetadata: KernelConnectionMetadata
): connectionMetadata is ConnectionWithKernelSpec {
    return connectionMetadata.kind !== 'connectToLiveKernel';
}
export function kernelConnectionMetadataHasKernelModel(
    connectionMetadata: KernelConnectionMetadata
): connectionMetadata is LiveKernelConnectionMetadata {
    return connectionMetadata.kind === 'connectToLiveKernel';
}
export function getKernelId(spec: IJupyterKernelSpec, interpreter?: PythonEnvironment) {
    // Non-Python kernels cannot contain an interpreter (even in their id).
    interpreter = isPythonKernelSpec(spec) ? interpreter : undefined;
    return `${spec.id || ''}.${spec.name}.${spec.path}.${interpreter?.path || ''}.${
        spec.display_name || interpreter?.displayName || ''
    }`;
}
export function getDisplayNameOrNameOfKernelConnection(
    kernelConnection: KernelConnectionMetadata | undefined,
    defaultValue: string = ''
) {
    if (!kernelConnection) {
        return defaultValue;
    }
    const displayName =
        kernelConnection.kind === 'connectToLiveKernel'
            ? kernelConnection.kernelModel.display_name
            : kernelConnection.kernelSpec?.display_name;
    const name =
        kernelConnection.kind === 'connectToLiveKernel'
            ? kernelConnection.kernelModel.name
            : kernelConnection.kernelSpec?.name;

    const interpeterName =
        kernelConnection.kind === 'startUsingPythonInterpreter' ? kernelConnection.interpreter.displayName : undefined;

    const defaultKernelName = kernelConnection.kind === 'startUsingDefaultKernel' ? 'Python 3' : undefined;
    return displayName || name || interpeterName || defaultKernelName || defaultValue;
}

export function getNameOfKernelConnection(
    kernelConnection: KernelConnectionMetadata | undefined,
    defaultValue: string = ''
) {
    if (!kernelConnection) {
        return defaultValue;
    }
    return kernelConnection.kind === 'connectToLiveKernel'
        ? kernelConnection.kernelModel.name
        : kernelConnection.kernelSpec?.name;
}

export function getKernelPathFromKernelConnection(kernelConnection?: KernelConnectionMetadata): string | undefined {
    if (!kernelConnection) {
        return;
    }
    const model = kernelConnectionMetadataHasKernelModel(kernelConnection) ? kernelConnection.kernelModel : undefined;
    const kernelSpec = kernelConnectionMetadataHasKernelSpec(kernelConnection)
        ? kernelConnection.kernelSpec
        : undefined;
    return model?.path || kernelSpec?.metadata?.interpreter?.path || kernelSpec?.interpreterPath || kernelSpec?.path;
}

export function getDescriptionOfKernelConnection(
    kernelConnection: KernelConnectionMetadata | undefined,
    defaultValue: string = ''
): string {
    if (kernelConnection?.kind === 'connectToLiveKernel') {
        return DataScience.jupyterSelectURIRunningDetailFormat().format(
            kernelConnection.kernelModel.lastActivityTime.toLocaleString(),
            kernelConnection.kernelModel.numberOfConnections.toString()
        );
    }
    return defaultValue;
}

export function getDetailOfKernelConnection(
    kernelConnection: KernelConnectionMetadata | undefined,
    pathUtils: IPathUtils,
    defaultValue: string = ''
): string {
    const kernelPath = getKernelPathFromKernelConnection(kernelConnection);
    const notebookPath =
        kernelConnection?.kind === 'connectToLiveKernel' ? `(${kernelConnection.kernelModel.session.path})` : '';
    return `${kernelPath ? pathUtils.getDisplayName(kernelPath) : defaultValue} ${notebookPath}`;
}

export function getInterpreterFromKernelConnectionMetadata(
    kernelConnection?: KernelConnectionMetadata
): Partial<PythonEnvironment> | undefined {
    if (!kernelConnection) {
        return;
    }
    if (kernelConnection.interpreter) {
        return kernelConnection.interpreter;
    }
    const model = kernelConnectionMetadataHasKernelModel(kernelConnection) ? kernelConnection.kernelModel : undefined;
    if (model?.metadata?.interpreter) {
        return model.metadata.interpreter;
    }
    const kernelSpec = kernelConnectionMetadataHasKernelSpec(kernelConnection)
        ? kernelConnection.kernelSpec
        : undefined;
    return kernelSpec?.metadata?.interpreter;
}
export function isPythonKernelConnection(kernelConnection?: KernelConnectionMetadata): boolean {
    if (!kernelConnection) {
        return false;
    }
    if (kernelConnection.kind === 'startUsingPythonInterpreter') {
        return true;
    }
    const model = kernelConnectionMetadataHasKernelModel(kernelConnection) ? kernelConnection.kernelModel : undefined;
    const kernelSpec = kernelConnectionMetadataHasKernelSpec(kernelConnection)
        ? kernelConnection.kernelSpec
        : undefined;
    return model?.language === PYTHON_LANGUAGE || isPythonKernelSpec(kernelSpec);
}
function isPythonKernelSpec(kernelSpec?: IJupyterKernelSpec): boolean {
    const language = (kernelSpec?.language || '').toLowerCase();
    return language === PYTHON_LANGUAGE;
}
export function getKernelConnectionLanguage(kernelConnection?: KernelConnectionMetadata): string | undefined {
    if (!kernelConnection) {
        return;
    }
    // Language is python when starting with Python Interpreter
    if (kernelConnection.kind === 'startUsingPythonInterpreter') {
        return PYTHON_LANGUAGE;
    }

    const model = kernelConnectionMetadataHasKernelModel(kernelConnection) ? kernelConnection.kernelModel : undefined;
    const kernelSpec = kernelConnectionMetadataHasKernelSpec(kernelConnection)
        ? kernelConnection.kernelSpec
        : undefined;
    return model?.language || kernelSpec?.language;
}
export function getLanguageInNotebookMetadata(metadata?: nbformat.INotebookMetadata): string | undefined {
    if (!metadata) {
        return;
    }
    // If kernel spec is defined & we have a language in that, then use that information.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const kernelSpec: IJupyterKernelSpec | undefined = metadata.kernelspec as any;
    // When a kernel spec is stored in ipynb, the `language` of the kernel spec is also saved.
    // Unfortunately there's no strong typing for this.
    if (kernelSpec?.language) {
        return kernelSpec.language;
    }
    return metadata.language_info?.name;
}

/**
 * All kernel specs generated/registered/saved & saved by this extension will have this in the name.
 * This helps us easily identify such kernels.
 * WARNING: Never change this, this is stored in ipynb & kernelspec.json.
 */
const autoGeneratedKernelNameIdentifier = 'jvsc74a57bd0';
/**
 * The name generated here is tied to the interpreter & is predictable.
 */
export function getInterpreterKernelSpecName(interpreter?: PythonEnvironment): string {
    // Generate a name from a hash of the interpreter
    // Note it must be prefixed with 'python' and the version number.
    const version = interpreter?.sysVersion ? getTelemetrySafeVersion(interpreter.sysVersion) || '3' : '';
    const versionWithSafeStrings = version.replace(/\./g, '');
    const prefix = interpreter ? `python${versionWithSafeStrings}` : '';
    return interpreter ? `${prefix}${autoGeneratedKernelNameIdentifier}${getInterpreterHash(interpreter)}` : 'python3';
}
/**
 * Whether this is a kernel spec that was generated by the us (Jupyter extension).
 * @returns {('oldVersion' | 'newVersion' | undefined)}
 * `undefined`  - Not generated by us.
 * `oldVersion` - In older versions we used to register kernels with a name that contained a Guid.
 * `newVersion` - In later (current) versions we register kernels with a name that's a combination of  interpreter version + hash of interpreter path.
 */
export function isKernelRegisteredByUs(kernelSpec: IJupyterKernelSpec): 'oldVersion' | 'newVersion' | undefined {
    // Check if this is a kernel we registered in the old days.
    // If it is, then no need to display that (selecting kernels registered is done by selecting the corresponding interpreter).
    // Hence we can hide such kernels.
    // Kernels we create will end with a uuid (with - stripped), & will have interpreter info in the metadata.
    // Only do this for raw kernel scenarios
    const guidRegEx = /[a-f0-9]{32}$/;
    if (kernelSpec.metadata?.interpreter && kernelSpec.name.toLowerCase().search(guidRegEx)) {
        return 'oldVersion';
    }
    return kernelSpec.name.includes(autoGeneratedKernelNameIdentifier) ? 'newVersion' : undefined;
}

// Create a default kernelspec with the given display name
export function createInterpreterKernelSpec(
    interpreter?: PythonEnvironment,
    rootKernelFilePath?: string
): IJupyterKernelSpec {
    // This creates a kernel spec for an interpreter. When launched, 'python' argument will map to using the interpreter
    // associated with the current resource for launching.
    const defaultSpec: Kernel.ISpecModel = {
        name: getInterpreterKernelSpecName(interpreter),
        language: 'python',
        display_name: interpreter?.displayName || 'Python 3',
        metadata: {
            interpreter
        },
        argv: ['python', '-m', 'ipykernel_launcher', '-f', connectionFilePlaceholder],
        env: {},
        resources: {}
    };

    // Generate spec file path if we know where kernel files will go
    const specFile =
        rootKernelFilePath && defaultSpec.name
            ? path.join(rootKernelFilePath, defaultSpec.name, 'kernel.json')
            : undefined;

    return new JupyterKernelSpec(defaultSpec, specFile, interpreter?.path);
}

export function areKernelConnectionsEqual(
    connection1?: KernelConnectionMetadata,
    connection2?: KernelConnectionMetadata
) {
    if (!connection1 && !connection2) {
        return true;
    }
    if (!connection1 && connection2) {
        return false;
    }
    if (connection1 && !connection2) {
        return false;
    }
    return connection1?.id === connection2?.id;
}
// Check if a name is a default python kernel name and pull the version
export function detectDefaultKernelName(name: string) {
    const regEx = NamedRegexp('python\\s*(?<version>(\\d+))', 'g');
    return regEx.exec(name.toLowerCase());
}

export function cleanEnvironment<T>(spec: T): T {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const copy = cloneDeep(spec) as { env?: any };

    if (copy.env) {
        // Scrub the environment of the spec to make sure it has allowed values (they all must be strings)
        // See this issue here: https://github.com/microsoft/vscode-python/issues/11749
        const keys = Object.keys(copy.env);
        keys.forEach((k) => {
            if (copy.env) {
                const value = copy.env[k];
                if (value !== null && value !== undefined) {
                    copy.env[k] = value.toString();
                }
            }
        });
    }

    return copy as T;
}

export function isLocalLaunch(configuration: IConfigurationService) {
    const settings = configuration.getSettings(undefined);
    const serverType: string | undefined = settings.jupyterServerType;

    if (!serverType || serverType.toLowerCase() === Settings.JupyterServerLocalLaunch) {
        return true;
    }

    return false;
}

export function findPreferredKernel(
    kernels: KernelConnectionMetadata[],
    resource: Resource,
    languages: string[],
    notebookMetadata: nbformat.INotebookMetadata | undefined,
    preferredInterpreter: PythonEnvironment | undefined,
    remoteKernelPreferredProvider: PreferredRemoteKernelIdProvider | undefined
): KernelConnectionMetadata | undefined {
    let index = -1;

    // First try remote
    if (index < 0 && resource && remoteKernelPreferredProvider) {
        const preferredKernelId = remoteKernelPreferredProvider.getPreferredRemoteKernelId(resource);
        if (preferredKernelId) {
            // Find the kernel that matches
            index = kernels.findIndex(
                (k) => k.kind === 'connectToLiveKernel' && k.kernelModel.id === preferredKernelId
            );
        }
    }

    // If this is an interactive window & we don't have metadata, then just return the preferred interpreter.
    if (!notebookMetadata && getResourceType(resource) === 'interactive' && preferredInterpreter) {
        //  Find kernel that matches the preferred interpreter.
        const kernelMatchingPreferredInterpreter = kernels.find(
            (kernel) =>
                kernel.kind === 'startUsingPythonInterpreter' && kernel.interpreter.path === preferredInterpreter.path
        );
        if (kernelMatchingPreferredInterpreter) {
            return kernelMatchingPreferredInterpreter;
        }
    }

    // If still not found, look for a match based on notebook metadata and interpreter
    if (index < 0) {
        const hasLanguageInfo = notebookMetadata?.language_info?.name ? true : false;
        const nbMetadataLanguage =
            !notebookMetadata || isPythonNotebook(notebookMetadata) || !hasLanguageInfo
                ? PYTHON_LANGUAGE
                : (
                      (notebookMetadata?.kernelspec?.language as string) || notebookMetadata?.language_info?.name
                  )?.toLowerCase();
        let bestScore = -1;
        for (let i = 0; kernels && i < kernels?.length; i = i + 1) {
            const metadata = kernels[i];
            const spec = metadata.kind !== 'connectToLiveKernel' ? metadata.kernelSpec : undefined;
            const speclanguage = getKernelConnectionLanguage(metadata);
            let score = -1;

            if (spec) {
                // Check if the kernel spec name matches the hash of the generated kernel spec name.
                if (
                    !notebookMetadata && // If we don't have metadata, only then should we compare against the interpreter.
                    isKernelRegisteredByUs(spec) === 'newVersion' &&
                    isPythonKernelSpec(spec) &&
                    preferredInterpreter &&
                    spec.name === getInterpreterKernelSpecName(preferredInterpreter)
                ) {
                    // This is a perfect match.
                    score += 100;
                }

                // See if the path matches.
                if (
                    spec &&
                    spec.path &&
                    spec.path.length > 0 &&
                    preferredInterpreter &&
                    spec.path === preferredInterpreter.path &&
                    nbMetadataLanguage === PYTHON_LANGUAGE
                ) {
                    // Path match. This is worth more if no notebook metadata as that should
                    // match first.
                    score += notebookMetadata ? 1 : 8;
                }

                // See if the version is the same
                if (
                    preferredInterpreter &&
                    preferredInterpreter.version &&
                    spec &&
                    spec.name &&
                    nbMetadataLanguage === PYTHON_LANGUAGE
                ) {
                    // Search for a digit on the end of the name. It should match our major version
                    const match = /\D+(\d+)/.exec(spec.name);
                    if (match && match !== null && match.length > 0) {
                        // See if the version number matches
                        const nameVersion = parseInt(match[1][0], 10);
                        if (nameVersion && nameVersion === preferredInterpreter.version.major) {
                            score += 4;
                        }
                    }
                }

                // See if the display name already matches.
                if (spec.display_name && spec.display_name === notebookMetadata?.kernelspec?.display_name) {
                    score += 16;
                }

                // See if interpreter should be tried instead.
                if (
                    spec.display_name &&
                    spec.display_name === preferredInterpreter?.displayName &&
                    !notebookMetadata?.kernelspec?.display_name &&
                    nbMetadataLanguage === PYTHON_LANGUAGE
                ) {
                    score += 10;
                }

                // Find a kernel spec that matches the language in the notebook metadata.
                if (score <= 0 && speclanguage === (nbMetadataLanguage || '')) {
                    score = 1;
                }
            }

            // Trace score for kernel
            traceInfo(`findPreferredKernel score for ${getDisplayNameOrNameOfKernelConnection(metadata)} is ${score}`);

            if (score > bestScore) {
                index = i;
                bestScore = score;
            }
        }
    }

    // If still not found, try languages
    if (index < 0) {
        index = kernels.findIndex((kernelSpecConnection) => {
            if (kernelSpecConnection.kind === 'startUsingKernelSpec') {
                return languages.find((l) => l === kernelSpecConnection.kernelSpec.language);
            } else if (kernelSpecConnection.kind === 'connectToLiveKernel') {
                return languages.find((l) => l === kernelSpecConnection.kernelModel.language);
            } else {
                return false;
            }
        });
    }
    return index >= 0 ? kernels[index] : undefined;
}

export async function sendTelemetryForPythonKernelExecutable(
    notebook: INotebook,
    file: string,
    kernelConnection: KernelConnectionMetadata
) {
    if (!kernelConnection.interpreter || !isPythonKernelConnection(kernelConnection)) {
        return;
    }
    if (kernelConnection.kind !== 'startUsingKernelSpec' && kernelConnection.kind !== 'startUsingPythonInterpreter') {
        return;
    }
    try {
        traceInfoIf(IS_CI_SERVER, 'Begin sendTelemetryForPythonKernelExecutable');
        const cells = await notebook.execute('import sys\nprint(sys.executable)', file, 0, uuid(), undefined, true);
        if (cells.length === 0 || !Array.isArray(cells[0].data.outputs) || cells[0].data.outputs.length === 0) {
            return;
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const output: nbformat.IStream = cells[0].data.outputs[0] as any;
        if (output.name !== 'stdout' && output.output_type !== 'stream') {
            return;
        }
        const sysExecutable = concatMultilineString(output.text).trim().toLowerCase();
        const match = kernelConnection.interpreter.path.toLowerCase() === sysExecutable;
        sendTelemetryEvent(Telemetry.PythonKerneExecutableMatches, undefined, {
            match: match ? 'true' : 'false',
            kernelConnectionType: kernelConnection.kind
        });
        trackKernelResourceInformation(Uri.file(file), { interpreterMatchesKernel: match });
    } catch (ex) {
        // Noop.
    }
    traceInfoIf(IS_CI_SERVER, 'End sendTelemetryForPythonKernelExecutable');
}
