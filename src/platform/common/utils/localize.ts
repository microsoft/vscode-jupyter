// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

import * as vscode from 'vscode';
import * as nls from 'vscode-nls';
import { getOSType, OSType } from './platform';

// This is configuring vscode-nls and saying "I'm bundling translations with webpack and I am not a part of language packs (aka standalone)".
nls.config({ messageFormat: nls.MessageFormat.bundle, bundleFormat: nls.BundleFormat.standalone });

let localize = nls.loadMessageBundle();

// Embed all known translations so we can use them on the web too
const packageBaseNlsJson = require('../../../../package.nls.json');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const packageNlsJsons: Record<string, any> = {
    en: require('../../../../package.nls.json'),
    it: require('../../../../package.nls.it.json'),
    nl: require('../../../../package.nls.nl.json'),
    pl: require('../../../../package.nls.pl.json'),
    ru: require('../../../../package.nls.ru.json'),
    'zh-cn': require('../../../../package.nls.zh-cn.json'),
    'zh-tw': require('../../../../package.nls.zh-tw.json')
};

// TODO: Once vscode-nls supports the web environment, we should:
// - Remove this function and the conditional afterwards that uses `osType`.
// - Change the signature of the localize properties in this file to not be functions but constants.
//   - Instead of `Common.bannerLabelYes()`, make them `Common.bannerLabelYes`.
export function localizeReplacement(key: string | nls.LocalizeInfo, defaultValue: string): string {
    if (typeof key !== 'string') {
        key = key.key;
    }
    return getString(key as string, defaultValue);
}
const osType = getOSType();
if (osType === OSType.Unknown) {
    localize = localizeReplacement;
} else {
    // Python should never be localized, so it should always be equal to Python,
    // unless there's an error in localization.
    let localizeTest = localize('test', 'Python');
    if (localizeTest !== 'Python') {
        localize = localizeReplacement;
    }
}

// External callers of localize use these tables to retrieve localized values.

export namespace Common {
    export const jupyter = () => localize('Common.jupyter', 'Jupyter');
    export const bannerLabelYes = () => localize('Common.bannerLabelYes', 'Yes');
    export const bannerLabelNo = () => localize('Common.bannerLabelNo', 'No');
    export const yesPlease = () => localize('Common.yesPlease', 'Yes, please');
    export const canceled = () => localize('Common.canceled', 'Canceled');
    export const cancel = () => localize('Common.cancel', 'Cancel');
    export const ok = () => localize('Common.ok', 'Ok');
    export const refresh = () => localize('Common.refresh', 'Refresh');
    export const refreshing = () => localize('Common.refreshing', 'Refreshing...');
    export const download = () => localize('Common.download', 'Download');
    export const gotIt = () => localize('Common.gotIt', 'Got it!');
    export const install = () => localize('Common.install', 'Install');
    export const loadingExtension = () => localize('Common.loadingExtension', 'Jupyter Extension loading...');
    export const handleExtensionActivationError = () =>
        localize(
            'Common.handleExtensionActivationError',
            "Extension activation failed, run the 'Developer: Toggle Developer Tools' command for more information."
        );
    export const openOutputPanel = () => localize('Common.openOutputPanel', 'Show output');
    export const noIWillDoItLater = () => localize('Common.noIWillDoItLater', 'No, I will do it later');
    export const notNow = () => localize('Common.notNow', 'Not now');
    export const doNotShowAgain = () => localize('Common.doNotShowAgain', 'Do not show again');
    export const reload = () => localize('Common.reload', 'Reload');
    export const moreInfo = () => localize('Common.moreInfo', 'More Info');
    export const learnMore = () => localize('Common.learnMore', 'Learn more');
    export const and = () => localize('Common.and', 'and');
    export const reportThisIssue = () => localize('Common.reportThisIssue', 'Report this issue');
    export const clickHereForMoreInfoWithHtml = () =>
        localize('Common.clickHereForMoreInfoWithHtml', "Click <a href='{0}'>here</a> for more info.");
}

export namespace CommonSurvey {
    export const remindMeLaterLabel = () => localize('CommonSurvey.remindMeLaterLabel', 'Remind me later');
    export const yesLabel = () => localize('CommonSurvey.yesLabel', 'Yes, take survey now');
    export const noLabel = () => localize('CommonSurvey.noLabel', 'No, thanks');
}

export namespace Http {
    export const downloadingFile = () => localize('downloading.file', 'Downloading {0}...');
    export const downloadingFileProgress = () => localize('downloading.file.progress', '{0}{1} of {2} KB ({3}%)');
}
export namespace Experiments {
    export const inGroup = () => localize('Experiments.inGroup', "User belongs to experiment group '{0}'");
}
export namespace OutputChannelNames {
    export const jupyter = () => localize('OutputChannelNames.jupyter', 'Jupyter');
}

export namespace GitHubIssue {
    export const failure = () =>
        localize(
            {
                key: 'GitHubIssue.Failure',
                comment: ['{Locked="Issue"']
            },
            'We encountered an error while submitting your GitHub Issue. Would you still like to report an issue?'
        );
    export const copyContentToClipboardAndOpenIssue = () =>
        localize('GitHubIssue.copyToClipboardAndOpenIssue', 'Yes, copy content to clipboard and open issue');
    export const askForIssueTitle = () =>
        localize('GitHubIssue.askForIssueTitle', 'Please provide a descriptive title summarizing your issue.');
    export const titlePlaceholder = () =>
        localize(
            { key: 'GitHubIssue.titlePlaceholder', comment: ['{Locked="kernel"}'] },
            'E.g.: Unable to start a local kernel session'
        );
    export const pleaseFillThisOut = () =>
        localize(
            'GitHubIssue.pleaseFillThisOut',
            'Please fill this section out and delete this comment before submitting an issue!'
        );
    export const missingFields = () =>
        localize(
            { key: 'GitHubIssue.missingFields', comment: ['{Locked="Issue"}'] },
            'Please provide details of the issue you encountered before clicking Submit GitHub Issue.'
        );
}

export namespace Logging {
    export const currentWorkingDirectory = () => 'cwd:';
    export const warnUserAboutDebugLoggingSetting = () =>
        localize(
            'Logging.WarnUserAboutDebugLoggingSetting',
            'You have enabled debug logging for the Jupyter Extension, which will continue to write logs to disk. Would you like to turn debug logging off?'
        );
    export const bannerYesTurnOffDebugLogging = () =>
        localize('Logging.YesTurnOffDebugLogging', 'Yes, turn off debug logging');
    export const NoResponse = () => localize('Logging.NoResponse', 'No');
    export const NoAndDontAskAgain = () => localize('Logging.NoAndDontAskAgain', "No, and don't ask again");
}

export namespace InteractiveShiftEnterBanner {
    export const bannerMessage = () =>
        localize(
            'InteractiveShiftEnterBanner.bannerMessage',
            'Would you like shift-enter to send code to the new Interactive Window experience?'
        );
}

export namespace InsidersNativeNotebooksSurveyBanner {
    export const bannerMessage = () =>
        localize(
            'InsidersNativeNotebooksSurveyBanner.bannerMessage',
            'Can you please take a minute to tell us about your notebooks experience in VS Code?'
        );
}

export namespace DataScienceSurveyBanner {
    export const bannerMessage = () =>
        localize(
            'DataScienceSurveyBanner.bannerMessage',
            'Can you please take 2 minutes to tell us how the Python Data Science features are working for you?'
        );
    export const bannerLabelYes = () => localize('DataScienceSurveyBanner.bannerLabelYes', 'Yes, take survey now');
    export const bannerLabelNo = () => localize('DataScienceSurveyBanner.bannerLabelNo', 'No, thanks');
}
export namespace DataScienceRendererExtension {
    export const installingExtension = () =>
        localize(
            {
                key: 'DataScienceRendererExtension.installingExtension',
                comment: ['{Locked="Notebook Renderers"}']
            },
            'Installing Notebook Renderers extension... '
        );
    export const installationCompleteMessage = () =>
        localize(
            {
                key: 'DataScienceRendererExtension.installationCompleteMessage',
                comment: ['{Locked="Notebook Renderers"}']
            },
            'complete.'
        );
    export const startingDownloadOutputMessage = () =>
        localize(
            {
                key: 'DataScienceRendererExtension.startingDownloadOutputMessage',
                comment: ['{Locked="Notebook Renderers"}']
            },
            'Starting download of Notebook Renderers extension.'
        );
    export const downloadingMessage = () =>
        localize(
            {
                key: 'DataScienceRendererExtension.downloadingMessage',
                comment: ['{Locked="Notebook Renderers"}']
            },
            'Downloading Notebook Renderers Extension... '
        );
    export const downloadCompletedOutputMessage = () =>
        localize(
            {
                key: 'DataScienceRendererExtension.downloadCompletedOutputMessage',
                comment: ['{Locked="Notebook Renderers"}']
            },
            'Notebook Renderers extension download complete.'
        );
}
export namespace ExtensionSurveyBanner {
    export const bannerMessage = () =>
        localize(
            'ExtensionSurveyBanner.bannerMessage',
            'Can you please take 2 minutes to tell us how the Python Extension is working for you?'
        );
    export const bannerLabelYes = () => localize('ExtensionSurveyBanner.bannerLabelYes', 'Yes, take survey now');
    export const bannerLabelNo = () => localize('ExtensionSurveyBanner.bannerLabelNo', 'No, thanks');
    export const maybeLater = () => localize('ExtensionSurveyBanner.maybeLater', 'Maybe later');
}

export namespace DataScience {
    export const installingModule = () => localize('products.installingModule', 'Installing {0}');
    export const warnWhenSelectingKernelWithUnSupportedPythonVersion = () =>
        localize(
            { key: 'DataScience.warnWhenSelectingKernelWithUnSupportedPythonVersion', comment: ['{Locked="kernel"}'] },
            'The version of Python associated with the selected kernel is no longer supported. Please consider selecting a different kernel.'
        );
    export const pythonExtensionRequiredToRunNotebook = () =>
        localize(
            'DataScience.pythonExtensionRequiredToRunNotebook',
            'Python Extension required to run Python notebooks.'
        );
    export const installingPythonExtension = () =>
        localize('DataScience.installingPythonExtension', 'Installing Python extension and locating kernels.');
    export const customizeLayout = () => localize('DataScience.customizeLayout', 'Customize Layout');
    export const pythonExtensionRequired = () =>
        localize(
            'DataScience.pythonExtensionRequired',
            'The Python Extension is required to perform that task. Click Yes to open Python Extension installation page.'
        );

