// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ServerConnection,
    KernelManager,
    SessionManager,
    KernelSpec,
    Kernel,
    Session,
    KernelSpecManager,
    Terminal,
    Contents,
    ContentsManager,
    TerminalManager
} from '@jupyterlab/services';
import { ServiceContainer } from '../../platform/ioc/container';
import { Lazy } from '../../platform/common/utils/lazy';
import { IAsyncDisposable, IAsyncDisposableRegistry } from '../../platform/common/types';
import { disposeManager } from '../../platform/common/utils/jupyterlab';
import { IJupyterLabManagers } from './types';

function computeConnectionId(serverSettings: ServerConnection.ISettings) {
    return [serverSettings.baseUrl, serverSettings.token, JSON.stringify(serverSettings.init.headers || {})]
        .map((item) => (item ? item.toString() : ''))
        .join('#');
}

// eslint-disable-next-line @typescript-eslint/no-use-before-define
const managers = new Map<string, IJupyterLabManagers & IAsyncDisposable>();

class Manager implements IJupyterLabManagers, IAsyncDisposable {
    private readonly _sessionManager: Lazy<SessionManager>;
    public readonly _kernelManager: Lazy<Kernel.IManager>;
    public readonly _kernelSpecManager: Lazy<KernelSpec.IManager>;
    public readonly _terminalManager: Lazy<Terminal.IManager>;
    public readonly _contentsManager: Lazy<Contents.IManager>;
    public get sessionManager(): Session.IManager {
        return this._sessionManager.getValue();
    }
    public get kernelManager(): Kernel.IManager {
        return this._kernelManager.getValue();
    }
    public get kernelSpecManager(): KernelSpec.IManager {
        return this._kernelSpecManager.getValue();
    }
    public get contentsManager(): Contents.IManager {
        return this._contentsManager.getValue();
    }
    public get terminalManager(): Terminal.IManager {
        return this._terminalManager.getValue();
    }
    constructor(public readonly serverSettings: ServerConnection.ISettings) {
        this._kernelManager = new Lazy(() => new KernelManager({ serverSettings }));
        this._kernelSpecManager = new Lazy(() => new KernelSpecManager({ serverSettings }));
        this._contentsManager = new Lazy(() => new ContentsManager({ serverSettings }));
        this._terminalManager = new Lazy(() => new TerminalManager({ serverSettings }));
        this._sessionManager = new Lazy(
            () => new SessionManager({ serverSettings, kernelManager: this.kernelManager })
        );
    }
    async dispose(): Promise<void> {
        await Promise.all(
            [this._kernelManager, this._kernelSpecManager, this._sessionManager].map((manager) => {
                if (manager.hasValue()) {
                    return disposeManager(manager.getValue());
                }
                return Promise.resolve();
            })
        );
    }
}

export function getJupyterLabManager(serverSettings: ServerConnection.ISettings): IJupyterLabManagers {
    const id = computeConnectionId(serverSettings);
    let manager = managers.get(id);
    if (manager) {
        return manager;
    }
    const asyncDisposables = ServiceContainer.instance.get<IAsyncDisposableRegistry>(IAsyncDisposableRegistry);
    manager = new Manager(serverSettings);
    asyncDisposables.push(manager);
    managers.set(id, manager);
    return manager;
}
