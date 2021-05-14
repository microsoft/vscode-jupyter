// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import { anything, instance, mock, verify, when } from 'ts-mockito';
import * as typemoq from 'typemoq';
import { IApplicationShell } from '../../client/common/application/types';
import { IConfigurationService } from '../../client/common/types';
import * as localize from '../../client/common/utils/localize';
import { DataScienceErrorHandler } from '../../client/datascience/errorHandler/errorHandler';
import { JupyterInstallError } from '../../client/datascience/jupyter/jupyterInstallError';
import { JupyterSelfCertsError } from '../../client/datascience/jupyter/jupyterSelfCertsError';
import { JupyterZMQBinariesNotFoundError } from '../../client/datascience/jupyter/jupyterZMQBinariesNotFoundError';
import { JupyterServerSelector } from '../../client/datascience/jupyter/serverSelector';
import { ILocalKernelFinder } from '../../client/datascience/kernel-launcher/types';
import { IJupyterInterpreterDependencyManager } from '../../client/datascience/types';
import { IServiceContainer } from '../../client/ioc/types';

suite('DataScience Error Handler Unit Tests', () => {
    let applicationShell: typemoq.IMock<IApplicationShell>;
    let dataScienceErrorHandler: DataScienceErrorHandler;
    let dependencyManager: IJupyterInterpreterDependencyManager;
    let serverSelector: JupyterServerSelector;
    let configService: IConfigurationService;
    let localKernelFinder: ILocalKernelFinder;

    setup(() => {
        applicationShell = typemoq.Mock.ofType<IApplicationShell>();
        dependencyManager = mock<IJupyterInterpreterDependencyManager>();
        serverSelector = mock(JupyterServerSelector);
        configService = mock<IConfigurationService>();
        localKernelFinder = mock<ILocalKernelFinder>();
        const serviceContainre = mock<IServiceContainer>();
        when(dependencyManager.installMissingDependencies(anything())).thenResolve();
        when(serviceContainre.get<IConfigurationService>(IConfigurationService)).thenReturn(instance(configService));
        when(serviceContainre.get<ILocalKernelFinder>(ILocalKernelFinder)).thenReturn(instance(localKernelFinder));
        dataScienceErrorHandler = new DataScienceErrorHandler(
            applicationShell.object,
            instance(dependencyManager),
            instance(serverSelector),
            instance(serviceContainre)
        );
    });
    const message = 'Test error message.';

    test('Default error', async () => {
        applicationShell
            .setup((app) => app.showErrorMessage(typemoq.It.isAny()))
            .returns(() => Promise.resolve(message))
            .verifiable(typemoq.Times.once());

        const err = new Error(message);
        await dataScienceErrorHandler.handleError(err);

        applicationShell.verifyAll();
    });

    test('Jupyter Self Certificates Error', async () => {
        applicationShell
            .setup((app) => app.showErrorMessage(typemoq.It.isAny()))
            .returns(() => Promise.resolve(message))
            .verifiable(typemoq.Times.never());

        const err = new JupyterSelfCertsError(message);
        await dataScienceErrorHandler.handleError(err);

        applicationShell.verifyAll();
    });

    test('Jupyter Install Error', async () => {
        applicationShell
            .setup((app) =>
                app.showInformationMessage(
                    typemoq.It.isAny(),
                    typemoq.It.isValue(localize.DataScience.jupyterInstall()),
                    typemoq.It.isValue(localize.DataScience.notebookCheckForImportNo()),
                    typemoq.It.isAny()
                )
            )
            .returns(() => Promise.resolve(localize.DataScience.jupyterInstall()))
            .verifiable(typemoq.Times.once());

        // const installers: IModuleInstaller[] = [
        //     {
        //         name: 'Pip',
        //         displayName: 'Pip',
        //         priority: 0,
        //         isSupported: () => Promise.resolve(true),
        //         installModule: () => Promise.resolve()
        //     },
        //     {
        //         name: 'Conda',
        //         displayName: 'Conda',
        //         priority: 0,
        //         isSupported: () => Promise.resolve(true),
        //         installModule: () => Promise.resolve()
        //     }
        // ];

        // channels
        //     .setup((ch) => ch.getInstallationChannels())
        //     .returns(() => Promise.resolve(installers))
        //     .verifiable(typemoq.Times.once());

        const err = new JupyterInstallError(message, 'test.com');
        await dataScienceErrorHandler.handleError(err);

        verify(dependencyManager.installMissingDependencies(err)).once();
    });

    test('ZMQ Install Error', async () => {
        applicationShell
            .setup((app) =>
                app.showErrorMessage(typemoq.It.isAny(), typemoq.It.isValue(localize.DataScience.selectNewServer()))
            )
            .returns(() => Promise.resolve(localize.DataScience.selectNewServer()))
            .verifiable(typemoq.Times.once());
        when(serverSelector.selectJupyterURI(anything())).thenResolve();
        when(serverSelector.selectJupyterURI(anything(), anything())).thenResolve();
        const err = new JupyterZMQBinariesNotFoundError('Not found');
        await dataScienceErrorHandler.handleError(err);
        verify(serverSelector.selectJupyterURI(anything())).once();
        applicationShell.verifyAll();
    });
});
