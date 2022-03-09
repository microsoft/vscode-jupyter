// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import { Uri } from 'vscode';

import { IProcessServiceFactory } from '../../client/common/process/types';
import { CodeCssGenerator } from '../../client/datascience/codeCssGenerator';
import {
    ICodeCssGenerator,
    IJupyterExecution,
    INotebookImporter,
    INotebookServer
} from '../../client/datascience/types';
import { JupyterImporter } from '../../kernels/jupyter/import-export/jupyterImporter';
import { HostJupyterExecution } from '../../kernels/jupyter/launcher/liveshare/hostJupyterExecution';
import { HostJupyterServer } from '../../kernels/jupyter/launcher/liveshare/hostJupyterServer';
import { getPythonSemVer } from '../common';
import { IocContainer } from '../serviceRegistry';

export class UnitTestIocContainer extends IocContainer {
    public async getPythonMajorVersion(resource: Uri): Promise<number> {
        const procServiceFactory = this.serviceContainer.get<IProcessServiceFactory>(IProcessServiceFactory);
        const procService = await procServiceFactory.create(resource);
        const pythonVersion = await getPythonSemVer(procService);
        if (pythonVersion) {
            return pythonVersion.major;
        } else {
            return -1; // log warning already issued by underlying functions...
        }
    }

    public registerDataScienceTypes() {
        this.serviceManager.addSingleton<IJupyterExecution>(IJupyterExecution, HostJupyterExecution);
        this.serviceManager.add<INotebookImporter>(INotebookImporter, JupyterImporter);
        this.serviceManager.add<INotebookServer>(INotebookServer, HostJupyterServer);
        this.serviceManager.addSingleton<ICodeCssGenerator>(ICodeCssGenerator, CodeCssGenerator);
    }
}
