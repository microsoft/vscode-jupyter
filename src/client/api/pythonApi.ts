// tslint:disable-next-line: no-single-line-block-comment
/* eslint-disable @typescript-eslint/explicit-module-boundary-types */
// tslint:disable-next-line: no-single-line-block-comment
/* eslint-disable class-methods-use-this */
// tslint:disable-next-line: no-single-line-block-comment
/* eslint-disable consistent-return */
// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { Event, EventEmitter } from 'vscode';
import { IApplicationShell } from '../common/application/types';
import { IExtensions, Resource } from '../common/types';
import { createDeferred, Deferred } from '../common/utils/async';
import { noop } from '../common/utils/misc';
import { IEnvironmentActivationService } from '../interpreter/activation/types';
import { IInterpreterService } from '../interpreter/contracts';
import { IWindowsStoreInterpreter } from '../interpreter/locators/types';
import { PythonEnvironment } from '../pythonEnvironments/info';
import { PythonApi } from './types';

@injectable()
export class PythonApiService implements IInterpreterService, IEnvironmentActivationService, IWindowsStoreInterpreter {
    private _onDidChangeInterpreter = new EventEmitter<void>();

    public get onDidChangeInterpreter(): Event<void> {
        return this._onDidChangeInterpreter.event;
    }

    private realService?: Deferred<PythonApi>;

    constructor(
        @inject(IExtensions) private readonly extensions: IExtensions,
        @inject(IApplicationShell) private readonly appShell: IApplicationShell
    ) {}

    public async isWindowsStoreInterpreter(pythonPath: string): Promise<boolean> {
        await this.init();
        const svc = await this.realService!.promise;
        // eslint-disable-next-line consistent-return
        return svc.isWindowsStoreInterpreter(pythonPath);
    }

    public async getActivatedEnvironmentVariables(
        resource: Resource,
        interpreter?: PythonEnvironment
    ): Promise<NodeJS.ProcessEnv | undefined> {
        await this.init();
        interpreter = interpreter || (await this.getActiveInterpreter(resource));
        if (!interpreter) {
            return;
        }
        const svc = await this.realService!.promise;
        // eslint-disable-next-line consistent-return
        return svc.getActivatedEnvironmentVariables(resource, interpreter, true);
    }

    public registerRealService(realService: PythonApi): void {
        this.realService = this.realService || createDeferred<PythonApi>();
        this.realService!.resolve(realService);
    }

    public async getInterpreters(resource: Resource): Promise<PythonEnvironment[]> {
        await this.init();
        return this.realService!.promise.then((svc) => svc.getInterpreters(resource));
    }

    public async getActiveInterpreter(resource: Resource): Promise<PythonEnvironment | undefined> {
        await this.init();
        return this.realService!.promise.then((svc) => svc.getActiveInterpreter(resource));
    }

    public async getInterpreterDetails(pythonPath: string): Promise<PythonEnvironment | undefined> {
        await this.init();
        return this.realService!.promise.then((svc) => svc.getInterpreterDetails(pythonPath));
    }

    public initialize() {
        // Not required in extension, only in tests.
    }

    private async init() {
        if (this.realService) {
            return this.realService.promise;
        }
        this.realService = createDeferred<PythonApi>();
        const pythonExtension = this.extensions.getExtension<{ jupyter: { registerHooks(): void } }>(
            'ms-python.python'
        );
        if (!pythonExtension) {
            // tslint:disable-next-line: messages-must-be-localized
            this.appShell.showErrorMessage('Install Python Extension').then(noop, noop);
            return;
        }
        if (!pythonExtension.isActive) {
            await pythonExtension.activate();
        }
        pythonExtension.exports.jupyter.registerHooks();
        await this.realService!.promise;
    }
}
