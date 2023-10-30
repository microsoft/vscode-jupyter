// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/* eslint-disable @typescript-eslint/no-explicit-any */

// Helper functions for dealing with kernels and kernelspecs

import * as path from '../platform/vscode-path/path';
import * as uriPath from '../platform/vscode-path/resources';
import type * as nbformat from '@jupyterlab/nbformat';
import type { Kernel, KernelSpec } from '@jupyterlab/services';
// eslint-disable-next-line @typescript-eslint/no-require-imports
import cloneDeep from 'lodash/cloneDeep';
import url from 'url-parse';
import {
    KernelConnectionMetadata,
    LocalKernelSpecConnectionMetadata,
    LiveRemoteKernelConnectionMetadata,
    PythonKernelConnectionMetadata,
    IJupyterKernelSpec
} from './types';
import { Uri } from 'vscode';
import { IWorkspaceService } from '../platform/common/application/types';
import { PYTHON_LANGUAGE, Telemetry } from '../platform/common/constants';
import { traceError, traceInfoIfCI, traceVerbose, traceWarning } from '../platform/logging';
import { getDisplayPath, getFilePath } from '../platform/common/platform/fs-paths';
import { DataScience } from '../platform/common/utils/localize';
import { getNormalizedInterpreterPath, getInterpreterHash } from '../platform/pythonEnvironments/info/interpreter';
import { getTelemetrySafeVersion } from '../platform/telemetry/helpers';
import { EnvironmentType, PythonEnvironment } from '../platform/pythonEnvironments/info';
import { deserializePythonEnvironment } from '../platform/api/pythonApi';
import { JupyterKernelSpec } from './jupyter/jupyterKernelSpec';
import { sendTelemetryEvent } from '../telemetry';
import { IPlatformService } from '../platform/common/platform/types';
import { splitLines } from '../platform/common/helpers';
import { getPythonEnvironmentName } from '../platform/interpreter/helpers';

// https://jupyter-client.readthedocs.io/en/stable/kernels.html
export const connectionFilePlaceholder = '{connection_file}';

// Find the index of the connection file placeholder in a kernelspec
export function findIndexOfConnectionFile(kernelSpec: Readonly<IJupyterKernelSpec>): number {
    return kernelSpec.argv.findIndex((arg) => arg.includes(connectionFilePlaceholder));
}

export const jvscIdentifier = '-jvsc-';

export const isDefaultPythonKernelSpecName = /^python\d*.?\d*$/;

/**
 * Create a default kernelspec with the given display name.
 */
export async function createInterpreterKernelSpec(
    interpreter?: PythonEnvironment,
    rootKernelFilePath?: Uri
): Promise<IJupyterKernelSpec> {
    return createInterpreterKernelSpecWithName(
        await getInterpreterKernelSpecName(interpreter),
        interpreter,
        rootKernelFilePath
    );
}

/**
 * Create a default kernelspec with the given display name.
 */
export function createInterpreterKernelSpecWithName(
    name: string,
    interpreter?: PythonEnvironment,
    rootKernelFilePath?: Uri
): IJupyterKernelSpec {
    const interpreterMetadata = interpreter
        ? {
              path: getFilePath(interpreter.uri)
          }
        : {};
    // This creates a kernel spec for an interpreter. When launched, 'python' argument will map to using the interpreter
    // associated with the current resource for launching.
    const defaultSpec: KernelSpec.ISpecModel = {
        name,
        language: 'python',
        display_name: interpreter?.displayName || 'Python 3',
        metadata: {
            interpreter: interpreterMetadata
        },
        argv: ['python', '-m', 'ipykernel_launcher', '-f', connectionFilePlaceholder],
        env: {},
        resources: {}
    };

    // Generate spec file path if we know where kernel files will go
    const specFile =
        rootKernelFilePath && defaultSpec.name
            ? uriPath.joinPath(rootKernelFilePath, defaultSpec.name, 'kernel.json')
            : undefined;

    return new JupyterKernelSpec(
        defaultSpec,
        specFile ? getFilePath(specFile) : undefined,
        getFilePath(interpreter?.uri),
        'registeredByNewVersionOfExt'
    );
}

