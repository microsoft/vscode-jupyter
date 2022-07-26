/* eslint-disable @typescript-eslint/no-explicit-any */
// Helper functions for dealing with kernels and kernelspecs

// eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
const NamedRegexp = require('named-js-regexp') as typeof import('named-js-regexp');
import * as path from '../platform/vscode-path/path';
import * as uriPath from '../platform/vscode-path/resources';
import * as nbformat from '@jupyterlab/nbformat';
import type { Kernel, KernelSpec } from '@jupyterlab/services';
// eslint-disable-next-line @typescript-eslint/no-require-imports
import cloneDeep = require('lodash/cloneDeep');
import * as url from 'url-parse';
import {
    KernelConnectionMetadata,
    LocalKernelSpecConnectionMetadata,
    LiveRemoteKernelConnectionMetadata,
    PythonKernelConnectionMetadata,
    IJupyterKernelSpec,
    IKernelConnectionSession
} from './types';
import { Uri } from 'vscode';
import { IWorkspaceService } from '../platform/common/application/types';
import { isCI, PYTHON_LANGUAGE, Telemetry } from '../platform/common/constants';
import { traceError, traceInfo, traceInfoIfCI, traceWarning } from '../platform/logging';
import { getDisplayPath, getFilePath } from '../platform/common/platform/fs-paths';
import { DataScience } from '../platform/common/utils/localize';
import { SysInfoReason } from '../messageTypes';
import { getNormalizedInterpreterPath, getInterpreterHash } from '../platform/pythonEnvironments/info/interpreter';
import { getTelemetrySafeVersion } from '../platform/telemetry/helpers';
import { EnvironmentType, PythonEnvironment } from '../platform/pythonEnvironments/info';
import { deserializePythonEnvironment, serializePythonEnvironment } from '../platform/api/pythonApi';
import { JupyterKernelSpec } from './jupyter/jupyterKernelSpec';
import { Resource } from '../platform/common/types';
import { getResourceType } from '../platform/common/utils';
import { sendTelemetryEvent } from '../telemetry';

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
export function createInterpreterKernelSpec(
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
        name: getInterpreterKernelSpecName(interpreter),
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

export function getInterpreterHashInMetadata(
    notebookMetadata: nbformat.INotebookMetadata | undefined
): string | undefined {
    if (!notebookMetadata) {
        return;
    }

    const metadataInterpreter: undefined | { hash?: string } =
        'interpreter' in notebookMetadata // In the past we'd store interpreter.hash directly under metadata, but now we store it under metadata.vscode.
            ? (notebookMetadata.interpreter as undefined | { hash?: string })
            : 'vscode' in notebookMetadata &&
              notebookMetadata.vscode &&
              typeof notebookMetadata.vscode === 'object' &&
              'interpreter' in notebookMetadata.vscode
            ? (notebookMetadata.vscode.interpreter as undefined | { hash?: string })
            : undefined;
    return metadataInterpreter?.hash;
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

export function rankKernels(
    kernels: KernelConnectionMetadata[],
    resource: Resource,
    notebookMetadata: nbformat.INotebookMetadata | undefined,
    preferredInterpreter: PythonEnvironment | undefined,
    preferredRemoteKernelId: string | undefined
): KernelConnectionMetadata[] | undefined {
    traceInfo(
        `Find preferred kernel for ${getDisplayPath(resource)} with metadata ${JSON.stringify(
            notebookMetadata || {}
        )} & preferred interpreter ${getDisplayPath(preferredInterpreter?.uri)}`
    );

    if (kernels.length === 0) {
        return;
    }

    // First calculate what the kernel spec would be for our active interpreter
    let preferredInterpreterKernelSpec =
        preferredInterpreter && findKernelSpecMatchingInterpreter(preferredInterpreter, kernels);
    if (preferredInterpreter && !preferredInterpreterKernelSpec) {
        const spec = createInterpreterKernelSpec(preferredInterpreter);
        preferredInterpreterKernelSpec = <PythonKernelConnectionMetadata>{
            kind: 'startUsingPythonInterpreter',
            kernelSpec: spec,
            interpreter: preferredInterpreter,
            id: getKernelId(spec, preferredInterpreter)
        };
        // Active interpreter isn't in the list of kernels,
        // Either because we're using a cached list or Python API isn't returning active interpreter
        // along with list of all interpreters.
        kernels.push(preferredInterpreterKernelSpec);
    }

    traceInfoIfCI(`preferredInterpreterKernelSpecIndex = ${preferredInterpreterKernelSpec?.id}`);

    // Figure out our possible language from the metadata
    const actualNbMetadataLanguage: string | undefined =
        notebookMetadata?.language_info?.name.toLowerCase() ||
        (notebookMetadata?.kernelspec as undefined | IJupyterKernelSpec)?.language?.toLowerCase();
    let possibleNbMetadataLanguage = actualNbMetadataLanguage;

    // If the notebook has a language set, remove anything not that language as we don't want to rank those items
    kernels = kernels.filter((kernel) => {
        if (
            possibleNbMetadataLanguage &&
            possibleNbMetadataLanguage !== PYTHON_LANGUAGE &&
            !notebookMetadata?.kernelspec &&
            kernel.kind !== 'connectToLiveRemoteKernel' &&
            kernel.kernelSpec.language &&
            kernel.kernelSpec.language.toLowerCase() !== possibleNbMetadataLanguage
        ) {
            return false;
        }
        // Return everything else
        return true;
    });

    // Now perform our big comparison on the kernel list
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
            b,
            preferredRemoteKernelId
        )
    );
    return kernels;
}

