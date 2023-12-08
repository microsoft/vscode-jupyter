// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Kernel, KernelSpec, ServerConnection, Session } from '@jupyterlab/services';
import { Signal } from '@lumino/signaling';
import { noop } from '../../platform/common/utils/misc';
import { inject, injectable } from 'inversify';
import { IKernelFinder, IKernelProvider } from '../../kernels/types';
import { ContributedKernelFinderKind } from '../../kernels/internalTypes';
import { IIterator } from '@lumino/algorithm';
// eslint-disable-next-line import/no-restricted-paths
import { ContributedLocalKernelSpecFinder } from '../../kernels/raw/finder/contributedLocalKernelSpecFinder.node';
// eslint-disable-next-line import/no-restricted-paths
import { RawJupyterSessionWrapper } from '../../kernels/raw/session/rawJupyterSession.node';

export function sessionToModel(session: Session.ISessionConnection): undefined | Session.IModel {
    if (!session.kernel) {
        return;
    }
    return {
        id: session.id,
        name: session.name,
        path: session.path,
        type: session.type,
        kernel: {
            id: session.kernel.id,
            name: session.kernel.name
        }
    };
}
export function getLocalSessions(kernelProvider: IKernelProvider) {
    const localKernels = kernelProvider.kernels.filter(
        (k) =>
            k.kernelConnectionMetadata.kind === 'startUsingPythonInterpreter' ||
            k.kernelConnectionMetadata.kind === 'startUsingLocalKernelSpec'
    );

    return localKernels
        .filter((k) => k.session && k.session instanceof RawJupyterSessionWrapper)
        .filter((item) => !!item)
        .map((k) => k.session! as unknown as RawJupyterSessionWrapper);
}
export class SessionManager implements Session.IManager {
    public readonly runningChanged = new Signal<this, Session.IModel[]>(this);
    public readonly connectionFailure = new Signal<this, ServerConnection.NetworkError>(this);
    public readonly disposed = new Signal<this, void>(this);
    public get serverSettings(): ServerConnection.ISettings {
        throw new Error('Method not implemented.');
    }
    public readonly isReady: boolean = true;
    public readonly ready = Promise.resolve();
    isDisposed: boolean;
    constructor(private readonly kernelProvider: IKernelProvider) {
        kernelProvider.onDidCreateKernel((e) => {
            e.onStarted(() => {
                if (e.session) {
                    this.runningChanged.emit(getLocalSessions(this.kernelProvider));
                }
            });
        });
        kernelProvider.onDidDisposeKernel(() => {
            this.runningChanged.emit(getLocalSessions(this.kernelProvider));
        });
        kernelProvider.onDidStartKernel(() => {
            this.runningChanged.emit(getLocalSessions(this.kernelProvider));
        });
    }
    running(): IIterator<Session.IModel> {
        const sessions = [...getLocalSessions(this.kernelProvider)];
        return {
            iter: () => this.running(),
            next: () => {
                if (sessions.length) {
                    const session = sessions.shift();
                    return session ? sessionToModel(session) : undefined;
                }
                return undefined;
            },
            clone() {
                return this;
            }
        };
    }
    startNew(
        _createOptions: Session.ISessionOptions,
        _connectOptions?:
            | Omit<Session.ISessionConnection.IOptions, 'serverSettings' | 'model' | 'connectToKernel'>
            | undefined
    ): Promise<Session.ISessionConnection> {
        throw new Error('Method not implemented.');
    }
    async findById(id: string): Promise<Session.IModel | undefined> {
        const session = this.kernelProvider.kernels.find((item) => item.session?.id === id)?.session;
        return session ? sessionToModel(session) : undefined;
    }
    async findByPath(path: string): Promise<Session.IModel | undefined> {
        const session = this.kernelProvider.kernels.find((item) => item.session?.path === path)?.session;
        return session ? sessionToModel(session) : undefined;
    }
    connectTo(
        options: Omit<Session.ISessionConnection.IOptions, 'serverSettings' | 'connectToKernel'>
    ): Session.ISessionConnection {
        const session = this.kernelProvider.kernels.find((item) => item.session?.id === options.model.id)?.session;
        if (!session) {
            throw new Error('Session not found');
        }
        // This is not correct, we need to create a new session using the same connection file.
        return session;
    }
    async shutdown(id: string): Promise<void> {
        const session = this.kernelProvider.kernels.find((item) => item.session?.id === id)?.session;
        if (!session) {
            throw new Error('Session not found');
        }
        await session.shutdown();
    }
    async shutdownAll(): Promise<void> {
        await Promise.all(this.kernelProvider.kernels.map((item) => item.session?.shutdown()));
    }
    async refreshRunning(): Promise<void> {
        //
    }
    stopIfNeeded(_path: string): Promise<void> {
        throw new Error('Method not implemented.');
    }
    dispose(): void {
        //
    }
}
export class LocalKernelManagerAdapter implements Kernel.IManager {
    public readonly runningChanged = new Signal<this, Kernel.IModel[]>(this);
    public readonly connectionFailure = new Signal<this, ServerConnection.NetworkError>(this);
    public readonly disposed = new Signal<this, void>(this);
    public get serverSettings(): ServerConnection.ISettings {
        throw new Error('Method not implemented.');
    }
    public readonly isReady: boolean = true;
    public readonly ready = Promise.resolve();
    isDisposed: boolean;
    running(): IIterator<Kernel.IModel> {
        return {
            iter: () => this.running(),
            next: () => undefined,
            clone() {
                return this;
            }
        };
    }
    async refreshRunning(): Promise<void> {
        //
    }
    startNew(
        _createOptions?: Partial<Pick<Kernel.IModel, 'name'>> | undefined,
        _connectOptions?: Omit<Kernel.IKernelConnection.IOptions, 'serverSettings' | 'model'> | undefined
    ): Promise<Kernel.IKernelConnection> {
        throw new Error('Method not implemented.');
    }
    findById(_id: string): Promise<Kernel.IModel | undefined> {
        throw new Error('Method not implemented.');
    }
    connectTo(_options: Kernel.IKernelConnection.IOptions): Kernel.IKernelConnection {
        throw new Error('Method not implemented.');
    }
    shutdown(_id: string): Promise<void> {
        throw new Error('Method not implemented.');
    }
    shutdownAll(): Promise<void> {
        throw new Error('Method not implemented.');
    }
    dispose(): void {
        throw new Error('Method not implemented.');
    }
}
@injectable()
export class LocalkernelsApiAdapter implements KernelSpec.IManager {
    public readonly specsChanged = new Signal<this, KernelSpec.ISpecModels>(this);
    public readonly connectionFailure = new Signal<this, ServerConnection.NetworkError>(this);
    public readonly disposed = new Signal<this, void>(this);
    public get serverSettings(): ServerConnection.ISettings {
        throw new Error('Method not implemented.');
    }
    public readonly isReady: boolean = true;
    public readonly ready = Promise.resolve();
    isDisposed: boolean;
    public get specs(): KernelSpec.ISpecModels {
        const specs: KernelSpec.ISpecModels = {
            default: '',
            kernelspecs: {}
        };
        this.finder.kernels.forEach((kernelSpec) => {
            specs.kernelspecs[kernelSpec.kernelSpec.name] = {
                argv: kernelSpec.kernelSpec.argv,
                display_name: kernelSpec.kernelSpec.display_name,
                language: kernelSpec.kernelSpec.language || '',
                name: kernelSpec.kernelSpec.name,
                resources: {},
                env: kernelSpec.kernelSpec.env,
                metadata: kernelSpec.kernelSpec.metadata
            };
        });
        return specs;
    }
    private readonly finder: ContributedLocalKernelSpecFinder;
    constructor(@inject(IKernelFinder) kernelFinder: IKernelFinder) {
        this.finder = kernelFinder.registered.find(
            (item) => item.id === ContributedKernelFinderKind.LocalKernelSpec
        )! as ContributedLocalKernelSpecFinder;
        this.finder.onDidChangeKernels(() => this.specsChanged.emit(this.specs));
        this.finder.kernels;
    }
    async refreshSpecs(): Promise<void> {
        await this.finder.refresh().catch(noop);
    }
    dispose(): void {
        throw new Error('Method not implemented.');
    }
}
