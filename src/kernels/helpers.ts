/* eslint-disable @typescript-eslint/no-explicit-any */
// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';

import * as path from 'path';
import type { KernelSpec } from '@jupyterlab/services';
// eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
const NamedRegexp = require('named-js-regexp') as typeof import('named-js-regexp');
import * as nbformat from '@jupyterlab/nbformat';
// eslint-disable-next-line @typescript-eslint/no-require-imports
import cloneDeep = require('lodash/cloneDeep');
import {
    IKernel,
    KernelConnectionMetadata,
    LocalKernelSpecConnectionMetadata,
    LiveKernelConnectionMetadata,
    PythonKernelConnectionMetadata,
    IKernelProvider,
    isLocalConnection
} from './types';
import { Uri, Memento, NotebookDocument } from 'vscode';
import {
    IWorkspaceService,
    ICommandManager,
    IVSCodeNotebook,
    IApplicationShell
} from '../client/common/application/types';
import { PYTHON_LANGUAGE, isCI } from '../client/common/constants';
import { traceError, traceInfo, traceInfoIfCI, traceVerbose, traceWarning } from '../client/common/logger';
import { getDisplayPath } from '../client/common/platform/fs-paths';
import { IPythonExecutionFactory } from '../client/common/process/types';
import { IPathUtils, IConfigurationService, Resource, IMemento, GLOBAL_MEMENTO } from '../client/common/types';
import { createDeferred, createDeferredFromPromise, Deferred } from '../client/common/utils/async';
import { DataScience } from '../client/common/utils/localize';
import { getResourceType } from '../client/datascience/common';
import { Settings } from '../client/datascience/constants';
import { SysInfoReason } from '../extension/messageTypes';
import { trackKernelResourceInformation, sendKernelTelemetryEvent } from '../client/datascience/telemetry/telemetry';
import {
    IJupyterSession,
    IInteractiveWindowProvider,
    IStatusProvider,
    IDataScienceErrorHandler,
    IRawNotebookProvider,
    KernelInterpreterDependencyResponse,
    IJupyterKernelSpec,
    IDisplayOptions
} from '../client/datascience/types';
import { IServiceContainer } from '../client/ioc/types';
import {
    getNormalizedInterpreterPath,
    getInterpreterHash,
    areInterpreterPathsSame
} from '../client/pythonEnvironments/info/interpreter';
import { sendTelemetryEvent } from '../client/telemetry';
import { getTelemetrySafeVersion } from '../client/telemetry/helpers';
import { concatMultilineString } from '../datascience-ui/common';
import { Telemetry, Commands } from '../datascience-ui/common/constants';
import { clearInstalledIntoInterpreterMemento } from './installer/productInstaller';
import { Product } from './installer/types';
import { JupyterKernelSpec } from './jupyter/jupyterKernelSpec';
import { removeNotebookSuffixAddedByExtension } from './jupyter/session/jupyterSession';
import { SilentExecutionErrorOptions } from './kernel';
import {
    isDefaultKernelSpec,
    isDefaultPythonKernelSpecName
} from './raw/finder/localPythonAndRelatedNonPythonKernelSpecFinder';
import { EnvironmentType, PythonEnvironment } from '../client/pythonEnvironments/info';
import { VSCodeNotebookController } from '../notebooks/controllers/vscodeNotebookController';
import { isPythonNotebook } from '../notebooks/helpers';
import { INotebookControllerManager } from '../notebooks/types';
import { PreferredRemoteKernelIdProvider } from './raw/finder/preferredRemoteKernelIdProvider';
import { findNotebookEditor, selectKernel } from '../notebooks/controllers/kernelSelector';
import { DisplayOptions } from '../client/datascience/displayOptions';
import { KernelDeadError } from '../extension/errors/kernelDeadError';

// Helper functions for dealing with kernels and kernelspecs

// https://jupyter-client.readthedocs.io/en/stable/kernels.html
export const connectionFilePlaceholder = '{connection_file}';

// Find the index of the connection file placeholder in a kernelspec
export function findIndexOfConnectionFile(kernelSpec: Readonly<IJupyterKernelSpec>): number {
    return kernelSpec.argv.findIndex((arg) => arg.includes(connectionFilePlaceholder));
}

type ConnectionWithKernelSpec = LocalKernelSpecConnectionMetadata | PythonKernelConnectionMetadata;
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
export function getKernelId(spec: IJupyterKernelSpec, interpreter?: PythonEnvironment, remoteBaseUrl?: string) {
    // Non-Python kernels cannot contain an interpreter (even in their id).
    interpreter = isPythonKernelSpec(spec) ? interpreter : undefined;
    // Do not include things like display names, as they aren't unique & can change over time.
    // if the spec name is generated by us, then exclude the leading bit (as it can contain version numbers).
    // & sometimes the kernelspec might not have the version number (if it wasn't available at the time of generation of spec)
    // See getInterpreterKernelSpecName for details of this logic.
    let specName = spec.name;
    const kernelRegistrationKind = getKernelRegistrationInfo(spec);
    // eslint-disable-next-line @typescript-eslint/no-use-before-define
    if (kernelRegistrationKind && specName.includes(autoGeneratedKernelNameIdentifier)) {
        // eslint-disable-next-line @typescript-eslint/no-use-before-define
        specName = specName.substring(specName.indexOf(autoGeneratedKernelNameIdentifier));
        // When users create kernelspecs, we need to include the name of custom kernelspecs in the id.
        if (kernelRegistrationKind === 'registeredByNewVersionOfExtForCustomKernelSpec') {
            const originalSpecFile = spec.metadata?.vscode?.originalSpecFile || spec.metadata?.originalSpecFile;
            if (originalSpecFile) {
                specName = `${specName}#${path.basename(path.dirname(originalSpecFile))}`;
            }
        }
    }
    // The arguments in the spec can be different for multiple kernel specs pointing to the same interpreter.
    // E.g. we can have pyspark kernels with `"-m", "sparkmagic.kernels.pysparkkernel.pysparkkernel",`
    // & another with "-m","jupyter_nb_ext.kernels.synapse_pyspark.kernel"
    let argsForGenerationOfId = '';
    if (isPythonKernelSpec(spec)) {
        // Ignore the first argument (its the python path).
        // Ignore the common bits such as `-f` & `connection_file`
        argsForGenerationOfId = spec.argv
            .slice(1)
            .filter((item) => !['-f', '{connection_file}'].includes(item))
            .join('#')
            .toLowerCase();
    } else {
        // Lets not assume that non-python kernels cannot have such issues
        argsForGenerationOfId = spec.argv.join('#').toLowerCase();
    }
    const prefixForRemoteKernels = remoteBaseUrl ? `${remoteBaseUrl}.` : '';
    return `${prefixForRemoteKernels}${spec.id || ''}.${specName}.${getNormalizedInterpreterPath(
        spec.interpreterPath || spec.path
    )}.${getNormalizedInterpreterPath(interpreter?.path) || ''}.${argsForGenerationOfId}`;
}

export function getSysInfoReasonHeader(
    reason: SysInfoReason,
    connection: KernelConnectionMetadata | undefined
): string {
    const displayName = getDisplayNameOrNameOfKernelConnection(connection);
    switch (reason) {
        case SysInfoReason.Start:
        case SysInfoReason.New:
            return DataScience.startedNewKernelHeader().format(displayName);
        case SysInfoReason.Restart:
            return DataScience.restartedKernelHeader().format(displayName);
        case SysInfoReason.Interrupt:
            return DataScience.pythonInterruptFailedHeader();
        case SysInfoReason.Connect:
            return DataScience.connectKernelHeader().format(displayName);
        default:
            traceError('Invalid SysInfoReason');
            return '';
    }
}

export function getDisplayNameOrNameOfKernelConnection(kernelConnection: KernelConnectionMetadata | undefined) {
    const oldDisplayName = getOldFormatDisplayNameOrNameOfKernelConnection(kernelConnection);
    if (!kernelConnection) {
        return oldDisplayName;
    }
    switch (kernelConnection.kind) {
        case 'connectToLiveKernel': {
            const notebookPath = removeNotebookSuffixAddedByExtension(
                kernelConnection.kernelModel?.notebook?.path || kernelConnection.kernelModel?.model?.path || ''
            );
            return notebookPath ? `${oldDisplayName} (${notebookPath})` : oldDisplayName;
        }
        case 'startUsingRemoteKernelSpec':
        case 'startUsingLocalKernelSpec': {
            if (
                kernelConnection.interpreter?.envType &&
                kernelConnection.interpreter.envType !== EnvironmentType.Global
            ) {
                if (kernelConnection.kernelSpec.language === PYTHON_LANGUAGE) {
                    const pythonVersion = `Python ${
                        getTelemetrySafeVersion(kernelConnection.interpreter.version?.raw || '') || ''
                    }`.trim();
                    return kernelConnection.interpreter.envName
                        ? `${oldDisplayName} (${pythonVersion})`
                        : oldDisplayName;
                } else {
                    // Non-Python kernelspec that launches via python interpreter
                    return kernelConnection.interpreter.envName
                        ? `${oldDisplayName} (${kernelConnection.interpreter.envName})`
                        : oldDisplayName;
                }
            } else {
                return oldDisplayName;
            }
        }
        case 'startUsingPythonInterpreter':
            if (
                kernelConnection.interpreter.envType &&
                kernelConnection.interpreter.envType !== EnvironmentType.Global
            ) {
                const pythonVersion = `Python ${
                    getTelemetrySafeVersion(kernelConnection.interpreter.version?.raw || '') || ''
                }`.trim();
                // If user has created a custom kernelspec, then use that.
                if (
                    kernelConnection.kernelSpec.display_name &&
                    getKernelRegistrationInfo(kernelConnection.kernelSpec) ===
                        'registeredByNewVersionOfExtForCustomKernelSpec'
                ) {
                    return kernelConnection.kernelSpec.display_name;
                }
                const pythonDisplayName = pythonVersion.trim();
                return kernelConnection.interpreter.envName
                    ? `${kernelConnection.interpreter.envName} (${pythonDisplayName})`
                    : pythonDisplayName;
            }
    }
    return oldDisplayName;
}
function getOldFormatDisplayNameOrNameOfKernelConnection(kernelConnection: KernelConnectionMetadata | undefined) {
    if (!kernelConnection) {
        return '';
    }
    const displayName =
        kernelConnection.kind === 'connectToLiveKernel'
            ? kernelConnection.kernelModel.display_name
            : kernelConnection.kernelSpec?.display_name;
    const name =
        kernelConnection.kind === 'connectToLiveKernel'
            ? kernelConnection.kernelModel.name
            : kernelConnection.kernelSpec?.name;

    const interpreterName =
        kernelConnection.kind === 'startUsingPythonInterpreter' ? kernelConnection.interpreter.displayName : undefined;

    return displayName || name || interpreterName || '';
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
    if (
        kernelConnection.kind === 'startUsingPythonInterpreter' ||
        ((kernelConnection.kind === 'startUsingRemoteKernelSpec' ||
            kernelConnection.kind === 'startUsingLocalKernelSpec') &&
            kernelConnection.kernelSpec.language === PYTHON_LANGUAGE)
    ) {
        return kernelSpec?.metadata?.interpreter?.path || kernelSpec?.interpreterPath || kernelSpec?.path;
    } else {
        // For non python kernels, give preference to the executable path in the kernelspec
        // E.g. if we have a rust kernel, we should show the path to the rust executable not the interpreter (such as conda env that owns the rust runtime).
        return (
            model?.path || kernelSpec?.path || kernelSpec?.metadata?.interpreter?.path || kernelSpec?.interpreterPath
        );
    }
}

