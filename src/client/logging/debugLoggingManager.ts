import { inject, injectable, named } from 'inversify';
import { Memento, Uri } from 'vscode';
import { IExtensionSingleActivationService } from '../activation/types';
import { IApplicationShell, ICommandManager } from '../common/application/types';
import { TemporaryFile } from '../common/platform/types';
import { GLOBAL_MEMENTO, IConfigurationService, IDisposableRegistry, IMemento } from '../common/types';
import { Common, Logging } from '../common/utils/localize';
import { Commands } from '../datascience/constants';
import { IDataScienceFileSystem } from '../datascience/types';
import { addLogfile } from './_global';
import { LogLevel } from './levels';

const SEEN_DEBUG_LOG_LEVEL_ON_ACTIVATION_AT_LEAST_ONCE = 'SeenDebugLogLevelAtLeastOnce';
const SHOULD_WARN_ABOUT_LOGGING = 'ShouldWarnAboutLogging';

@injectable()
export class DebugLoggingManager implements IExtensionSingleActivationService {
    private temporaryLogFile: TemporaryFile | undefined;

    constructor(
        @inject(IDataScienceFileSystem) private filesystem: IDataScienceFileSystem,
        @inject(IMemento) @named(GLOBAL_MEMENTO) private globalState: Memento,
        @inject(IApplicationShell) private appShell: IApplicationShell,
        @inject(ICommandManager) private commandManager: ICommandManager,
        @inject(IConfigurationService) private configService: IConfigurationService,
        @inject(IDisposableRegistry) private readonly disposables: IDisposableRegistry
    ) {
        this.disposables.push(this.commandManager.registerCommand(Commands.OpenLogFile, this.onOpenDebugLogFile, this));
    }

    public async activate() {
        const logLevelSetting = this.configService.getSettings().logging.level;
        const seenDebugAtLeastOnce = this.globalState.get<boolean>(
            SEEN_DEBUG_LOG_LEVEL_ON_ACTIVATION_AT_LEAST_ONCE,
            false
        );
        if (
            logLevelSetting === LogLevel.Debug &&
            seenDebugAtLeastOnce &&
            this.globalState.get<boolean>(SHOULD_WARN_ABOUT_LOGGING, true)
        ) {
            await this.warnUserAboutLoggingToFile();
        } else if (logLevelSetting === LogLevel.Debug && !seenDebugAtLeastOnce) {
            await this.configureLoggingToFile();
        }
    }

    private async configureLoggingToFile() {
        const logfile = await this.filesystem.createTemporaryLocalFile('.txt');
        addLogfile(logfile.filePath);
        this.temporaryLogFile = logfile;
        this.globalState.update(SEEN_DEBUG_LOG_LEVEL_ON_ACTIVATION_AT_LEAST_ONCE, true);
    }

    private async warnUserAboutLoggingToFile() {
        const prompts = [Logging.bannerYesTurnOffDebugLogging(), Common.doNotShowAgain()];
        const selection = await this.appShell.showWarningMessage(
            Logging.warnUserAboutDebugLoggingSetting(),
            ...prompts
        );
        switch (selection) {
            case Logging.bannerYesTurnOffDebugLogging():
                this.globalState.update(SEEN_DEBUG_LOG_LEVEL_ON_ACTIVATION_AT_LEAST_ONCE, false);
                this.commandManager.executeCommand(Commands.ResetLoggingLevel);
                return;
            case Common.doNotShowAgain():
                this.globalState.update(SHOULD_WARN_ABOUT_LOGGING, false);
                break;
            default:
                break;
        }
        await this.configureLoggingToFile();
    }

    private async onOpenDebugLogFile() {
        if (this.temporaryLogFile) {
            this.commandManager.executeCommand('vscode.open', Uri.file(this.temporaryLogFile.filePath));
        }
    }
}