export function cleanEnvironment<T>(spec: T): T {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const copy = cloneDeep(spec) as unknown as { env?: any };

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

    return copy as any;
}

export function isPythonNotebook(metadata?: nbformat.INotebookMetadata) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const kernelSpec = metadata?.kernelspec as any as Partial<IJupyterKernelSpec> | undefined;
    if (metadata?.language_info?.name && metadata.language_info.name !== PYTHON_LANGUAGE) {
        return false;
    }

    if (kernelSpec?.name?.includes(PYTHON_LANGUAGE)) {
        return true;
    }

    // Valid notebooks will have a language information in the metadata.
    return kernelSpec?.language === PYTHON_LANGUAGE || metadata?.language_info?.name === PYTHON_LANGUAGE;
}

export function isDefaultKernelSpec(kernelspec: IJupyterKernelSpec) {
    // // When we create kernlespecs, we change the name to include a unique id.
    // // We need to look at the name of the original kernelspec that was created on disc.
    // // E.g. assume we're loading a kernlespec for a default Python kernel, the name would be `python3`
    // // However we give this a completely different name, and at that point its not possible to determine
    // // whether this is a default kernel or not.
    // // Hence determine the original name baesed on the original kernelspec file.
    const originalSpecFile = kernelspec.metadata?.vscode?.originalSpecFile || kernelspec.metadata?.originalSpecFile;
    const name = originalSpecFile ? path.basename(path.dirname(originalSpecFile)) : kernelspec.name || '';
    const displayName = kernelspec.metadata?.vscode?.originalDisplayName || kernelspec.display_name || '';

    // If the user creates a kernelspec with a name `python4` or changes the display
    // name of kernel `python3` to `Hello World`, then we'd still treat them as default kernelspecs,
    // The expectation is for users to use unique names & display names for their kernelspecs.
    if (
        name.toLowerCase().match(isDefaultPythonKernelSpecName) ||
        displayName.toLowerCase() === 'python 3 (ipykernel)' ||
        displayName.toLowerCase() === 'python 3'
    ) {
        return true;
    }
    return false;
}

/**
 * When creating remote sessions, we generate bogus names for the notebook.
 * These names are prefixed with the same local file name, and a random suffix.
 * However the random part does contain an identifier, and we can stip this off
 * to get the original local ipynb file name.
 */
export function removeNotebookSuffixAddedByExtension(notebookPath: string) {
    if (notebookPath.includes(jvscIdentifier)) {
        const guidRegEx = /[a-f0-9]$/;
        if (
            notebookPath
                .substring(notebookPath.lastIndexOf(jvscIdentifier) + jvscIdentifier.length)
                .search(guidRegEx) !== -1
        ) {
            const nbFile = notebookPath.substring(0, notebookPath.lastIndexOf(jvscIdentifier));
            return nbFile.toLowerCase().endsWith('.ipynb') || nbFile.toLowerCase().endsWith('.py')
                ? nbFile
                : `${nbFile}.ipynb`;
        }
    }
    return notebookPath;
}

type ConnectionWithKernelSpec = LocalKernelSpecConnectionMetadata | PythonKernelConnectionMetadata;
export function kernelConnectionMetadataHasKernelSpec(
    connectionMetadata: KernelConnectionMetadata
): connectionMetadata is ConnectionWithKernelSpec {
    return connectionMetadata.kind !== 'connectToLiveRemoteKernel';
}
export function kernelConnectionMetadataHasKernelModel(
    connectionMetadata: KernelConnectionMetadata
): connectionMetadata is LiveRemoteKernelConnectionMetadata {
    return connectionMetadata.kind === 'connectToLiveRemoteKernel';
}
export function getKernelId(spec: IJupyterKernelSpec, interpreter?: PythonEnvironment, serverId?: string) {
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
    const prefixForRemoteKernels = serverId ? `${serverId}.` : '';
    const specPath = getFilePath(
        getNormalizedInterpreterPath(spec.interpreterPath ? Uri.file(spec.interpreterPath) : Uri.file(spec.executable))
    );
    const interpreterPath = getFilePath(getNormalizedInterpreterPath(interpreter?.uri)) || '';
    return `${prefixForRemoteKernels}${
        spec.id || ''
    }.${specName}.${specPath}.${interpreterPath}.${argsForGenerationOfId}`;
}

