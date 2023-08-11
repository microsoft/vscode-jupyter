// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable, named } from 'inversify';
import { CancellationToken, CancellationTokenSource, Event, EventEmitter, Memento } from 'vscode';
import { getKernelId } from '../../../kernels/helpers';
import { IKernelFinder, LocalKernelSpecConnectionMetadata } from '../../../kernels/types';
import { KernelSpecLoader } from './localKernelSpecFinderBase.node';
import { JupyterPaths } from './jupyterPaths.node';
import { traceError } from '../../../platform/logging';
import { IFileSystemNode } from '../../../platform/common/platform/types.node';
import { IMemento, GLOBAL_MEMENTO, IDisposableRegistry } from '../../../platform/common/types';
import { sendKernelSpecTelemetry } from './helper';
import { noop } from '../../../platform/common/utils/misc';
import { IExtensionSyncActivationService } from '../../../platform/activation/types';
import { ILocalNonPythonKernelSpecFinder } from '../../jupyter/types';
import { IQuickPickItemProvider } from '../../../platform/common/providerBasedQuickPick';
import { ContributedKernelFinderKind } from '../../internalTypes';
import { Disposables } from '../../../platform/common/utils';
import { PromiseMonitor } from '../../../platform/common/utils/promises';
import { PYTHON_LANGUAGE } from '../../../platform/common/constants';
import { DataScience } from '../../../platform/common/utils/localize';

/**
 * This class searches for kernels on the file system in well known paths documented by Jupyter.
 * This will return Python, Julia, R etc kernels.
 * Returns all kernels regardless of whether Python extension is installed or not.
 */
