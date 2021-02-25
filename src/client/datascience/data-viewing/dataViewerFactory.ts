// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import '../../common/extensions';

import { inject, injectable } from 'inversify';

import { IAsyncDisposable, IAsyncDisposableRegistry, IDisposableRegistry } from '../../common/types';
import { IServiceContainer } from '../../ioc/types';
import { captureTelemetry } from '../../telemetry';
import { Commands, EditorContexts, Telemetry } from '../constants';
import { IDataViewer, IDataViewerDataProvider, IDataViewerFactory } from './types';
import { ICommandManager } from '../../common/application/types';
import { ContextKey } from '../../common/contextKey';

@injectable()
export class DataViewerFactory implements IDataViewerFactory, IAsyncDisposable {
    private knownViewers = new Set<IDataViewer>();
    private viewContext: ContextKey;

    constructor(
        @inject(IServiceContainer) private serviceContainer: IServiceContainer,
        @inject(IAsyncDisposableRegistry) asyncRegistry: IAsyncDisposableRegistry,
        @inject(IDisposableRegistry) private disposables: IDisposableRegistry,
        @inject(ICommandManager) private commandManager: ICommandManager
    ) {
        asyncRegistry.push(this);
        this.viewContext = new ContextKey(EditorContexts.IsDataViewerActive, this.commandManager);
        this.disposables.push(this.commandManager.registerCommand(Commands.RefreshDataViewer, this.refreshDataViewer, this));
    }

    public async dispose() {
        for (const viewer of this.knownViewers) {
            viewer.dispose();
        }
    }

    @captureTelemetry(Telemetry.StartShowDataViewer)
    public async create(dataProvider: IDataViewerDataProvider, title: string): Promise<IDataViewer> {
        let result: IDataViewer | undefined;

        // Create the data explorer
        const dataExplorer = this.serviceContainer.get<IDataViewer>(IDataViewer);
        try {
            // Then load the data.
            this.knownViewers.add(dataExplorer);
            dataExplorer.onDidDisposeDataViewer(this.updateOpenDataViewers, this, this.disposables);
            dataExplorer.onDidChangeDataViewerViewState(this.updateViewStateContext, this, this.disposables);

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

    private updateOpenDataViewers(viewer: IDataViewer) {
        this.knownViewers.delete(viewer);
    }

    private async updateViewStateContext() {
        // A data viewer's view state has changed. Look through our known viewers to see if any are active
        let hasActiveViewer = false;
        this.knownViewers.forEach((viewer) => {
            if (viewer.active) {
                hasActiveViewer = true;
            }
        })
        await this.viewContext.set(hasActiveViewer);
    }

    private refreshDataViewer() {
        // Find the data viewer which is currently active
        for (const viewer of this.knownViewers) {
            if (viewer.active) { // There should only be one of these
                void viewer.refreshData();
            }
        }
    }
}
