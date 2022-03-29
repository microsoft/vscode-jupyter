import { ApplicationShell } from '../common/application/applicationShell.node';
import { CommandManager } from '../common/application/commandManager.node';
import { IApplicationShell, ICommandManager, IWorkspaceService } from '../common/application/types';
import { WorkspaceService } from '../common/application/workspace.node';
import { ConfigurationService } from '../common/configuration/service.node';
import { FileSystem } from '../common/platform/fileSystem.node';
import { IFileSystem } from '../common/platform/types';
import { IConfigurationService } from '../common/types';
import { IServiceManager } from '../ioc/types';

export function registerLoggerTypes(serviceManager: IServiceManager) {
    serviceManager.addSingleton<IFileSystem>(IFileSystem, FileSystem);
    serviceManager.addSingleton<ICommandManager>(ICommandManager, CommandManager);
    serviceManager.addSingleton<IWorkspaceService>(IWorkspaceService, WorkspaceService);
    serviceManager.addSingleton<IApplicationShell>(IApplicationShell, ApplicationShell);
    serviceManager.addSingleton<IConfigurationService>(IConfigurationService, ConfigurationService);
}
