// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { nbformat } from '@jupyterlab/coreutils/lib/nbformat';
import { KernelMessage } from '@jupyterlab/services';
import * as fastDeepEqual from 'fast-deep-equal';
import { sha256 } from 'hash.js';
import { cloneDeep } from 'lodash';
import { Event, EventEmitter, Memento, Uri } from 'vscode';
import { ICryptoUtils } from '../../common/types';
import { isUntitledFile, noop } from '../../common/utils/misc';
import { pruneCell } from '../common';
import { NotebookModelChange } from '../interactive-common/interactiveWindowTypes';
import {
    createDefaultKernelSpec,
    getInterpreterFromKernelConnectionMetadata,
    isPythonKernelConnection,
    kernelConnectionMetadataHasKernelModel
} from '../jupyter/kernels/helpers';
import { KernelConnectionMetadata } from '../jupyter/kernels/types';
import { CellState, INotebookModel } from '../types';
import { PreferredRemoteKernelIdProvider } from './preferredRemoteKernelIdProvider';

export function getInterpreterInfoStoredInMetadata(
    metadata?: nbformat.INotebookMetadata
): { displayName: string; hash: string } | undefined {
    if (!metadata || !metadata.kernelspec || !metadata.kernelspec.name) {
        return;
    }
    // See `updateNotebookMetadata` to determine how & where exactly interpreter hash is stored.
    // tslint:disable-next-line: no-any
    const kernelSpecMetadata: undefined | any = metadata.kernelspec.metadata as any;
    const interpreterHash = kernelSpecMetadata?.interpreter?.hash;
    return interpreterHash ? { displayName: metadata.kernelspec.name, hash: interpreterHash } : undefined;
}

// tslint:disable-next-line: cyclomatic-complexity
export function updateNotebookMetadata(
    metadata?: nbformat.INotebookMetadata,
    kernelConnection?: KernelConnectionMetadata,
    kernelInfo?: KernelMessage.IInfoReplyMsg['content']
) {
    let changed = false;
    let kernelId: string | undefined;
    if (!metadata) {
        return { changed, kernelId };
    }

    if (kernelInfo && kernelInfo.status === 'ok') {
        if (!fastDeepEqual(metadata.language_info, kernelInfo.language_info)) {
            metadata.language_info = cloneDeep(kernelInfo.language_info);
            changed = true;
        }
    } else {
        // Get our kernel_info and language_info from the current notebook
        const isPythonConnection = isPythonKernelConnection(kernelConnection);
        const interpreter = isPythonConnection
            ? getInterpreterFromKernelConnectionMetadata(kernelConnection)
            : undefined;
        if (
            interpreter &&
            interpreter.version &&
            metadata &&
            metadata.language_info &&
            metadata.language_info.version !== interpreter.version.raw
        ) {
            metadata.language_info.version = interpreter.version.raw;
            changed = true;
        } else if (!interpreter && metadata?.language_info && isPythonConnection) {
            // It's possible, such as with raw kernel and a default kernelspec to not have interpreter info
            // for this case clear out old invalid language_info entries as they are related to the previous execution
            // However we should clear previous language info only if language is python, else just leave it as is.
            metadata.language_info = undefined;
            changed = true;
        }
    }

    const kernelSpecOrModel =
        kernelConnection && kernelConnectionMetadataHasKernelModel(kernelConnection)
            ? kernelConnection.kernelModel
            : kernelConnection?.kernelSpec;
    if (kernelConnection?.kind === 'startUsingPythonInterpreter') {
        // Store interpreter name, we expect the kernel finder will find the corresponding interpreter based on this name.
        const kernelSpec = kernelConnection.kernelSpec || createDefaultKernelSpec(kernelConnection.interpreter);
        const displayName = kernelConnection.interpreter.displayName || '';
        const name = kernelSpec.name;
        if (metadata.kernelspec?.name !== name || metadata.kernelspec?.display_name !== name) {
            changed = true;
            metadata.kernelspec = {
                name,
                display_name: displayName,
                metadata: {
                    interpreter: {
                        hash: sha256().update(kernelConnection.interpreter.path).digest('hex')
                    }
                }
            };
        }
    } else if (kernelSpecOrModel && !metadata.kernelspec) {
        // Add a new spec in this case
        metadata.kernelspec = {
            name: kernelSpecOrModel.name || kernelSpecOrModel.display_name || '',
            display_name: kernelSpecOrModel.display_name || kernelSpecOrModel.name || ''
        };
        kernelId = kernelSpecOrModel.id;
        changed = true;
    } else if (kernelSpecOrModel && metadata.kernelspec) {
        // Spec exists, just update name and display_name
        const name = kernelSpecOrModel.name || kernelSpecOrModel.display_name || '';
        const displayName = kernelSpecOrModel.display_name || kernelSpecOrModel.name || '';
        const language = kernelSpecOrModel.language || kernelSpecOrModel.language || '';
        if (
            metadata.kernelspec.name !== name ||
            metadata.kernelspec.language !== language ||
            metadata.kernelspec.display_name !== displayName ||
            kernelId !== kernelSpecOrModel.id
        ) {
            changed = true;
            metadata.kernelspec.name = name;
            metadata.kernelspec.display_name = displayName;
            metadata.kernelspec.language = language;
            kernelId = kernelSpecOrModel.id;
        }
        try {
            // This is set only for when we select an interpreter.
            // tslint:disable-next-line: no-any
            delete (metadata.kernelspec as any).metadata;
        } catch {
            // Noop.
        }
    }
    return { changed, kernelId };
}

