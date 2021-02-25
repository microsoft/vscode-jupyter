// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import '../../common/extensions';

import { inject, injectable } from 'inversify';

import { IAsyncDisposable, IAsyncDisposableRegistry, IDisposableRegistry } from '../../common/types';
import { IServiceContainer } from '../../ioc/types';
import { captureTelemetry } from '../../telemetry';
import { Commands, Telemetry } from '../constants';
import { IDataViewer, IDataViewerDataProvider, IDataViewerFactory } from './types';
import { ICommandManager } from '../../common/application/types';

@injectable()
export class DataViewerFactory implements IDataViewerFactory, IAsyncDisposable {
    private activeExplorers: IDataViewer[] = [];
    constructor(
        @inject(IServiceContainer) private serviceContainer: IServiceContainer,
        @inject(IAsyncDisposableRegistry) asyncRegistry: IAsyncDisposableRegistry,
        @inject(IDisposableRegistry) private disposables: IDisposableRegistry,
        @inject(ICommandManager) private commandManager: ICommandManager
    ) {
        asyncRegistry.push(this);
        this.disposables.push(this.commandManager.registerCommand(Commands.RefreshDataViewer, this.refreshDataViewer, this));
    }

    public async dispose() {
        await Promise.all(this.activeExplorers.map((d) => d.dispose()));
    }

    @captureTelemetry(Telemetry.StartShowDataViewer)
    public async create(dataProvider: IDataViewerDataProvider, title: string): Promise<IDataViewer> {
        let result: IDataViewer | undefined;

        // Create the data explorer
        const dataExplorer = this.serviceContainer.get<IDataViewer>(IDataViewer);
        try {
            // Then load the data.
            this.activeExplorers.push(dataExplorer);

            // Show the window and the data
            await dataExplorer.showData(dataProvider, title);
            result = dataExplorer;
        } finally {
            if (!result) {
                // If throw any errors, close the window we opened.
                dataExplorer.dispose();
            }
        }
        return result;
    }

    private refreshDataViewer() {
        // Find the data viewer which is currently active
        const activeDataViewer = this.activeExplorers.find((viewer) => !(viewer as any).isDisposed && viewer.active);
        void activeDataViewer?.refreshData();
    }
}
