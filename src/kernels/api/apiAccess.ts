// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ExtensionMode, Uri, env, extensions, l10n, window, workspace } from 'vscode';
import { JVSC_EXTENSION_ID } from '../../platform/common/constants';
import { ServiceContainer } from '../../platform/ioc/container';
import { traceError } from '../../platform/logging';
import { IDisposableRegistry, IExtensionContext } from '../../platform/common/types';
import { once } from '../../platform/common/utils/functional';
import { Common } from '../../platform/common/utils/localize';
import { noop } from '../../platform/common/utils/misc';

const extensionApiAccess = new Map<string, ReturnType<typeof requestKernelAccessImpl>>();
const extensionsTriedAccessingApi = new Set<string>();
export function clearApiAccess() {
    extensionApiAccess.clear();
}
export async function requestApiAccess(extensionId: string): Promise<{ accessAllowed: boolean }> {
    if (!workspace.isTrusted) {
        return { accessAllowed: false };
    }
    if (extensionId === JVSC_EXTENSION_ID) {
        // Our own extension can use this API (used in tests)
        return { accessAllowed: true };
    }
    let apiAccess = extensionApiAccess.get(extensionId);
    if (!apiAccess) {
        apiAccess = requestKernelAccessImpl(extensionId);
        extensionApiAccess.set(extensionId, apiAccess);
        void apiAccess.then(({ result }) => {
            if (
                (result === 'learnMore' || result === 'cancelled') &&
                extensionApiAccess.get(extensionId) === apiAccess
            ) {
                extensionApiAccess.delete(extensionId);
                extensionsTriedAccessingApi.add(extensionId);
            }
        });
    }
    return apiAccess.then(({ result }) => ({ accessAllowed: result === 'allowed' }));
}

async function requestKernelAccessImpl(
    extensionId: string
): Promise<{ result: 'allowed' | 'denied' | 'learnMore' | 'cancelled' }> {
    const accessInfo = await getAccessForExtensionsFromStore();
    if (accessInfo.get(extensionId) === true) {
        return { result: 'allowed' };
    }
    const displayName = extensions.getExtension(extensionId)?.packageJSON?.displayName;
    if (!displayName) {
        traceError(`Kernel API access revoked, as extension ${extensionId} does not exist!`);
        return { result: 'denied' };
    }
    const allow = l10n.t('Allow');
    const deny = l10n.t('Deny');
    const result = await window.showInformationMessage(
        l10n.t('Do you want to grant Kernel access to the extension {0} ({1})?', displayName, extensionId),
        {
            modal: true,
            detail: l10n.t('This allows the extension to execute code against Jupyter Kernels.')
        },
        allow,
        Common.learnMore,
        deny
    );

    if (result === Common.learnMore) {
        env.openExternal(Uri.parse('https://aka.ms/vscodeJupyterKernelApiAccess')).then(noop, noop);
    } else if (result === allow || result === deny) {
        await updateIndividualExtensionAccessInStore(extensionId, result === allow);
    }
    switch (result) {
        case allow:
            return { result: 'allowed' };
        case Common.learnMore:
            return { result: 'learnMore' };
        case deny:
            return { result: 'denied' };
        default:
            return { result: 'cancelled' };
    }
}

export async function getExtensionAccessListForManagement() {
    const extensionsWithoutAccess = new Set<string>();
    const [extensions] = await Promise.all([
        getAccessForExtensionsFromStore().then((accessInfo) => new Map(accessInfo)),
        ...Array.from(extensionApiAccess.entries()).map(async ([extensionId, promise]) => {
            if ((await promise).result !== 'allowed') {
                extensionsWithoutAccess.add(extensionId);
            }
        })
    ]);
    extensionsWithoutAccess.forEach((extensionId) => extensions.set(extensionId, false));
    extensionsTriedAccessingApi.forEach((extensionId) =>
        extensions.set(extensionId, extensions.get(extensionId) === true)
    );
    return extensions;
}

const apiAccessSecretKey = 'API.Access';
let cachedAccessInfo: Map<string, boolean> | undefined;

async function getAccessForExtensionsFromStore(ignoreCache: boolean = false): Promise<Map<string, boolean>> {
    const context = ServiceContainer.instance.get<IExtensionContext>(IExtensionContext);
    if (context.extensionMode === ExtensionMode.Test) {
        // In our tests always allow access.
        return new Map<string, boolean>();
    }

    once(() => {
        const disposables = ServiceContainer.instance.get<IDisposableRegistry>(IDisposableRegistry);
        disposables.push(
            context.secrets.onDidChange((e) => {
                e.key === apiAccessSecretKey ? (cachedAccessInfo = undefined) : undefined;
            })
        );
    })();

    if (cachedAccessInfo && !ignoreCache) {
        return cachedAccessInfo;
    }
    let json: string | undefined = '';
    try {
        json = await context.secrets.get(apiAccessSecretKey);
        if (!json || json.length === 0) {
            return new Map<string, boolean>();
        }
        cachedAccessInfo = new Map<string, boolean>(Object.entries(JSON.parse(json)));
        return cachedAccessInfo;
    } catch (ex) {
        traceError(`Failed to parse API access information ${json}`, ex);
        return new Map<string, boolean>();
    }
}

// Chain the updates, as we do not want to lose any transient updates/changes.
let updatePromise = Promise.resolve();
export async function updateListOfExtensionsAllowedToAccessApi(extensionIds: string[]) {
    return (updatePromise = updatePromise.then(async () => {
        await Promise.all(
            Array.from(extensionApiAccess.entries()).map(async ([extensionId, promise]) => {
                const access = await promise;
                access.result = extensionIds.includes(extensionId) === true ? 'allowed' : 'denied';
            })
        );
        cachedAccessInfo = new Map(extensionIds.map((extensionId) => [extensionId, true]));
        const context = ServiceContainer.instance.get<IExtensionContext>(IExtensionContext);
        if (context.extensionMode === ExtensionMode.Test) {
            return;
        }
        try {
            await context.secrets.store(apiAccessSecretKey, JSON.stringify(Object.fromEntries(cachedAccessInfo)));
        } catch (ex) {
            traceError(
                `Failed to update API access information ${JSON.stringify(Object.fromEntries(cachedAccessInfo))}`,
                ex
            );
        }
    }));
}

async function updateIndividualExtensionAccessInStore(extensionId: string, accessAllowed: boolean) {
    return (updatePromise = updatePromise.then(async () => {
        const context = ServiceContainer.instance.get<IExtensionContext>(IExtensionContext);
        if (context.extensionMode === ExtensionMode.Test) {
            return;
        }
        const apiAccess = await getAccessForExtensionsFromStore(true);
        if (accessAllowed === apiAccess.get(extensionId)) {
            return;
        }
        apiAccess.set(extensionId, accessAllowed);
        try {
            await context.secrets.store(apiAccessSecretKey, JSON.stringify(Object.fromEntries(apiAccess)));
        } catch (ex) {
            traceError(`Failed to store API access information ${JSON.stringify(Object.fromEntries(apiAccess))}`, ex);
        }
    }));
}