export function getDefaultNotebookContent(pythonNumber: number = 3): Partial<nbformat.INotebookContent> {
    // Use this to build our metadata object
    // Use these as the defaults unless we have been given some in the options.
    const metadata: nbformat.INotebookMetadata = {
        language_info: {
            codemirror_mode: {
                name: 'ipython',
                version: pythonNumber
            },
            file_extension: '.py',
            mimetype: 'text/x-python',
            name: 'python',
            nbconvert_exporter: 'python',
            pygments_lexer: `ipython${pythonNumber}`,
            version: pythonNumber
        },
        orig_nbformat: 2
    };

    // Default notebook data.
    return {
        metadata: metadata,
        nbformat: 4,
        nbformat_minor: 2
    };
}
/**
 * Generates the metadata stored in ipynb for new notebooks.
 * If a preferred language is provided we use that.
 * We do not default to Python, as selecting a kernel will update the language_info in the ipynb file (after a kernel is successfully started).
 */
export function getDefaultNotebookContentForNativeNotebooks(language?: string): Partial<nbformat.INotebookContent> {
    const metadata: undefined | nbformat.INotebookMetadata = language
        ? {
              language_info: {
                  name: language,
                  nbconvert_exporter: 'python'
              },
              orig_nbformat: 2
          }
        : undefined;

    return {
        metadata,
        nbformat: 4,
        nbformat_minor: 2
    };
}
export abstract class BaseNotebookModel implements INotebookModel {
    public get onDidDispose() {
        return this._disposed.event;
    }
    public get isDisposed() {
        return this._isDisposed === true;
    }
    public get isDirty(): boolean {
        return false;
    }
    public get changed(): Event<NotebookModelChange> {
        return this._changedEmitter.event;
    }
    public get file(): Uri {
        return this._file;
    }

