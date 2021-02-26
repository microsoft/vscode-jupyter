// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';

import type { Kernel } from '@jupyterlab/services';
import * as fastDeepEqual from 'fast-deep-equal';
import { IJupyterKernelSpec } from '../../types';
import { JupyterKernelSpec } from './jupyterKernelSpec';
// eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
const NamedRegexp = require('named-js-regexp') as typeof import('named-js-regexp');
import { nbformat } from '@jupyterlab/coreutils';
// eslint-disable-next-line @typescript-eslint/no-require-imports
import cloneDeep = require('lodash/cloneDeep');
import { PYTHON_LANGUAGE } from '../../../common/constants';
import { IConfigurationService, ReadWrite, Resource } from '../../../common/types';
import { PythonEnvironment } from '../../../pythonEnvironments/info';
import {
    DefaultKernelConnectionMetadata,
    KernelConnectionMetadata,
    KernelSpecConnectionMetadata,
    LiveKernelConnectionMetadata,
    LiveKernelModel,
    PythonKernelConnectionMetadata
} from './types';
import { Settings } from '../../constants';
import { PreferredRemoteKernelIdProvider } from '../../notebookStorage/preferredRemoteKernelIdProvider';
import { isPythonNotebook } from '../../notebook/helpers/helpers';
import { sha256 } from 'hash.js';

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
    return model?.path || kernelSpec?.path;
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
    return model?.language === PYTHON_LANGUAGE || kernelSpec?.language === PYTHON_LANGUAGE;
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

export function getInterpreterKernelSpecName(interpreter?: PythonEnvironment): string {
    // Generate a name from a hash of the interpreter name and path
    return interpreter ? sha256().update(`${interpreter.path}${interpreter.displayName}`).digest('hex') : 'python3';
}