    export const pythonExtensionInstalled = () =>
        localize(
            'DataScience.pythonInstalledReloadPromptMessage',
            'Python Extension is now installed. Some features might not be available until a notebook or interactive window session is restarted.'
        );
    export const unknownServerUri = () =>
        localize(
            'DataScience.unknownServerUri',
            'Server URL cannot be used. Did you uninstall an extension that provided a Jupyter server connection?'
        );
    export const uriProviderDescriptionFormat = () =>
        localize('DataScience.uriProviderDescriptionFormat', '{0} (From {1} extension)');
    export const unknownPackage = () => localize('DataScience.unknownPackage', 'unknown');
    export const interactiveWindowTitle = () => localize('DataScience.interactiveWindowTitle', 'Interactive');
    export const interactiveWindowTitleFormat = () =>
        localize('DataScience.interactiveWindowTitleFormat', 'Interactive - {0}');

    export const interactiveWindowModeBannerTitle = () =>
        localize(
            {
                key: 'DataScience.interactiveWindowModeBannerTitle',
                comment: ["{Locked='command:workbench.action.openSettings?%5B%22jupyter.interactiveWindowMode%22%5D'}"]
            },
            'Do you want to open a new Interactive Window for this file? [More Information](command:workbench.action.openSettings?%5B%22jupyter.interactiveWindowMode%22%5D).'
        );

    export const interactiveWindowModeBannerSwitchYes = () =>
        localize('DataScience.interactiveWindowModeBannerSwitchYes', 'Yes');
    export const interactiveWindowModeBannerSwitchAlways = () =>
        localize('DataScience.interactiveWindowModeBannerSwitchAlways', 'Always');
    export const interactiveWindowModeBannerSwitchNo = () =>
        localize('DataScience.interactiveWindowModeBannerSwitchNo', 'No');

    export const dataExplorerTitle = () => localize('DataScience.dataExplorerTitle', 'Data Viewer');
    export const badWebPanelFormatString = () =>
        localize(
            {
                key: 'DataScience.badWebPanelFormatString',
                comment: ['{RegEx=">[^<]*<"}', 'Only translate the text within the HTML tags']
            },
            '<html><body><h1>{0} is not a valid file name</h1></body></html>'
        );
    export const checkingIfImportIsSupported = () =>
        localize(
            { key: 'DataScience.checkingIfImportIsSupported', comment: ['{Locked="import"}'] },
            'Checking if "import" is supported'
        );
    export const installingMissingDependencies = () =>
        localize('DataScience.installingMissingDependencies', 'Installing missing dependencies');
    export const validatingKernelDependencies = () =>
        localize(
            { key: 'DataScience.validatingKernelDependencies', comment: ['{Locked="kernel"}'] },
            'Validating kernel dependencies'
        );
    export const performingExport = () => localize('DataScience.performingExport', 'Performing Export');
    export const convertingToPDF = () => localize('DataScience.convertingToPDF', 'Converting to PDF');
    export const exportNotebookToPython = () =>
        localize(
            { key: 'DataScience.exportNotebookToPython', comment: ['{Locked="Notebook"}'] },
            'Exporting Notebook to Python'
        );
    export const sessionDisposed = () =>
        localize('DataScience.sessionDisposed', 'Cannot execute code, session has been disposed.');
    export const passwordFailure = () =>
        localize(
            'DataScience.passwordFailure',
            'Failed to connect to password protected server. Check that password is correct.'
        );
    export const rawKernelProcessNotStarted = () =>
        localize(
            { key: 'DataScience.rawKernelProcessNotStarted', comment: ['{Locked="kernel"}'] },
            'Raw kernel process was not able to start.'
        );
    export const rawKernelProcessExitBeforeConnect = () =>
        localize(
            { key: 'DataScience.rawKernelProcessExitBeforeConnect', comment: ['{Locked="kernel"}'] },
            'Raw kernel process exited before connecting.'
        );
    export const unknownMimeTypeFormat = () =>
        localize('DataScience.unknownMimeTypeFormat', 'MIME type {0} is not currently supported');
    export const exportDialogTitle = () =>
        localize(
            { key: 'DataScience.exportDialogTitle', comment: ['{Locked="Notebook"}'] },
            'Export to Jupyter Notebook'
        );
    export const exportDialogFilter = () =>
        localize({ key: 'DataScience.exportDialogFilter', comment: ['{Locked="Notebooks"}'] }, 'Jupyter Notebooks');
    export const exportDialogComplete = () => localize('DataScience.exportDialogComplete', 'Notebook written to {0}');
    export const exportDialogFailed = () =>
        localize('DataScience.exportDialogFailed', 'Failed to export notebook. {0}');
    export const exportOpenQuestion1 = () => localize('DataScience.exportOpenQuestion1', 'Open in editor');
    export const runCellLensCommandTitle = () => localize('jupyter.command.jupyter.runcell.title', 'Run Cell');
    export const importDialogTitle = () =>
        localize({ key: 'DataScience.importDialogTitle', comment: ['{Locked="Notebook"}'] }, 'Import Jupyter Notebook');
    export const importDialogFilter = () => 'Jupyter Notebooks';
    export const notebookCheckForImportTitle = () =>
        localize(
            { key: 'DataScience.notebookCheckForImportTitle', comment: ['{Locked="Notebook"}'] },
            'Do you want to import the Jupyter Notebook into Python code?'
        );
    export const notebookCheckForImportYes = () => localize('DataScience.notebookCheckForImportYes', 'Import');
    export const notebookCheckForImportNo = () => localize('DataScience.notebookCheckForImportNo', 'Later');
    export const notebookCheckForImportDontAskAgain = () =>
        localize('DataScience.notebookCheckForImportDontAskAgain', "Don't Ask Again");
    export const libraryNotInstalled = () =>
        localize('DataScience.libraryNotInstalled', 'Data Science library {0} is not installed. Install?');
    export const libraryNotInstalledCorrectlyOrOutdated = () =>
        localize(
            'DataScience.libraryNotInstalledCorrectlyOrOutdated',
            'Data Science library {0} is not installed correctly or outdated. Re-Install?'
        );
    export const couldNotInstallLibrary = () =>
        localize(
            'DataScience.couldNotInstallLibrary',
            'Could not install {0} package. If pip is not available, please use the package manager of your choice to manually install this library into your Python environment.'
        );
    export const libraryRequiredToLaunchJupyterNotInstalled = () =>
        localize('DataScience.libraryRequiredToLaunchJupyterNotInstalled', 'Running cells requires {0} package.');
    export const librariesRequiredToLaunchJupyterNotInstalled = () =>
        localize('DataScience.librariesRequiredToLaunchJupyterNotInstalled', 'Running cells requires {0} package.');
    export const libraryRequiredToLaunchJupyterNotInstalledInterpreter = () =>
        localize(
            'DataScience.libraryRequiredToLaunchJupyterNotInstalledInterpreter',
            "Running cells with '{0}' requires {1} package."
        );
    export const libraryRequiredToLaunchJupyterKernelNotInstalledInterpreter = () =>
        localize(
            'DataScience.libraryRequiredToLaunchJupyterKernelNotInstalledInterpreter',
            "Running cells with '{0}' requires {1} package."
        );
    export const libraryRequiredToLaunchJupyterKernelNotInstalledInterpreterAndRequiresUpdate = () =>
        localize(
            'DataScience.libraryRequiredToLaunchJupyterKernelNotInstalledInterpreterAndRequiresUpdate',
            "Running cells with '{0}' requires {1} package installed or requires an update."
        );
    export const librariesRequiredToLaunchJupyterNotInstalledInterpreter = () =>
        localize(
            'DataScience.librariesRequiredToLaunchJupyterNotInstalledInterpreter',
            "Running cells with '{0}' requires {1} package."
        );
    export const installPackageInstructions = () =>
        localize(
            'DataScience.installPackageInstructions',
            "Run the following command to install '{0}' into the Python environment. \nCommand: '{1}'"
        );
    export const selectJupyterInterpreter = () =>
        localize('DataScience.selectJupyterInterpreter', 'Select an Interpreter to start Jupyter');
    export const jupyterInstall = () => localize('DataScience.jupyterInstall', 'Install');
    export const currentlySelectedJupyterInterpreterForPlaceholder = () =>
        localize('DataScience.currentlySelectedJupyterInterpreterForPlaceholder', 'current: {0}');
    export const jupyterNotSupported = () =>
        localize(
            'DataScience.jupyterNotSupported',
            'Jupyter cannot be started. Error attempting to locate Jupyter: {0}'
        );
    export const jupyterNotSupportedBecauseOfEnvironment = () =>
        localize(
            'DataScience.jupyterNotSupportedBecauseOfEnvironment',
            'Activating {0} to run Jupyter failed with {1}'
        );
    export const jupyterNbConvertNotSupported = () =>
        localize('DataScience.jupyterNbConvertNotSupported', 'Jupyter nbconvert is not installed');
    export const jupyterLaunchTimedOut = () =>
        localize('DataScience.jupyterLaunchTimedOut', 'The Jupyter notebook server failed to launch in time');
    export const jupyterLaunchNoURL = () =>
        localize('DataScience.jupyterLaunchNoURL', 'Failed to find the URL of the launched Jupyter notebook server');
    export const jupyterSelfCertFail = () =>
        localize(
            'DataScience.jupyterSelfCertFail',
            'The security certificate used by server {0} was not issued by a trusted certificate authority.\r\nThis may indicate an attempt to steal your information.\r\nDo you want to enable the Allow Unauthorized Remote Connection setting for this workspace to allow you to connect?'
        );
    export const jupyterExpiredCertFail = () =>
        localize(
            'DataScience.jupyterExpiredCertFail',
            'The security certificate used by server {0} has expired.\r\nThis may indicate an attempt to steal your information.\r\nDo you want to enable the Allow Unauthorized Remote Connection setting for this workspace to allow you to connect?'
        );
    export const jupyterSelfCertFailErrorMessageOnly = () =>
        localize(
            'DataScience.jupyterSelfCertFailErrorMessageOnly',
            'The security certificate used by server was not issued by a trusted certificate authority.\r\nThis may indicate an attempt to steal your information.'
        );
    export const jupyterSelfCertExpiredErrorMessageOnly = () =>
        localize(
            'DataScience.jupyterSelfCertExpiredErrorMessageOnly',
            'The security certificate used by server has expired.\r\nThis may indicate an attempt to steal your information.'
        );
    export const jupyterSelfCertEnable = () => localize('DataScience.jupyterSelfCertEnable', 'Yes, connect anyways');
    export const jupyterSelfCertClose = () => localize('DataScience.jupyterSelfCertClose', 'No, close the connection');
    export const pythonInteractiveHelpLink = () =>
        localize(
            'DataScience.pythonInteractiveHelpLink',
            'See <https://aka.ms/pyaiinstall> for help on installing Jupyter.'
        );
    export const markdownHelpInstallingMissingDependencies = () =>
        localize(
            'DataScience.markdownHelpInstallingMissingDependencies',
            'See <https://aka.ms/pyaiinstall> for help on installing Jupyter and related dependencies.'
        );
    export const importingFormat = () => localize('DataScience.importingFormat', 'Importing {0}');
    export const startingJupyter = () => localize('DataScience.startingJupyter', 'Starting Jupyter server');
    export const connectingToKernel = () =>
        localize(
            { key: 'DataScience.connectingToKernel', comment: ['{Locked="kernel"}'] },
            'Connecting to kernel: {0}'
        );
    export const connectedToKernel = () => localize('DataScience.connectedToKernel', 'Connected.');
    export const connectingToJupyter = () =>
        localize('DataScience.connectingToJupyter', 'Connecting to Jupyter server');
    export const exportingFormat = () => localize('DataScience.exportingFormat', 'Exporting {0}');
    export const runAllCellsLensCommandTitle = () =>
        localize('jupyter.command.jupyter.runallcells.title', 'Run All Cells');
    export const runAllCellsAboveLensCommandTitle = () =>
        localize('jupyter.command.jupyter.runallcellsabove.title', 'Run Above');
    export const runCellAndAllBelowLensCommandTitle = () =>
        localize('jupyter.command.jupyter.runcellandallbelow.title', 'Run Below');

