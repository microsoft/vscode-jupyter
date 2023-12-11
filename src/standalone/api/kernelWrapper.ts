// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { Kernel, Session } from '@jupyterlab/services';
import type { ICommOpenMsg } from '@jupyterlab/services/lib/kernel/messages';
import {
    registerCommTargetFor3rdPartyExtensions,
    remoteCommTargetFor3rdPartyExtensions
} from '../../notebooks/controllers/ipywidgets/message/ipyWidgetMessageDispatcher';

const wrappedSession = new WeakMap<Session.ISessionConnection, Session.ISessionConnection>();
export function wrapKernelSession(session: Session.ISessionConnection) {
    let wrapper = wrappedSession.get(session);
    if (!wrapper) {
        wrapper = createSessionWrapper(session);
        wrappedSession.set(session, wrapper);
    }
    return wrapper;
}

function createSessionWrapper(session: Session.ISessionConnection) {
    return new Proxy(session, {
        get(target: Session.ISessionConnection, p: string | symbol) {
            if (p === 'kernel') {
                if (!target.kernel) {
                    return;
                }
                return wrapKernel(target.kernel);
            }
            return Reflect.get(target, p);
        }
    });
}

const wrappedKernel = new WeakMap<Kernel.IKernelConnection, Kernel.IKernelConnection>();
export function wrapKernel(kernel: Kernel.IKernelConnection) {
    let wrapper = wrappedKernel.get(kernel);
    if (!wrapper) {
        wrapper = createKernelWrapper(kernel);
        wrappedKernel.set(kernel, wrapper);
    }
    return wrapper;
}

function createKernelWrapper(kernel: Kernel.IKernelConnection) {
    return new Proxy(kernel, {
        get(target: Kernel.IKernelConnection, p: keyof Kernel.IKernelConnection | symbol) {
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
                    remoteCommTargetFor3rdPartyExtensions(kernel, targetName);
                    return Reflect.get(target, p).apply(target, [targetName, callback]);
                };
            }
            return Reflect.get(target, p);
        }
    });
}
