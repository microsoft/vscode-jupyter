// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { Kernel, Session } from '@jupyterlab/services';
import type { ICommOpenMsg } from '@jupyterlab/services/lib/kernel/messages';
import {
    registerCommTargetFor3rdPartyExtensions,
    removeCommTargetFor3rdPartyExtensions
} from '../../../notebooks/controllers/ipywidgets/message/ipyWidgetMessageDispatcher';
import { Telemetry, sendTelemetryEvent } from '../../../telemetry';
import { traceWarning } from '../../../platform/logging';

type ExtensionId = string;
const wrappedSession = new WeakMap<Session.ISessionConnection, Map<ExtensionId, Session.ISessionConnection>>();
export function wrapKernelSession(session: Session.ISessionConnection, extensionId: string) {
    let wrapper = wrappedSession.get(session)?.get(extensionId);
    if (!wrapper) {
        wrapper = createSessionWrapper(session, extensionId);
        const map = wrappedSession.get(session) || new Map<ExtensionId, Session.ISessionConnection>();
        map.set(extensionId, wrapper);
        wrappedSession.set(session, map);
    }
    return wrapper;
}

function createSessionWrapper(session: Session.ISessionConnection, extensionId: string) {
    return new Proxy(session, {
        get(target: Session.ISessionConnection, p: string | symbol) {
            sendSessionUsageTelemetry(extensionId, p);
            if (p === 'kernel') {
                if (!target.kernel) {
                    return;
                }
                return wrapKernel(target.kernel, extensionId);
            }
            return Reflect.get(target, p);
        }
    });
}

function sendSessionUsageTelemetry(extensionId: string, pemUsed: string | symbol) {
    try {
        sendTelemetryEvent(Telemetry.JupyterKernelApiSessionPEMUsage, undefined, {
            extensionId,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            pemUsed: pemUsed.toString() as any
        });
    } catch (ex) {
        traceWarning(`Failed to send telemetry for JupyterKernelApiSessionPEMUsage. ${ex}`);
    }
}

const wrappedKernel = new WeakMap<Kernel.IKernelConnection, Map<ExtensionId, Kernel.IKernelConnection>>();
export function wrapKernel(kernel: Kernel.IKernelConnection, extensionId: string) {
    let wrapper = wrappedKernel.get(kernel)?.get(extensionId);
    if (!wrapper) {
        wrapper = createKernelWrapper(kernel, extensionId);
        const map = wrappedKernel.get(kernel) || new Map<ExtensionId, Kernel.IKernelConnection>();
        map.set(extensionId, wrapper);
        wrappedKernel.set(kernel, map);
    }
    return wrapper;
}

function createKernelWrapper(kernel: Kernel.IKernelConnection, extensionId: string) {
    return new Proxy(kernel, {
        get(target: Kernel.IKernelConnection, p: keyof Kernel.IKernelConnection | symbol) {
            sendKernelUsageTelemetry(extensionId, p);
            if (p === 'registerCommTarget') {
                return (
                    targetName: string,
                    callback: (comm: Kernel.IComm, msg: ICommOpenMsg<'iopub' | 'shell'>) => void | PromiseLike<void>
                ): void => {
                    registerCommTargetFor3rdPartyExtensions(kernel, targetName);
                    return Reflect.get(target, p).apply(target, [targetName, callback]);
                };
            }
            if (p === 'removeCommTarget') {
                return (
                    targetName: string,
                    callback: (comm: Kernel.IComm, msg: ICommOpenMsg<'iopub' | 'shell'>) => void | PromiseLike<void>
                ): void => {
                    removeCommTargetFor3rdPartyExtensions(kernel, targetName);
                    return Reflect.get(target, p).apply(target, [targetName, callback]);
                };
            }
            return Reflect.get(target, p);
        }
    });
}

function sendKernelUsageTelemetry(extensionId: string, pemUsed: string | symbol) {
    try {
        sendTelemetryEvent(Telemetry.JupyterKernelApiKernelPEMUsage, undefined, {
            extensionId,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            pemUsed: pemUsed.toString() as any
        });
    } catch (ex) {
        traceWarning(`Failed to send telemetry for JupyterKernelApiKernelPEMUsage. ${ex}`);
    }
}