    export const restartKernelMessage = () =>
        localize(
            { key: 'DataScience.restartKernelMessage', comment: ['{Locked="kernel"}'] },
            'Do you want to restart the Jupyter kernel? All variables will be lost.'
        );
    export const restartKernelMessageYes = () => localize('DataScience.restartKernelMessageYes', 'Restart');
    export const restartKernelMessageDontAskAgain = () =>
        localize('DataScience.restartKernelMessageDontAskAgain', "Don't Ask Again");
    export const automaticallyReconnectingToAKernelProgressMessage = () =>
        localize('DataScience.automaticallyReconnectingToAKernelProgressMessage', 'Reconnecting to the kernel {0}');
    export const restartingKernelStatus = () => localize('DataScience.restartingKernelStatus', 'Restarting Kernel {0}');
    export const restartingKernelFailed = () =>
        localize(
            'DataScience.restartingKernelFailed',
            'Kernel restart failed. Jupyter server is hung. Please reload VS Code.'
        );
    export const interruptingKernelFailed = () =>
        localize(
            'DataScience.interruptingKernelFailed',
            'Kernel interrupt failed. Jupyter server is hung. Please reload VS Code.'
        );
    export const sessionStartFailedWithKernel = () =>
        localize(
            {
                key: 'DataScience.sessionStartFailedWithKernel',
                comment: ['{Locked="command:jupyter.viewOutput"}']
            },
            "Failed to start the Kernel '{0}'. \nView Jupyter [log](command:jupyter.viewOutput) for further details."
        );
    export const failedToStartJupyter = () =>
        localize(
            {
                key: 'DataScience.failedToStartJupyter',
                comment: ['{Locked="command:jupyter.viewOutput"}']
            },
            "Failed to start Jupyter in the environment '{0}'. \nView Jupyter [log](command:jupyter.viewOutput) for further details."
        );
    export const failedToStartJupyterWithErrorInfo = () =>
        localize(
            {
                key: 'DataScience.failedToStartJupyterWithErrorInfo',
                comment: ['{Locked="command:jupyter.viewOutput"}']
            },
            "Failed to start Jupyter in the environment '{0}'. \n{1} \nView Jupyter [log](command:jupyter.viewOutput) for further details."
        );
    export const failedToStartJupyterDueToOutdatedTraitlets = () =>
        localize(
            {
                key: 'DataScience.failedToStartJupyterDueToOutdatedTraitlets',
                comment: ['{Locked="command:jupyter.viewOutput"}', '{Locked="traitless"}']
            },
            "Failed to start Jupyter in the environment '{0}' possibly due to an outdated version of 'traitlets'. \n{1} \nConsider updating the 'traitlets' module to '5.1.1' or later. \nView Jupyter [log](command:jupyter.viewOutput) for further details."
        );
    export const failedToStartKernel = () => localize('DataScience.failedToStartKernel', 'Failed to start the Kernel.');
    export const failedToRestartKernel = () =>
        localize('DataScience.failedToRestartKernel', 'Failed to restart the Kernel.');
    export const failedToInterruptKernel = () =>
        localize('DataScience.failedToInterruptKernel', 'Failed to interrupt the Kernel.');
    export const rawKernelStartFailedDueToTimeout = () =>
        localize(
            {
                key: 'DataScience.rawKernelStartFailedDueToTimeout',
                comment: ['{Locked="command:jupyter.viewOutput"}']
            },
            "Unable to start Kernel '{0}' due to connection timeout. \nView Jupyter [log](command:jupyter.viewOutput) for further details."
        );
    export const viewJupyterLogForFurtherInfo = () =>
        localize(
            {
                key: 'DataScience.viewJupyterLogForFurtherInfo',
                comment: ['{Locked="command:jupyter.viewOutput"}']
            },
            'View Jupyter [log](command:jupyter.viewOutput) for further details.'
        );
    export const kernelDied = () =>
        localize(
            {
                key: 'DataScience.kernelDied',
                comment: ['{Locked="kernel"}', '{Locked="command:jupyter.viewOutput"}']
            },
            'The kernel died. Error: {0}... View Jupyter [log](command:jupyter.viewOutput) for further details.'
        );
    export const kernelDiedWithoutError = () =>
        localize(
            {
                key: 'DataScience.kernelDiedWithoutError',
                comment: ['{Locked="command:jupyter.viewOutput"}', '{Locked="vscodeJupyterKernelCrash"}']
            },
            "The kernel '{0}' died. Click [here](https://aka.ms/vscodeJupyterKernelCrash) for more info. View Jupyter [log](command:jupyter.viewOutput) for further details."
        );
    export const failedToStartAnUntrustedKernelSpec = () =>
        localize(
            'DataScience.failedToStartAnUntrustedKernelSpec',
            "The kernel '{0}' was not started as it is located in an insecure location '{1}'.  \nClick [here](https://aka.ms/JupyterTrustedKernelPaths) for further details, optionally update the setting [jupyter.kernels.trusted](command:workbench.action.openSettings?[\"jupyter.kernels.trusted\"]) to trust the kernel."
        );
    export const kernelDiedWithoutErrorAndAutoRestarting = () =>
        localize(
            {
                key: 'DataScience.kernelDiedWithoutErrorAndAutoRestarting',
                comment: [
                    '{Locked="kernel"}',
                    '{Locked="command:jupyter.viewOutput"}',
                    '{Locked="vscodeJupyterKernelCrash"}'
                ]
            },
            "The kernel '{0}' died and is being automatically restarted by Jupyter. Click [here](https://aka.ms/vscodeJupyterKernelCrash) for more info. View Jupyter [log](command:jupyter.viewOutput) for further details."
        );
    export const kernelCrashedDueToCodeInCurrentOrPreviousCell = () =>
        localize(
            {
                key: 'DataScience.kernelCrashedDueToCodeInCurrentOrPreviousCell',
                comment: [
                    '{Locked="kernel"}',
                    '{Locked="vscodeJupyterKernelCrash"}',
                    '{Locked="command:jupyter.viewOutput"}'
                ]
            },
            "The Kernel crashed while executing code in the the current cell or a previous cell. Please review the code in the cell(s) to identify a possible cause of the failure. Click <a href='https://aka.ms/vscodeJupyterKernelCrash'>here</a> for more info. View Jupyter [log](command:jupyter.viewOutput) for further details."
        );
    export const kernelDisconnected = () =>
        localize(
            'DataScience.kernelDisconnected',
            "Unable to connect to the kernel '{0}', please verify the Jupyter Server connection. View Jupyter [log](command:jupyter.viewOutput) for further details."
        );
    export const cannotRunCellKernelIsDead = () =>
        localize(
            { key: 'DataScience.cannotRunCellKernelIsDead', comment: ['{Locked="kernel"}'] },
            "Cannot run cells, as the kernel '{0}' is dead."
        );
    export const showJupyterLogs = () => localize('jupyter.showJupyterLogs', 'Show Jupyter Logs.');
    export const executingCode = () => localize('DataScience.executingCode', 'Executing Cell');
    export const collapseAll = () => localize('DataScience.collapseAll', 'Collapse all cell inputs');
    export const expandAll = () => localize('DataScience.expandAll', 'Expand all cell inputs');
    export const collapseSingle = () => localize('DataScience.collapseSingle', 'Collapse');
    export const expandSingle = () => localize('DataScience.expandSingle', 'Expand');
    export const exportKey = () => localize('DataScience.export', 'Export as Jupyter notebook');
    export const restartServer = () => localize('DataScience.restartServer', 'Restart Jupyter Kernel');
    export const restartKernel = () => localize('DataScience.restartKernel', 'Restart Kernel');
    export const undo = () => localize('DataScience.undo', 'Undo');
    export const redo = () => localize('DataScience.redo', 'Redo');
    export const save = () => localize('DataScience.save', 'Save file');
    export const clearAll = () => localize('DataScience.clearAll', 'Remove all cells');
    export const reloadRequired = () =>
        localize('DataScience.reloadRequired', 'Please reload the window for new settings to take effect.');
    export const restartedKernelHeader = () => localize('DataScience.restartedKernelHeader', 'Restarted {0}');
    export const restartingKernelCustomHeader = () =>
        localize('DataScience.restartingKernelCustomHeader', '_Restarting {0}..._');
    export const restartingKernelHeader = () =>
        localize(
            { key: 'DataScience.restartingKernelHeader', comment: ['{Locked="kernel"}'] },
            '_Restarting kernel..._'
        );
    export const startedNewKernelHeader = () => localize('DataScience.startedNewKernelHeader', 'Started {0}');
    export const startingNewKernelHeader = () =>
        localize({ key: 'DataScience.kernelStarting', comment: ['{Locked="kernel"}'] }, '_Connecting to kernel..._');
    export const startingNewKernelCustomHeader = () =>
        localize('DataScience.kernelStartingCustom', '_Connecting to {0}..._');
    export const connectKernelHeader = () => localize('DataScience.connectKernelHeader', 'Connected to {0}');

