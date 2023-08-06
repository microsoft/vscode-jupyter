// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { Event, EventEmitter, Uri } from 'vscode';
import { CancellationToken } from 'vscode-jsonrpc';
import { raceCancellation } from '../../../platform/common/cancellation';
import { noop } from '../../../platform/common/utils/misc';
import { IInterpreterService } from '../../../platform/interpreter/contracts';
import { PythonEnvironment } from '../../../platform/pythonEnvironments/info';
import { sendTelemetryEvent, Telemetry } from '../../../telemetry';
import { JupyterInstallError } from '../../../platform/errors/jupyterInstallError';
import { JupyterInterpreterDependencyService } from './jupyterInterpreterDependencyService.node';
import { JupyterInterpreterSelector } from './jupyterInterpreterSelector.node';
import { JupyterInterpreterStateStore } from './jupyterInterpreterStateStore';
import { JupyterInterpreterDependencyResponse } from '../types';
import { IApplicationShell, IWorkspaceService } from '../../../platform/common/application/types';
import { DataScience } from '../../../platform/common/utils/localize';
import { IDisposableRegistry } from '../../../platform/common/types';

/**
 * Manages picking an interpreter that can run jupyter.
 * This interpreter is how we start jupyter on a local machine when ZMQ doesn't work.
 */
@injectable()
export class JupyterInterpreterService {
    private _selectedInterpreter?: PythonEnvironment;
    private _onDidChangeInterpreter = new EventEmitter<PythonEnvironment>();
    private getInitialInterpreterPromise: Promise<PythonEnvironment | undefined> | undefined;
    private getInitialInterpreterPromiseFailed?: boolean;
    public get onDidChangeInterpreter(): Event<PythonEnvironment> {
        return this._onDidChangeInterpreter.event;
    }

    constructor(
        @inject(JupyterInterpreterStateStore) private readonly interpreterSelectionState: JupyterInterpreterStateStore,
        @inject(JupyterInterpreterSelector) private readonly jupyterInterpreterSelector: JupyterInterpreterSelector,
        @inject(JupyterInterpreterDependencyService)
        private readonly interpreterConfiguration: JupyterInterpreterDependencyService,
        @inject(IInterpreterService) private readonly interpreterService: IInterpreterService,
        @inject(IApplicationShell) private readonly appShell: IApplicationShell,
        @inject(IWorkspaceService) private readonly workspace: IWorkspaceService,
        @inject(IDisposableRegistry) disposables: IDisposableRegistry
    ) {
        this.workspace.onDidGrantWorkspaceTrust(
            () => {
                if (this.getInitialInterpreterPromiseFailed) {
                    this.getInitialInterpreterPromise = undefined;
                    this.getInitialInterpreterPromiseFailed = false;
                }
            },
            this,
            disposables
        );
    }
    /**
     * Gets the selected interpreter configured to run Jupyter.
     *
     * @param {CancellationToken} [token]
     * @returns {(Promise<PythonEnvironment | undefined>)}
     * @memberof JupyterInterpreterService
     */
    public async getSelectedInterpreter(token?: CancellationToken): Promise<PythonEnvironment | undefined> {
        // Before we return _selected interpreter make sure that we have run our initial set interpreter once
        // because _selectedInterpreter can be changed by other function and at other times, this promise
        // is cached to only run once
        await this.setInitialInterpreter(token);

        return this._selectedInterpreter;
    }

    // To be run one initial time. Check our saved locations and then current interpreter to try to start off
    // with a valid jupyter interpreter
    public async setInitialInterpreter(token?: CancellationToken): Promise<PythonEnvironment | undefined> {
        if (!this.getInitialInterpreterPromise) {
            this.getInitialInterpreterPromise = this.getInitialInterpreterImpl(token).then((result) => {
                // Set ourselves as a valid interpreter if we found something
                if (result) {
                    this.changeSelectedInterpreterProperty(result);
                }
                return result;
            });
            this.getInitialInterpreterPromise.catch(() => (this.getInitialInterpreterPromiseFailed = true));
        }

        return this.getInitialInterpreterPromise;
    }

    /**
     * Selects and interpreter to run jupyter server.
     * Validates and configures the interpreter.
     * Once completed, the interpreter is stored in settings, else user can select another interpreter.
     *
     * @returns {(Promise<PythonEnvironment | undefined>)}
     * @memberof JupyterInterpreterService
     */
    public async selectInterpreter(): Promise<PythonEnvironment | undefined> {
        sendTelemetryEvent(Telemetry.SelectJupyterInterpreter);
        const interpreter = await this.jupyterInterpreterSelector.selectPythonInterpreter();
        if (!interpreter) {
            sendTelemetryEvent(Telemetry.SelectJupyterInterpreter, undefined, { result: 'notSelected' });
            return;
        }

        const result = await this.interpreterConfiguration.installMissingDependencies(interpreter, undefined);
        switch (result) {
            case JupyterInterpreterDependencyResponse.ok: {
                await this.setAsSelectedInterpreter(interpreter);
                return interpreter;
            }
            case JupyterInterpreterDependencyResponse.cancel:
                sendTelemetryEvent(Telemetry.SelectJupyterInterpreter, undefined, { result: 'installationCancelled' });
                return;
            default:
                sendTelemetryEvent(Telemetry.SelectJupyterInterpreter, undefined, {
                    result: 'selectAnotherInterpreter'
                });
                return this.selectInterpreter();
        }
    }