export function isExactMatch(
    kernelConnection: KernelConnectionMetadata,
    notebookMetadata: nbformat.INotebookMetadata | undefined,
    preferredRemoteKernelId: string | undefined
): boolean {
    // Live kernel ID match is always an exact match
    if (
        kernelConnection.kind === 'connectToLiveRemoteKernel' &&
        preferredRemoteKernelId &&
        kernelConnection.kernelModel.id === preferredRemoteKernelId
    ) {
        return true;
    }

    // To get an exact match, we need to have a kernelspec in the metadata
    if (!notebookMetadata || !notebookMetadata.kernelspec) {
        return false;
    }

    if (
        getInterpreterHashInMetadata(notebookMetadata) &&
        interpreterMatchesThatInNotebookMetadata(kernelConnection, notebookMetadata)
    ) {
        // Case: Metadata has interpreter, in this case it should have an interpreter
        // and a kernel spec that should fully match, note that in this case matching
        // name on a default python kernel spec is ok (as the interpreter hash matches)
        return isKernelSpecExactMatch(kernelConnection, notebookMetadata.kernelspec, true);
    } else {
        // Case: Metadata does not have an interpreter, in this case just full match on the
        // kernelspec, but do not accept default python name as valid for an exact match
        return isKernelSpecExactMatch(kernelConnection, notebookMetadata.kernelspec, false);
    }
}

function isKernelSpecExactMatch(
    kernelConnection: KernelConnectionMetadata,
    notebookMetadataKernelSpec: nbformat.IKernelspecMetadata,
    allowPythonDefaultMatch: boolean
): boolean {
    if (kernelConnection.kind === 'connectToLiveRemoteKernel') {
        return false;
    }
    const kernelConnectionKernelSpec = kernelConnection.kernelSpec;

    // Get our correct kernelspec name from the connection
    const connectionOriginalSpecFile =
        kernelConnectionKernelSpec.metadata?.vscode?.originalSpecFile ||
        kernelConnectionKernelSpec.metadata?.originalSpecFile;
    const connectionKernelSpecName = connectionOriginalSpecFile
        ? path.basename(path.dirname(connectionOriginalSpecFile))
        : kernelConnectionKernelSpec?.name || '';
    const connectionInterpreterEnvName = kernelConnection.interpreter?.envName;
    const metadataNameIsDefaultName = isDefaultKernelSpec({
        argv: [],
        display_name: notebookMetadataKernelSpec.display_name,
        name: notebookMetadataKernelSpec.name,
        executable: ''
    });

    if (allowPythonDefaultMatch && metadataNameIsDefaultName) {
        // If default is allowed (due to interpreter hash match) and the metadata name is a default name then allow the match
        return true;
    } else if (
        !metadataNameIsDefaultName &&
        (connectionKernelSpecName === notebookMetadataKernelSpec.name ||
            connectionInterpreterEnvName === notebookMetadataKernelSpec.name)
    ) {
        // If default match is not ok, only accept name / display name match for
        // non-default kernel specs
        return true;
    }

    return false;
}