    export const jupyterSelectURIPrompt = () =>
        localize('DataScience.jupyterSelectURIPrompt', 'Enter the URL of the running Jupyter server');
    export const jupyterSelectURIQuickPickTitle = () =>
        localize('DataScience.jupyterSelectURIQuickPickTitle', 'Enter the URL of the running Jupyter server');
    export const jupyterSelectURIQuickPickTitleOld = () =>
        localize('DataScience.jupyterSelectURIQuickPickTitleOld', 'Pick how to connect to Jupyter');
    export const jupyterSelectURIQuickPickPlaceholder = () =>
        localize('DataScience.jupyterSelectURIQuickPickPlaceholder', 'Choose an option');
    export const jupyterSelectURIQuickPickCurrent = () =>
        localize('DataScience.jupyterSelectURIQuickPickCurrent', 'Current: {0}');
    export const jupyterSelectURINoneLabel = () => localize('DataScience.jupyterSelectURINoneLabel', 'None');
    export const jupyterSelectURINoneDetail = () =>
        localize('DataScience.jupyterSelectURINoneDetail', 'Do not connect to any remote Jupyter server');
    export const jupyterSelectURIMRUDetail = () =>
        localize('DataScience.jupyterSelectURIMRUDetail', 'Last Connection: {0}');
    export const jupyterSelectURINewLabel = () => localize('DataScience.jupyterSelectURINewLabel', 'Existing');
    export const jupyterSelectURINewDetail = () =>
        localize('DataScience.jupyterSelectURINewDetail', 'Specify the URL of an existing server');
    export const jupyterSelectURIInvalidURI = () =>
        localize('DataScience.jupyterSelectURIInvalidURI', 'Invalid URL specified');
    export const jupyterSelectURIRunningDetailFormat = () =>
        localize('DataScience.jupyterSelectURIRunningDetailFormat', 'Last connection {0}. {1} existing connections.');
    export const jupyterSelectURINotRunningDetail = () =>
        localize('DataScience.jupyterSelectURINotRunningDetail', 'Cannot connect at this time. Status unknown.');
    export const jupyterSelectUserAndPasswordTitle = () =>
        localize(
            'DataScience.jupyterSelectUserAndPasswordTitle',
            'Enter your user name and password to connect to Jupyter Hub'
        );
    export const jupyterRenameServer = () =>
        localize('DataScience.jupyterRenameServer', 'Change Server Display Name (Leave Blank To Use URL)');
    export const jupyterSelectUserPrompt = () =>
        localize('DataScience.jupyterSelectUserPrompt', 'Enter your user name');
    export const jupyterSelectPasswordPrompt = () =>
        localize('DataScience.jupyterSelectPasswordPrompt', 'Enter your password');
    export const pythonNotInstalled = () =>
        localize(
            'DataScience.pythonNotInstalled',
            'Python is not installed. \nPlease download and install Python in order to execute cells in this notebook.'
        );
    export const kernelNotInstalled = () =>
        localize(
            'DataScience.installKernel',
            "The Jupyter Kernel '{0}' could not be found and needs to be installed in order to execute cells in this notebook."
        );
    export const jupyterNotebookFailure = () =>
        localize('DataScience.jupyterNotebookFailure', 'Jupyter notebook failed to launch. \r\n{0}');
    export const remoteJupyterServerProvidedBy3rdPartyExtensionNoLongerValid = () =>
        localize(
            'DataScience.remoteJupyterServerProvidedBy3rdPartyExtensionNoLongerValid',
            "The remote Jupyter Server contributed by the extension '{0}' is no longer available."
        );
    export const remoteJupyterConnectionFailedWithServerWithError = () =>
        localize(
            'DataScience.remoteJupyterConnectionFailedWithServerWithError',
            "Failed to connect to the remote Jupyter Server '{0}'. Verify the server is running and reachable. ({1})."
        );
    export const remoteJupyterConnectionFailedWithServer = () =>
        localize(
            'DataScience.remoteJupyterConnectionFailedWithServer',
            "Failed to connect to the remote Jupyter Server '{0}'. Verify the server is running and reachable."
        );
    export const remoteJupyterConnectionFailedWithoutServerWithError = () =>
        localize(
            'DataScience.remoteJupyterConnectionFailedWithoutServerWithError',
            'Connection failure. Verify the server is running and reachable. ({0}).'
        );
    export const remoteJupyterConnectionFailedWithoutServerWithErrorWeb = () =>
        localize(
            'DataScience.remoteJupyterConnectionFailedWithoutServerWithErrorWeb',
            'Connection failure. Verify the server is running and reachable from a browser. ({0}). When connecting from vscode.dev Jupyter servers must be started with specific options to connect. See [here](https://aka.ms/vscjremoteweb) for more information.'
        );
    export const remoteJupyterConnectionFailedWebExtension = () =>
        localize(
            'DataScience.remoteJupyterConnectionFailedWebExtension',
            'When connecting from vscode.dev Jupyter servers must be started with specific options to connect. See [here](https://aka.ms/vscjremoteweb) for more information.'
        );
    export const removeRemoteJupyterConnectionButtonText = () =>
        localize('DataScience.removeRemoteJupyterConnectionButtonText', 'Forget Connection');
    export const jupyterNotebookRemoteConnectFailedWeb = () =>
        localize(
            'DataScience.jupyterNotebookRemoteConnectFailedWeb',
            'Failed to connect to remote Jupyter server.\r\nCheck that the Jupyter Server URL can be reached from a browser.\r\n{0}. Click [here](https://aka.ms/vscjremoteweb) for more information.'
        );
    export const changeRemoteJupyterConnectionButtonText = () =>
        localize('DataScience.changeRemoteJupyterConnectionButtonText', 'Manage Connections');

    export const changeJupyterRemoteConnection = () =>
        localize('DataScience.changeJupyterRemoteConnection', 'Change Jupyter Server connection.');
    export const jupyterNotebookRemoteConnectSelfCertsFailed = () =>
        localize(
            'DataScience.jupyterNotebookRemoteConnectSelfCertsFailed',
            'Failed to connect to remote Jupyter notebook.\r\nSpecified server is using self signed certs. Enable Allow Unauthorized Remote Connection setting to connect anyways\r\n{0}\r\n{1}'
        );
    export const rawConnectionDisplayName = () =>
        localize(
            { key: 'DataScience.rawConnectionDisplayName', comment: ['{Locked="kernel"}'] },
            'Direct kernel connection'
        );
    export const rawConnectionBrokenError = () =>
        localize(
            { key: 'DataScience.rawConnectionBrokenError', comment: ['{Locked="kernel"}'] },
            'Direct kernel connection broken'
        );
    export const jupyterServerCrashed = () =>
        localize(
            'DataScience.jupyterServerCrashed',
            'Jupyter server crashed. Unable to connect. \r\nError code from Jupyter: {0}'
        );
    export const notebookVersionFormat = () =>
        localize(
            { key: 'DataScience.notebookVersionFormat', comment: ['{Locked="Notebook"}'] },
            'Jupyter Notebook version: {0}'
        );
    export const jupyterKernelSpecNotFound = () =>
        localize(
            { key: 'DataScience.jupyterKernelSpecNotFound', comment: ['{Locked="kernel"}'] },
            'Cannot create a Jupyter kernel spec and none are available for use'
        );
    export const jupyterKernelSpecModuleNotFound = () =>
        localize(
            'DataScience.jupyterKernelSpecModuleNotFound',
            "'Kernelspec' module not installed in the selected interpreter ({0}).\n Please re-install or update 'jupyter'."
        );
    export const interruptKernel = () => localize('DataScience.interruptKernel', 'Interrupt Jupyter Kernel');
    export const clearAllOutput = () => localize('DataScience.clearAllOutput', 'Clear All Output');
    export const interruptKernelStatus = () =>
        localize('DataScience.interruptKernelStatus', 'Interrupting Jupyter Kernel');
    export const exportCancel = () => localize('DataScience.exportCancel', 'Cancel');
    export const exportPythonQuickPickLabel = () => localize('DataScience.exportPythonQuickPickLabel', 'Python Script');
    export const exportHTMLQuickPickLabel = () => localize('DataScience.exportHTMLQuickPickLabel', 'HTML');
    export const exportPDFQuickPickLabel = () => localize('DataScience.exportPDFQuickPickLabel', 'PDF');
    export const restartKernelAfterInterruptMessage = () =>
        localize(
            { key: 'DataScience.restartKernelAfterInterruptMessage', comment: ['{Locked="kernel"}'] },
            'Interrupting the kernel timed out. Do you want to restart the kernel instead? All variables will be lost.'
        );
    export const pythonInterruptFailedHeader = () =>
        localize(
            { key: 'DataScience.pythonInterruptFailedHeader', comment: ['{Locked="kernel"}'] },
            'Keyboard interrupt crashed the kernel. Kernel restarted.'
        );
    export const sysInfoURILabel = () => localize('DataScience.sysInfoURILabel', 'Jupyter Server URL: ');
    export const executingCodeFailure = () =>
        localize('DataScience.executingCodeFailure', 'Executing code failed : {0}');
    export const inputWatermark = () =>
        localize('DataScience.inputWatermark', 'Type code here and press shift-enter to run');
    export const liveShareConnectFailure = () =>
        localize('DataScience.liveShareConnectFailure', 'Cannot connect to host Jupyter session. URL not found.');
    export const liveShareCannotSpawnNotebooks = () =>
        localize(
            'DataScience.liveShareCannotSpawnNotebooks',
            'Spawning Jupyter notebooks is not supported over a live share connection'
        );
    export const liveShareCannotImportNotebooks = () =>
        localize(
            'DataScience.liveShareCannotImportNotebooks',
            'Importing notebooks is not currently supported over a live share connection'
        );
    export const liveShareHostFormat = () => localize('DataScience.liveShareHostFormat', '{0} Jupyter Server');
    export const liveShareSyncFailure = () =>
        localize('DataScience.liveShareSyncFailure', 'Synchronization failure during live share startup.');
    export const liveShareServiceFailure = () =>
        localize('DataScience.liveShareServiceFailure', "Failure starting '{0}' service during live share connection.");
    export const documentMismatch = () =>
        localize('DataScience.documentMismatch', 'Cannot run cells, duplicate documents for {0} found.');
    export const jupyterGetVariablesBadResults = () =>
        localize('DataScience.jupyterGetVariablesBadResults', 'Failed to fetch variable info from the Jupyter server.');
    export const dataExplorerInvalidVariableFormat = () =>
        localize('DataScience.dataExplorerInvalidVariableFormat', "'{0}' is not an active variable.");
    export const pythonInteractiveCreateFailed = () =>
        localize(
            'DataScience.pythonInteractiveCreateFailed',
            "Failure to create an 'Interactive' window. Try reinstalling the Python Extension."
        );
    export const jupyterGetVariablesExecutionError = () =>
        localize('DataScience.jupyterGetVariablesExecutionError', 'Failure during variable extraction: \r\n{0}');
    export const loadingMessage = () => localize('DataScience.loadingMessage', 'loading ...');
    export const fetchingDataViewer = () => localize('DataScience.fetchingDataViewer', 'Fetching data ...');
    export const noRowsInDataViewer = () => localize('DataScience.noRowsInDataViewer', 'No rows match current filter');
    export const jupyterServer = () => localize('DataScience.jupyterServer', 'Jupyter Server');
    export const noKernel = () => localize('DataScience.noKernel', 'No Kernel');
    export const serverNotStarted = () => localize('DataScience.serverNotStarted', 'Not Started');
    export const selectKernel = () =>
        localize({ key: 'DataScience.selectKernel', comment: ['{Locked="Kernel"}'] }, 'Change Kernel');
    export const selectDifferentKernel = () =>
        localize(
            { key: 'DataScience.selectDifferentKernel', comment: ['{Locked="kernel"}'] },
            'Select a different Kernel'
        );
    export const kernelFilterPlaceholder = () =>
        localize(
            { key: 'jupyter.kernel.filter.placeholder', comment: ['{Locked="kernel"}', '{Locked="kernels"}'] },
            'Choose the kernels that are available in the kernel picker.'
        );
    export const recommendedKernelCategoryInQuickPick = () => localize('jupyter.kernel.recommended', 'Recommended');
    export const createPythonEnvironmentInQuickPick = () =>
        localize('jupyter.kernel.createPythonEnvironment', 'Create Python Environment');