    // Install jupyter dependencies in the current jupyter selected interpreter
    // If there is no jupyter selected interpreter, prompt for install into the
    // current active interpreter and set as active if successful
    public async installMissingDependencies(err?: JupyterInstallError): Promise<JupyterInterpreterDependencyResponse> {
        const jupyterInterpreter = await this.getSelectedInterpreter();
        let interpreter = jupyterInterpreter;
        if (!interpreter) {
            // Use current interpreter.
            interpreter = await this.interpreterService.getActiveInterpreter(undefined);
            if (!interpreter) {
                if (err) {
                    const selection = await this.appShell.showErrorMessage(
                        err.message,
                        { modal: true },
                        DataScience.selectDifferentJupyterInterpreter
                    );
                    if (selection !== DataScience.selectDifferentJupyterInterpreter) {
                        return JupyterInterpreterDependencyResponse.cancel;
                    }
                }

                // Unlikely scenario, user hasn't selected python, python extension will fall over.
                // Get user to select something.
                await this.selectInterpreter();
                return JupyterInterpreterDependencyResponse.selectAnotherInterpreter;
            }
        }

        const response = await this.interpreterConfiguration.installMissingDependencies(interpreter, err);
        if (response === JupyterInterpreterDependencyResponse.selectAnotherInterpreter) {
            interpreter = await this.selectInterpreter();
            return interpreter ? JupyterInterpreterDependencyResponse.ok : JupyterInterpreterDependencyResponse.cancel;
        } else if (response === JupyterInterpreterDependencyResponse.ok) {
            // We might have installed jupyter in a new active interpreter here, if we did and the install
            // went ok we also want to select that interpreter as our jupyter selected interperter
            // so that on next launch we use it correctly
            if (interpreter !== jupyterInterpreter) {
                await this.setAsSelectedInterpreter(interpreter);
            }
        }
        return response;
    }

    // Set the specified interpreter as our current selected interpreter. Public so can
    // be set by the test code.
    public async setAsSelectedInterpreter(interpreter: PythonEnvironment): Promise<void> {
        // Make sure that our initial set has happened before we allow a set so that
        // calculation of the initial interpreter doesn't clobber the existing one
        await this.setInitialInterpreter();
        this.changeSelectedInterpreterProperty(interpreter);
    }

    private changeSelectedInterpreterProperty(interpreter: PythonEnvironment) {
        this._selectedInterpreter = interpreter;
        this._onDidChangeInterpreter.fire(interpreter);
        this.interpreterSelectionState.updateSelectedPythonPath(interpreter.uri);
        let envVersion = '';
        if (interpreter.version) {
            const { major, minor, patch } = interpreter.version;
            envVersion = `${major}.${minor}.${patch}`;
        }
        sendTelemetryEvent(Telemetry.SelectJupyterInterpreter, undefined, {
            result: 'selected',
            envType: interpreter.envType,
            envVersion
        });
    }

    // For a given python path check if it can run jupyter for us
    // if so, return the interpreter
    private async validateInterpreterPath(
        pythonPath: Uri,
        token?: CancellationToken
    ): Promise<PythonEnvironment | undefined> {
        try {
            // First see if we can get interpreter details
            const interpreter = await raceCancellation(
                token,
                this.interpreterService.getInterpreterDetails(pythonPath)
            );
            if (interpreter) {
                // Then check that dependencies are installed
                if (await this.interpreterConfiguration.areDependenciesInstalled(interpreter, token)) {
                    return interpreter;
                }
            }
        } catch (_err) {
            // For any errors we are ok with just returning undefined for an invalid interpreter
            noop();
        }
        return undefined;
    }

    private async getInitialInterpreterImpl(token?: CancellationToken): Promise<PythonEnvironment | undefined> {
        let interpreter: PythonEnvironment | undefined;

        // Next check the saved global path
        if (this.interpreterSelectionState.selectedPythonPath) {
            interpreter = await this.validateInterpreterPath(this.interpreterSelectionState.selectedPythonPath, token);

            // If we had a global path, but it's not valid, trash it
            if (!interpreter) {
                this.interpreterSelectionState.updateSelectedPythonPath(undefined);
            }
        }

        // Nothing saved found, so check our current interpreter
        if (!interpreter) {
            const currentInterpreter = await this.interpreterService.getActiveInterpreter(undefined);
            if (currentInterpreter) {
                // If the current active interpreter has everything installed already just use that
                if (await this.interpreterConfiguration.areDependenciesInstalled(currentInterpreter, token)) {
                    interpreter = currentInterpreter;
                }
            }
        }

        return interpreter;
    }
}
