// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

import * as nbformat from '@jupyterlab/nbformat';
import {
    createInterpreterKernelSpec,
    getKernelId,
    getKernelRegistrationInfo,
    isDefaultKernelSpec,
    isDefaultPythonKernelSpecName,
    isPythonNotebook
} from '../../../kernels/helpers';
import { IJupyterKernelSpec, KernelConnectionMetadata, PythonKernelConnectionMetadata } from '../../../kernels/types';
import { isCI, PYTHON_LANGUAGE } from '../../../platform/common/constants';
import { getDisplayPath } from '../../../platform/common/platform/fs-paths';
import { Resource } from '../../../platform/common/types';
import { getResourceType } from '../../../platform/common/utils';
import { traceError, traceInfo, traceInfoIfCI } from '../../../platform/logging';
import { PythonEnvironment } from '../../../platform/pythonEnvironments/info';
import { getInterpreterHash } from '../../../platform/pythonEnvironments/info/interpreter';
import * as path from '../../../platform/vscode-path/path';

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

function getInterpreterHashInMetadata(notebookMetadata: nbformat.INotebookMetadata | undefined): string | undefined {
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
                      (notebookMetadata?.kernelspec?.language as string) || notebookMetadata?.language_info?.name
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