    export const selectDifferentJupyterInterpreter = () =>
        localize('DataScience.selectDifferentJupyterInterpreter', 'Change Interpreter');
    export const localJupyterServer = () => localize('DataScience.localJupyterServer', 'local');
    export const pandasTooOldForViewingFormat = () =>
        localize(
            {
                key: 'DataScience.pandasTooOldForViewingFormat',
                comment: ["{Locked='pandas'", 'This is the name of the pandas package']
            },
            "Python package 'pandas' is version {0}. Version {1} or greater is required for viewing data."
        );
    export const pandasRequiredForViewing = () =>
        localize(
            {
                key: 'DataScience.pandasRequiredForViewing',
                comment: ["{Locked='pandas'", 'This is the name of the pandas package']
            },
            "Python package 'pandas' version {0} (or above) is required for viewing data."
        );
    export const valuesColumn = () => localize('DataScience.valuesColumn', 'values');
    export const liveShareInvalid = () =>
        localize(
            'DataScience.liveShareInvalid',
            'One or more guests in the session do not have the Jupyter Extension installed. Live share session cannot continue.'
        );
    export const tooManyColumnsMessage = () =>
        localize(
            'DataScience.tooManyColumnsMessage',
            'Variables with over a 1000 columns may take a long time to display. Are you sure you wish to continue?'
        );
    export const tooManyColumnsYes = () => localize('DataScience.tooManyColumnsYes', 'Yes');
    export const tooManyColumnsNo = () => localize('DataScience.tooManyColumnsNo', 'No');
    export const tooManyColumnsDontAskAgain = () =>
        localize('DataScience.tooManyColumnsDontAskAgain', "Don't Ask Again");
    export const filterRowsTooltip = () =>
        localize(
            'DataScience.filterRowsTooltip',
            'Allows filtering multiple rows. Use =, >, or < signs to filter numeric values.'
        );
    export const previewHeader = () => localize('DataScience.previewHeader', '--- Begin preview of {0} ---');
    export const previewFooter = () => localize('DataScience.previewFooter', '--- End preview of {0} ---');
    export const previewStatusMessage = () => localize('DataScience.previewStatusMessage', 'Generating preview of {0}');
    export const plotViewerTitle = () => localize('DataScience.plotViewerTitle', 'Plots');
    export const exportPlotTitle = () => localize('DataScience.exportPlotTitle', 'Save plot image');
    export const pdfFilter = () => 'PDF';
    export const pngFilter = () => 'PNG';
    export const svgFilter = () => 'SVG';
    export const previousPlot = () => localize('DataScience.previousPlot', 'Previous');
    export const nextPlot = () => localize('DataScience.nextPlot', 'Next');
    export const panPlot = () => localize('DataScience.panPlot', 'Pan');
    export const zoomInPlot = () => localize('DataScience.zoomInPlot', 'Zoom in');
    export const zoomOutPlot = () => localize('DataScience.zoomOutPlot', 'Zoom out');
    export const exportPlot = () => localize('DataScience.exportPlot', 'Export to different formats');
    export const deletePlot = () => localize('DataScience.deletePlot', 'Remove');
    export const editSection = () => localize('DataScience.editSection', 'Input new cells here.');
    export const selectedImageListLabel = () => localize('DataScience.selectedImageListLabel', 'Selected Image');
    export const imageListLabel = () => localize('DataScience.imageListLabel', 'Image');
    export const exportImageFailed = () => localize('DataScience.exportImageFailed', 'Error exporting image: {0}');
    export const jupyterDataRateExceeded = () =>
        localize(
            {
                key: 'DataScience.jupyterDataRateExceeded',
                comment: [
                    "{Locked='NotebookApp.iopub_data_rate_limit'}",
                    'This command line parameter does not change across languages.'
                ]
            },
            'Cannot view variable because data rate exceeded. Please restart your server with a higher data rate limit. For example, --NotebookApp.iopub_data_rate_limit=10000000000.0'
        );
    export const addCellBelowCommandTitle = () => localize('DataScience.addCellBelowCommandTitle', 'Add cell');
    export const debugCellCommandTitle = () => localize('DataScience.debugCellCommandTitle', 'Debug Cell');
    export const debugStepOverCommandTitle = () => localize('DataScience.debugStepOverCommandTitle', 'Step over');
    export const debugContinueCommandTitle = () => localize('DataScience.debugContinueCommandTitle', 'Continue');
    export const debugStopCommandTitle = () => localize('DataScience.debugStopCommandTitle', 'Stop');
    export const runCurrentCellAndAddBelow = () =>
        localize('DataScience.runCurrentCellAndAddBelow', 'Run current cell and add empty cell below');
    export const jupyterDebuggerNotInstalledError = () =>
        localize(
            'DataScience.jupyterDebuggerNotInstalledError',
            'Pip module {0} is required for debugging cells. You will need to install it to debug cells.'
        );
    export const jupyterDebuggerOutputParseError = () =>
        localize(
            'DataScience.jupyterDebuggerOutputParseError',
            'Unable to parse {0} output, please log an issue with https://github.com/microsoft/vscode-jupyter'
        );
    export const jupyterDebuggerPortNotAvailableError = () =>
        localize(
            {
                key: 'DataScience.jupyterDebuggerPortNotAvailableError',
                comment: ["{Locked='remoteDebuggerPort'}"]
            },
            'Port {0} cannot be opened for debugging. Please specify a different port in the remoteDebuggerPort setting.'
        );
    export const jupyterDebuggerPortBlockedError = () =>
        localize(
            'DataScience.jupyterDebuggerPortBlockedError',
            'Port {0} cannot be connected to for debugging. Please let port {0} through your firewall.'
        );
    export const jupyterDebuggerPortNotAvailableSearchError = () =>
        localize(
            'DataScience.jupyterDebuggerPortNotAvailableSearchError',
            'Ports in the range {0}-{1} cannot be found for debugging. Please specify a port in the remoteDebuggerPort setting.'
        );
    export const jupyterDebuggerPortBlockedSearchError = () =>
        localize(
            'DataScience.jupyterDebuggerPortBlockedSearchError',
            'A port cannot be connected to for debugging. Please let ports {0}-{1} through your firewall.'
        );
    export const jupyterDebuggerInstallNew = () =>
        localize(
            'DataScience.jupyterDebuggerInstallNew',
            'Pip module {0} is required for debugging cells. Install {0} and continue to debug cell?'
        );
    export const jupyterDebuggerInstallNewRunByLine = () =>
        localize(
            'DataScience.jupyterDebuggerInstallNewRunByLine',
            'Pip module {0} is required for running by line. Install {0} and continue to run by line?'
        );
    export const jupyterDebuggerInstallUpdate = () =>
        localize(
            'DataScience.jupyterDebuggerInstallUpdate',
            'The version of {0} installed does not support debugging cells. Update {0} to newest version and continue to debug cell?'
        );
    export const jupyterDebuggerInstallUpdateRunByLine = () =>
        localize(
            'DataScience.jupyterDebuggerInstallUpdateRunByLine',
            'The version of {0} installed does not support running by line. Update {0} to newest version and continue to run by line?'
        );
    export const jupyterDebuggerInstallYes = () => localize('DataScience.jupyterDebuggerInstallYes', 'Yes');
    export const jupyterDebuggerInstallNo = () => localize('DataScience.jupyterDebuggerInstallNo', 'No');
    export const cellStopOnErrorMessage = () =>
        localize('DataScience.cellStopOnErrorMessage', 'Cell was canceled due to an error in a previous cell.');
    export const scrollToCellTitleFormatMessage = () =>
        localize('DataScience.scrollToCellTitleFormatMessage', 'Go to [{0}]');
    export const instructionComments = () =>
        localize(
            'DataScience.instructionComments',
            `# To add a new cell, type '{0}'\n# To add a new markdown cell, type '{0} [markdown]'\n`
        );
    export const nativeEditorTitle = () => localize('DataScience.nativeEditorTitle', 'Notebook Editor');
    export const untitledNotebookFileName = () => localize('DataScience.untitledNotebookFileName', 'Untitled');
    export const dirtyNotebookMessage1 = () =>
        localize('DataScience.dirtyNotebookMessage1', 'Do you want to save the changes you made to {0}?');
    export const dirtyNotebookMessage2 = () =>
        localize('DataScience.dirtyNotebookMessage2', "Your changes will be lost if you don't save them.");
    export const dirtyNotebookYes = () => localize('DataScience.dirtyNotebookYes', 'Save');
    export const dirtyNotebookNo = () => localize('DataScience.dirtyNotebookNo', "Don't Save");
    export const dirtyNotebookCancel = () => localize('DataScience.dirtyNotebookCancel', 'Cancel');
    export const dirtyNotebookDialogTitle = () => localize('DataScience.dirtyNotebookDialogTitle', 'Save');
    export const dirtyNotebookDialogFilter = () =>
        localize('DataScience.dirtyNotebookDialogFilter', 'Jupyter Notebooks');
    export const notebookExportAs = () => localize('DataScience.notebookExportAs', 'Export As');
    export const exportAsPythonFileTitle = () => localize('DataScience.exportAsPythonFileTitle', 'Save as Python File');
    export const exportButtonTitle = () => localize('DataScience.exportButtonTitle', 'Export');
    export const exportAsQuickPickPlaceholder = () =>
        localize('DataScience.exportAsQuickPickPlaceholder', 'Export As...');
    export const openExportedFileMessage = () =>
        localize('DataScience.openExportedFileMessage', 'Would you like to open the exported file?');
    export const openExportFileYes = () => localize('DataScience.openExportFileYes', 'Yes');
    export const openExportFileNo = () => localize('DataScience.openExportFileNo', 'No');
    export const exportFailedGeneralMessage = () =>
        localize(
            {
                key: 'DataScience.exportFailedGeneralMessage',
                comment: ["{Locked='command:jupyter.viewOutput'}"]
            },
            `Please check the 'Jupyter' [output](command:jupyter.viewOutput) panel for further details.`
        );
    export const exportToPDFDependencyMessage = () =>
        localize(
            'DataScience.exportToPDFDependencyMessage',
            'If you have not installed xelatex (TeX) you will need to do so before you can export to PDF, for further instructions please look https://nbconvert.readthedocs.io/en/latest/install.html#installing-tex. \r\nTo avoid installing xelatex (TeX) you might want to try exporting to HTML and using your browsers "Print to PDF" feature.'
        );
    export const failedExportMessage = () => localize('DataScience.failedExportMessage', 'Export failed.');
    export const runCell = () => localize('DataScience.runCell', 'Run cell');
    export const deleteCell = () => localize('DataScience.deleteCell', 'Delete cell');
    export const moveCellUp = () => localize('DataScience.moveCellUp', 'Move cell up');
    export const moveCellDown = () => localize('DataScience.moveCellDown', 'Move cell down');
    export const moveSelectedCellUp = () => localize('DataScience.moveSelectedCellUp', 'Move selected cell up');
    export const moveSelectedCellDown = () => localize('DataScience.deleteCell', 'Move selected cell down');
    export const insertBelow = () => localize('DataScience.insertBelow', 'Insert cell below');
    export const insertAbove = () => localize('DataScience.insertAbove', 'Insert cell above');
    export const addCell = () => localize('DataScience.addCell', 'Add cell');
    export const runAll = () => localize('DataScience.runAll', 'Insert cell');
    export const convertingToPythonFile = () =>
        localize('DataScience.convertingToPythonFile', 'Converting ipynb to python file');
    export const noInterpreter = () => localize('DataScience.noInterpreter', 'No python selected');
    export const notebookNotFound = () =>
        localize(
            {
                key: 'DataScience.notebookNotFound',
                comment: ["{Locked='python -m jupyter notebook --version'}"]
            },
            'python -m jupyter notebook --version is not running'
        );
    export const savePngTitle = () => localize('DataScience.savePngTitle', 'Save Image');
    export const fallbackToUseActiveInterpreterAsKernel = () =>
        localize(
            { key: 'DataScience.fallbackToUseActiveInterpreterAsKernel', comment: ['{Locked="kernel"}'] },
            "Couldn't find kernel '{0}' that the notebook was created with. Using the current interpreter."
        );
    export const fallBackToRegisterAndUseActiveInterpreterAsKernel = () =>
        localize(
            { key: 'DataScience.fallBackToRegisterAndUseActiveInterpreterAsKernel', comment: ['{Locked="kernel"}'] },
            "Couldn't find kernel '{0}' that the notebook was created with. Registering a new kernel using the current interpreter."
        );
    export const fallBackToPromptToUseActiveInterpreterOrSelectAKernel = () =>
        localize(
            {
                key: 'DataScience.fallBackToPromptToUseActiveInterpreterOrSelectAKernel',
                comment: ['{Locked="kernel"}']
            },
            "Couldn't find kernel '{0}' that the notebook was created with."
        );
    export const startingJupyterLogMessage = () =>
        localize('DataScience.startingJupyterLogMessage', 'Starting Jupyter from {0}');
    export const jupyterStartTimedout = () =>
        localize(
            'DataScience.jupyterStartTimedout',
            "Starting Jupyter has timed out. Please check the 'Jupyter' output panel for further details."
        );
    export const switchingKernelProgress = () =>
        localize(
            { key: 'DataScience.switchingKernelProgress', comment: ['{Locked="Kernel"}'] },
            "Switching Kernel to '{0}'"
        );
    export const waitingForJupyterSessionToBeIdle = () =>
        localize('DataScience.waitingForJupyterSessionToBeIdle', 'Waiting for Jupyter Session to be idle');
    export const gettingListOfKernelsForLocalConnection = () =>
        localize(
            { key: 'DataScience.gettingListOfKernelsForLocalConnection', comment: ['{Locked="Kernels"}'] },
            'Fetching Kernels'
        );
    export const gettingListOfKernelsForRemoteConnection = () =>
        localize(
            { key: 'DataScience.gettingListOfKernelsForRemoteConnection', comment: ['{Locked="Kernels"}'] },
            'Fetching Kernels'
        );
    export const gettingListOfKernelSpecs = () =>
        localize(
            { key: 'DataScience.gettingListOfKernelSpecs', comment: ['{Locked="Kernel"}'] },
            'Fetching Kernel specs'
        );
    export const startingJupyterNotebook = () =>
        localize(
            { key: 'DataScience.startingJupyterNotebook', comment: ['{Locked="Notebook"}'] },
            'Starting Jupyter Notebook'
        );
    export const registeringKernel = () =>
        localize({ key: 'DataScience.registeringKernel', comment: ['{Locked="Kernel"}'] }, 'Registering Kernel');
    export const trimmedOutput = () =>
        localize(
            {
                key: 'DataScience.trimmedOutput',
                comment: ["{Locked='jupyter.textOutputLimit'}"]
            },
            'Output was trimmed for performance reasons.\nTo see the full output set the setting "jupyter.textOutputLimit" to 0.'
        );
    export const jupyterCommandLineDefaultLabel = () =>
        localize('DataScience.jupyterCommandLineDefaultLabel', 'Default');
    export const jupyterCommandLineDefaultDetail = () =>
        localize(
            'DataScience.jupyterCommandLineDefaultDetail',
            'The Python Extension will determine the appropriate command line for Jupyter'
        );
    export const jupyterCommandLineCustomLabel = () => localize('DataScience.jupyterCommandLineCustomLabel', 'Custom');
    export const jupyterCommandLineCustomDetail = () =>
        localize(
            'DataScience.jupyterCommandLineCustomDetail',
            'Customize the command line passed to Jupyter on startup'
        );
    export const jupyterCommandLineReloadQuestion = () =>
        localize(
            'DataScience.jupyterCommandLineReloadQuestion',
            'Please reload the window when changing the Jupyter command line.'
        );
    export const jupyterCommandLineReloadAnswer = () =>
        localize('DataScience.jupyterCommandLineReloadAnswer', 'Reload');
    export const jupyterCommandLineQuickPickPlaceholder = () =>
        localize('DataScience.jupyterCommandLineQuickPickPlaceholder', 'Choose an option');
    export const jupyterCommandLineQuickPickTitle = () =>
        localize('DataScience.jupyterCommandLineQuickPickTitle', 'Pick command line for Jupyter');
    export const jupyterCommandLinePrompt = () =>
        localize('DataScience.jupyterCommandLinePrompt', 'Enter your custom command line for Jupyter');