export function getRemoteKernelSessionInformation(
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

export function getKernelConnectionPath(
    kernelConnection: KernelConnectionMetadata | undefined,
    pathUtils: IPathUtils,
    workspaceService: IWorkspaceService
) {
    if (kernelConnection?.kind === 'connectToLiveKernel') {
        return undefined;
    }
    const kernelPath = getKernelPathFromKernelConnection(kernelConnection);
    // If we have just one workspace folder opened, then ensure to use relative paths
    // where possible (e.g. for virtual environments).
    const cwd =
        workspaceService.workspaceFolders?.length === 1 ? workspaceService.workspaceFolders[0].uri.fsPath : undefined;
    return kernelPath ? pathUtils.getDisplayName(kernelPath, cwd) : '';
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
export function isPythonKernelSpec(kernelSpec?: IJupyterKernelSpec): boolean {
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
    return model?.language || getLanguageInKernelSpec(kernelSpec);
}
export function getLanguageInNotebookMetadata(metadata?: nbformat.INotebookMetadata): string | undefined {
    if (!metadata) {
        return;
    }
    // If kernel spec is defined & we have a language in that, then use that information.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const kernelSpec: IJupyterKernelSpec | undefined = metadata.kernelspec as any;
    return getLanguageInKernelSpec(kernelSpec) || metadata.language_info?.name;
}
export function getLanguageInKernelSpec(kernelSpec?: IJupyterKernelSpec | undefined): string | undefined {
    // When a kernel spec is stored in ipynb, the `language` of the kernel spec is also saved.
    // Unfortunately there's no strong typing for this.
    return kernelSpec?.language;
}

/**
 * All kernel specs generated/registered/saved & saved by this extension will have this in the name.
 * This helps us easily identify such kernels.
 * WARNING: Never change this, this is stored in ipynb & kernelspec.json.
 */
const autoGeneratedKernelNameIdentifier = 'jvsc74a57bd0';
/**
 * The name generated here is tied to the interpreter & is predictable.
 * WARNING: Changes to this will impact `getKernelId()`
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
 * Returns the workspace folder this interpreter is based in or the root if not a virtual env
 */
export function getInterpreterWorkspaceFolder(
    interpreter: PythonEnvironment,
    workspaceService: IWorkspaceService
): string | undefined {
    const folder = workspaceService.getWorkspaceFolder(Uri.file(interpreter.path));
    return folder?.uri.fsPath || workspaceService.rootPath;
}
/**
 * Gets information about the registered kernelspec.
 * Note: When dealing with non-raw kernels, we register kernelspecs in a global location.
 * Thus when users have custom kernelspecs, we re-create those kernelspecs in another location.
 * However we treat those non-user kernelspecs.
 * We need a way to differentiate between the different flavours.
 * `undefined`  - Not generated by us.
 * `registeredByOldVersionOfExt` - In older versions of the Extension we used to register kernels with a name that contained a Guid.
 * `registeredByNewVersionOfExt` - In later (current) versions we register kernels with a name that's a combination of  interpreter version + hash of interpreter path & others.
 * `registeredByNewVersionOfExtForCustomKernelSpec` - Same as the former, but this was created to map a custom kernelspec the user created in a non-global directory.
 *                              E.g. a custom kernelspec found in a Python environment (either created by user or as a result of installing some custom kernelspec).
 */
export function getKernelRegistrationInfo(
    kernelSpec: IJupyterKernelSpec
):
    | 'registeredByOldVersionOfExt'
    | 'registeredByNewVersionOfExt'
    | 'registeredByNewVersionOfExtForCustomKernelSpec'
    | undefined {
    if (kernelSpec.isRegisteredByVSC) {
        return kernelSpec.isRegisteredByVSC;
    }
    if (!kernelSpec.name) {
        return;
    }

    // The name of the original kernel can be derived from the original spec file path (directory containing the specfile).
    const originalSpecFile = kernelSpec.metadata?.vscode?.originalSpecFile || kernelSpec.metadata?.originalSpecFile;
    const originalName = originalSpecFile ? path.basename(path.dirname(originalSpecFile)) : kernelSpec.name;
    const isUserCreatedOrUserCustomizedKernelSpec = isDefaultKernelSpec({ ...kernelSpec, name: originalName })
        ? // If this is a default kernelspec, and we have env variables, then assume user modified it (effectively a user defined kernelspec).
          Object.keys(kernelSpec.env || {}).length > 0
        : // Original kernel spec file paths cannot contain the auto generated identifier.
          typeof originalSpecFile === 'string' && !originalSpecFile.includes(autoGeneratedKernelNameIdentifier);

    // Check if this is a kernel we registered in the old days.
    // If it is, then no need to display that (selecting kernels registered is done by selecting the corresponding interpreter).
    // Hence we can hide such kernels.
    // Kernels we create will end with a uuid (with - stripped), & will have interpreter info in the metadata.
    // Only do this for raw kernel scenarios
    if (kernelSpec.name.includes(autoGeneratedKernelNameIdentifier)) {
        return isUserCreatedOrUserCustomizedKernelSpec
            ? // This is a kernelspec we created to be able to load custom kernelspecs using Jupyter.
              // E.g. user creates a custom kernelspec in a Python env, Jupyter will not be able to load that.
              // We need to create a corresponding kernelspec in global location (which would be a copy of the users custom kernelspec).
              'registeredByNewVersionOfExtForCustomKernelSpec'
            : // This is a kernelspec we created to be able to load Python environments using Jupyter.
              'registeredByNewVersionOfExt';
    }
    const guidRegEx = /[a-f0-9]{32}$/;
    if (kernelSpec.metadata?.interpreter && kernelSpec.name.toLowerCase().search(guidRegEx) !== -1) {
        return 'registeredByOldVersionOfExt';
    }
    return;
}

/**
 * Create a default kernelspec with the given display name.
 */
export function createInterpreterKernelSpec(
    interpreter?: PythonEnvironment,
    rootKernelFilePath?: string
): IJupyterKernelSpec {
    // This creates a kernel spec for an interpreter. When launched, 'python' argument will map to using the interpreter
    // associated with the current resource for launching.
    const defaultSpec: KernelSpec.ISpecModel = {
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

    return new JupyterKernelSpec(defaultSpec, specFile, interpreter?.path, 'registeredByNewVersionOfExt');
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

export function getInterpreterHashInMetadata(
    notebookMetadata: nbformat.INotebookMetadata | undefined
): string | undefined {
    // If the user has kernelspec in metadata & the interpreter hash is stored in metadata, then its a perfect match.
    // This is the preferred approach https://github.com/microsoft/vscode-jupyter/issues/5612
    if (
        typeof notebookMetadata === 'object' &&
        'interpreter' in notebookMetadata &&
        (notebookMetadata as any).interpreter &&
        typeof (notebookMetadata as any).interpreter === 'object' &&
        'hash' in (notebookMetadata as any).interpreter
    ) {
        return (notebookMetadata as any).interpreter.hash;
    }
}
export function findPreferredKernel(
    kernels: KernelConnectionMetadata[],
    resource: Resource,
    notebookMetadata: nbformat.INotebookMetadata | undefined,
    preferredInterpreter: PythonEnvironment | undefined,
    remoteKernelPreferredProvider: PreferredRemoteKernelIdProvider | undefined
): KernelConnectionMetadata | undefined {
    traceInfo(
        `Find preferred kernel for ${getDisplayPath(resource)} with metadata ${JSON.stringify(
            notebookMetadata || {}
        )} & preferred interpreter ${getDisplayPath(preferredInterpreter?.path)}`
    );

    if (kernels.length === 0) {
        return;
    }

    // First try remote
    if (resource && remoteKernelPreferredProvider) {
        const preferredKernelId = remoteKernelPreferredProvider.getPreferredRemoteKernelId(resource);
        // Find the kernel that matches
        const kernel =
            preferredKernelId &&
            kernels.find((k) => k.kind === 'connectToLiveKernel' && k.kernelModel.id === preferredKernelId);
        if (kernel) {
            return kernel;
        }
    }

    const preferredInterpreterKernelSpec =
        preferredInterpreter && findKernelSpecMatchingInterpreter(preferredInterpreter, kernels);
    traceInfoIfCI(`preferredInterpreterKernelSpecIndex = ${preferredInterpreterKernelSpec?.id}`);

    if (!notebookMetadata || !notebookMetadata?.kernelspec) {
        // If we don't have metadata, then just return the preferred interpreter.
        switch (getResourceType(resource)) {
            case 'notebook':
                if (preferredInterpreterKernelSpec && !remoteKernelPreferredProvider) {
                    return preferredInterpreterKernelSpec;
                }
                break;
            default:
                if (preferredInterpreterKernelSpec) {
                    return preferredInterpreterKernelSpec;
                }
                // Telemetry to see if this happens in the real world, this should not be possible.
                sendTelemetryEvent(Telemetry.FailedToFindKernelSpecInterpreterForInteractive);
        }
    }

    notebookMetadata?.language_info?.name || (notebookMetadata?.kernelspec as undefined | IJupyterKernelSpec)?.language;
    const actualNbMetadataLanguage: string | undefined =
        notebookMetadata?.language_info?.name ||
        (notebookMetadata?.kernelspec as undefined | IJupyterKernelSpec)?.language;
    let possibleNbMetadataLanguage = actualNbMetadataLanguage;
    // Interactive window always defaults to Python kernels.
    if (getResourceType(resource) === 'interactive') {
        // TODO: Based on the resource, we should be able to find the language.
        possibleNbMetadataLanguage = PYTHON_LANGUAGE;
    } else {
        possibleNbMetadataLanguage =
            !notebookMetadata || isPythonNotebook(notebookMetadata) || !possibleNbMetadataLanguage
                ? PYTHON_LANGUAGE
                : (
                      ((notebookMetadata?.kernelspec as any)?.language as string) ||
                      notebookMetadata?.language_info?.name
                  )?.toLowerCase();
    }

    kernels.sort((a, b) =>
        compareKernels(
            resource,
            possibleNbMetadataLanguage,
            actualNbMetadataLanguage,
            notebookMetadata,
            preferredInterpreterKernelSpec,
            a,
            b
        )
    );

    let preferredKernel: KernelConnectionMetadata | undefined = kernels[kernels.length - 1];
    if (
        possibleNbMetadataLanguage &&
        possibleNbMetadataLanguage !== PYTHON_LANGUAGE &&
        !notebookMetadata?.kernelspec &&
        preferredKernel.kind !== 'connectToLiveKernel' &&
        preferredKernel.kernelSpec.language &&
        preferredKernel.kernelSpec.language !== possibleNbMetadataLanguage
    ) {
        // If we have a specific language & the preferred item is not of the same language then don't return anything.
        // Remember, all we're doing is sorting the list, just because its sorted in order of preference doesn't mean we have a match.
        preferredKernel = undefined;
    } else {
        traceInfoIfCI(isCI, `Preferred kernel is ${JSON.stringify(kernels[0])}`);
    }
    return preferredKernel;
}

export function compareKernels(
    _resource: Resource,
    possibleNbMetadataLanguage: string | undefined,
    actualNbMetadataLanguage: string | undefined,
    notebookMetadata: nbformat.INotebookMetadata | undefined,
    activeInterpreterConnection: KernelConnectionMetadata | undefined,
    a: KernelConnectionMetadata,
    b: KernelConnectionMetadata
) {
    // Do not sort live kernel connections (they are at the bottom);
    if (a.kind === b.kind && b.kind === 'connectToLiveKernel') {
        return 0;
    }
    if (a.kind === 'connectToLiveKernel') {
        return -1;
    }
    if (b.kind === 'connectToLiveKernel') {
        return 1;
    }

    if (!notebookMetadata?.kernelspec) {
        if (possibleNbMetadataLanguage) {
            if (
                possibleNbMetadataLanguage === PYTHON_LANGUAGE &&
                a.kernelSpec.language === b.kernelSpec.language &&
                a.kernelSpec.language === possibleNbMetadataLanguage
            ) {
                // Fall back to returning the active interpreter (further below).
            } else if (
                a.kernelSpec.language === b.kernelSpec.language &&
                a.kernelSpec.language === possibleNbMetadataLanguage
            ) {
                return 0;
            } else if (a.kernelSpec.language === possibleNbMetadataLanguage) {
                return 1;
            } else if (b.kernelSpec.language === possibleNbMetadataLanguage) {
                return -1;
            }
        }
        // Which ever is the default, use that.
        if (a === activeInterpreterConnection) {
            return 1;
        } else if (b === activeInterpreterConnection) {
            return -1;
        } else {
            return 0;
        }
    }

    const originalSpecFileA =
        a.kernelSpec.metadata?.vscode?.originalSpecFile || a.kernelSpec.metadata?.originalSpecFile;
    const originalSpecFileB =
        b.kernelSpec.metadata?.vscode?.originalSpecFile || b.kernelSpec.metadata?.originalSpecFile;
    const kernelSpecDisplayNameOfA =
        a.kernelSpec.metadata?.vscode?.originalDisplayName || a.kernelSpec?.display_name || '';
    const kernelSpecDisplayNameOfB =
        b.kernelSpec.metadata?.vscode?.originalDisplayName || b.kernelSpec?.display_name || '';
    const kernelSpecNameOfA = originalSpecFileA
        ? path.basename(path.dirname(originalSpecFileA))
        : a.kernelSpec?.display_name || '';
    const kernelSpecNameOfB = originalSpecFileB
        ? path.basename(path.dirname(originalSpecFileB))
        : b.kernelSpec?.display_name || '';

    // Special simple comparison algorithm for Non-Python notebooks.
    if (possibleNbMetadataLanguage && possibleNbMetadataLanguage !== PYTHON_LANGUAGE) {
        // If this isn't a python notebook, then just look at the name & display name.
        if (
            a.kernelSpec.language &&
            b.kernelSpec.language &&
            a.kernelSpec.language !== possibleNbMetadataLanguage &&
            b.kernelSpec.language !== possibleNbMetadataLanguage
        ) {
            return 0;
        } else if (
            a.kernelSpec.language === possibleNbMetadataLanguage &&
            b.kernelSpec.language !== possibleNbMetadataLanguage
        ) {
            return 1;
        } else if (
            a.kernelSpec.language !== possibleNbMetadataLanguage &&
            b.kernelSpec.language === possibleNbMetadataLanguage
        ) {
            return -1;
        } else if (
            kernelSpecNameOfA &&
            kernelSpecNameOfA === kernelSpecNameOfB &&
            kernelSpecDisplayNameOfA === kernelSpecDisplayNameOfB
        ) {
            return 0;
        } else if (
            kernelSpecNameOfA &&
            kernelSpecNameOfA === notebookMetadata.kernelspec?.name &&
            kernelSpecDisplayNameOfA === notebookMetadata.kernelspec.display_name
        ) {
            return 1;
        } else if (
            kernelSpecNameOfB &&
            kernelSpecNameOfB === notebookMetadata.kernelspec?.name &&
            kernelSpecDisplayNameOfB === notebookMetadata.kernelspec.display_name
        ) {
            return -1;
        } else if (kernelSpecNameOfA && kernelSpecNameOfA === notebookMetadata.kernelspec?.name) {
            return 1;
        } else if (kernelSpecNameOfB && kernelSpecNameOfB === notebookMetadata.kernelspec?.name) {
            return -1;
        } else if (kernelSpecDisplayNameOfA && kernelSpecDisplayNameOfA === notebookMetadata.kernelspec?.display_name) {
            return 1;
        } else if (kernelSpecDisplayNameOfB && kernelSpecDisplayNameOfB === notebookMetadata.kernelspec?.display_name) {
            return -1;
        } else if (a === activeInterpreterConnection) {
            return 1;
        } else if (b === activeInterpreterConnection) {
            return -1;
        } else {
            return 0;
        }
    }
    // Sometimes we guess the language information.
    // If notebook metadata doesn't have the language information we assume it is Python.
    // However if we have a notebook that has kernel information without language information, then we treat them as Python and end up looking for Python kernels.
    // Look for exact matches in kernelspecifications, and if found use that.
    if (!actualNbMetadataLanguage && possibleNbMetadataLanguage) {
        if (
            kernelSpecNameOfA &&
            kernelSpecDisplayNameOfA &&
            kernelSpecNameOfA !== kernelSpecNameOfB &&
            kernelSpecDisplayNameOfA !== kernelSpecDisplayNameOfB &&
            a.kind === 'startUsingLocalKernelSpec' &&
            a.kernelSpec.language !== PYTHON_LANGUAGE &&
            kernelSpecNameOfA === notebookMetadata.kernelspec.name &&
            kernelSpecDisplayNameOfA === notebookMetadata.kernelspec.display_name
        ) {
            // Prefect match.
            return 1;
        } else if (
            kernelSpecNameOfB &&
            kernelSpecDisplayNameOfB &&
            kernelSpecNameOfA !== kernelSpecNameOfB &&
            kernelSpecDisplayNameOfA !== kernelSpecDisplayNameOfB &&
            b.kind === 'startUsingLocalKernelSpec' &&
            b.kernelSpec.language !== PYTHON_LANGUAGE &&
            kernelSpecNameOfB === notebookMetadata.kernelspec.name &&
            kernelSpecDisplayNameOfB === notebookMetadata.kernelspec.display_name
        ) {
            return -1;
        }
    }

    //
    // Everything from here on end, is Python.
    //

    // Check if one of them is non-python.
    if (a.kernelSpec.language && b.kernelSpec.language) {
        if (a.kernelSpec.language === b.kernelSpec.language) {
            if (a.kernelSpec.language !== PYTHON_LANGUAGE) {
                return 0;
            }
        } else {
            return a.kernelSpec.language === PYTHON_LANGUAGE ? 1 : -1;
        }
    }

    if (notebookMetadata?.kernelspec?.name) {
        // Check if the name matches against the names in the kernelspecs.
        let result = compareKernelSpecOrEnvNames(
            a,
            b,
            kernelSpecNameOfA,
            kernelSpecNameOfB,
            notebookMetadata,
            activeInterpreterConnection
        );
        if (typeof result === 'number') {
            return result;
        }
        // At this stage when dealing with remote kernels, we cannot match without any confidence.
        // Hence give preference to local kernels over remote kernels.
        if (a.kind !== 'startUsingRemoteKernelSpec' && b.kind === 'startUsingRemoteKernelSpec') {
            return 1;
        } else if (a.kind === 'startUsingRemoteKernelSpec' && b.kind !== 'startUsingRemoteKernelSpec') {
            return -1;
        } else if (a.kind === 'startUsingRemoteKernelSpec' && b.kind === 'startUsingRemoteKernelSpec') {
            if (a === activeInterpreterConnection) {
                return 1;
            } else if (b === activeInterpreterConnection) {
                return -1;
            } else {
                return 0;
            }
        }
        // Check if the name matches against the Python Environment names.
        result = compareKernelSpecOrEnvNames(
            a,
            b,
            a.interpreter?.envName || '',
            b.interpreter?.envName || '',
            notebookMetadata,
            activeInterpreterConnection
        );
        if (typeof result === 'number') {
            return result;
        }
    }

    // However if anything is a remote connection give preference to the local connection.
    // Because with remotes, we can only best match with the names.
    // And we haven't been able to match with the names.
    if (a.kind !== 'startUsingRemoteKernelSpec' && b.kind === 'startUsingRemoteKernelSpec') {
        return 1;
    } else if (a.kind === 'startUsingRemoteKernelSpec' && b.kind !== 'startUsingRemoteKernelSpec') {
        return -1;
    } else if (a.kind === 'startUsingRemoteKernelSpec' && b.kind === 'startUsingRemoteKernelSpec') {
        return 0;
    }

    const comparisonOfDisplayNames = compareAgainstKernelDisplayNameInNotebookMetadata(a, b, notebookMetadata);
    const comparisonOfInterpreter = compareAgainstInterpreterInNotebookMetadata(a, b, notebookMetadata);

    // By now we know that the kernelspec name in notebook metadata doesn't match the names of the kernelspecs.
    // Nor does it match any of the environment names in the kernels.
    // The best we can do is try to match up against the display names & the interpreters

    if (comparisonOfDisplayNames >= 0 && comparisonOfInterpreter > 0) {
        // Kernel a is a great match for its interpreter over b.
        return 1;
    } else if (comparisonOfDisplayNames > 0 && comparisonOfInterpreter >= 0) {
        // Kernel a is a great match for its display name over b.
        return 1;
    } else if (comparisonOfDisplayNames <= 0 && comparisonOfInterpreter < 0) {
        // Kernel b is a great match for its interpreter over a.
        return -1;
    } else if (comparisonOfDisplayNames < 0 && comparisonOfInterpreter <= 0) {
        // Kernel b is a great match for its display name over a.
        return -1;
    } else if (comparisonOfDisplayNames < 0 && comparisonOfInterpreter > 0) {
        // Ambiguous case, stick to the default behavior.
        if (a === activeInterpreterConnection) {
            return 1;
        } else if (b === activeInterpreterConnection) {
            return -1;
        } else {
            return 0;
        }
    } else if (comparisonOfDisplayNames === 0 && comparisonOfInterpreter === 0) {
        // Which ever is the default, use that.
        if (a === activeInterpreterConnection) {
            return 1;
        } else if (b === activeInterpreterConnection) {
            return -1;
        }
    }

    // No idea, stick to the defaults.
    if (a === activeInterpreterConnection) {
        return 1;
    } else if (b === activeInterpreterConnection) {
        return -1;
    } else {
        return 0;
    }
}

function givePreferenceToStartingWithoutCustomKernelSpec(a: KernelConnectionMetadata, b: KernelConnectionMetadata) {
    if (a.kind === 'connectToLiveKernel' || b.kind === 'connectToLiveKernel') {
        if (a.kind !== 'connectToLiveKernel') {
            return 1;
        } else if (b.kind !== 'connectToLiveKernel') {
            return -1;
        } else {
            return 0;
        }
    }
    const kernelRegA = getKernelRegistrationInfo(a.kernelSpec);
    const kernelRegB = getKernelRegistrationInfo(b.kernelSpec);
    if (kernelRegA === kernelRegB) {
        return 0;
    }
    if (kernelRegB === 'registeredByNewVersionOfExtForCustomKernelSpec') {
        return 1;
    }
    if (kernelRegA === 'registeredByNewVersionOfExtForCustomKernelSpec') {
        return -1;
    }
    return 0;
}
function compareKernelSpecOrEnvNames(
    a: KernelConnectionMetadata,
    b: KernelConnectionMetadata,
    nameOfA: string,
    nameOfB: string,
    notebookMetadata: nbformat.INotebookMetadata | undefined,
    activeInterpreterConnection: KernelConnectionMetadata | undefined
) {
    const comparisonOfDisplayNames = compareAgainstKernelDisplayNameInNotebookMetadata(a, b, notebookMetadata);
    const comparisonOfInterpreter = compareAgainstInterpreterInNotebookMetadata(a, b, notebookMetadata);

    if (!notebookMetadata?.kernelspec?.name) {
        //
    } else if (notebookMetadata.kernelspec.name.toLowerCase().match(isDefaultPythonKernelSpecName)) {
        const kernelRegA = a.kind !== 'connectToLiveKernel' ? getKernelRegistrationInfo(a.kernelSpec) : '';
        const kernelRegB = b.kind !== 'connectToLiveKernel' ? getKernelRegistrationInfo(b.kernelSpec) : '';
        // Almost all Python kernels match kernel name `python`, `python2` or `python3`.
        // When we start kernels using Python interpreter, we store `python` or `python3` in the nb metadata.
        // Thus it could match any kernel.
        // In such cases we default back to the active interpreter.
        // An exception to this is, if we have a display name or interpreter.hash that could match a kernel.
        const majorVersion = parseInt(notebookMetadata.kernelspec.name.toLowerCase().replace('python', ''), 10);
        if (
            majorVersion &&
            a.interpreter?.version?.major === b.interpreter?.version?.major &&
            a.kind === b.kind &&
            comparisonOfDisplayNames === 0 &&
            comparisonOfInterpreter === 0
        ) {
            // Both kernels match this version.
            if (a === activeInterpreterConnection) {
                return 1;
            } else if (b === activeInterpreterConnection) {
                return -1;
            } else {
                // We're dealing with default kernel (python3), hence start using Python interpreter, not custom kernlespecs.
                // Thus iff user has interpreter & a custom kernel spec, then in this case give preference to
                // starting with interpreter instead of custom kernelspec.
                return givePreferenceToStartingWithoutCustomKernelSpec(a, b);
            }
        } else if (
            majorVersion &&
            a.interpreter?.version?.major !== b.interpreter?.version?.major &&
            a.interpreter?.version?.major === majorVersion &&
            a.kind !== 'startUsingRemoteKernelSpec' &&
            comparisonOfDisplayNames >= 0 &&
            comparisonOfInterpreter >= 0
        ) {
            return 1;
        } else if (
            majorVersion &&
            a.interpreter?.version?.major !== b.interpreter?.version?.major &&
            b.interpreter?.version?.major === majorVersion &&
            b.kind !== 'startUsingRemoteKernelSpec' &&
            comparisonOfDisplayNames <= 0 &&
            comparisonOfInterpreter <= 0
        ) {
            return -1;
        } else if (
            nameOfA === notebookMetadata.kernelspec.name &&
            comparisonOfDisplayNames >= 0 &&
            comparisonOfInterpreter >= 0
        ) {
            // Kernel a matches the name and it has a better match for display names & interpreter.
            return 1;
        } else if (
            a.kind === 'startUsingPythonInterpreter' &&
            kernelRegA !== 'registeredByNewVersionOfExtForCustomKernelSpec' &&
            nameOfA === a.kernelSpec.display_name &&
            comparisonOfDisplayNames >= 0 &&
            comparisonOfInterpreter >= 0
        ) {
            // Some times the kernel name might not match, as the name might default to the display name of the kernelspec.
            // IN such cases check if this kernel a is a python interpreter and not mapping to a custom kernelspec.
            // If that's the case then this matches default Python kernels.
            return 1;
        } else if (
            nameOfB === notebookMetadata.kernelspec.name &&
            comparisonOfDisplayNames <= 0 &&
            comparisonOfInterpreter <= 0
        ) {
            // Kernel b matches the name and it has a better match for display names & interpreter.
            return -1;
        } else if (
            b.kind === 'startUsingPythonInterpreter' &&
            kernelRegB !== 'registeredByNewVersionOfExtForCustomKernelSpec' &&
            nameOfA === b.kernelSpec.display_name &&
            comparisonOfDisplayNames <= 0 &&
            comparisonOfInterpreter <= 0
        ) {
            // Some times the kernel name might not match, as the name might default to the display name of the kernelspec.
            // IN such cases check if this kernel a is a python interpreter and not mapping to a custom kernelspec.
            // If that's the case then this matches default Python kernels.
            return 1;
        } else if (comparisonOfInterpreter > 0) {
            // Clearly kernel a has a better match (at least the interpreter matches).
            return 1;
        } else if (comparisonOfInterpreter < 0) {
            // Clearly kernel b has a better match (at least the interpreter matches).
            return -1;
        }
    } else if (nameOfA === nameOfB && nameOfA === notebookMetadata.kernelspec.name) {
        // Names match for both kernels.
        // Check which has a better match for interpreter & display name.
        if (comparisonOfDisplayNames >= 0 && comparisonOfInterpreter >= 0) {
            return 1;
        } else if (comparisonOfDisplayNames < 0 && comparisonOfInterpreter < 0) {
            return -1;
        } else {
            // If interpreter matches for a, then use a.
            return comparisonOfInterpreter;
        }
    } else if (nameOfA === notebookMetadata.kernelspec.name) {
        // Check which has a better match for interpreter & display name.
        if (comparisonOfDisplayNames >= 0 && comparisonOfInterpreter >= 0) {
            return 1;
        } else if (comparisonOfDisplayNames < 0 && comparisonOfInterpreter < 0) {
            return -1;
        }
        // If kernel a matches the default (active) interpreter connection,
        // Then use a, similarly for b.
        if (a === activeInterpreterConnection) {
            return 1;
        } else if (b === activeInterpreterConnection) {
            return -1;
        } else {
            // If interpreter matches for a, then use a.
            return comparisonOfInterpreter;
        }
    } else if (nameOfB === notebookMetadata.kernelspec.name) {
        // Check which has a better match for interpreter & display name.
        if (comparisonOfDisplayNames > 0 && comparisonOfInterpreter > 0) {
            // Kernel a has a better match for display name & interpreter, hence
            // use that (even though the name doesn't match).
            return 1;
        } else if (comparisonOfDisplayNames <= 0 && comparisonOfInterpreter <= 0) {
            // Kernel a has a better match for name, display name & interpreter, hence
            // use that.
            return -1;
        }
        // If kernel a matches the default (active) interpreter connection,
        // Then use a, similarly for b.
        if (a === activeInterpreterConnection) {
            return 1;
        } else if (b === activeInterpreterConnection) {
            return -1;
        } else {
            // If interpreter matches for a, then use a.
            return comparisonOfInterpreter;
        }
    }
    // None of them match the name.
}
/**
 * In the notebook we store a hash of the interpreter.
 * Given that hash, compare the two kernels and find the better of the two.
 *
 * If the user has kernelspec in metadata & the interpreter hash is stored in metadata, then its a great match.
 * This is the preferred approach https://github.com/microsoft/vscode-jupyter/issues/5612
 */
function compareAgainstInterpreterInNotebookMetadata(
    a: KernelConnectionMetadata,
    b: KernelConnectionMetadata,
    notebookMetadata?: nbformat.INotebookMetadata
) {
    if (a.kind === 'connectToLiveKernel' && b.kind === 'connectToLiveKernel') {
        return 0;
    } else if (a.kind === 'connectToLiveKernel') {
        return -1;
    } else if (b.kind === 'connectToLiveKernel') {
        return 1;
    }

    const kernelRegInfoA = getKernelRegistrationInfo(a.kernelSpec);
    const kernelRegInfoB = getKernelRegistrationInfo(b.kernelSpec);
    const interpreterMatchesThatInNotebookMetadataA = !!interpreterMatchesThatInNotebookMetadata(a, notebookMetadata);
    const interpreterMatchesThatInNotebookMetadataB = !!interpreterMatchesThatInNotebookMetadata(b, notebookMetadata);

    if (!interpreterMatchesThatInNotebookMetadataA && !interpreterMatchesThatInNotebookMetadataB) {
        // Both don't match.
        return 0;
    } else if (
        interpreterMatchesThatInNotebookMetadataA &&
        interpreterMatchesThatInNotebookMetadataB &&
        a.kind === b.kind &&
        kernelRegInfoA === kernelRegInfoB
    ) {
        // Both are the same.
        return 0;
    } else if (interpreterMatchesThatInNotebookMetadataA && !interpreterMatchesThatInNotebookMetadataB) {
        // a matches and b does not.
        return 1;
    } else if (!interpreterMatchesThatInNotebookMetadataA && interpreterMatchesThatInNotebookMetadataB) {
        // b matches and a does not.
        return -1;
    }

    // Now we know that both kernels point to the same interpreter defined in the notebook metadata.
    // Find the best of the two.

    if (
        a.kind === 'startUsingPythonInterpreter' &&
        a.kind !== b.kind &&
        kernelRegInfoA !== 'registeredByNewVersionOfExtForCustomKernelSpec'
    ) {
        // Give preference to kernel a that starts using plain python.
        return 1;
    } else if (
        b.kind === 'startUsingPythonInterpreter' &&
        b.kind !== a.kind &&
        kernelRegInfoB !== 'registeredByNewVersionOfExtForCustomKernelSpec'
    ) {
        // Give preference to kernel b that starts using plain python.
        return -1;
    } else if (a.kind === 'startUsingPythonInterpreter' && a.kind !== b.kind) {
        // Give preference to kernel a that starts using a plain Python for a custom kenrelspec.
        return 1;
    } else if (b.kind === 'startUsingPythonInterpreter' && b.kind !== a.kind) {
        // Give preference to kernel b that starts using a plain Python for a custom kenrelspec.
        return -1;
    } else if (a.kind === 'startUsingLocalKernelSpec' && a.kind !== b.kind) {
        // Give preference to kernel a that starts using a custom kernelspec python.
        return 1;
    } else if (b.kind === 'startUsingLocalKernelSpec' && a.kind !== b.kind) {
        // Give preference to kernel a that starts using a custom kernelspec python.
        return 1;
    } else {
        return 0;
    }
}

/**
 * In the notebook we store a display name of the kernelspec.
 * Given that display name, compare the two kernels and find the better of the two.
 * If the display name matches the display name of the kernelspec its a perfect match,
 * If the display name matches the display name of the interpreter its also a match (but not as great as the former).
 */
function compareAgainstKernelDisplayNameInNotebookMetadata(
    a: KernelConnectionMetadata,
    b: KernelConnectionMetadata,
    notebookMetadata?: nbformat.INotebookMetadata
) {
    if (a.kind === 'connectToLiveKernel' && b.kind === 'connectToLiveKernel') {
        return 0;
    } else if (a.kind === 'connectToLiveKernel') {
        return -1;
    } else if (b.kind === 'connectToLiveKernel') {
        return 1;
    }
    if (!notebookMetadata?.kernelspec?.display_name) {
        return 0;
    }
    const metadataPointsToADefaultKernelSpec = isDefaultKernelSpec({
        argv: [],
        display_name: notebookMetadata.kernelspec.display_name,
        name: notebookMetadata.kernelspec.name,
        path: ''
    });
    if (metadataPointsToADefaultKernelSpec) {
        // If we're dealing with default kernelspec names, then special handling.
        // Sometimes if we have an interpreter a, then the kernelspec name might default to the
        // interpreter display name (this is how we generate display names).
        // In such cases don't compare the display names of these kernlespecs against the notebook metadata.
        const kernelRegA = getKernelRegistrationInfo(a.kernelSpec);
        const kernelRegB = getKernelRegistrationInfo(b.kernelSpec);

        if (kernelRegA === kernelRegB && a.kind === b.kind) {
            // Do nothing.
        } else if (
            kernelRegA !== 'registeredByNewVersionOfExtForCustomKernelSpec' &&
            kernelRegB === 'registeredByNewVersionOfExtForCustomKernelSpec' &&
            a.kind === 'startUsingPythonInterpreter'
        ) {
            // Give pref to a
            return 1;
        } else if (
            kernelRegB !== 'registeredByNewVersionOfExtForCustomKernelSpec' &&
            kernelRegA === 'registeredByNewVersionOfExtForCustomKernelSpec' &&
            b.kind === 'startUsingPythonInterpreter'
        ) {
            // Give pref to a
            return -1;
        }
        // Possible the kernelspec of one of them matches exactly.
        if (
            a.kernelSpec.metadata?.vscode?.originalDisplayName &&
            a.kernelSpec.metadata?.vscode?.originalDisplayName === b.kernelSpec.metadata?.vscode?.originalDisplayName
        ) {
            // Both match.
            return 0;
        } else if (
            a.kernelSpec.metadata?.vscode?.originalDisplayName &&
            a.kernelSpec.metadata?.vscode?.originalDisplayName === notebookMetadata.kernelspec.display_name
        ) {
            return 1;
        } else if (
            b.kernelSpec.metadata?.vscode?.originalDisplayName &&
            b.kernelSpec.metadata?.vscode?.originalDisplayName === notebookMetadata.kernelspec.display_name
        ) {
            return -1;
        } else {
            // Ambiguous case.
            return 0;
        }
    }
    if (
        a.kernelSpec.display_name === b.kernelSpec.display_name &&
        a.kernelSpec.metadata?.vscode?.originalDisplayName === b.kernelSpec.metadata?.vscode?.originalDisplayName
    ) {
        // Both match.
        return 0;
    } else if (
        a.kernelSpec.display_name === notebookMetadata.kernelspec.display_name ||
        a.kernelSpec.metadata?.vscode?.originalDisplayName === notebookMetadata.kernelspec.display_name
    ) {
        return 1;
    } else if (
        b.kernelSpec.display_name === notebookMetadata.kernelspec.display_name ||
        b.kernelSpec.metadata?.vscode?.originalDisplayName === notebookMetadata.kernelspec.display_name
    ) {
        return -1;
    } else {
        return 0;
    }
}

/**
 * Given an interpreter, find the kernel connection that matches this interpreter.
 * & is used to start a kernel using the provided interpreter.
 */
function findKernelSpecMatchingInterpreter(
    interpreter: PythonEnvironment | undefined,
    kernels: KernelConnectionMetadata[]
) {
    if (!interpreter || kernels.length === 0) {
        return;
    }

    const result = kernels.filter((kernel) => {
        return (
            kernel.kind === 'startUsingPythonInterpreter' &&
            getKernelRegistrationInfo(kernel.kernelSpec) !== 'registeredByNewVersionOfExtForCustomKernelSpec' &&
            getInterpreterHash(kernel.interpreter) === getInterpreterHash(interpreter) &&
            kernel.interpreter.envName === interpreter.envName
        );
    });

    // if we have more than one match then something is wrong.
    if (result.length > 1) {
        traceError(`More than one kernel spec matches the interpreter ${interpreter.path}.`, result);
        if (isCI) {
            throw new Error('More than one kernelspec matches the intererpreter');
        }
    }
    return result.length ? result[0] : undefined;
}
/**
 * Checks whether the kernel connection matches the interpreter defined in the notebook metadata.
 */
function interpreterMatchesThatInNotebookMetadata(
    kernelConnection: KernelConnectionMetadata,
    notebookMetadata?: nbformat.INotebookMetadata
) {
    const interpreterHashInMetadata = getInterpreterHashInMetadata(notebookMetadata);
    return (
        interpreterHashInMetadata &&
        (kernelConnection.kind === 'startUsingLocalKernelSpec' ||
            kernelConnection.kind === 'startUsingRemoteKernelSpec' ||
            kernelConnection.kind === 'startUsingPythonInterpreter') &&
        kernelConnection.interpreter &&
        getInterpreterHash(kernelConnection.interpreter) === interpreterHashInMetadata
    );
}

export function _findPreferredKernel(
    kernels: KernelConnectionMetadata[],
    resource: Resource,
    notebookMetadata: nbformat.INotebookMetadata | undefined,
    preferredInterpreter: PythonEnvironment | undefined,
    remoteKernelPreferredProvider: PreferredRemoteKernelIdProvider | undefined
): KernelConnectionMetadata | undefined {
    traceInfo(
        `Find preferred kernel for ${getDisplayPath(resource)} with metadata ${JSON.stringify(
            notebookMetadata || {}
        )} & preferred interpreter ${getDisplayPath(preferredInterpreter?.path)}`
    );
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
                kernel.kind === 'startUsingPythonInterpreter' &&
                areInterpreterPathsSame(kernel.interpreter.path, preferredInterpreter.path)
        );
        if (kernelMatchingPreferredInterpreter) {
            return kernelMatchingPreferredInterpreter;
        }
        // Telemetry to see if this happens in the real world, this should not be possible.
        sendTelemetryEvent(Telemetry.FailedToFindKernelSpecInterpreterForInteractive);
    }

    // If still not found, look for a match based on notebook metadata and interpreter
    if (index < 0) {
        const hasLanguageInfo = notebookMetadata?.language_info?.name ? true : false;
        let nbMetadataLanguage: string | undefined;
        // Interactive window always defaults to Python kernels.
        if (getResourceType(resource) === 'interactive') {
            nbMetadataLanguage = PYTHON_LANGUAGE;
        } else {
            nbMetadataLanguage =
                !notebookMetadata || isPythonNotebook(notebookMetadata) || !hasLanguageInfo
                    ? PYTHON_LANGUAGE
                    : (
                          ((notebookMetadata?.kernelspec as any)?.language as string) ||
                          notebookMetadata?.language_info?.name
                      )?.toLowerCase();
        }
        let bestScore = -1;

        // Find index of the kernelspec that matches the preferred interpreter.
        const preferredInterpreterKernelSpecIndex = preferredInterpreter
            ? kernels.findIndex((spec) => {
                  if (
                      spec.kind === 'startUsingPythonInterpreter' &&
                      spec.kernelSpec &&
                      spec.kernelSpec.language === PYTHON_LANGUAGE &&
                      areInterpreterPathsSame(spec.interpreter.path, preferredInterpreter.path)
                  ) {
                      return true;
                  }
                  return false;
              })
            : -1;

        traceInfoIfCI(`preferredInterpreterKernelSpecIndex = ${preferredInterpreterKernelSpecIndex}`);

        if (
            getResourceType(resource) === 'notebook' &&
            preferredInterpreterKernelSpecIndex >= 0 &&
            !remoteKernelPreferredProvider
        ) {
            // If we don't have any kernelspec, then just return the preferred interpreter for notebooks.
            if (!notebookMetadata?.kernelspec) {
                traceInfoIfCI("Using preferred interpreter as there's no kernelspec in notebook metadata");
                return kernels[preferredInterpreterKernelSpecIndex];
            }

            // // Check if we have any interperter information in the kernelspec.
            // const hasInterpreterInfo =
            //     'interpreter' in notebookMetadata &&
            //     typeof notebookMetadata.interpreter === 'object' &&
            //     notebookMetadata.interpreter !== null;
            // // If we have a kernelspec (with just the name & display name) & no intepreter information
            // // & we cannot find a matching kernel (for the provided name & display name), then just return the preferred interpreter for notebooks.
            // const kernelSpec = notebookMetadata.kernelspec;
            // // eslint-disable-next-line @typescript-eslint/no-explicit-any
            // const definedValuesForKernelSpec = new Set(Object.keys(kernelSpec) as any);
            // definedValuesForKernelSpec.delete('name');
            // definedValuesForKernelSpec.delete('display_name');
            // if (
            //     hasInterpreterInfo &&
            //     definedValuesForKernelSpec.size === 0 &&
            //     !kernels.find((item) => {
            //         if (item.kind === 'startUsingLocalKernelSpec') {
            //             return (
            //                 item.kernelSpec.display_name === kernelSpec.display_name ||
            //                 item.kernelSpec.name === kernelSpec.name
            //             );
            //         } else if (item.kind === 'startUsingPythonInterpreter') {
            //             return (
            //                 item.kernelSpec.display_name === kernelSpec.display_name ||
            //                 item.kernelSpec.name === kernelSpec.name ||
            //                 item.interpreter.displayName === kernelSpec.display_name ||
            //                 item.interpreter.displayName === kernelSpec.name
            //             );
            //         }
            //     })
            // ) {
            //     traceInfoIfCI("Using preferred interpreter as there's no kernelspec in notebook metadata");
            //     return kernels[preferredInterpreterKernelSpecIndex];
            // }
        }

        for (let i = 0; kernels && i < kernels?.length; i = i + 1) {
            const metadata = kernels[i];
            const spec = metadata.kind !== 'connectToLiveKernel' ? metadata.kernelSpec : undefined;
            const speclanguage = getKernelConnectionLanguage(metadata);
            let score = -1;
            let subScore = 0;

            if (spec) {
                traceInfoIfCI(`Checking kernel Spec ${JSON.stringify(spec)}`);
                traceInfoIfCI(`isPythonKernelSpec(spec) = ${isPythonKernelSpec(spec)}`);
                traceInfoIfCI(`isKernelRegisteredByUs(spec) = ${getKernelRegistrationInfo(spec)}`);

                // Check if the kernel spec name matches the hash of the generated kernel spec name.
                // This approach of storing our generated kernelspec name in metadadata is not longer practiced.
                if (
                    !notebookMetadata && // If we don't have metadata, only then should we compare against the interpreter.
                    (getKernelRegistrationInfo(spec) === 'registeredByNewVersionOfExt' ||
                        getKernelRegistrationInfo(spec) === 'registeredByNewVersionOfExtForCustomKernelSpec') &&
                    isPythonKernelSpec(spec) &&
                    preferredInterpreter &&
                    spec.name.includes(getInterpreterKernelSpecName(preferredInterpreter))
                ) {
                    // This is a perfect match.
                    traceInfoIfCI('Increased score by +100 for matching names without notebook metadata');
                    score += 100;
                }

                // If the user has kernelspec in metadata & this is a kernelspec we generated & names match, then use that kernelspec.
                // Reason we are only interested kernelspecs we generate is because user can have kernelspecs named `python`.
                // Such kernelspecs are ambiguous (we have no idea what `python` kernel means, its not necessarily tied to a specific interpreter).
                // This approach of storing our generated kernelspec name in metadadata is not longer practiced.
                if (
                    notebookMetadata?.kernelspec?.name &&
                    getKernelRegistrationInfo(spec) &&
                    notebookMetadata.kernelspec.name === spec.name
                ) {
                    // This is a perfect match.
                    traceInfoIfCI('Increased score by +100 for matching names in notbeook metadata');
                    score += 100;
                }

                // If the user has kernelspec in metadata & the interpreter hash is stored in metadata, then its a perfect match.
                // This is the preferred approach https://github.com/microsoft/vscode-jupyter/issues/5612
                const interpreterHashInMetadata = getInterpreterHashInMetadata(notebookMetadata);
                if (
                    (metadata.kind === 'startUsingLocalKernelSpec' ||
                        metadata.kind === 'startUsingRemoteKernelSpec' ||
                        metadata.kind === 'startUsingPythonInterpreter') &&
                    metadata.interpreter &&
                    getInterpreterHash(metadata.interpreter) === interpreterHashInMetadata
                ) {
                    // This is a perfect match.
                    traceInfoIfCI('Increased score by +100 for matching interpreter in notbeook metadata');
                    score += 100;
                }

                // See if the path matches.
                if (
                    spec &&
                    spec.path &&
                    spec.path.length > 0 &&
                    preferredInterpreter &&
                    areInterpreterPathsSame(spec.path, preferredInterpreter.path) &&
                    nbMetadataLanguage === PYTHON_LANGUAGE
                ) {
                    // Path match. This is worth more if no notebook metadata as that should
                    // match first.
                    traceInfoIfCI(
                        `Increased score by ${notebookMetadata ? 1 : 8} for matching spec.path in notbeook metadata`
                    );
                    score += notebookMetadata ? 1 : 8;
                }

                // See if the display name already matches.
                if (spec.display_name && spec.display_name === notebookMetadata?.kernelspec?.display_name) {
                    traceInfoIfCI('Increased score by +16 for matching display_name with metadata');
                    score += 16;
                }
                // See if the name of the environments match (kernel name == environment name).
                // At this point we dont care about version numbers of the Python environments.
                // E.g. assume user opens notebook with metadata pointing to kernelspec with the name `condaPytoch`,
                // & the user has such an environment (with the same name), then its a match.
                if (
                    metadata.interpreter?.envName &&
                    metadata.interpreter?.envName === notebookMetadata?.kernelspec?.name &&
                    nbMetadataLanguage === PYTHON_LANGUAGE &&
                    !notebookMetadata?.kernelspec?.name.toLowerCase().match(isDefaultPythonKernelSpecName)
                ) {
                    traceInfoIfCI('Increased score by +16 for matching env name');
                    score += 16;
                }

                // See if interpreter should be tried instead.
                if (
                    spec.display_name &&
                    spec.display_name === preferredInterpreter?.displayName &&
                    !notebookMetadata?.kernelspec?.display_name &&
                    nbMetadataLanguage === PYTHON_LANGUAGE
                ) {
                    traceInfoIfCI('Increased score by +16 for matching display_name with interpreter');
                    score += 10;
                }

                // Find a kernel spec that matches the language in the notebook metadata.
                if (score <= 0 && nbMetadataLanguage && speclanguage === (nbMetadataLanguage || '')) {
                    traceVerbose(
                        `findPreferredKernel score for speclanguage=${nbMetadataLanguage}, ${getDisplayNameOrNameOfKernelConnection(
                            metadata
                        )} is ${score}`
                    );
                    traceInfoIfCI('Increased score by +1 for matching language');
                    subScore = 1;
                    score = +1;
                }

                // See if the version is the same
                if (
                    preferredInterpreter &&
                    preferredInterpreter.version &&
                    spec &&
                    spec.name &&
                    nbMetadataLanguage === PYTHON_LANGUAGE &&
                    !getKernelRegistrationInfo(spec)
                ) {
                    // Search for a digit on the end of the name. It should match our major version
                    const match = /\D+(\d+)/.exec(spec.name);
                    if (match && match !== null && match.length > 0) {
                        // See if the version number matches
                        const nameVersion = parseInt(match[1][0], 10);
                        if (nameVersion && nameVersion === preferredInterpreter.version.major) {
                            traceInfoIfCI('Increased score by +4 for matching major version');
                            score += 4;
                        }
                    }
                }

                // Give python 3 environments a higher priority over others.
                // E.g. if we end up just looking at the suppof ot ehe languages, then Python2 & Python3 will both get 1.
                // But Python 3 is definitely preferred over Python 2.
                if (
                    nbMetadataLanguage === PYTHON_LANGUAGE &&
                    (metadata.interpreter?.sysVersion?.startsWith('3') ||
                        metadata.interpreter?.version?.major === 3 ||
                        metadata.interpreter?.displayName?.toLowerCase().includes('python 3') ||
                        metadata.interpreter?.displayName?.toLowerCase().includes('python3') ||
                        metadata.interpreter?.path?.toLowerCase().includes('python3') ||
                        spec.argv[0].toLocaleLowerCase().includes('python3'))
                ) {
                    traceInfoIfCI('Increased score by +1 for matching major version 3');
                    score += 1;
                    subScore += 1;
                    traceVerbose(
                        `findPreferredKernel score for Python3, ${getDisplayNameOrNameOfKernelConnection(
                            metadata
                        )} is ${score}`
                    );

                    // If the versions match exactly, then increase the score by another 1
                    if (
                        typeof notebookMetadata === 'object' &&
                        'interpreter' in notebookMetadata &&
                        (notebookMetadata as any).interpreter &&
                        typeof (notebookMetadata as any).interpreter === 'object' &&
                        metadata.kind === 'startUsingPythonInterpreter'
                    ) {
                        const nbMetadataInterpreter = (notebookMetadata as any).interpreter as Partial<
                            PythonEnvironment
                        >;
                        if (
                            nbMetadataInterpreter.version?.raw &&
                            nbMetadataInterpreter.version?.raw === metadata.interpreter.version?.raw
                        ) {
                            traceInfoIfCI(
                                'Increased score by +3 for matching raw version in notebook metadata interpreter'
                            );
                            score += 3;
                        }
                    } else if (
                        metadata.interpreter?.version?.raw &&
                        metadata.interpreter?.version?.raw === preferredInterpreter?.version?.raw
                    ) {
                        traceInfoIfCI('Increased score by +3 for matching raw version in preferred interpreter');
                        score += 3;
                    }
                }

                // If ther'es no kernelspec in the metadata (e.g. blank notebooks),
                // & its a python notebook (language in the notebook metatadata will be Python),
                // Then give preference to the preferred (active) interpreter.
                if (
                    !notebookMetadata?.kernelspec &&
                    preferredInterpreter &&
                    areInterpreterPathsSame(spec.interpreterPath, preferredInterpreter?.path)
                ) {
                    traceInfoIfCI('Increased score by +10 for matching spec.interpreterPath');
                    score += 10;
                }
            }

            // Trace score for kernel
            traceVerbose(
                `findPreferredKernel score for ${getDisplayNameOrNameOfKernelConnection(metadata)} is ${score}`
            );

            // If we have a score of 5, this can only happen if we match against language and find a Python 3 kernel.
            // In such cases, use our preferred interpreter kernel if we have one.
            // I.e. give preference to the preferred interpreter kernelspec if we dont have any matches.
            if (
                subScore === 5 && // This is a bit flakey. Number isn't consistent. Should probably just make the order of kernelspecs have the preferred one first
                score === 5 &&
                (metadata.kind === 'startUsingPythonInterpreter' ||
                    ((metadata.kind === 'startUsingLocalKernelSpec' ||
                        metadata.kind === 'startUsingRemoteKernelSpec') &&
                        metadata.kernelSpec.language === PYTHON_LANGUAGE)) &&
                preferredInterpreterKernelSpecIndex >= 0 &&
                bestScore <= 2
            ) {
                index = preferredInterpreterKernelSpecIndex;
            } else if (score > bestScore) {
                index = i;
                bestScore = score;
            }
        }
    }

    traceInfoIfCI(isCI && index >= 0, `Preferred kernel is ${JSON.stringify(kernels[index])}`);
    return index >= 0 ? kernels[index] : undefined;
}
export async function sendTelemetryForPythonKernelExecutable(
    kernel: IKernel,
    resource: Resource,
    kernelConnection: KernelConnectionMetadata,
    executionService: IPythonExecutionFactory
) {
    if (!kernel.session) {
        return;
    }
    if (!kernelConnection.interpreter || !isPythonKernelConnection(kernelConnection)) {
        return;
    }
    if (
        kernelConnection.kind !== 'startUsingLocalKernelSpec' &&
        kernelConnection.kind !== 'startUsingPythonInterpreter'
    ) {
        return;
    }
    try {
        traceVerbose('Begin sendTelemetryForPythonKernelExecutable');
        const outputs = await executeSilently(kernel.session, 'import sys\nprint(sys.executable)');
        if (outputs.length === 0) {
            return;
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const output: nbformat.IStream = outputs[0] as any;
        if (output.name !== 'stdout' && output.output_type !== 'stream') {
            return;
        }
        const sysExecutable = concatMultilineString(output.text).trim().toLowerCase();
        const match = areInterpreterPathsSame(
            kernelConnection.interpreter.path.toLowerCase(),
            sysExecutable.toLowerCase()
        );
        sendTelemetryEvent(Telemetry.PythonKerneExecutableMatches, undefined, {
            match: match ? 'true' : 'false',
            kernelConnectionType: kernelConnection.kind
        });
        trackKernelResourceInformation(resource, { interpreterMatchesKernel: match });
        if (match) {
            return;
        }

        // Rest of the code can all be async, no need to slow the calling code.

        // The interpreter paths don't match, possible we have a synlink or similar.
        // Lets try to get the path from the interpreter using the exact same code we send to the kernel.
        executionService
            .createActivatedEnvironment({
                interpreter: kernelConnection.interpreter,
                allowEnvironmentFetchExceptions: true
            })
            .then(async (execService) => {
                const execOutput = await execService.exec(['-c', 'import sys;print(sys.executable)'], {
                    throwOnStdErr: false
                });
                if (execOutput.stdout.trim().length > 0) {
                    const match = areInterpreterPathsSame(execOutput.stdout.trim().toLowerCase(), sysExecutable);
                    sendTelemetryEvent(Telemetry.PythonKerneExecutableMatches, undefined, {
                        match: match ? 'true' : 'false',
                        kernelConnectionType: kernelConnection.kind
                    });
                    trackKernelResourceInformation(resource, { interpreterMatchesKernel: match });
                    if (!match) {
                        traceError(
                            `Interpreter started by kernel does not match expectation, expected ${getDisplayPath(
                                kernelConnection.interpreter?.path
                            )}, got ${getDisplayPath(sysExecutable)}`
                        );
                    }
                }
            })
            .catch((ex) => traceError('Failed to compare interpreters', ex));
    } catch (ex) {
        traceError('Failed to compare interpreters', ex);
    }
    traceVerbose('End sendTelemetryForPythonKernelExecutable');
}

export async function executeSilently(
    session: IJupyterSession,
    code: string,
    errorOptions?: SilentExecutionErrorOptions
): Promise<nbformat.IOutput[]> {
    traceInfo(`Executing silently Code (${session.status}) = ${code.substring(0, 100).splitLines().join('\\n')}`);
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const jupyterLab = require('@jupyterlab/services') as typeof import('@jupyterlab/services');

    const request = session.requestExecute(
        {
            code: code.replace(/\r\n/g, '\n'),
            silent: false,
            stop_on_error: false,
            allow_stdin: true,
            store_history: false
        },
        true
    );
    const outputs: nbformat.IOutput[] = [];
    request.onIOPub = (msg) => {
        if (jupyterLab.KernelMessage.isStreamMsg(msg)) {
            traceInfoIfCI(`Got io pub message (stream), ${msg.content.text.substr(0, 100).splitLines().join('\\n')}`);
            if (
                outputs.length > 0 &&
                outputs[outputs.length - 1].output_type === 'stream' &&
                outputs[outputs.length - 1].name === msg.content.name
            ) {
                const streamOutput = outputs[outputs.length - 1] as nbformat.IStream;
                streamOutput.text += msg.content.text;
            } else {
                const streamOutput: nbformat.IStream = {
                    name: msg.content.name,
                    text: msg.content.text,
                    output_type: 'stream'
                };
                outputs.push(streamOutput);
            }
        } else if (jupyterLab.KernelMessage.isExecuteResultMsg(msg)) {
            traceInfoIfCI(`Got io pub message (execresult)}`);
            const output: nbformat.IExecuteResult = {
                data: msg.content.data,
                execution_count: msg.content.execution_count,
                metadata: msg.content.metadata,
                output_type: 'execute_result'
            };
            outputs.push(output);
        } else if (jupyterLab.KernelMessage.isDisplayDataMsg(msg)) {
            traceInfoIfCI(`Got io pub message (displaydata)}`);
            const output: nbformat.IDisplayData = {
                data: msg.content.data,
                metadata: msg.content.metadata,
                output_type: 'display_data'
            };
            outputs.push(output);
        } else if (jupyterLab.KernelMessage.isErrorMsg(msg)) {
            traceInfoIfCI(
                `Got io pub message (error), ${msg.content.ename},${
                    msg.content.evalue
                }, ${msg.content.traceback.join().substring(0, 100)}}`
            );
            const output: nbformat.IError = {
                ename: msg.content.ename,
                evalue: msg.content.evalue,
                traceback: msg.content.traceback,
                output_type: 'error'
            };
            outputs.push(output);
        } else {
            traceInfoIfCI(`Got io pub message (${msg.header.msg_type})`);
        }
    };
    await request.done;

    const codeForLogging = code.substring(0, 100).splitLines().join('\\n');

    // Handle any errors logged in the output if needed
    if (errorOptions) {
        handleExecuteSilentErrors(outputs, errorOptions, codeForLogging);
    }

    traceInfo(`Executing silently Code (completed) = ${codeForLogging}`);

    return outputs;
}

function handleExecuteSilentErrors(
    outputs: nbformat.IOutput[],
    errorOptions: SilentExecutionErrorOptions,
    codeForLogging: string
) {
    outputs
        .filter((output) => {
            return output.output_type === 'error';
        })
        .forEach((outputError) => {
            const errorOutput = outputError as nbformat.IError;
            const outputMessage = `${errorOutput.ename}: ${errorOutput.evalue} \n ${errorOutput.traceback
                .map((line) => `    ${line}`)
                .join('\n')}`;
            const fullMessage = `${errorOptions.traceErrorsMessage || ''} ${codeForLogging} ${outputMessage}`;
            if (errorOptions.traceErrors) {
                traceError(fullMessage);
            } else {
                traceWarning(fullMessage);
            }

            // Send telemetry if requested, no traceback for PII
            if (errorOptions.telemetryName) {
                sendTelemetryEvent(errorOptions.telemetryName, undefined, {
                    ename: errorOutput.ename,
                    evalue: errorOutput.evalue
                });
            }
        });
}

async function switchController(
    resource: Resource,
    serviceContainer: IServiceContainer
): Promise<VSCodeNotebookController | undefined> {
    const commandManager = serviceContainer.get<ICommandManager>(ICommandManager);
    const notebooks = serviceContainer.get<IVSCodeNotebook>(IVSCodeNotebook);
    const editor = findNotebookEditor(resource, notebooks, serviceContainer.get(IInteractiveWindowProvider));

    // Listen for selection change events (may not fire if user cancels)
    const controllerManager = serviceContainer.get<INotebookControllerManager>(INotebookControllerManager);
    let controller: VSCodeNotebookController | undefined;
    const waitForSelection = createDeferred<VSCodeNotebookController>();
    const disposable = controllerManager.onNotebookControllerSelected((e) => waitForSelection.resolve(e.controller));

    const selected = await selectKernel(
        resource,
        notebooks,
        serviceContainer.get(IInteractiveWindowProvider),
        commandManager
    );
    if (selected && editor) {
        controller = await waitForSelection.promise;
    }
    disposable.dispose();
    return controller;
}

export async function notifyAndRestartDeadKernel(
    kernel: IKernel,
    serviceContainer: IServiceContainer
): Promise<boolean> {
    const appShell = serviceContainer.get<IApplicationShell>(IApplicationShell);
    const commandManager = serviceContainer.get<ICommandManager>(ICommandManager);
    const statusProvider = serviceContainer.get<IStatusProvider>(IStatusProvider);

    const selection = await appShell.showErrorMessage(
        DataScience.cannotRunCellKernelIsDead().format(
            getDisplayNameOrNameOfKernelConnection(kernel.kernelConnectionMetadata)
        ),
        { modal: true },
        DataScience.showJupyterLogs(),
        DataScience.restartKernel()
    );
    let restartedKernel = false;
    switch (selection) {
        case DataScience.restartKernel(): {
            // Set our status
            const status = statusProvider.set(DataScience.restartingKernelStatus());
            try {
                await kernel.restart();
                restartedKernel = true;
            } finally {
                status.dispose();
            }
            break;
        }
        case DataScience.showJupyterLogs(): {
            void commandManager.executeCommand(Commands.ViewJupyterOutput);
        }
    }
    return restartedKernel;
}

export async function handleKernelError(
    serviceContainer: IServiceContainer,
    error: Error,
    context: 'start' | 'interrupt' | 'restart' | 'execution',
    resource: Resource,
    kernel: IKernel,
    controller: VSCodeNotebookController
) {
    const memento = serviceContainer.get<Memento>(IMemento, GLOBAL_MEMENTO);
    const errorHandler = serviceContainer.get<IDataScienceErrorHandler>(IDataScienceErrorHandler);
    let resultController: VSCodeNotebookController = controller;

    if (controller.connection.interpreter && context === 'start') {
        // If we failed to start the kernel, then clear cache used to track
        // whether we have dependencies installed or not.
        // Possible something is missing.
        clearInstalledIntoInterpreterMemento(
            memento,
            Product.ipykernel,
            controller.connection.interpreter.path
        ).ignoreErrors();
    }

    const handleResult = await errorHandler.handleKernelError(error, 'start', controller.connection, resource);

    // Send telemetry for handling the error (if raw)
    const isLocal = isLocalConnection(controller?.connection);
    const rawLocalKernel = serviceContainer.get<IRawNotebookProvider>(IRawNotebookProvider).isSupported && isLocal;
    if (rawLocalKernel && context === 'start') {
        sendKernelTelemetryEvent(resource, Telemetry.RawKernelSessionStartNoIpykernel, {
            reason: handleResult
        });
    }

    // Dispose the kernel no matter what happened as we need to go around again when there's an error
    kernel.dispose().ignoreErrors();

    switch (handleResult) {
        case KernelInterpreterDependencyResponse.cancel:
        case KernelInterpreterDependencyResponse.failed:
            throw error;

        case KernelInterpreterDependencyResponse.selectDifferentKernel: {
            // Loop around and create the new one. The user wants to switch

            // Update to the selected controller
            const newController = await switchController(resource, serviceContainer);
            if (!newController) {
                throw error;
            } else {
                resultController = newController;
            }
            break;
        }
    }

    return resultController;
}

function convertContextToFunction(context: 'start' | 'interrupt' | 'restart', options?: IDisplayOptions) {
    switch (context) {
        case 'start':
            return (k: IKernel) => k.start(options);

        case 'interrupt':
            return (k: IKernel) => k.interrupt();

        case 'restart':
            return (k: IKernel) => k.restart();
    }
}

const connections = new WeakMap<
    NotebookDocument,
    {
        kernel: Deferred<{
            kernel: IKernel;
            controller: VSCodeNotebookController;
            deadKernelAction?: 'deadKernelWasRestarted' | 'deadKernelWasNoRestarted';
        }>;
        options: IDisplayOptions;
    }
>();

export async function wrapKernelMethod(
    initialController: VSCodeNotebookController,
    initialContext: 'start' | 'interrupt' | 'restart',
    serviceContainer: IServiceContainer,
    resource: Resource,
    notebook: NotebookDocument,
    options: IDisplayOptions = new DisplayOptions(false)
): Promise<IKernel> {
    let currentPromise = connections.get(notebook);
    if (!options.disableUI && currentPromise?.options.disableUI) {
        currentPromise.options.disableUI = false;
    }
    // If the current kernel has been disposed or in the middle of being disposed, then create another one.
    // But do that only if we require a UI, else we can just use the current one.
    if (
        !options.disableUI &&
        currentPromise?.kernel.resolved &&
        (currentPromise?.kernel.value?.kernel?.disposed || currentPromise?.kernel.value?.kernel?.disposing)
    ) {
        connections.delete(notebook);
        currentPromise = undefined;
    }
    const verifyKernelState = async (
        promise: Promise<{
            kernel: IKernel;
            controller: VSCodeNotebookController;
            deadKernelAction?: 'deadKernelWasRestarted' | 'deadKernelWasNoRestarted';
        }>
    ): Promise<IKernel> => {
        const { kernel, controller, deadKernelAction } = await promise;
        // Before returning, but without disposing the kernel, double check it's still valid
        // If a restart didn't happen, then we can't connect. Throw an error.
        // Do this outside of the loop so that subsequent calls will still ask because the kernel isn't disposed
        if (kernel.status === 'dead' || (kernel.status === 'terminating' && !kernel.disposed && !kernel.disposing)) {
            // If the kernel is dead, then remove the cached promise, & try to get the kernel again.
            // At that point, it will get restarted.
            if (connections.get(notebook)?.kernel.promise === promise) {
                connections.delete(notebook);
            }
            if (deadKernelAction === 'deadKernelWasNoRestarted') {
                throw new KernelDeadError(kernel.kernelConnectionMetadata);
            } else if (deadKernelAction === 'deadKernelWasRestarted') {
                return kernel;
            }
            // Kernel is dead and we didn't prompt the user to restart it, hence re-run the code that will prompt the user for a restart.
            return wrapKernelMethod(controller, 'start', serviceContainer, resource, notebook, options);
        }
        return kernel;
    };

    // Wrap the kernel method again to interrupt/restart this kernel.
    if (currentPromise && initialContext !== 'restart' && initialContext !== 'interrupt') {
        return verifyKernelState(currentPromise.kernel.promise);
    }

    const promise = wrapKernelMethodImpl(
        initialController,
        initialContext,
        serviceContainer,
        resource,
        notebook,
        options
    );
    const deferred = createDeferredFromPromise(promise);
    // If the kernel gets disposed or we fail to create the kernel, then ensure we remove the cached result.
    promise
        .then((result) => {
            result.kernel.onDisposed(() => {
                if (connections.get(notebook)?.kernel === deferred) {
                    connections.delete(notebook);
                }
            });
        })
        .catch(() => {
            if (connections.get(notebook)?.kernel === deferred) {
                connections.delete(notebook);
            }
        });

    connections.set(notebook, { kernel: deferred, options });
    return verifyKernelState(deferred.promise);
}

export async function wrapKernelMethodImpl(
    initialController: VSCodeNotebookController,
    initialContext: 'start' | 'interrupt' | 'restart',
    serviceContainer: IServiceContainer,
    resource: Resource,
    notebook: NotebookDocument,
    options: IDisplayOptions = new DisplayOptions(false)
): Promise<{
    kernel: IKernel;
    controller: VSCodeNotebookController;
    deadKernelAction?: 'deadKernelWasRestarted' | 'deadKernelWasNoRestarted';
}> {
    const kernelProvider = serviceContainer.get<IKernelProvider>(IKernelProvider);
    let kernel: IKernel | undefined;
    let controller: VSCodeNotebookController = initialController;
    let currentMethod = convertContextToFunction(initialContext, options);
    let context = initialContext;
    while (kernel === undefined) {
        // Try to create the kernel (possibly again)
        kernel = kernelProvider.getOrCreate(notebook, {
            metadata: controller.connection,
            controller: controller.controller,
            resourceUri: resource
        });

        const isKernelDead = (k: IKernel) =>
            k.status === 'dead' || (k.status === 'terminating' && !k.disposed && !k.disposing);

        try {
            // If the kernel is dead, ask the user if they want to restart.
            // We need to perform this check first, as its possible we'd call this method for dead kernels.
            // & if the kernel is dead, prompt to restart.
            if (initialContext !== 'restart' && isKernelDead(kernel) && !options.disableUI) {
                const restarted = await notifyAndRestartDeadKernel(kernel, serviceContainer);
                return {
                    kernel,
                    controller,
                    deadKernelAction: restarted ? 'deadKernelWasRestarted' : 'deadKernelWasNoRestarted'
                };
            } else {
                await currentMethod(kernel);

                // If the kernel is dead, ask the user if they want to restart
                if (isKernelDead(kernel) && !options.disableUI) {
                    await notifyAndRestartDeadKernel(kernel, serviceContainer);
                }
            }
        } catch (error) {
            if (options.disableUI) {
                throw error;
            }
            controller = await handleKernelError(serviceContainer, error, context, resource, kernel, controller);

            // When we wrap around, update the current method to start. This
            // means if we're handling a restart or an interrupt that fails, we move onto trying to start the kernel.
            currentMethod = (k) => k.start(options);
            context = 'start';

            // Since an error occurred, we have to try again (controller may have switched so we have to pick a new kernel)
            kernel = undefined;
        }
    }
    return { kernel, controller };
}

export async function connectToKernel(
    initialController: VSCodeNotebookController,
    serviceContainer: IServiceContainer,
    resource: Resource,
    notebook: NotebookDocument,
    options: IDisplayOptions = new DisplayOptions(false)
): Promise<IKernel> {
    return wrapKernelMethod(initialController, 'start', serviceContainer, resource, notebook, options);
}
