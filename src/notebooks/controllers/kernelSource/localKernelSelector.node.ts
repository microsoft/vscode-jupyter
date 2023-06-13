// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { CancellationToken, CancellationTokenSource, commands, Disposable, NotebookDocument, QuickPick } from 'vscode';
import { ContributedKernelFinderKind, IContributedKernelFinder } from '../../../kernels/internalTypes';
import { KernelConnectionMetadata } from '../../../kernels/types';
import { IPythonExtensionChecker } from '../../../platform/api/types';
import { IWorkspaceService } from '../../../platform/common/application/types';
import { Commands } from '../../../platform/common/constants';
import { IDisposable } from '../../../platform/common/types';
import { DataScience } from '../../../platform/common/utils/localize';
import { noop } from '../../../platform/common/utils/misc';
import { InputFlowAction } from '../../../platform/common/utils/multiStepInput';
import { ServiceContainer } from '../../../platform/ioc/container';
import { PythonEnvKernelConnectionCreator } from '../pythonEnvKernelConnectionCreator';
import { CommandQuickPickItem, IQuickPickKernelItemProvider } from './types';
import { BaseKernelSelector, CompoundQuickPickItem, CreateAndSelectItemFromQuickPick } from './baseKernelSelector';

/**
 * Used to indicate the fact that the quick pick workflow
 * has been successfully completed.
 * Do not use `CancellationError` as that indicates the user stopped the workflow.
 * & VS Code will re-display the quick pick, & that's not something we want as the user has taken an action.
 */
class SomeOtherActionError extends Error {}