    export const connectingToJupyterUri = () =>
        localize('DataScience.connectingToJupyterUri', 'Connecting to Jupyter server at {0}');
    export const createdNewNotebook = () => localize('DataScience.createdNewNotebook', '{0}: Creating new notebook ');

    export const createdNewKernel = () => localize('DataScience.createdNewKernel', '{0}: Kernel started: {1}');
    export const kernelInvalid = () =>
        localize(
            'DataScience.kernelInvalid',
            'Kernel {0} is not usable. Check the Jupyter output tab for more information.'
        );

    export const nativeDependencyFail = () =>
        localize(
            'DataScience.nativeDependencyFail',
            '{0}. We cannot launch a Jupyter server for you because your OS is not supported. Select an already running server if you wish to continue.'
        );

    export const selectNewServer = () => localize('DataScience.selectNewServer', 'Pick Running Server');
    export const jupyterSelectURIRemoteLabel = () => localize('DataScience.jupyterSelectURIRemoteLabel', 'Existing');
    export const jupyterSelectURIQuickPickTitleRemoteOnly = () =>
        localize('DataScience.jupyterSelectURIQuickPickTitleRemoteOnly', 'Pick an already running Jupyter server');
    export const jupyterSelectURIRemoteDetail = () =>
        localize('DataScience.jupyterSelectURIRemoteDetail', 'Specify the URL of an existing server');
    export const removeRemoteJupyterServerEntryInQuickPick = () =>
        localize('DataScience.removeRemoteJupyterServerEntryInQuickPick', 'Remove');
    export const specifyLocalOrRemoteJupyterServerForConnections = () =>
        localize('jupyter.command.jupyter.selectjupyteruri.title', 'Specify Jupyter Server for Connections');
    export const jupyterNativeNotebookUriStatusLabelForLocal = () =>
        localize('DataScience.jupyterNativeNotebookUriStatusLabelForLocal', 'Jupyter Server: Local');
    export const jupyterNativeNotebookUriStatusLabelForRemote = () =>
        localize('DataScience.jupyterNativeNotebookUriStatusLabelForRemote', 'Jupyter Server: Remote');

    export const loadClassFailedWithNoInternet = () =>
        localize(
            'DataScience.loadClassFailedWithNoInternet',
            'Error loading {0}:{1}. Internet connection required for loading 3rd party widgets.'
        );
    export const useCDNForWidgets = () =>
        localize(
            'DataScience.useCDNForWidgets',
            'Widgets require us to download supporting files from a 3rd party website. Click [here](https://aka.ms/PVSCIPyWidgets) for more information.'
        );
    export const useCDNForWidgetsNoInformation = () =>
        localize(
            'DataScience.useCDNForWidgetsNoInformation',
            'Widgets require us to download supporting files from a 3rd party website.'
        );
    export const enableCDNForWidgetsSettingHtml = () =>
        localize(
            {
                key: 'DataScience.enableCDNForWidgetsSettingHtml',
                comment: ['{Locked="command:jupyter.enableLoadingWidgetScriptsFromThirdPartySource"}']
            },
            "Widgets require us to download supporting files from a 3rd party website. Click <a href='https://command:jupyter.enableLoadingWidgetScriptsFromThirdPartySource'>here</a> to enable this or click <a href='https://aka.ms/PVSCIPyWidgets'>here</a> for more information. (Error loading {0}:{1})."
        );

    export const enableCDNForWidgetsSetting = () =>
        localize(
            'DataScience.enableCDNForWidgetsSetting',
            'Widgets require us to download supporting files from a 3rd party website. (Error loading {0}:{1}).'
        );

    export const enableCDNForWidgetsButton = () =>
        localize('DataScience.enableCDNForWidgetsButton', 'Enable Downloads');

    export const unhandledMessage = () =>
        localize(
            { key: 'DataScience.unhandledMessage', comment: ['{Locked="kernel"}'] },
            'Unhandled kernel message from a widget: {0} : {1}'
        );

    export const cdnWidgetScriptNotAccessibleWarningMessage = () =>
        localize(
            'DataScience.cdnWidgetScriptNotAccessibleWarningMessage',
            "Unable to download widget '{0}' from 3rd party website {1}, due to network access. Expected behavior may be affected. Click [here](https://aka.ms/PVSCIPyWidgets) for more information."
        );
    export const widgetScriptNotFoundOnCDNWidgetMightNotWork = () =>
        localize(
            'DataScience.widgetScriptNotFoundOnCDNWidgetMightNotWork',
            "Unable to find widget '{0}' version '{1}' from configured widget sources {2}. Expected behavior may be affected. Click [here](https://aka.ms/PVSCIPyWidgets) for more information."
        );
    export const qgridWidgetScriptVersionCompatibilityWarning = () =>
        localize(
            'DataScience.qgridWidgetScriptVersionCompatibilityWarning',
            "Unable to load a compatible version of the widget 'qgrid'. Consider downgrading to version 1.1.1."
        );