export function getDisplayNameOrNameOfKernelConnection(kernelConnection: KernelConnectionMetadata | undefined) {
    const oldDisplayName = getOldFormatDisplayNameOrNameOfKernelConnection(kernelConnection);
    if (!kernelConnection) {
        return oldDisplayName;
    }
    switch (kernelConnection.kind) {
        case 'connectToLiveRemoteKernel': {
            const notebookPath = removeNotebookSuffixAddedByExtension(
                kernelConnection.kernelModel?.notebook?.path || kernelConnection.kernelModel?.model?.path || ''
            );
            return notebookPath ? `${oldDisplayName} (${notebookPath})` : oldDisplayName;
        }
        case 'startUsingRemoteKernelSpec':
        case 'startUsingLocalKernelSpec': {
            if (
                kernelConnection.interpreter?.envType &&
                kernelConnection.interpreter.envType !== EnvironmentType.Unknown
            ) {
                const envName = getPythonEnvironmentName(kernelConnection.interpreter);
                if (kernelConnection.kernelSpec.language === PYTHON_LANGUAGE) {
                    const pythonVersion = `Python ${
                        getTelemetrySafeVersion(kernelConnection.interpreter.version?.raw || '') || ''
                    }`.trim();
                    return kernelConnection.interpreter.envName
                        ? `${oldDisplayName} (${pythonVersion})`
                        : oldDisplayName;
                } else {
                    // Non-Python kernelspec that launches via python interpreter
                    return envName ? `${oldDisplayName} (${envName})` : oldDisplayName;
                }
            } else {
                return oldDisplayName;
            }
        }
        case 'startUsingPythonInterpreter':
            const pythonVersion = (
                getTelemetrySafeVersion(kernelConnection.interpreter.version?.raw || '') || ''
            ).trim();
            if (
                kernelConnection.interpreter.envType &&
                kernelConnection.interpreter.envType !== EnvironmentType.Unknown
            ) {
                // If user has created a custom kernelspec, then use that.
                if (
                    kernelConnection.kernelSpec.display_name &&
                    getKernelRegistrationInfo(kernelConnection.kernelSpec) ===
                        'registeredByNewVersionOfExtForCustomKernelSpec'
                ) {
                    return kernelConnection.kernelSpec.display_name;
                }
                // If this is a conda environment without Python, then don't display `Python` in it.
                const isCondaEnvWithoutPython =
                    kernelConnection.interpreter.envType === EnvironmentType.Conda &&
                    kernelConnection.interpreter.isCondaEnvWithoutPython === true;
                const pythonDisplayName = pythonVersion.trim() ? `Python ${pythonVersion}` : 'Python';
                const envName = getPythonEnvironmentName(kernelConnection.interpreter);
                if (isCondaEnvWithoutPython && envName) {
                    return envName;
                }
                return envName ? `${envName} (${pythonDisplayName})` : pythonDisplayName;
            } else {
                return `Python ${pythonVersion}`.trim();
            }
    }
    return oldDisplayName;
}
function getOldFormatDisplayNameOrNameOfKernelConnection(kernelConnection: KernelConnectionMetadata | undefined) {
    if (!kernelConnection) {
        return '';
    }
    const displayName =
        kernelConnection.kind === 'connectToLiveRemoteKernel'
            ? kernelConnection.kernelModel.display_name
            : kernelConnection.kernelSpec?.display_name;
    const name =
        kernelConnection.kind === 'connectToLiveRemoteKernel'
            ? kernelConnection.kernelModel.name
            : kernelConnection.kernelSpec?.name;

    const interpreterName =
        kernelConnection.kind === 'startUsingPythonInterpreter' ? kernelConnection.interpreter.displayName : undefined;

    return [displayName, name, interpreterName, ''].find((item) => typeof item === 'string' && item.length > 0) || '';
}

