// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import * as uuid from 'uuid/v4';
import { Uri } from 'vscode';
import { CancellationToken } from 'vscode-jsonrpc';
import * as vsls from 'vsls/vscode';
import { ILiveShareApi, IWorkspaceService } from '../../../common/application/types';
import { IAsyncDisposableRegistry, IConfigurationService, IDisposableRegistry, Resource } from '../../../common/types';
import { createDeferred, Deferred } from '../../../common/utils/async';
import * as localize from '../../../common/utils/localize';
import { IServiceContainer } from '../../../ioc/types';
import { LiveShare, LiveShareCommands } from '../../constants';
import {
    IJupyterConnection,
    IJupyterSessionManagerFactory,
    INotebook,
    INotebookServer,
    INotebookServerLaunchInfo
} from '../../types';
import { GuestJupyterNotebook } from './guestJupyterNotebook';
import { LiveShareParticipantDefault, LiveShareParticipantGuest } from './liveShareParticipantMixin';
import { ILiveShareParticipant } from './types';

export class GuestJupyterServer
    extends LiveShareParticipantGuest(LiveShareParticipantDefault, LiveShare.JupyterServerSharedService)
    implements INotebookServer, ILiveShareParticipant {
    private launchInfo: INotebookServerLaunchInfo | undefined;
    private connectPromise: Deferred<INotebookServerLaunchInfo> = createDeferred<INotebookServerLaunchInfo>();
    private _id = uuid();
    private notebooks = new Map<string, Promise<INotebook>>();

    constructor(
        private liveShare: ILiveShareApi,
        private activationStartTime: number,
        _asyncRegistry: IAsyncDisposableRegistry,
        private disposableRegistry: IDisposableRegistry,
        private configService: IConfigurationService,
        _sessionManager: IJupyterSessionManagerFactory,
        _workspaceService: IWorkspaceService,
        _serviceContainer: IServiceContainer
    ) {
        super(liveShare);
    }

    public get id(): string {
        return this._id;
    }

    public async connect(launchInfo: INotebookServerLaunchInfo, _cancelToken?: CancellationToken): Promise<void> {
        this.launchInfo = launchInfo;
        this.connectPromise.resolve(launchInfo);
        return Promise.resolve();
    }

    public async createNotebook(resource: Resource, identity: Uri): Promise<INotebook> {
        // Remember we can have multiple native editors opened against the same ipynb file.
        if (this.notebooks.get(identity.toString())) {
            return this.notebooks.get(identity.toString())!;
        }

        const deferred = createDeferred<INotebook>();
        this.notebooks.set(identity.toString(), deferred.promise);
        // Tell the host side to generate a notebook for this uri
        const service = await this.waitForService();
        if (service) {
            const resourceString = resource ? resource.toString() : undefined;
            const identityString = identity.toString();
            await service.request(LiveShareCommands.createNotebook, [resourceString, identityString]);
        }

        // Return a new notebook to listen to
        const result = new GuestJupyterNotebook(
            this.liveShare,
            this.disposableRegistry,
            this.configService,
            resource,
            identity,
            this.launchInfo,
            this.activationStartTime
        );
        deferred.resolve(result);
        const oldDispose = result.dispose.bind(result);
        result.dispose = () => {
            this.notebooks.delete(identity.toString());
            return oldDispose();
        };

        return result;
    }

    public async onSessionChange(api: vsls.LiveShare | null): Promise<void> {
        await super.onSessionChange(api);

        this.notebooks.forEach(async (notebook) => {
            const guestNotebook = (await notebook) as GuestJupyterNotebook;
            if (guestNotebook) {
                await guestNotebook.onSessionChange(api);
            }
        });
    }

    public async getNotebook(resource: Uri): Promise<INotebook | undefined> {
        return this.notebooks.get(resource.toString());
    }

    public async shutdown(): Promise<void> {
        // Send this across to the other side. Otherwise the host server will remain running (like during an export)
        const service = await this.waitForService();
        if (service) {
            await service.request(LiveShareCommands.disposeServer, []);
        }
    }

    public dispose(): Promise<void> {
        return this.shutdown();
    }

    // Return a copy of the connection information that this server used to connect with
    public getConnectionInfo(): IJupyterConnection | undefined {
        if (this.launchInfo) {
            return this.launchInfo.connectionInfo;
        }

        return undefined;
    }

    public waitForConnect(): Promise<INotebookServerLaunchInfo | undefined> {
        return this.connectPromise.promise;
    }

    public async waitForServiceName(): Promise<string> {
        // First wait for connect to occur
        const launchInfo = await this.waitForConnect();

        // Use our base name plus our purpose. This means one unique server per purpose
        if (!launchInfo) {
            return LiveShare.JupyterServerSharedService;
        }
        // eslint-disable-next-line
        // TODO: Should there be some separator in the name?
        return `${LiveShare.JupyterServerSharedService}${launchInfo.purpose}`;
    }

    public async onAttach(api: vsls.LiveShare | null): Promise<void> {
        await super.onAttach(api);

        if (api) {
            const service = await this.waitForService();

            // Wait for sync up
            const synced = service ? await service.request(LiveShareCommands.syncRequest, []) : undefined;
            if (!synced && api.session && api.session.role !== vsls.Role.None) {
                throw new Error(localize.DataScience.liveShareSyncFailure());
            }
        }
    }
}