    export const runByLine = () => localize('DataScience.runByLine', 'Run by line (F10)');
    export const step = () => localize('DataScience.step', 'Run next line (F10)');
    export const stopRunByLine = () => localize('DataScience.stopRunByLine', 'Stop');
    export const rawKernelSessionFailed = () =>
        localize(
            { key: 'DataScience.rawKernelSessionFailed', comment: ['{Locked="kernel"}'] },
            'Unable to start session for kernel {0}. Select another kernel to launch with.'
        );
    export const rawKernelConnectingSession = () =>
        localize(
            { key: 'DataScience.rawKernelConnectingSession', comment: ['{Locked="kernel"}'] },
            'Connecting to kernel.'
        );

    export const insecureSessionMessage = () =>
        localize(
            'DataScience.insecureSessionMessage',
            'Connecting over HTTP without a token may be an insecure connection. Do you want to connect to a possibly insecure server?'
        );
    export const insecureSessionDenied = () =>
        localize('DataScience.insecureSessionDenied', 'Denied connection to insecure server.');
    export const connected = () => localize('DataScience.connected', 'Connected');
    export const disconnected = () => localize('DataScience.disconnected', 'Disconnected');
    export const noKernelsSpecifyRemote = () =>
        localize(
            {
                key: 'DataScience.noKernelsSpecifyRemote',
                comment: ['{Locked="kernel"}', '{Locked="command:jupyter.selectjupyteruri"}']
            },
            'No kernel available for cell execution, please [specify a Jupyter server for connections](command:jupyter.selectjupyteruri)'
        );
    export const ipykernelNotInstalled = () =>
        localize('DataScience.ipykernelNotInstalled', 'IPyKernel not installed into interpreter {0}');
    export const needIpykernel6 = () =>
        localize('DataScience.needIpykernel6', 'Ipykernel setup required for this feature');
    export const setup = () => localize('DataScience.setup', 'Setup');
    export const startingRunByLine = () => localize('DataScience.startingRunByLine', 'Starting Run by Line');
    export const showDataViewerFail = () =>
        localize(
            'DataScience.showDataViewerFail',
            'Failed to create the Data Viewer. Check the Jupyter tab of the Output window for more info.'
        );

    export const placeHolderToSelectOptionForNotebookCreation = () =>
        localize('DataScience.notebookCreationPickerPlaceHolder', 'Select an option to create a blank notebook');

    export const defaultNotebookName = () => localize('DataScience.defaultNotebookName', 'default');
    export const recommendExtensionForNotebookLanguage = () =>
        localize(
            'DataScience.recommendExtensionForNotebook',
            "The {0} extension is recommended for notebooks targeting the language '{1}'"
        );
    export const kernelWasNotStarted = () =>
        localize(
            { key: 'DataScience.kernelWasNotStarted', comment: ['{Locked="kernel"}'] },
            'Kernel was not started. A kernel session is needed to start debugging.'
        );
    export const noNotebookToDebug = () =>
        localize('DataScience.noNotebookToDebug', 'No active notebook document to debug.');
    export const cantStartDebugging = () => localize('DataScience.cantStartDebugging', "Can't start debugging.");
    export const restartNotSupported = () =>
        localize('DataScience.restartNotSupported', 'Restarting is not supported in the interactive window.');
    export const importingIpynb = () => localize('DataScience.importingIpynb', 'Importing notebook file');
    export const exportingToFormat = () => localize('DataScience.exportingToFormat', 'Exporting to {0}');
    export const kernelCategoryForJupyterSession = () =>
        localize('jupyter.kernel.category.jupyterSession', '({0}) Jupyter Session');
    export const kernelPrefixForRemote = () => localize('DataScience.kernelPrefixForRemote', '(Remote)');
    export const kernelDefaultRemoteDisplayName = () =>
        localize('DataScience.kernelDefaultRemoteDisplayName', 'Remote');
    export const kernelCategoryForJupyterKernel = () =>
        localize({ key: 'jupyter.kernel.category.jupyterKernel', comment: ['{Locked="Kernel"}'] }, 'Jupyter Kernel');
    export const kernelCategoryForRemoteJupyterKernel = () =>
        localize(
            { key: 'jupyter.kernel.category.jupyterRemoteKernel', comment: ['{Locked="kernel"}'] },
            '({0}) Jupyter Kernel'
        );
    export const kernelCategoryForConda = () => localize('jupyter.kernel.category.conda', 'Conda Env');
    export const kernelCategoryForPoetry = () =>
        localize({ key: 'jupyter.kernel.category.poetry', comment: ['{Locked="Poetry"}'] }, 'Poetry Env');
    export const kernelCategoryForPipEnv = () => localize('jupyter.kernel.category.pipenv', 'Pipenv Env');
    export const kernelCategoryForPyEnv = () => localize('jupyter.kernel.category.pyenv', 'PyEnv Env');
    export const kernelCategoryForGlobal = () =>
        localize({ key: 'jupyter.kernel.category.global', comment: ['{Locked="Global"}'] }, 'Global Env');
    export const kernelCategoryForVirtual = () =>
        localize({ key: 'jupyter.kernel.category.virtual', comment: ['{Locked="Virtual"}'] }, 'Virtual Env');

    export const fileSeemsToBeInterferingWithKernelStartup = () =>
        localize(
            { key: 'DataScience.fileSeemsToBeInterferingWithKernelStartup', comment: ['{Locked="kernel"}'] },
            "The file '{0}' seems to be overriding built in modules and interfering with the startup of the kernel. Consider renaming the file and starting the kernel again."
        );
    export const moduleSeemsToBeInterferingWithKernelStartup = () =>
        localize(
            { key: 'DataScience.moduleSeemsToBeInterferingWithKernelStartup', comment: ['{Locked="kernel"}'] },
            "The module '{0}' seems to be overriding built in modules and interfering with the startup of the kernel. Consider renaming the folder and starting the kernel again."
        );
    export const pipCondaInstallHoverWarning = () =>
        localize(
            'jupyter.kernel.pipCondaInstallHoverWarning',
            "'!{0} install' could install packages into the wrong environment. [More info]({1})"
        );
    export const percentPipCondaInstallInsteadOfBang = () =>
        localize(
            {
                key: 'jupyter.kernel.percentPipCondaInstallInsteadOfBang',
                comment: ['{Locked="install"}']
            },
            "Use '%{0} install' instead of '!{0} install'"
        );
    export const replacePipCondaInstallCodeAction = () =>
        localize(
            {
                key: 'jupyter.kernel.replacePipCondaInstallCodeAction',
                comment: ['{Locked="install"}']
            },
            "Replace with '%{0} install'"
        );
    export const failedToStartKernelDueToMissingModule = () =>
        localize(
            { key: 'DataScience.failedToStartKernelDueToMissingModule', comment: ['{Locked="kernel"}'] },
            "The kernel failed to start due to the missing module '{0}'. Consider installing this module."
        );
    export const failedToStartKernelDueToImportFailure = () =>
        localize(
            { key: 'DataScience.failedToStartKernelDueToImportFailure', comment: ['{Locked="kernel"}'] },
            "The kernel failed to start as the module '{0}' could not be imported."
        );
    export const failedToStartKernelDueToImportFailureFromFile = () =>
        localize(
            { key: 'DataScience.failedToStartKernelDueToImportFromFileFailure', comment: ['{Locked="kernel"}'] },
            "The kernel failed to start as '{0}' could not be imported from '{1}'."
        );
    export const failedToStartKernelDueToUnknownDllLoadFailure = () =>
        localize(
            { key: 'DataScience.failedToStartKernelDueToUnknownDllLoadFailure', comment: ['{Locked="kernel"}'] },
            'The kernel failed to start as a dll could not be loaded.'
        );
    export const failedToStartKernelDueToDllLoadFailure = () =>
        localize(
            { key: 'DataScience.failedToStartKernelDueToDllLoadFailure', comment: ['{Locked="kernel"}'] },
            "The kernel failed to start as the dll '{0}' could not be loaded."
        );
    export const failedToStartKernelDueToWin32APIFailure = () =>
        localize(
            { key: 'DataScience.failedToStartKernelDueToWin32APIFailure', comment: ['{Locked="kernel"}'] },
            'The kernel failed to start due to an error with the Win32api module. Consider (re) installing this module.'
        );
    export const failedToStartKernelDueToPyZmqFailure = () =>
        localize(
            { key: 'DataScience.failedToStartKernelDueToPyZmqFailure', comment: ['{Locked="kernel"}'] },
            "The kernel failed to start due to an error with the 'pyzmq' module. Consider re-installing this module."
        );
    export const failedToStartKernelDueToOldIPython = () =>
        localize(
            { key: 'DataScience.failedToStartKernelDueToOldIPython', comment: ['{Locked="kernel"}'] },
            'The kernel failed to start due to an outdated version of IPython. Consider updating this module to the latest version.'
        );
    export const failedToStartKernelDueToOldIPyKernel = () =>
        localize(
            { key: 'DataScience.failedToStartKernelDueToOldIPyKernel', comment: ['{Locked="kernel"}'] },
            'The kernel failed to start due to an outdated version of IPyKernel. Consider updating this module to the latest version.'
        );
    export const matplotlibWidgetInsteadOfOther = () =>
        localize('DataScience.matplotlibWidgetInsteadOfOther', "'%matplotlib' widget works best inside of VS Code");
    export const matplotlibWidgetCodeActionTitle = () =>
        localize('DataScience.matplotlibWidgetCodeActionTitle', 'More info');
    export const allowExtensionToUseJupyterKernelApi = () =>
        localize(
            { key: 'DataScience.allowExtensionToUseJupyterKernelApi', comment: ['{Locked="Kernels"}'] },
            "Do you want to give the extension '{0}' access to the Jupyter Kernels? Clicking '{1}' would allow this extension to execute code against the Jupyter Kernels."
        );
    export const thanksForUsingJupyterKernelApiPleaseRegisterWithUs = () =>
        localize(
            'DataScience.thanksForUsingJupyterKernelApiPleaseRegisterWithUs',
            'Thanks for trying the Jupyter API. Please file an issue on our repo to use this API in production. This would prevent us from breaking your extension when updating the API (as it is still a work in progress).'
        );
    export const activatingPythonEnvironment = () =>
        localize('DataScience.activatingEnvironment', "Activating Python Environment '{0}'");