@injectable()
export class LocalKnownPathKernelSpecFinderV2
    extends Disposables
    implements
        IExtensionSyncActivationService,
        ILocalNonPythonKernelSpecFinder,
        IQuickPickItemProvider<LocalKernelSpecConnectionMetadata>
{
    title: string = DataScience.localKernelSpecs;
    get status(): 'discovering' | 'idle' {
        return this.promiseMonitor.isComplete ? 'idle' : 'discovering';
    }
    private _onDidChange = new EventEmitter<void>();
    onDidChange = this._onDidChange.event;
    private _onDidChangeStatus = new EventEmitter<void>();
    onDidChangeStatus = this._onDidChangeStatus.event
    lastError?: Error | undefined;
    id: string = ContributedKernelFinderKind.LocalKernelSpec;
    displayName: string = DataScience.localKernelSpecs;
    kind: ContributedKernelFinderKind = ContributedKernelFinderKind.LocalKernelSpec;
    private readonly _onDidChangeKernels = new EventEmitter<{ removed?: { id: string }[] | undefined }>();
    onDidChangeKernels = this._onDidChangeKernels.event;
    private _kernels = new Map<string, LocalKernelSpecConnectionMetadata>();
    get kernels(): LocalKernelSpecConnectionMetadata[] {
        return Array.from(this._kernels.values());
    }
    get items(): readonly LocalKernelSpecConnectionMetadata[] {
        return this.kernels;
    }
    private readonly promiseMonitor = new PromiseMonitor();
    private readonly kernelSpecFinder: KernelSpecLoader;
    constructor(
        @inject(IDisposableRegistry) disposables: IDisposableRegistry,
        @inject(JupyterPaths) private readonly jupyterPaths: JupyterPaths,
        @inject(IFileSystemNode) fs: IFileSystemNode,
        @inject(IMemento) @named(GLOBAL_MEMENTO) memento: Memento,
        @inject(IKernelFinder) kernelFinder: IKernelFinder
    ) {
        super();
        disposables.push(this);
        kernelFinder.registerKernelFinder(this);
        this.promiseMonitor.onStateChange(() => this._onDidChangeStatus.fire(), this.disposables);
        this.disposables.push(this.promiseMonitor);
        this.disposables.push(this._onDidChange);
        this.disposables.push(this._onDidChangeStatus);
        this.kernelSpecFinder = new KernelSpecLoader(fs, memento, jupyterPaths);
        this.disposables.push(this.kernelSpecFinder);
    }
    async refresh(): Promise<void> {
        const token = new CancellationTokenSource();
        try {
            const promise = this.findKernelSpecs(token.token);
            this.promiseMonitor.push(promise);
            await promise;
        } catch (ex) {
            traceError('Failed to refresh local kernelSpecs', ex);
        } finally {
            token.dispose();
        }
    }
    activate(): void {
        this.refresh().catch(noop);
    }
    private async findKernelSpecs(cancelToken: CancellationToken) {
        const oldKernelSpecIds = Array.from(this._kernels.keys());
        const newKernelSpecIds = new Set<string>();
        // Find all the possible places to look for this resource
        const paths = await this.jupyterPaths.getKernelSpecRootPaths(cancelToken);
        if (cancelToken.isCancellationRequested) {
            return [];
        }
        await Promise.all(
            paths.map(async (kernelPath) => {
                const kernelSpecs = await this.kernelSpecFinder.findKernelSpecsInPaths(kernelPath, cancelToken);
                await Promise.all(
                    kernelSpecs.map(async (kernelSpecFile) => {
                        try {
                            if (cancelToken.isCancellationRequested) {
                                return;
                            }
                            // Add these into our path cache to speed up later finds
                            const kernelSpec = await this.kernelSpecFinder.loadKernelSpec(kernelSpecFile, cancelToken);
                            if (kernelSpec?.language?.toLowerCase() === PYTHON_LANGUAGE.toLowerCase()) {
                                // We rely on another finder to find Python kernels.
                                // Even if they are not started using ipykernel.
                                return;
                            }
                            if (kernelSpec && !cancelToken.isCancellationRequested) {
                                sendKernelSpecTelemetry(kernelSpec, 'local');
                                const connection = LocalKernelSpecConnectionMetadata.create({
                                    kernelSpec,
                                    interpreter: undefined,
                                    id: getKernelId(kernelSpec)
                                });
                                this._kernels.set(connection.id, connection);
                                newKernelSpecIds.add(connection.id);
                                this._onDidChange.fire();
                            }
                        } catch (ex) {
                            traceError(`Failed to load kernelSpec for ${kernelSpecFile}`, ex);
                        }
                    })
                );
            })
        );

        // Remove kernelSpecs that are no longer valid.
        if (newKernelSpecIds.size !== oldKernelSpecIds.length) {
            oldKernelSpecIds
                .filter((id) => !newKernelSpecIds.has(id))
                .forEach((id) => {
                    this._kernels.delete(id);
                });
            this._onDidChange.fire();
        }
        if (cancelToken.isCancellationRequested) {
            return [];
        }

        // Filter out duplicates. This can happen when
        // 1) Conda installs kernel
        // 2) Same kernel is registered in the global location
        // We should have extra metadata on the global location pointing to the original
        const originalSpecFiles = new Map<string, LocalKernelSpecConnectionMetadata>();
        Array.from(this._kernels.values()).forEach((c) => {
            const spec = c.kernelSpec;
            if (spec.metadata?.originalSpecFile) {
                originalSpecFiles.set(spec.metadata.originalSpecFile, c);
            }
        });
        Array.from(this._kernels.values()).forEach((connection) => {
            if (
                connection.kernelSpec.specFile &&
                originalSpecFiles.has(connection.kernelSpec.specFile) &&
                originalSpecFiles.get(connection.kernelSpec.specFile) !== connection
            ) {
                this._kernels.delete(connection.id);
                this._onDidChange.fire();
            }
        });

        // There was also an old bug where the same item would be registered more than once. Eliminate these dupes
        // too.
        const byDisplayName = new Map<string, LocalKernelSpecConnectionMetadata>();
        Array.from(this._kernels.values()).forEach((connection) => {
            const existing = byDisplayName.get(connection.kernelSpec.display_name);
            if (existing && existing.kernelSpec.executable !== connection.kernelSpec.executable) {
                // We have another kernelSpec with the same name but with a different path to exe.
                // Hence this is ok.
            } else if (!existing) {
                byDisplayName.set(connection.kernelSpec.display_name, connection);
            } else {
                // We have another kernelSpec with the same name and path to exe.
                // Hence this is a duplicate.
                this._kernels.delete(connection.id);
                this._onDidChange.fire();
            }
        });
    }
}
