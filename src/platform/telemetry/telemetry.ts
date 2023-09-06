// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// eslint-disable-next-line @typescript-eslint/no-require-imports
import cloneDeep from 'lodash/cloneDeep';
import { Uri } from 'vscode';
import { Resource } from '../common/types';
import { ResourceSpecificTelemetryProperties } from '../../telemetry';
import { getTelemetrySafeHashedString } from './helpers';
import { PythonEnvironment } from '../pythonEnvironments/info';
import { createDeferred } from '../common/utils/async';
import { getResourceType } from '../common/utils';
import { getComparisonKey } from '../vscode-path/resources';
import { traceError } from '../logging';

type Context = {
    previouslySelectedKernelConnectionId: string;
};
export const trackedInfo = new Map<string, [ResourceSpecificTelemetryProperties, Context]>();
export const pythonEnvironmentsByHash = new Map<string, PythonEnvironment>();
type InterpreterPackageProvider = (interpreter: PythonEnvironment) => Promise<Map<string, string>>;
let _interpreterPackageProvider: InterpreterPackageProvider | undefined;
export function initializeGlobals(interpreterPackageProvider: InterpreterPackageProvider) {
    _interpreterPackageProvider = interpreterPackageProvider;
}

/**
 * The python package information is fetch asynchronously.
 * Its possible the information is available at a later time.
 * Use this to update with the latest information (if available)
 */
export function updatePythonPackages(
    currentData: ResourceSpecificTelemetryProperties,
    clonedCurrentData?: ResourceSpecificTelemetryProperties
) {
    if (!currentData.pythonEnvironmentPath) {
        return;
    }
    // Getting package information is async, hence update property to indicate that a promise is pending.
    const deferred = createDeferred<void>();
    getPythonEnvironmentPackages({
        interpreterHash: currentData.pythonEnvironmentPath
    })
        .then((packages) => {
            currentData.pythonEnvironmentPackages = packages || currentData.pythonEnvironmentPackages;
            if (clonedCurrentData) {
                clonedCurrentData.pythonEnvironmentPackages = packages || clonedCurrentData.pythonEnvironmentPackages;
            }
        })
        .catch(() => undefined)
        .finally(() => {
            deferred.resolve();
        });
}
/**
 * Gets a JSON with hashed keys of some python packages along with their versions.
 */
async function getPythonEnvironmentPackages(options: { interpreter: PythonEnvironment } | { interpreterHash: string }) {
    if (!_interpreterPackageProvider) {
        traceError(`Python package provider is not initialized.`);
        return '{}';
    }
    let interpreter: PythonEnvironment | undefined;
    if ('interpreter' in options) {
        interpreter = options.interpreter;
    } else {
        interpreter = pythonEnvironmentsByHash.get(options.interpreterHash);
    }
    if (!interpreter) {
        return '{}';
    }
    const packages = await _interpreterPackageProvider(interpreter);
    if (!packages || packages.size === 0) {
        return '{}';
    }
    return JSON.stringify(Object.fromEntries(packages));
}
export function deleteTrackedInformation(resource: Uri) {
    trackedInfo.delete(getComparisonKey(resource));
}

/**
 * Always return a clone of the properties.
 * We will be using a reference of this object elsewhere & adding properties to the object.
 */
export async function getContextualPropsForTelemetry(resource: Resource): Promise<ResourceSpecificTelemetryProperties> {
    if (!resource) {
        return {};
    }
    const data = trackedInfo.get(getComparisonKey(resource));
    const resourceType = getResourceType(resource);
    if (!data && resourceType) {
        return {
            resourceType,
            resourceHash: resource ? await getTelemetrySafeHashedString(resource.toString()) : undefined
        };
    }
    if (!data) {
        return {};
    }
    // Create a copy of this data as it gets updated later asynchronously for other events.
    // At the point of sending this telemetry we don't want it to change again.
    const clonedData = cloneDeep(data[0]);
    // Possible the Python package information is now available, update the properties accordingly.
    // We want to update both the data items with package information
    // 1. Data we track against the Uri.
    // 2. Data that is returned & sent via telemetry now
    updatePythonPackages(data[0], clonedData);
    return clonedData;
}