    public get isUntitled(): boolean {
        return isUntitledFile(this.file);
    }
    public get onDidEdit(): Event<NotebookModelChange> {
        return this._editEventEmitter.event;
    }
    public get metadata(): Readonly<nbformat.INotebookMetadata> | undefined {
        return this.kernelId && this.notebookJson.metadata
            ? {
                  ...this.notebookJson.metadata,
                  id: this.kernelId
              }
            : // Fix nyc compiler problem
              // tslint:disable-next-line: no-any
              (this.notebookJson.metadata as any);
    }
    public get isTrusted() {
        return this._isTrusted;
    }
    public get cellCount(): number {
        return this.getCellCount();
    }
    protected _disposed = new EventEmitter<void>();
    protected _isDisposed?: boolean;
    protected _changedEmitter = new EventEmitter<NotebookModelChange>();
    protected _editEventEmitter = new EventEmitter<NotebookModelChange>();
    protected _kernelConnection?: KernelConnectionMetadata;
    private kernelId: string | undefined;
    private readonly preferredRemoteKernelIdStorage: PreferredRemoteKernelIdProvider;
    constructor(
        protected _isTrusted: boolean,
        protected _file: Uri,
        protected globalMemento: Memento,
        crypto: ICryptoUtils,
        protected notebookJson: Partial<nbformat.INotebookContent> = {},
        public readonly indentAmount: string = ' ',
        private readonly pythonNumber: number = 3,
        initializeJsonIfRequired = true
    ) {
        // VSCode Notebook Model will execute this itself.
        // THe problem is we need to override this behavior, however the overriding doesn't work in JS
        // as some of the dependencies passed as ctor arguments are not available in the ctor.
        // E.g. in the ctor of the base class, the private members (passed as ctor ares) initialized in child class are not available (unlike other languages).
        if (initializeJsonIfRequired) {
            this.ensureNotebookJson();
        }
        this.preferredRemoteKernelIdStorage = new PreferredRemoteKernelIdProvider(globalMemento, crypto);
        this.kernelId = this.getStoredKernelId();
    }
    public dispose() {
        this._isDisposed = true;
        this._disposed.fire();
    }
    public abstract getCellsWithId(): { data: nbformat.IBaseCell; id: string; state: CellState }[];
    public getContent(): string {
        return this.generateNotebookContent();
    }
    public trust() {
        this._isTrusted = true;
    }
    protected abstract getCellCount(): number;
    protected handleUndo(_change: NotebookModelChange): boolean {
        return false;
    }
    protected handleRedo(change: NotebookModelChange): boolean {
        let changed = false;
        switch (change.kind) {
            case 'version':
                changed = this.updateVersionInfo(change.kernelConnection);
                break;
            default:
                break;
        }

        return changed;
    }
    protected generateNotebookJson() {
        // Make sure we have some
        this.ensureNotebookJson();

        // Reuse our original json except for the cells.
        const json = { ...this.notebookJson };
        json.cells = this.getJupyterCells().map(pruneCell);
        return json;
    }
    protected abstract getJupyterCells(): nbformat.IBaseCell[];
    protected getDefaultNotebookContent() {
        return getDefaultNotebookContent(this.pythonNumber);
    }

    protected ensureNotebookJson() {
        if (!this.notebookJson || !this.notebookJson.metadata) {
            this.notebookJson = this.getDefaultNotebookContent();
        }
    }

    // tslint:disable-next-line: cyclomatic-complexity
    private updateVersionInfo(kernelConnection: KernelConnectionMetadata | undefined): boolean {
        this._kernelConnection = kernelConnection;
        const { changed, kernelId } = updateNotebookMetadata(this.notebookJson.metadata, kernelConnection);
        if (kernelId) {
            this.kernelId = kernelId;
        }
        // Update our kernel id in our global storage too
        this.setStoredKernelId(kernelId);

        return changed;
    }

    private generateNotebookContent(): string {
        const json = this.generateNotebookJson();
        return JSON.stringify(json, null, this.indentAmount);
    }
    private getStoredKernelId(): string | undefined {
        return this.preferredRemoteKernelIdStorage.getPreferredRemoteKernelId(this._file);
    }
    private setStoredKernelId(id: string | undefined) {
        this.preferredRemoteKernelIdStorage.storePreferredRemoteKernelId(this._file, id).catch(noop);
    }
}