export function getNameOfKernelConnection(
    kernelConnection: KernelConnectionMetadata | undefined,
    defaultValue: string = ''
) {
    if (!kernelConnection) {
        return defaultValue;
    }
    return kernelConnection.kind === 'connectToLiveRemoteKernel'
        ? kernelConnection.kernelModel.name
        : kernelConnection.kernelSpec?.name;
}

export function getKernelDisplayPathFromKernelConnection(kernelConnection?: KernelConnectionMetadata): Uri | undefined {
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
        const pathValue =
            kernelSpec?.metadata?.interpreter?.path || kernelSpec?.interpreterPath || kernelSpec?.executable;
        if (pathValue === '/python' || pathValue === 'python') {
            return kernelConnection.interpreter?.displayPath;
        }
        return pathValue ? Uri.file(pathValue) : undefined;
    } else {
        // For non python kernels, give preference to the executable path in the kernelspec
        // E.g. if we have a rust kernel, we should show the path to the rust executable not the interpreter (such as conda env that owns the rust runtime).
        const pathValue =
            model?.executable ||
            kernelSpec?.executable ||
            kernelSpec?.metadata?.interpreter?.path ||
            kernelSpec?.interpreterPath;
        return pathValue ? Uri.file(pathValue) : undefined;
    }
}

export function getRemoteKernelSessionInformation(
    kernelConnection: KernelConnectionMetadata | undefined,
    defaultValue: string = ''
): string {
    if (kernelConnection?.kind === 'connectToLiveRemoteKernel') {
        let date: Date | undefined;
        if (typeof kernelConnection.kernelModel.lastActivityTime === 'string') {
            try {
                date = new Date(kernelConnection.kernelModel.lastActivityTime);
            } catch (ex) {
                traceVerbose(`Error parsing date ${ex}`);
            }
        } else {
            date = kernelConnection.kernelModel.lastActivityTime;
        }
        return DataScience.jupyterSelectLiveRemoteKernelDescription(
            date,
            kernelConnection.kernelModel.numberOfConnections
        );
    }
    return defaultValue;
}

export function getKernelConnectionDisplayPath(
    kernelConnection: KernelConnectionMetadata | undefined,
    workspaceService: IWorkspaceService,
    platform: IPlatformService
) {
    if (kernelConnection?.kind === 'connectToLiveRemoteKernel') {
        return undefined;
    }
    const kernelPath = getKernelDisplayPathFromKernelConnection(kernelConnection);
    // If we have just one workspace folder opened, then ensure to use relative paths
    // where possible (e.g. for virtual environments).
    const folders = workspaceService.workspaceFolders ? workspaceService.workspaceFolders : [];
    return kernelPath ? getDisplayPath(kernelPath, folders, platform.homeDir) : '';
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
        return deserializePythonEnvironment(model?.metadata?.interpreter, '');
    }
    const kernelSpec = kernelConnectionMetadataHasKernelSpec(kernelConnection)
        ? kernelConnection.kernelSpec
        : undefined;
    return deserializePythonEnvironment(kernelSpec?.metadata?.interpreter, '');
}

export function isUserRegisteredKernelSpecConnection(
    kernelConnection: KernelConnectionMetadata
): kernelConnection is LocalKernelSpecConnectionMetadata | PythonKernelConnectionMetadata {
    return (
        kernelConnection.kind === 'startUsingLocalKernelSpec' ||
        (kernelConnection.kind === 'startUsingPythonInterpreter' &&
            kernelConnection.kernelSpec &&
            // Also include kernel Specs that are in a non-global directory.
            getKernelRegistrationInfo(kernelConnection.kernelSpec) === 'registeredByNewVersionOfExtForCustomKernelSpec')
    );
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
    const kernelSpec: Partial<IJupyterKernelSpec> | undefined = metadata.kernelspec as any;
    return getLanguageInKernelSpec(kernelSpec) || metadata.language_info?.name;
}
export function getLanguageInKernelSpec(kernelSpec?: Partial<IJupyterKernelSpec> | undefined): string | undefined {
    // When a kernel spec is stored in ipynb, the `language` of the kernel spec is also saved.
    // Unfortunately there's no strong typing for this.
    return kernelSpec?.language;
}