export class LocalKernelSelector extends BaseKernelSelector implements IDisposable {
    private readonly extensionChecker: IPythonExtensionChecker;
    private readonly createPythonItems: CompoundQuickPickItem[] = [];
    private readonly installPythonExtItems: CompoundQuickPickItem[] = [];
    private readonly installPythonItems: CompoundQuickPickItem[] = [];
    private readonly installPythonExtension: CommandQuickPickItem;
    private readonly installPythonItem: CommandQuickPickItem;
    private readonly createPythonEnvQuickPickItem: CommandQuickPickItem;
    constructor(
        private readonly workspace: IWorkspaceService,
        private readonly notebook: NotebookDocument,
        provider: IQuickPickKernelItemProvider,
        token: CancellationToken
    ) {
        super(provider, token);
        this.extensionChecker = ServiceContainer.instance.get<IPythonExtensionChecker>(IPythonExtensionChecker);
        this.createPythonEnvQuickPickItem = {
            label: `$(add) ${DataScience.createPythonEnvironmentInQuickPick}`,
            tooltip: DataScience.createPythonEnvironmentInQuickPickTooltip,
            command: this.onCreatePythonEnvironment.bind(this)
        };
        this.installPythonItem = {
            label: DataScience.installPythonQuickPickTitle,
            tooltip: DataScience.installPythonQuickPickToolTip,
            detail: DataScience.pleaseReloadVSCodeOncePythonHasBeenInstalled,
            command: async () => {
                // Timeout as we want the quick pick to close before we start this process.
                setTimeout(() => commands.executeCommand(Commands.InstallPythonViaKernelPicker).then(noop, noop));
                throw new SomeOtherActionError();
            }
        };
        this.installPythonExtension = {
            label: DataScience.installPythonExtensionViaKernelPickerTitle,
            tooltip: DataScience.installPythonExtensionViaKernelPickerToolTip,
            command: async () => {
                // TODO: Once user installs Python wait here and refresh this UI so we display the Python Envs.
                const installed = await commands.executeCommand(Commands.InstallPythonExtensionViaKernelPicker);
                if (installed === true) {
                    // refresh the view and wait here
                    this.provider.refresh().catch(noop);
                    // TODO: Re-display the quick pick so user can pick a kernel.
                    return undefined;
                } else {
                    throw new SomeOtherActionError();
                }
            }
        };
    }
    public override async selectKernelImpl(
        quickPickFactory: CreateAndSelectItemFromQuickPick,
        quickPickToBeUpdated: { quickPick: QuickPick<CompoundQuickPickItem> | undefined }
    ): Promise<
        | { selection: 'controller'; finder: IContributedKernelFinder; connection: KernelConnectionMetadata }
        | { selection: 'userPerformedSomeOtherAction' }
        | undefined
    > {
        if (this.token.isCancellationRequested) {
            return;
        }

        if (
            !this.extensionChecker.isPythonExtensionInstalled &&
            this.provider.kind === ContributedKernelFinderKind.LocalPythonEnvironment
        ) {
            this.installPythonExtItems.push(this.installPythonExtension);
        }

        quickPickToBeUpdated = {
            quickPick: undefined
        };
        if (
            this.extensionChecker.isPythonExtensionInstalled &&
            this.provider.kind === ContributedKernelFinderKind.LocalPythonEnvironment
        ) {
            if (this.provider.kernels.length === 0 && this.provider.status === 'idle') {
                if (this.workspace.isTrusted) {
                    // Python extension cannot create envs if there are no python environments.
                    this.installPythonItems.push(this.installPythonItem);
                }
            } else {
                const updatePythonItems = () => {
                    if (
                        this.provider.kernels.length === 0 &&
                        this.installPythonItems.length === 0 &&
                        this.provider.status === 'idle'
                    ) {
                        if (this.workspace.isTrusted) {
                            this.installPythonItems.push(this.installPythonItem);
                            if (quickPickToBeUpdated.quickPick) {
                                this.updateQuickPickItems(quickPickToBeUpdated.quickPick);
                            }
                        }
                    } else if (this.provider.kernels.length) {
                        this.installPythonItems.length = 0;
                        if (quickPickToBeUpdated.quickPick) {
                            this.updateQuickPickItems(quickPickToBeUpdated.quickPick);
                        }
                    }
                };
                this.provider.onDidChangeStatus(updatePythonItems, this, this.disposables);
                this.provider.onDidChange(updatePythonItems, this, this.disposables);
            }
            if (this.provider.kernels.length > 0) {
                // Python extension cannot create envs if there are no python environments.
                this.createPythonItems.push(this.createPythonEnvQuickPickItem);
            } else {
                this.provider.onDidChange(
                    () => {
                        if (this.provider.kernels.length > 0 && this.createPythonItems.length === 0) {
                            this.createPythonItems.push(this.createPythonEnvQuickPickItem);
                        }
                    },
                    this,
                    this.disposables
                );
            }
        }
        return super.selectKernelImpl(quickPickFactory, quickPickToBeUpdated);
    }
    protected override getAdditionalQuickPickItems() {
        return this.installPythonItems.concat(this.installPythonExtItems).concat(this.createPythonItems);
    }
    private async onCreatePythonEnvironment() {
        const cancellationToken = new CancellationTokenSource();
        this.disposables.push(new Disposable(() => cancellationToken.cancel()));
        this.disposables.push(cancellationToken);

        const creator = new PythonEnvKernelConnectionCreator(this.notebook, cancellationToken.token);
        this.disposables.push(creator);
        const result = await creator.createPythonEnvFromKernelPicker();
        if ('action' in result) {
            if (result.action === 'Cancel') {
                throw InputFlowAction.cancel;
            }
            throw InputFlowAction.back;
        }
        return result.kernelConnection;
    }
    protected override updateQuickPickItems(quickPick: QuickPick<CompoundQuickPickItem>) {
        if (
            this.extensionChecker.isPythonExtensionInstalled &&
            this.provider.kind === ContributedKernelFinderKind.LocalPythonEnvironment
        ) {
            this.installPythonExtItems.length = 0;
        }
        if (
            this.provider.kind === ContributedKernelFinderKind.LocalPythonEnvironment &&
            this.provider.kernels.some((k) => k.kind === 'startUsingPythonInterpreter')
        ) {
            this.installPythonItems.length = 0;
        }

        super.updateQuickPickItems(quickPick);
    }
}
