// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as path from '../../vscode-path/path';
import {
    CancellationToken,
    ConfigurationChangeEvent,
    Event,
    FileSystemWatcher,
    GlobPattern,
    Uri,
    workspace,
    WorkspaceConfiguration,
    WorkspaceFolder,
    WorkspaceFoldersChangeEvent
} from 'vscode';
import { Resource } from '../types';
import { getOSType, OSType } from '../utils/platform';
import { IWorkspaceService } from './types';

/**
 * Wrapper around vscode's workspace namespace.
 */
export abstract class BaseWorkspaceService implements IWorkspaceService {
    public get onDidChangeConfiguration(): Event<ConfigurationChangeEvent> {
        return workspace.onDidChangeConfiguration;
    }
    public get rootFolder(): Uri | undefined {
        const firstWorkspace =
            Array.isArray(workspace.workspaceFolders) && workspace.workspaceFolders.length > 0
                ? workspace.workspaceFolders[0]
                : undefined;
        if (firstWorkspace) {
            return firstWorkspace.uri;
        }
    }
    public get workspaceFolders(): readonly WorkspaceFolder[] | undefined {
        return workspace.workspaceFolders;
    }
    public get onDidChangeWorkspaceFolders(): Event<WorkspaceFoldersChangeEvent> {
        return workspace.onDidChangeWorkspaceFolders;
    }
    public get hasWorkspaceFolders() {
        return Array.isArray(workspace.workspaceFolders) && workspace.workspaceFolders.length > 0;
    }
    public get workspaceFile() {
        return workspace.workspaceFile;
    }
    public getConfiguration(section?: string, resource?: Uri): WorkspaceConfiguration {
        return workspace.getConfiguration(section, resource || null);
    }
    public getWorkspaceFolder(uri: Resource): WorkspaceFolder | undefined {
        return uri ? workspace.getWorkspaceFolder(uri) : undefined;
    }
    public asRelativePath(pathOrUri: string | Uri, includeWorkspaceFolder?: boolean): string {
        return workspace.asRelativePath(pathOrUri, includeWorkspaceFolder);
    }
    public get isTrusted() {
        return workspace.isTrusted;
    }
    public get onDidGrantWorkspaceTrust() {
        return workspace.onDidGrantWorkspaceTrust;
    }

    public createFileSystemWatcher(
        globPattern: GlobPattern,
        _ignoreCreateEvents?: boolean,
        ignoreChangeEvents?: boolean,
        ignoreDeleteEvents?: boolean
    ): FileSystemWatcher {
        return workspace.createFileSystemWatcher(
            globPattern,
            ignoreChangeEvents,
            ignoreChangeEvents,
            ignoreDeleteEvents
        );
    }
    public findFiles(
        include: GlobPattern,
        exclude?: GlobPattern,
        maxResults?: number,
        token?: CancellationToken
    ): Thenable<Uri[]> {
        return workspace.findFiles(include, exclude, maxResults, token);
    }
    public getWorkspaceFolderIdentifier(resource: Resource, defaultValue: string = ''): string {
        const workspaceFolder = resource
            ? workspace.getWorkspaceFolder(resource)
            : workspace.workspaceFolders
            ? workspace.workspaceFolders[0] // Default to first folder if resource not passed in.
            : undefined;
        return workspaceFolder
            ? path.normalize(
                  getOSType() === OSType.Windows ? workspaceFolder.uri.path.toUpperCase() : workspaceFolder.uri.path
              )
            : defaultValue;
    }

    public abstract computeWorkingDirectory(resource: Resource): Promise<string>;
}