/**
 * All kernel specs generated/registered/saved & saved by this extension will have this in the name.
 * This helps us easily identify such kernels.
 * WARNING: Never change this, this is stored in ipynb & kernelspec.json.
 */
export const autoGeneratedKernelNameIdentifier = 'jvsc74a57bd0';
/**
 * The name generated here is tied to the interpreter & is predictable.
 * WARNING: Changes to this will impact `getKernelId()`
 */
export async function getInterpreterKernelSpecName(interpreter?: PythonEnvironment): Promise<string> {
    // Generate a name from a hash of the interpreter
    // Note it must be prefixed with 'python' and the version number.
    const version = interpreter?.sysVersion ? getTelemetrySafeVersion(interpreter.sysVersion) || '3' : '';
    const versionWithSafeStrings = version.replace(/\./g, '');
    const prefix = interpreter ? `python${versionWithSafeStrings}` : '';
    return interpreter
        ? `${prefix}${autoGeneratedKernelNameIdentifier}${await getInterpreterHash(interpreter)}`
        : 'python3';
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
    const regEx = new RegExp('python\\s*(?<version>(\\d+))', 'g');
    return regEx.exec(name.toLowerCase());
}

export function isLocalHostConnection(kernelConnection: KernelConnectionMetadata): boolean {
    if (
        kernelConnection.kind === 'connectToLiveRemoteKernel' ||
        kernelConnection.kind === 'startUsingRemoteKernelSpec'
    ) {
        const parsed = new url(kernelConnection.baseUrl);
        return parsed.hostname.toLocaleLowerCase() === 'localhost' || parsed.hostname === '127.0.0.1';
    }
    return false;
}

// Options for error reporting from kernel silent execution
export type SilentExecutionErrorOptions = {
    // Setting this will log jupyter errors from silent execution as errors as opposed to warnings
    traceErrors?: boolean;
    // This optional message will be displayed as a prefix for the error or warning message
    traceErrorsMessage?: string;
    // Setting this will log telemetry on the given name
    telemetryName?: Telemetry.InteractiveWindowDebugSetupCodeFailure | Telemetry.PythonVariableFetchingCodeFailure;
};

export async function executeSilently(
    kernelConnection: Kernel.IKernelConnection,
    code: string,
    errorOptions?: SilentExecutionErrorOptions
): Promise<nbformat.IOutput[]> {
    traceVerbose(
        `Executing silently Code (${kernelConnection.status}) = ${splitLines(code.substring(0, 100)).join('\\n')}`
    );
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const jupyterLab = require('@jupyterlab/services') as typeof import('@jupyterlab/services');

    const request = kernelConnection.requestExecute(
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
            traceInfoIfCI(`Got io pub message (stream), ${splitLines(msg.content.text.substr(0, 100)).join('\\n')}`);
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
                `Got io pub message (error), ${msg.content.ename},${msg.content.evalue}, ${msg.content.traceback
                    .join()
                    .substring(0, 100)}}`
            );
            if (errorOptions?.traceErrors) {
                const errorMessage = `${
                    errorOptions.traceErrorsMessage || 'Failed to execute (silent) code against the kernel'
                }, \nCode = ${code}\nError details: `;
                traceError(
                    `${errorMessage} ${msg.content.ename},${msg.content.evalue}, ${msg.content.traceback.join()}`
                );
            }
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

    const codeForLogging = splitLines(code.substring(0, 100)).join('\\n');

    // Handle any errors logged in the output if needed
    if (errorOptions) {
        handleExecuteSilentErrors(outputs, errorOptions, codeForLogging);
    }

    traceVerbose(`Executing silently Code (completed) = ${codeForLogging} with ${outputs.length} output(s)`);

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
                sendTelemetryEvent(errorOptions.telemetryName);
            }
        });
}