export function compareKernels(
    _resource: Resource,
    possibleNbMetadataLanguage: string | undefined,
    actualNbMetadataLanguage: string | undefined,
    notebookMetadata: nbformat.INotebookMetadata | undefined,
    activeInterpreterConnection: KernelConnectionMetadata | undefined,
    a: KernelConnectionMetadata,
    b: KernelConnectionMetadata,
    preferredRemoteKernelId: string | undefined
) {
    // If any ids match the perferred remote kernel id for a live connection that wins over everything
    if (
        a.kind === 'connectToLiveRemoteKernel' &&
        preferredRemoteKernelId &&
        a.kernelModel.id === preferredRemoteKernelId
    ) {
        // No need to deal with ties here since ID is unique for this case
        return 1;
    } else if (
        b.kind === 'connectToLiveRemoteKernel' &&
        preferredRemoteKernelId &&
        b.kernelModel.id === preferredRemoteKernelId
    ) {
        return -1;
    }

    //  Do not sort other live kernel connections (they are at the bottom);
    if (a.kind === b.kind && b.kind === 'connectToLiveRemoteKernel') {
        return 0;
    }
    if (a.kind === 'connectToLiveRemoteKernel') {
        return -1;
    }
    if (b.kind === 'connectToLiveRemoteKernel') {
        return 1;
    }

    // Make sure we are comparing lower case here as we have seen C# => c# mis-matches
    const aLang = a.kernelSpec.language?.toLowerCase();
    const bLang = b.kernelSpec.language?.toLowerCase();
    possibleNbMetadataLanguage = possibleNbMetadataLanguage?.toLowerCase();
    actualNbMetadataLanguage = actualNbMetadataLanguage?.toLowerCase();

    if (!notebookMetadata?.kernelspec) {
        if (possibleNbMetadataLanguage) {
            if (
                possibleNbMetadataLanguage === PYTHON_LANGUAGE &&
                aLang === bLang &&
                aLang === possibleNbMetadataLanguage
            ) {
                // Fall back to returning the active interpreter (further below).
            } else if (aLang === bLang && aLang === possibleNbMetadataLanguage) {
                return 0;
            } else if (aLang === possibleNbMetadataLanguage) {
                return 1;
            } else if (bLang === possibleNbMetadataLanguage) {
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
        : a.kernelSpec?.name || '';
    const kernelSpecNameOfB = originalSpecFileB
        ? path.basename(path.dirname(originalSpecFileB))
        : b.kernelSpec?.name || '';

    // Special simple comparison algorithm for Non-Python notebooks.
    if (possibleNbMetadataLanguage && possibleNbMetadataLanguage !== PYTHON_LANGUAGE) {
        // If this isn't a python notebook, then just look at the name & display name.
        if (aLang && bLang && aLang !== possibleNbMetadataLanguage && bLang !== possibleNbMetadataLanguage) {
            return 0;
        } else if (aLang === possibleNbMetadataLanguage && bLang !== possibleNbMetadataLanguage) {
            return 1;
        } else if (aLang !== possibleNbMetadataLanguage && bLang === possibleNbMetadataLanguage) {
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
            aLang !== PYTHON_LANGUAGE &&
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
            bLang !== PYTHON_LANGUAGE &&
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
    if (aLang && bLang) {
        if (aLang === bLang) {
            if (aLang !== PYTHON_LANGUAGE) {
                return 0;
            }
        } else {
            return aLang === PYTHON_LANGUAGE ? 1 : -1;
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
            // Interpreter should trump kernelspec
        } else if (a.kind === 'startUsingPythonInterpreter' && b.kind !== 'startUsingPythonInterpreter') {
            return 1;
        } else if (a.kind !== 'startUsingPythonInterpreter' && b.kind === 'startUsingPythonInterpreter') {
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
    if (a.kind === 'connectToLiveRemoteKernel' || b.kind === 'connectToLiveRemoteKernel') {
        if (a.kind !== 'connectToLiveRemoteKernel') {
            return 1;
        } else if (b.kind !== 'connectToLiveRemoteKernel') {
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
        const kernelRegA = a.kind !== 'connectToLiveRemoteKernel' ? getKernelRegistrationInfo(a.kernelSpec) : '';
        const kernelRegB = b.kind !== 'connectToLiveRemoteKernel' ? getKernelRegistrationInfo(b.kernelSpec) : '';
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
    if (a.kind === 'connectToLiveRemoteKernel' && b.kind === 'connectToLiveRemoteKernel') {
        return 0;
    } else if (a.kind === 'connectToLiveRemoteKernel') {
        return -1;
    } else if (b.kind === 'connectToLiveRemoteKernel') {
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
        // Give preference to kernel a that starts using a plain Python for a custom kernelspec.
        return 1;
    } else if (b.kind === 'startUsingPythonInterpreter' && b.kind !== a.kind) {
        // Give preference to kernel b that starts using a plain Python for a custom kernelspec.
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
    if (a.kind === 'connectToLiveRemoteKernel' && b.kind === 'connectToLiveRemoteKernel') {
        return 0;
    } else if (a.kind === 'connectToLiveRemoteKernel') {
        return -1;
    } else if (b.kind === 'connectToLiveRemoteKernel') {
        return 1;
    }
    if (!notebookMetadata?.kernelspec?.display_name) {
        return 0;
    }
    const metadataPointsToADefaultKernelSpec = isDefaultKernelSpec({
        argv: [],
        display_name: notebookMetadata.kernelspec.display_name,
        name: notebookMetadata.kernelspec.name,
        executable: ''
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
export function findKernelSpecMatchingInterpreter(
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
        traceError(`More than one kernel spec matches the interpreter ${interpreter.uri}.`, result);
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
    const interpreterHashForKernel = kernelConnection.interpreter
        ? getInterpreterHash(kernelConnection.interpreter)
        : undefined;
    return (
        interpreterHashInMetadata &&
        (kernelConnection.kind === 'startUsingLocalKernelSpec' ||
            kernelConnection.kind === 'startUsingRemoteKernelSpec' ||
            kernelConnection.kind === 'startUsingPythonInterpreter') &&
        kernelConnection.interpreter &&
        interpreterHashForKernel === interpreterHashInMetadata
    );
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
            return nbFile.toLowerCase().endsWith('.ipynb') ? nbFile : `${nbFile}.ipynb`;
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
                kernelConnection.interpreter.envType !== EnvironmentType.Global
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
                const envName = getPythonEnvironmentName(kernelConnection.interpreter);
                return envName ? `${envName} (${pythonDisplayName})` : pythonDisplayName;
            }
    }
    return oldDisplayName;
}
function getPythonEnvironmentName(pythonEnv: PythonEnvironment) {
    // Sometimes Python extension doesn't detect conda environments correctly (e.g. conda env create without a name).
    // In such cases the envName is empty, but it has a path.
    let envName = pythonEnv.envName;
    if (pythonEnv.envPath && pythonEnv.envType === EnvironmentType.Conda && !pythonEnv.envName) {
        envName = uriPath.basename(pythonEnv.envPath);
    }
    return envName;
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

    return displayName || name || interpreterName || '';
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

export function getKernelPathFromKernelConnection(kernelConnection?: KernelConnectionMetadata): Uri | undefined {
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
        return DataScience.jupyterSelectURIRunningDetailFormat().format(
            kernelConnection.kernelModel.lastActivityTime.toLocaleString(),
            kernelConnection.kernelModel.numberOfConnections.toString()
        );
    }
    return defaultValue;
}

export function getKernelConnectionPath(
    kernelConnection: KernelConnectionMetadata | undefined,
    workspaceService: IWorkspaceService
) {
    if (kernelConnection?.kind === 'connectToLiveRemoteKernel') {
        return undefined;
    }
    const kernelPath = getKernelPathFromKernelConnection(kernelConnection);
    // If we have just one workspace folder opened, then ensure to use relative paths
    // where possible (e.g. for virtual environments).
    const folders = workspaceService.workspaceFolders ? workspaceService.workspaceFolders : [];
    return kernelPath ? getDisplayPath(kernelPath, folders) : '';
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
        return deserializePythonEnvironment(model?.metadata?.interpreter);
    }
    const kernelSpec = kernelConnectionMetadataHasKernelSpec(kernelConnection)
        ? kernelConnection.kernelSpec
        : undefined;
    return deserializePythonEnvironment(kernelSpec?.metadata?.interpreter);
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
): Uri | undefined {
    const folder = workspaceService.getWorkspaceFolder(interpreter.uri);
    return folder?.uri || workspaceService.rootFolder;
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
    const regEx = NamedRegexp('python\\s*(?<version>(\\d+))', 'g');
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
    telemetryName?: Telemetry;
};

export async function executeSilently(
    session: IKernelConnectionSession | Kernel.IKernelConnection,
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
                `Got io pub message (error), ${msg.content.ename},${msg.content.evalue}, ${msg.content.traceback
                    .join()
                    .substring(0, 100)}}`
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

    traceInfo(`Executing silently Code (completed) = ${codeForLogging} with ${outputs.length} output(s)`);

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

export function serializeKernelConnection(kernelConnection: KernelConnectionMetadata) {
    if (kernelConnection.interpreter) {
        return {
            ...kernelConnection,
            interpreter: serializePythonEnvironment(kernelConnection.interpreter)!
        };
    }
    return kernelConnection;
}

export function deserializeKernelConnection(kernelConnection: any): KernelConnectionMetadata {
    if (kernelConnection.interpreter) {
        return {
            ...kernelConnection,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            interpreter: deserializePythonEnvironment(kernelConnection.interpreter as any)!
        };
    }
    return kernelConnection;
}