// Create a default kernelspec with the given display name
export function createIntepreterKernelSpec(interpreter?: PythonEnvironment): IJupyterKernelSpec {
    // This creates a kernel spec for an interpreter. When launched, 'python' argument will map to using the interpreter
    // associated with the current resource for launching.
    const defaultSpec: Kernel.ISpecModel = {
        name: getInterpreterKernelSpecName(interpreter),
        language: 'python',
        display_name: interpreter?.displayName || 'Python 3',
        metadata: {},
        argv: ['python', '-m', 'ipykernel_launcher', '-f', connectionFilePlaceholder],
        env: {},
        resources: {}
    };

    return new JupyterKernelSpec(defaultSpec, undefined, interpreter?.path);
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
    if (connection1?.kind !== connection2?.kind) {
        return false;
    }
    if (connection1?.kind === 'connectToLiveKernel' && connection2?.kind === 'connectToLiveKernel') {
        return areKernelModelsEqual(connection1.kernelModel, connection2.kernelModel);
    } else if (
        connection1 &&
        connection1.kind !== 'connectToLiveKernel' &&
        connection2 &&
        connection2.kind !== 'connectToLiveKernel'
    ) {
        const kernelSpecsAreTheSame = areKernelSpecsEqual(connection1?.kernelSpec, connection2?.kernelSpec);
        // If both are launching interpreters, compare interpreter paths.
        const interpretersAreSame =
            connection1.kind === 'startUsingPythonInterpreter'
                ? connection1.interpreter.path === connection2.interpreter?.path
                : true;

        return kernelSpecsAreTheSame && interpretersAreSame;
    }
    return false;
}
function areKernelSpecsEqual(kernelSpec1?: IJupyterKernelSpec, kernelSpec2?: IJupyterKernelSpec) {
    if (kernelSpec1 && kernelSpec2) {
        const spec1 = cloneDeep(kernelSpec1) as ReadWrite<IJupyterKernelSpec>;
        spec1.env = spec1.env || {};
        spec1.metadata = spec1.metadata || {};
        const spec2 = cloneDeep(kernelSpec2) as ReadWrite<IJupyterKernelSpec>;
        spec2.env = spec1.env || {};
        spec2.metadata = spec1.metadata || {};

        return fastDeepEqual(spec1, spec2);
    } else if (!kernelSpec1 && !kernelSpec2) {
        return true;
    } else {
        return false;
    }
}
function areKernelModelsEqual(kernelModel1?: LiveKernelModel, kernelModel2?: LiveKernelModel) {
    if (kernelModel1 && kernelModel2) {
        // When comparing kernel models, just compare the id. nothing else matters.
        if (typeof kernelModel1.id === 'string' || typeof kernelModel2.id === 'string') {
            return kernelModel1.id === kernelModel2.id;
        }
        // If we don't have ids, then compare the rest of the data (backwards compatibility).
        const model1 = cloneDeep(kernelModel1) as ReadWrite<LiveKernelModel>;
        model1.env = model1.env || {};
        model1.metadata = model1.metadata || {};
        const model2 = cloneDeep(kernelModel2) as ReadWrite<LiveKernelModel>;
        model2.env = model1.env || {};
        model2.metadata = model1.metadata || {};
        return fastDeepEqual(model1, model2);
    } else if (!kernelModel1 && !kernelModel2) {
        return true;
    } else {
        return false;
    }
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

export function findPreferredKernelIndex(
    kernels: KernelConnectionMetadata[],
    resource: Resource,
    languages: string[],
    notebookMetadata: nbformat.INotebookMetadata | undefined,
    interpreter: PythonEnvironment | undefined,
    remoteKernelPreferredProvider: PreferredRemoteKernelIdProvider | undefined
) {
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

    // If still not found, look for a match based on notebook metadata and interpreter
    if (index < 0 && (notebookMetadata || interpreter)) {
        let bestScore = -1;
        for (let i = 0; kernels && i < kernels?.length; i = i + 1) {
            const metadata = kernels[i];
            const spec = metadata.kind !== 'connectToLiveKernel' ? metadata.kernelSpec : undefined;
            let score = 0;

            if (spec) {
                // See if the path matches.
                if (spec && spec.path && spec.path.length > 0 && interpreter && spec.path === interpreter.path) {
                    // Path match
                    score += 8;
                }

                // See if the version is the same
                if (interpreter && interpreter.version && spec && spec.name) {
                    // Search for a digit on the end of the name. It should match our major version
                    const match = /\D+(\d+)/.exec(spec.name);
                    if (match && match !== null && match.length > 0) {
                        // See if the version number matches
                        const nameVersion = parseInt(match[1][0], 10);
                        if (nameVersion && nameVersion === interpreter.version.major) {
                            score += 4;
                        }
                    }
                }

                // See if the display name already matches.
                if (spec.display_name && spec.display_name === notebookMetadata?.kernelspec?.display_name) {
                    score += 16;
                }
                if (spec.display_name && spec.display_name === interpreter?.displayName) {
                    score += 10;
                }

                // Find a kernel spec that matches the language in the notebook metadata.
                const nbMetadataLanguage = isPythonNotebook(notebookMetadata)
                    ? PYTHON_LANGUAGE
                    : (notebookMetadata?.kernelspec?.language as string) || notebookMetadata?.language_info?.name;
                if (score === 0 && spec.language?.toLowerCase() === (nbMetadataLanguage || '').toLowerCase()) {
                    score = 1;
                }
            }

            if (score > bestScore) {
                index = i;
                bestScore = score;
            }
        }
    }

    // If still not found, try languages
    if (index < 0) {
        index = kernels.findIndex((k) => {
            const kernelSpecConnection = k;
            if (kernelSpecConnection.kind === 'startUsingKernelSpec') {
                return languages.find((l) => l === kernelSpecConnection.kernelSpec.language);
            } else if (kernelSpecConnection.kind === 'connectToLiveKernel') {
                return languages.find((l) => l === kernelSpecConnection.kernelModel.language);
            } else {
                return false;
            }
        });
    }
    return index;
}
