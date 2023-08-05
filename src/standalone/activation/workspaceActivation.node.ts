// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { TextDocument } from 'vscode';
import { sendActivationTelemetry } from '../../platform/telemetry/envFileTelemetry.node';
import { IWorkspaceService, IDocumentManager } from '../../platform/common/application/types';
import { PYTHON_LANGUAGE } from '../../platform/common/constants';
import { IDisposable, Resource } from '../../platform/common/types';
import { traceDecoratorError } from '../../platform/logging';
import { IExtensionSyncActivationService } from '../../platform/activation/types';
import { IFileSystem } from '../../platform/common/platform/types';
import { noop } from '../../platform/common/utils/misc';

/**
 * Responsible for sending workspace level telemetry.
 */
@injectable()
export class WorkspaceActivation implements IExtensionSyncActivationService {
    public readonly activatedWorkspaces = new Set<string>();
    private readonly disposables: IDisposable[] = [];
    private docOpenedHandler?: IDisposable;

    constructor(
        @inject(IDocumentManager) private readonly documentManager: IDocumentManager,
        @inject(IWorkspaceService) private readonly workspaceService: IWorkspaceService,
        @inject(IFileSystem) private readonly fileSystem: IFileSystem
    ) {}

    public activate() {
        this.addHandlers();
        this.addRemoveDocOpenedHandlers();
        this.activateWorkspace(this.getActiveResource()).catch(noop);
    }

    private getActiveResource(): Resource {
        const editor = this.documentManager.activeTextEditor;
        if (editor && !editor.document.isUntitled) {
            return editor.document.uri;
        }
        return Array.isArray(this.workspaceService.workspaceFolders) &&
            this.workspaceService.workspaceFolders.length > 0
            ? this.workspaceService.workspaceFolders[0].uri
            : undefined;
    }

    @traceDecoratorError('Failed to activate a workspace')
    public async activateWorkspace(resource: Resource) {
        const key = this.getWorkspaceKey(resource);
        if (this.activatedWorkspaces.has(key)) {
            return;
        }
        this.activatedWorkspaces.add(key);

        await sendActivationTelemetry(this.fileSystem, this.workspaceService, resource);
    }

    public onDocOpened(doc: TextDocument) {
        if (doc.languageId !== PYTHON_LANGUAGE) {
            return;
        }
        const key = this.getWorkspaceKey(doc.uri);
        // If we have opened a doc that does not belong to workspace, then do nothing.
        if (key === '' && this.workspaceService.hasWorkspaceFolders) {
            return;
        }
        if (this.activatedWorkspaces.has(key)) {
            return;
        }
        const folder = this.workspaceService.getWorkspaceFolder(doc.uri);
        this.activateWorkspace(folder ? folder.uri : undefined).catch(noop);
    }

    protected addHandlers() {
        this.disposables.push(this.workspaceService.onDidChangeWorkspaceFolders(this.onWorkspaceFoldersChanged, this));
    }
    protected addRemoveDocOpenedHandlers() {
        if (this.hasMultipleWorkspaces()) {
            if (!this.docOpenedHandler) {
                this.docOpenedHandler = this.documentManager.onDidOpenTextDocument(this.onDocOpened, this);
            }
            return;
        }
        if (this.docOpenedHandler) {
            this.docOpenedHandler.dispose();
            this.docOpenedHandler = undefined;
        }
    }
    protected onWorkspaceFoldersChanged() {
        //If an activated workspace folder was removed, delete its key
        const workspaceKeys = this.workspaceService.workspaceFolders!.map((workspaceFolder) =>
            this.getWorkspaceKey(workspaceFolder.uri)
        );
        const activatedWkspcKeys = Array.from(this.activatedWorkspaces.keys());
        const activatedWkspcFoldersRemoved = activatedWkspcKeys.filter((item) => workspaceKeys.indexOf(item) < 0);
        if (activatedWkspcFoldersRemoved.length > 0) {
            for (const folder of activatedWkspcFoldersRemoved) {
                this.activatedWorkspaces.delete(folder);
            }
        }
        this.addRemoveDocOpenedHandlers();
    }
    protected hasMultipleWorkspaces() {
        return this.workspaceService.hasWorkspaceFolders && this.workspaceService.workspaceFolders!.length > 1;
    }
    protected getWorkspaceKey(resource: Resource) {
        return this.workspaceService.getWorkspaceFolderIdentifier(resource, '');
    }
}