    export const cellAtFormat = () => localize('DataScience.cellAtFormat', '{0} Cell {1}');

    export const jupyterServerConsoleOutputChannel = () =>
        localize('DataScience.jupyterServerConsoleOutputChannel', `Jupyter Server Console`);

    export const kernelConsoleOutputChannel = () =>
        localize('DataScience.kernelConsoleOutputChannel', `{0} Kernel Console Output`);
    export const webNotSupported = () =>
        localize('DataScience.webNotSupported', `Operation not supported in web version of Jupyter Extension.`);
    export const validationErrorMessageForRemoteUrlProtocolNeedsToBeHttpOrHttps = () =>
        localize('DataScience.validationErrorMessageForRemoteUrlProtocolNeedsToBeHttpOrHttps', 'Has to be http(s)');
    export const pickLocalKernelPlaceholder = () =>
        localize('DataScience.pickLocalKernelPlaceholder', `type to filter`);
    export const pickRemoteKernelTitle = () => localize('DataScience.pickRemoteKernelTitle', `Select a Remote Kernel`);
    export const pickRemoteKernelPlaceholder = () =>
        localize('DataScience.pickRemoteKernelPlaceholder', `type to filter`);
    export const failedToInstallPythonExtension = () =>
        localize('DataScience.failedToInstallPythonExtension', `Failed to install the Python Extension.`);
    export const pythonFileOverridesPythonPackage = () =>
        localize(
            'DataScience.pythonFileOverridesPythonPackage',
            'This file could potentially override an existing Python package and interfere with kernel execution, consider renaming it.'
        );
    export const alwaysIgnoreWarningsAboutOverridingPythonPackages = () =>
        localize(
            'DataScience.alwaysIgnoreWarningsAboutOverridingPythonPackages',
            'Always ignore warnings about overriding Python packages'
        );
    export const ignoreWarningAboutOverridingPythonPackage = () =>
        localize('DataScience.ignoreWarningAboutOverridingPythonPackage', 'Ignore warning for {0}');
    export const moreInfoAboutFileNamesOverridingPythonPackages = () =>
        localize(
            'DataScience.moreInfoAboutFileNamesOverridingPythonPackages',
            'More information on overriding Python packages'
        );
    export const reservedPythonFileNamesDiagnosticCollectionName = () =>
        localize('DataScience.reservedPythonFileNamesDiagnosticCollectionName', 'Reserved Python Filenames');
    export const filesPossiblyOverridingPythonModulesMayHavePreventedKernelFromStarting = () =>
        localize(
            'DataScience.filesPossiblyOverridingPythonModulesMayHavePreventedKernelFromStarting',
            'Some of the following files found in the working directory may have prevented the Kernel from starting. Consider renaming them.'
        );
    export const listOfFilesWithLinksThatMightNeedToBeRenamed = () =>
        localize('DataScience.listOfFilesWithLinksThatMightNeedToBeRenamed', 'File(s): {0} might need to be renamed.');
    export const failedToGetVersionOfPandas = () =>
        localize(
            { key: 'DataScience.failedToGetVersionOfPandas', comment: ['{Locked="Pandas"}'] },
            'Failed to get version of Pandas to use the Data Viewer.'
        );
    export const failedToInstallPandas = () =>
        localize(
            { key: 'DataScience.failedToInstallPandas', comment: ['{Locked="Pandas"}'] },
            'Failed to install Pandas to use the Data Viewer.'
        );
    export const localKernelSpecs = () => localize('DataScience.localKernelSpecs', 'Local Kernel Specs...');
    export const pickLocalKernelSpecTitle = () =>
        localize('DataScience.pickLocalKernelSpecTitle', `Select a Local Kernel spec`);

    export const localPythonEnvironments = () =>
        localize('DataScience.localPythonEnvironments', 'Local Python Environments...');
    export const pickLocalKernelPythonEnvTitle = () =>
        localize('DataScience.pickLocalKernelPythonEnvTitle', `Select a Local Python Environment`);
    export const UserJupyterServerUrlProviderDisplayName = () =>
        localize('DataScience.UserJupyterServerUrlProviderDisplayName', 'Existing Jupyter Server...');
    export const UserJupyterServerUrlProviderDetail = () =>
        localize('DataScience.UserJupyterServerUrlProviderDetail', 'Connect to an existing Jupyter Server');
    export const UserJupyterServerUrlAlreadyExistError = () =>
        localize('DataScience.UserJupyterServerUrlAlreadyExistError', 'A Jupyter Server with this URL already exists');
    export const universalRemoteKernelFinderDisplayName = () =>
        localize('DataScience.universalRemoteKernelFinderDisplayName', 'Remote - {0}');
    export const remoteKernelFinderDisplayName = () =>
        localize('DataScience.remoteKernelFinderDisplayName', 'Current Remote');
    export const kernelPickerSelectSourceTitle = () =>
        localize('DataScience.kernelPickerSelectSourceTitle', 'Select Another Jupyter Kernel...');
    export const kernelPickerSelectKernelTitle = () =>
        localize('DataScience.kernelPickerSelectKernelTitle', 'Select Kernel');
    export const kernelPickerSelectLocalKernelSpecTitle = () =>
        localize('DataScience.kernelPickerSelectLocalKernelSpecTitle', 'Select a Local Kernel Spec');
    export const kernelPickerSelectPythonEnvironmentTitle = () =>
        localize('DataScience.kernelPickerSelectPythonEnvironmentTitle', 'Select a Local Python Environment');
    export const kernelPickerSelectKernelFromRemoteTitle = () =>
        localize('DataScience.kernelPickerSelectKernelFromRemoteTitle', 'Select a Kernel from {0}');
    export const installPythonExtensionViaKernelPickerTitle = () =>
        localize('DataScience.installPythonExtensionViaKernelPickerTitle', 'Install Python Extension');
    export const installPythonTitle = () => localize('DataScience.installPythonTitle', 'Install Python');
}

export namespace Deprecated {
    export const SHOW_DEPRECATED_FEATURE_PROMPT_FORMAT_ON_SAVE = () =>
        localize(
            {
                key: 'Deprecated.SHOW_DEPRECATED_FEATURE_PROMPT_FORMAT_ON_SAVE',
                comment: ['{Locked="python.formatting.formatOnSave"}', '{Locked="editor.formatOnSave"}']
            },
            "The setting 'python.formatting.formatOnSave' is deprecated, please use 'editor.formatOnSave'."
        );
    export const SHOW_DEPRECATED_FEATURE_PROMPT_LINT_ON_TEXT_CHANGE = () =>
        localize(
            {
                key: 'Deprecated.SHOW_DEPRECATED_FEATURE_PROMPT_LINT_ON_TEXT_CHANGE',
                comment: [
                    '{Locked="python.linting.lintOnTextChange"}',
                    '{Locked="python.linting.lintOnSave"}',
                    '{Locked="files.autoSave"}'
                ]
            },
            "The setting 'python.linting.lintOnTextChange' is deprecated, please enable 'python.linting.lintOnSave' and 'files.autoSave'."
        );
    export const SHOW_DEPRECATED_FEATURE_PROMPT_FOR_AUTO_COMPLETE_PRELOAD_MODULES = () =>
        localize(
            {
                key: 'Deprecated.SHOW_DEPRECATED_FEATURE_PROMPT_FOR_AUTO_COMPLETE_PRELOAD_MODULES',
                comment: ['{Locked="python.autoComplete.preloadModules"}', '{Locked="python.languageServer"}']
            },
            "The setting 'python.autoComplete.preloadModules' is deprecated, please consider using Pylance Language Server ('python.languageServer' setting)."
        );
}

export namespace Installer {
    export const noCondaOrPipInstaller = () =>
        localize(
            'Installer.noCondaOrPipInstaller',
            'There is no Conda or Pip installer available in the selected environment.'
        );
    export const noPipInstaller = () =>
        localize('Installer.noPipInstaller', 'There is no Pip installer available in the selected environment.');
    export const searchForHelp = () => localize('Installer.searchForHelp', 'Search for help');
    export const couldNotInstallLibrary = () =>
        localize(
            'Installer.couldNotInstallLibrary',
            'Could not install {0}. If pip is not available, please use the package manager of your choice to manually install this library into your Python environment.'
        );
    export const dataScienceInstallPrompt = () =>
        localize('Installer.dataScienceInstallPrompt', 'Data Science library {0} is not installed. Install?');
}

export namespace Products {
    export const installingModule = () => localize('products.installingModule', 'Installing {0}');
}

// Skip using vscode-nls and instead just compute our strings based on key values. Key values
// can be loaded out of the nls.<locale>.json files
let loadedCollection: Record<string, string> | undefined;
let defaultCollection: Record<string, string> | undefined;
let askedForCollection: Record<string, string> = {};
let loadedLocale: string;

// This is exported only for testing purposes.
export function _resetCollections() {
    loadedLocale = '';
    loadedCollection = undefined;
    askedForCollection = {};
}

// This is exported only for testing purposes.
export function _getAskedForCollection() {
    return askedForCollection;
}

// Return the effective set of all localization strings, by key.
//
// This should not be used for direct lookup.
export function getCollectionJSON(): string {
    // Load the current collection
    if (!loadedCollection || parseLocale() !== loadedLocale) {
        load();
    }

    // Combine the default and loaded collections
    return JSON.stringify({ ...defaultCollection, ...loadedCollection });
}

function parseLocale(): string {
    // Attempt to load from the vscode locale. If not there, use english
    return vscode.env.language || 'en-us';
}

function getString(key: string, defValue?: string): string {
    // Load the current collection
    if (!loadedCollection || parseLocale() !== loadedLocale) {
        load();
    }

    // The default collection (package.nls.json) is the fallback.
    // Note that we are guaranteed the following (during shipping)
    //  1. defaultCollection was initialized by the load() call above
    //  2. defaultCollection has the key (see the "keys exist" test)
    let collection = defaultCollection!;

    // Use the current locale if the key is defined there.
    if (loadedCollection && loadedCollection.hasOwnProperty(key)) {
        collection = loadedCollection;
    }
    let result = collection[key];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    result = (result as any)?.message || result;
    if (!result && defValue) {
        // This can happen during development if you haven't fixed up the nls file yet or
        // if for some reason somebody broke the functional test.
        result = defValue;
    }
    askedForCollection[key] = result;

    return result;
}

function load() {
    // Figure out our current locale.
    loadedLocale = parseLocale();

    // Find the nls file that matches (if there is one)
    let contents = packageNlsJsons[loadedLocale];
    if (contents) {
        loadedCollection = contents;
    } else {
        // If there isn't one, at least remember that we looked so we don't try to load a second time
        loadedCollection = {};
    }

    // Get the default collection if necessary. Strings may be in the default or the locale json
    if (!defaultCollection) {
        defaultCollection = packageBaseNlsJson;
    }
}

// Default to loading the current locale
load();
