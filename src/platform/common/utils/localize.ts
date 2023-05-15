// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { l10n } from 'vscode';
import { PythonEnvironment } from '../../pythonEnvironments/info';
import { getDisplayPath } from '../platform/fs-paths';

function getInterpreterDisplayName(interpreter: PythonEnvironment) {
    const interpreterDisplayName = interpreter.displayName || interpreter.envName || '';
    const displayPath = getDisplayPath(interpreter.uri);
    return interpreterDisplayName ? ` ${interpreterDisplayName} (${displayPath})` : displayPath;
}
export namespace Common {
    export const bannerLabelYes = l10n.t('Yes');
    export const bannerLabelNo = l10n.t('No');
    export const canceled = l10n.t('Canceled');
    export const cancel = l10n.t('Cancel');
    export const ok = l10n.t('Ok');
    export const refresh = l10n.t('Refresh');
    export const refreshing = l10n.t('Refreshing...');
    export const install = l10n.t('Install');
    export const loadingExtension = l10n.t('Jupyter Extension loading...');
    export const handleExtensionActivationError = l10n.t(
        "Extension activation failed, run the 'Developer: Toggle Developer Tools' command for more information."
    );
    export const doNotShowAgain = l10n.t('Do not show again');
    export const reload = l10n.t('Reload');
    export const moreInfo = l10n.t('More Info');
    export const documentation = l10n.t('Documentation');
    export const learnMore = l10n.t('Learn more');
    export const and = l10n.t('and');
    export const reportThisIssue = l10n.t('Report this issue');
    export const clickHereForMoreInfoWithHtml = (link: string) =>
        l10n.t("Click <a href='{0}'>here</a> for more info.", link);
}

export namespace Experiments {
    export const inGroup = (groupName: string) => l10n.t("User belongs to experiment group '{0}'", groupName);
}
export namespace OutputChannelNames {
    export const jupyter = l10n.t('Jupyter');
}

export namespace Logging {
    export const currentWorkingDirectory = 'cwd:';
}

export namespace InteractiveShiftEnterBanner {
    export const bannerMessage = l10n.t(
        'Would you like shift-enter to send code to the new Interactive Window experience?'
    );
}

export namespace InsidersNativeNotebooksSurveyBanner {
    export const bannerMessage = l10n.t(
        'Can you please take a minute to tell us about your notebooks experience in VS Code?'
    );
}

export namespace DataScienceSurveyBanner {
    export const bannerLabelYes = l10n.t('Yes, take survey now');
    export const bannerLabelNo = l10n.t('No, thanks');
}
export namespace DataScience {
    export const warnWhenSelectingKernelWithUnSupportedPythonVersion = l10n.t(
        'The version of Python associated with the selected kernel is no longer supported. Please consider selecting a different kernel.'
    );
    export const installingPythonExtension = l10n.t('Installing Python extension and locating kernels.');
    export const pythonExtensionRequired = l10n.t(
        'The Python Extension is required to perform that task. Click Yes to open Python Extension installation page.'
    );
    export const rendererExtensionRequired = l10n.t(
        'The Renderer Extension is required to view IPyWidgets. Click Yes to open Jupyter Notebook Renderer Extension installation page.'
    );
    export const rendererExtension1015Required = l10n.t(
        'The installed version of the Renderer Extension is outdated and requires and update to view IPyWidgets. Click Yes to open Jupyter Notebook Renderer Extension installation page.'
    );

    export const pythonExtensionInstalled = l10n.t(
        'Python Extension is now installed. Some features might not be available until a notebook or interactive window session is restarted.'
    );
    export const unknownServerUri = l10n.t(
        'Server URL cannot be used. Did you uninstall an extension that provided a Jupyter server connection?'
    );
    export const uriProviderDescriptionFormat = (description: string, extensionId: string) =>
        l10n.t('{0} (From {1} extension)', description, extensionId);
    export const unknownPackage = l10n.t('unknown');
    export const interactiveWindowTitleFormat = (ownerFileName: string) => l10n.t('Interactive - {0}', ownerFileName);

    export const interactiveWindowModeBannerTitle = l10n.t({
        message:
            'Do you want to open a new Interactive Window for this file? [More Information](command:workbench.action.openSettings?%5B%22jupyter.interactiveWindowMode%22%5D).',
        args: [],
        comment:
            'The string "command:workbench.action.openSettings?%5B%22jupyter.interactiveWindowMode%22%5D" should not be translated. It is a command that opens the settings page with the "jupyter.interactiveWindowMode" setting selected.'
    });

    export const interactiveWindowModeBannerSwitchYes = l10n.t('Yes');
    export const interactiveWindowModeBannerSwitchNo = l10n.t('No');

    export const dataExplorerTitle = l10n.t('Data Viewer');
    export const badWebPanelFormatString = (fileNames: string) =>
        l10n.t({
            message: '<html><body><h1>{0} is not a valid file name</h1></body></html>',
            args: [fileNames],
            comment: ['Only translate the text within the HTML tags']
        });
    export const installingMissingDependencies = l10n.t('Installing missing dependencies');
    export const validatingKernelDependencies = l10n.t('Validating kernel dependencies');
    export const performingExport = l10n.t('Performing Export');
    export const exportNotebookToPython = l10n.t('Exporting Notebook to Python');
    export const sessionDisposed = l10n.t(
        'Cannot execute code, session has been disposed. Please try restarting the Kernel.'
    );
    export const passwordFailure = l10n.t(
        'Failed to connect to password protected server. Check that password is correct.'
    );
    export const exportDialogFilter = l10n.t('Jupyter Notebooks');
    export const exportDialogComplete = (fileName: string) => l10n.t('Notebook written to {0}', fileName);
    export const exportDialogFailed = (errorMessage: string) => l10n.t('Failed to export notebook. {0}', errorMessage);
    export const exportOpenQuestion1 = l10n.t('Open in editor');
    export const runCellLensCommandTitle = l10n.t('Run Cell');
    export const importDialogTitle = l10n.t('Import Jupyter Notebook');
    export const importDialogFilter = 'Jupyter Notebooks';
    export const notebookCheckForImportNo = l10n.t('Later');
    export const libraryRequiredToLaunchJupyterNotInstalled = (pythonModuleName: string) =>
        l10n.t('Running cells requires {0} package.', pythonModuleName);
    export const librariesRequiredToLaunchJupyterNotInstalled = (pythonModuleName: string) =>
        l10n.t('Running cells requires {0} package.', pythonModuleName);
    export const libraryRequiredToLaunchJupyterNotInstalledInterpreter = (
        pythonEnvName: string,
        pythonModuleName: string
    ) => l10n.t("Running cells with '{0}' requires the {1} package.", pythonEnvName, pythonModuleName);
    export const libraryRequiredToLaunchJupyterKernelNotInstalledInterpreter = (
        pythonEnvName: string,
        pythonModuleName: string
    ) => l10n.t("Running cells with '{0}' requires the {1} package.", pythonEnvName, pythonModuleName);
    export const libraryRequiredToLaunchJupyterKernelNotInstalledInterpreterAndRequiresUpdate = (
        pythonEnvName: string,
        pythonModuleName: string
    ) =>
        l10n.t(
            "Running cells with '{0}' requires the {1} package to be installed or requires an update.",
            pythonEnvName,
            pythonModuleName
        );
    export const librariesRequiredToLaunchJupyterNotInstalledInterpreter = (
        pythonEnvName: string,
        pythonModuleName: string
    ) => l10n.t("Running cells with '{0}' requires the {1} package.", pythonEnvName, pythonModuleName);
    export const pythonRequiredToLaunchJupyterNotInstalledInConda = (pythonEnvName: string, pythonModuleName: string) =>
        l10n.t("Running cells with '{0}' requires Python and the {0} package.", pythonEnvName, pythonModuleName);

    export const installPackageInstructions = (pythonModuleName: string, commandId: string) =>
        l10n.t(
            "Run the following command to install '{0}' into the Python environment. \nCommand: '{1}'",
            pythonModuleName,
            commandId
        );
    export const pythonCondaKernelsWithoutPython = l10n.t(
        'The Python Runtime and IPyKernel will be automatically installed upon selecting this environment.'
    );

    export const selectJupyterInterpreter = l10n.t('Select an Interpreter to start Jupyter');
    export const jupyterInstall = l10n.t('Install');
    export const currentlySelectedJupyterInterpreterForPlaceholder = (pythonEnvPath: string) =>
        l10n.t('current: {0}', pythonEnvPath);
    export const jupyterNotSupported = (errorMessage: string) =>
        l10n.t('Jupyter cannot be started. Error attempting to locate Jupyter: {0}', errorMessage);
    export const jupyterNotebookNotInstalledOrNotFound = (interpreter: PythonEnvironment | undefined) => {
        if (interpreter) {
            const displayName = getInterpreterDisplayName(interpreter);
            return l10n.t(
                "Failed to start Jupyter Server as the packages 'jupyter' and 'notebook' could not be located in the Python environment '{0}'.",
                displayName
            );
        } else {
            return l10n.t(
                "Failed to start Jupyter Server as the packages 'jupyter' and 'notebook' could not be located in the Python environment."
            );
        }
    };
    export const jupyterNotSupportedBecauseOfEnvironment = (pythonEnvName: string, errorMessage: string) =>
        l10n.t('Activating {0} to run Jupyter failed with {1}', pythonEnvName, errorMessage);
    export const jupyterNbConvertNotSupported = l10n.t('Jupyter nbconvert is not installed');
    export const jupyterLaunchTimedOut = l10n.t('The Jupyter notebook server failed to launch in time');
    export const jupyterLaunchNoURL = l10n.t('Failed to find the URL of the launched Jupyter notebook server');
    export const jupyterSelfCertFail = (errorMessage: string) =>
        l10n.t(
            'The security certificate used by server {0} was not issued by a trusted certificate authority.\r\nThis may indicate an attempt to steal your information.\r\nDo you want to enable the Allow Unauthorized Remote Connection setting for this workspace to allow you to connect?',
            errorMessage
        );
    export const jupyterExpiredCertFail = (errorMessage: string) =>
        l10n.t(
            'The security certificate used by server {0} has expired.\r\nThis may indicate an attempt to steal your information.\r\nDo you want to enable the Allow Unauthorized Remote Connection setting for this workspace to allow you to connect?',
            errorMessage
        );
    export const jupyterSelfCertFailErrorMessageOnly = l10n.t(
        'The security certificate used by server was not issued by a trusted certificate authority.\r\nThis may indicate an attempt to steal your information.'
    );
    export const jupyterSelfCertExpiredErrorMessageOnly = l10n.t(
        'The security certificate used by server has expired.\r\nThis may indicate an attempt to steal your information.'
    );
    export const jupyterSelfCertEnable = l10n.t('Yes, connect anyways');
    export const jupyterSelfCertClose = l10n.t('No, close the connection');
    export const pythonInteractiveHelpLink = l10n.t('See <https://aka.ms/pyaiinstall> for help on installing Jupyter.');
    export const importingFormat = (pythoModuleName: string) => l10n.t('Importing {0}', pythoModuleName);
    export const startingJupyter = l10n.t('Starting Jupyter server');
    export const connectingToKernel = (kernelName: string) => l10n.t('Connecting to kernel: {0}', kernelName);
    export const connectingToJupyter = l10n.t('Connecting to Jupyter server');
    export const exportingFormat = (fileName: string) => l10n.t('Exporting {0}', fileName);
    export const runAllCellsLensCommandTitle = l10n.t('Run All Cells');
    export const runAllCellsAboveLensCommandTitle = l10n.t('Run Above');
    export const runCellAndAllBelowLensCommandTitle = l10n.t('Run Below');

    export const restartKernelMessage = l10n.t(
        'Do you want to restart the Jupyter kernel? All variables will be lost.'
    );
    export const restartKernelMessageYes = l10n.t('Restart');
    export const restartKernelMessageDontAskAgain = l10n.t("Don't Ask Again");
    export const automaticallyReconnectingToAKernelProgressMessage = (kernelName: string) =>
        l10n.t('Reconnecting to the kernel {0}', kernelName);
    export const restartingKernelStatus = (kernelName: string) => l10n.t('Restarting Kernel {0}', kernelName);
    export const interruptingKernelFailed = l10n.t(
        'Kernel interrupt failed. Jupyter server is hung. Please reload VS Code.'
    );
    export const sessionStartFailedWithKernel = (kernelName: string) =>
        l10n.t({
            message:
                "Failed to start the Kernel '{0}'. \nView Jupyter [log](command:jupyter.viewOutput) for further details.",
            args: [kernelName],
            comment: [
                'Do not translate the text "command:jupyter.viewOutput", that is a command Id that will be used by VS Code to open the output panel'
            ]
        });
    export const failedToStartJupyter = (pythonEnvName: string) =>
        l10n.t({
            message:
                "Failed to start Jupyter in the environment '{0}'. \nView Jupyter [log](command:jupyter.viewOutput) for further details.",
            args: [pythonEnvName],
            comment: [
                'Do not translate the text "command:jupyter.viewOutput", that is a command Id that will be used by VS Code to open the output panel'
            ]
        });
    export const failedToStartJupyterWithErrorInfo = (pythonEnvName: string, errorMessage: string) =>
        l10n.t({
            message:
                "Failed to start Jupyter in the environment '{0}'. \n{1} \nView Jupyter [log](command:jupyter.viewOutput) for further details.",
            args: [pythonEnvName, errorMessage],
            comment: [
                'Do not translate the text "command:jupyter.viewOutput", that is a command Id that will be used by VS Code to open the output panel'
            ]
        });
    export const failedToStartJupyterDueToOutdatedTraitlets = (pythonEnvName: string, errorMessage: string) =>
        l10n.t({
            message:
                "Failed to start Jupyter in the environment '{0}' possibly due to an outdated version of 'traitlets'. \n{1} \nConsider updating the 'traitlets' module to '5.1.1' or later. \nView Jupyter [log](command:jupyter.viewOutput) for further details.",
            args: [pythonEnvName, errorMessage],
            comment: [
                'Do not translate the text "command:jupyter.viewOutput", that is a command Id that will be used by VS Code to open the output panel',
                "Do not translate the text 'traitlets', that is a Python module name"
            ]
        });
    export const failedToStartKernel = l10n.t('Failed to start the Kernel.');
    export const failedToRestartKernel = l10n.t('Failed to restart the Kernel.');
    export const failedToInterruptKernel = l10n.t('Failed to interrupt the Kernel.');
    export const rawKernelStartFailedDueToTimeout = (kernelName: string) =>
        l10n.t({
            message:
                "Unable to start Kernel '{0}' due to connection timeout. \nView Jupyter [log](command:jupyter.viewOutput) for further details.",
            args: [kernelName],
            comment: [
                'Do not translate the text "command:jupyter.viewOutput", that is a command Id that will be used by VS Code to open the output panel'
            ]
        });
    export const viewJupyterLogForFurtherInfo = l10n.t({
        message: 'View Jupyter [log](command:jupyter.viewOutput) for further details.',
        comment: [
            'Do not translate the text "command:jupyter.viewOutput", that is a command Id that will be used by VS Code to open the output panel'
        ]
    });
    export const kernelDied = (kernelName: string) =>
        l10n.t({
            message:
                'The kernel died. Error: {0}... View Jupyter [log](command:jupyter.viewOutput) for further details.',
            args: [kernelName],
            comment: [
                'Do not translate the text "command:jupyter.viewOutput", that is a command Id that will be used by VS Code to open the output panel'
            ]
        });
    export const kernelDiedWithoutError = (kernelName: string) =>
        l10n.t({
            message:
                "The kernel '{0}' died. Click [here](https://aka.ms/vscodeJupyterKernelCrash) for more info. View Jupyter [log](command:jupyter.viewOutput) for further details.",
            args: [kernelName],
            comment: [
                'Do not translate the text "command:jupyter.viewOutput", that is a command Id that will be used by VS Code to open the output panel',
                'Do not translate the link https://aka.ms/vscodeJupyterKernelCrash'
            ]
        });
    export const failedToStartAnUntrustedKernelSpec = (kernelName: string, specFile: string) =>
        l10n.t({
            message:
                "The kernel '{0}' was not started as it is located in an insecure location '{1}'.  \nClick [here](https://aka.ms/JupyterTrustedKernelPaths) for further details, optionally update the setting [jupyter.kernels.trusted](command:workbench.action.openSettings?[\"jupyter.kernels.trusted\"]) to trust the kernel.",
            args: [kernelName, specFile],
            comment: [
                'Do not translate the text "jupyter.kernels.trusted", that is a setting in VS Code',
                'Do not translate the text command:workbench.action.openSettings?["jupyter.kernels.trusted"], that is a command Id that will be used by VS Code to open the output panel',
                'Do not translate the link https://aka.ms/JupyterTrustedKernelPaths'
            ]
        });
    export const kernelDiedWithoutErrorAndAutoRestarting = (kernelName: string) =>
        l10n.t({
            message:
                "The kernel '{0}' died and is being automatically restarted by Jupyter. Click [here](https://aka.ms/vscodeJupyterKernelCrash) for more info. View Jupyter [log](command:jupyter.viewOutput) for further details.",
            args: [kernelName],
            comment: [
                'Do not translate the text "command:jupyter.viewOutput", that is a command Id that will be used by VS Code to open the output panel',
                'Do not translate the link https://aka.ms/vscodeJupyterKernelCrash'
            ]
        });
    export const kernelCrashedDueToCodeInCurrentOrPreviousCell = l10n.t({
        message:
            "The Kernel crashed while executing code in the the current cell or a previous cell. Please review the code in the cell(s) to identify a possible cause of the failure. Click <a href='https://aka.ms/vscodeJupyterKernelCrash'>here</a> for more info. View Jupyter [log](command:jupyter.viewOutput) for further details.",
        comment: [
            'Do not translate the text "command:jupyter.viewOutput", that is a command Id that will be used by VS Code to open the output panel',
            'Do not translate the link https://aka.ms/vscodeJupyterKernelCrash'
        ]
    });
    export const kernelDisconnected = (kernelName: string) =>
        l10n.t(
            "Unable to connect to the kernel '{0}', please verify the Jupyter Server connection. View Jupyter [log](command:jupyter.viewOutput) for further details.",
            kernelName
        );
    export const cannotRunCellKernelIsDead = (kernelName: string) =>
        l10n.t("Cannot run cells, as the kernel '{0}' is dead.", kernelName);
    export const showJupyterLogs = l10n.t('Show Jupyter Logs.');
    export const restartKernel = l10n.t('Restart Kernel');
    export const reloadRequired = l10n.t('Please reload the window for new settings to take effect.');
    export const restartedKernelHeader = (kernelName: string) => l10n.t('Restarted {0}', kernelName);
    export const restartingKernelCustomHeader = (kernelName: string) => l10n.t('_Restarting {0}..._', kernelName);
    export const restartingKernelHeader = l10n.t('_Restarting kernel..._');
    export const startingNewKernelHeader = l10n.t('_Connecting to kernel..._');
    export const startingNewKernelCustomHeader = (kernelName: string) => l10n.t('_Connecting to {0}..._', kernelName);
    export const jupyterSelectURIPrompt = l10n.t('Enter the URL of the running Jupyter server');
    export const jupyterSelectURIQuickPickTitleOld = l10n.t('Pick how to connect to Jupyter');
    export const jupyterSelectURIQuickPickPlaceholder = l10n.t('Choose an option');
    export const jupyterSelectURIQuickPickCurrent = (uri: string) => l10n.t('Current: {0}', uri);
    export const jupyterSelectURINoneLabel = l10n.t('None');
    export const jupyterSelectURINoneDetail = l10n.t('Do not connect to any remote Jupyter server');
    export const jupyterSelectURIMRUDetail = (date: Date) => l10n.t('Last Connection: {0}', date.toLocaleString());
    export const jupyterSelectURINewLabel = l10n.t('Existing');
    export const jupyterSelectURINewDetail = l10n.t('Specify the URL of an existing server');
    export const jupyterSelectURIInvalidURI = l10n.t('Invalid URL specified');
    export const jupyterSelectURIRunningDetailFormat = (time: Date, numberOfConnections: number) =>
        l10n.t('Last connection {0}. {1} existing connections.', time.toLocaleString(), numberOfConnections.toString());
    export const jupyterSelectUserAndPasswordTitle = l10n.t(
        'Enter your user name and password to connect to Jupyter Hub'
    );
    export const jupyterRenameServer = l10n.t('Change Server Display Name (Leave Blank To Use URL)');
    export const jupyterSelectUserPrompt = l10n.t('Enter your user name');
    export const jupyterSelectPasswordPrompt = l10n.t('Enter your password');
    export const jupyterSelectPasswordTitle = (jupyterServer: string) =>
        l10n.t('Enter your password for the Jupyter Server {0}', jupyterServer);
    export const pythonNotInstalled = l10n.t(
        'Python is not installed. \nPlease download and install Python in order to execute cells in this notebook. \nOnce installed please reload VS Code.'
    );
    export const pleaseReloadVSCodeOncePythonHasBeenInstalled = l10n.t('Upon installing Python please reload VS Code.');
    export const jupyterNotebookFailure = (errorMessage: string) =>
        l10n.t('Jupyter notebook failed to launch. \r\n{0}', errorMessage);
    export const remoteJupyterServerProvidedBy3rdPartyExtensionNoLongerValid = (extensionName: string) =>
        l10n.t("The remote Jupyter Server contributed by the extension '{0}' is no longer available.", extensionName);
    export const remoteJupyterConnectionFailedWithServerWithError = (hostName: string, errorMessage: string) =>
        l10n.t(
            "Failed to connect to the remote Jupyter Server '{0}'. Verify the server is running and reachable. ({1}).",
            hostName,
            errorMessage
        );
    export const remoteJupyterConnectionFailedWithServer = (hostName: string) =>
        l10n.t(
            "Failed to connect to the remote Jupyter Server '{0}'. Verify the server is running and reachable.",
            hostName
        );
    export const remoteJupyterConnectionFailedWithoutServerWithError = (errorMessage: string) =>
        l10n.t('Connection failure. Verify the server is running and reachable. ({0}).', errorMessage);
    export const remoteJupyterConnectionFailedWithoutServerWithErrorWeb = (errorMessage: string) =>
        l10n.t(
            'Connection failure. Verify the server is running and reachable from a browser. ({0}). \nWhen connecting from vscode.dev Jupyter servers must be started with specific options to connect. \nClick [here](https://aka.ms/vscjremoteweb) for more information.',
            errorMessage
        );
    export const removeRemoteJupyterConnectionButtonText = l10n.t('Forget Connection');
    export const jupyterNotebookRemoteConnectFailedWeb = (hostName: string) =>
        l10n.t(
            'Failed to connect to remote Jupyter server.\r\nCheck that the Jupyter Server URL can be reached from a browser.\r\n{0}. Click [here](https://aka.ms/vscjremoteweb) for more information.',
            hostName
        );
    export const packageNotInstalledWindowsLongPathNotEnabledError = (
        pythonPackageName: string,
        interpreterDisplayName: string
    ) =>
        l10n.t(
            "Support for Windows Long Path has not been enabled, hence the package {0} could not be installed into the Python Environment '{1}'.\nPlease ensure that support for Windows Long Path is enabled.\nSee [here](https://pip.pypa.io/warnings/enable-long-paths) for more information.",
            pythonPackageName,
            interpreterDisplayName
        );
    export const changeRemoteJupyterConnectionButtonText = l10n.t('Manage Connections');
    export const rawConnectionBrokenError = l10n.t('Direct kernel connection broken');
    export const jupyterServerCrashed = (exitCode: number) =>
        l10n.t('Jupyter server crashed. Unable to connect. \r\nError code from Jupyter: {0}', exitCode.toString());
    export const jupyterKernelSpecModuleNotFound = (pythonExecFileName: string) =>
        l10n.t(
            "'Kernelspec' module not installed in the selected interpreter ({0}).\n Please re-install or update 'jupyter'.",
            pythonExecFileName
        );
    export const interruptKernelStatus = l10n.t('Interrupting Jupyter Kernel');
    export const exportPythonQuickPickLabel = l10n.t('Python Script');
    export const exportHTMLQuickPickLabel = l10n.t('HTML');
    export const exportPDFQuickPickLabel = l10n.t('PDF');
    export const restartKernelAfterInterruptMessage = l10n.t(
        'Interrupting the kernel timed out. Do you want to restart the kernel instead? All variables will be lost.'
    );
    export const documentMismatch = (fileName: string) =>
        l10n.t('Cannot run cells, duplicate documents for {0} found.', fileName);
    export const jupyterGetVariablesBadResults = l10n.t('Failed to fetch variable info from the Jupyter server.');
    l10n.t("Failure to create an 'Interactive' window. Try reinstalling the Python Extension.");
    export const jupyterGetVariablesExecutionError = (errorMessage: string) =>
        l10n.t('Failure during variable extraction: \r\n{0}', errorMessage);
    export const selectKernel = l10n.t('Change Kernel');
    export const selectDifferentKernel = l10n.t('Select a different Kernel');
    export const kernelFilterPlaceholder = l10n.t('Choose the kernels that are available in the kernel picker.');
    export const recommendedKernelCategoryInQuickPick = l10n.t('Recommended');
    export const createPythonEnvironmentInQuickPick = l10n.t('Create Python Environment');
    export const createPythonEnvironmentInQuickPickTooltip = l10n.t(
        'Create an isolated Python Environment per workspace folder'
    );

    export const selectDifferentJupyterInterpreter = l10n.t('Change Interpreter');
    export const pandasTooOldForViewingFormat = (currentVersion: string, requiredVersion: string) =>
        l10n.t({
            message: "Python package 'pandas' is version {0}. Version {1} or greater is required for viewing data.",
            args: [currentVersion, requiredVersion],
            comment: ["Do not translate 'pandas' as that is a Python module name"]
        });
    export const pandasRequiredForViewing = (requiredVersion: string) =>
        l10n.t({
            message: "Python package 'pandas' version {0} (or above) is required for viewing data.",
            args: [requiredVersion],
            comment: ["Do not translate 'pandas' as that is a Python module name"]
        });
    export const tooManyColumnsMessage = l10n.t(
        'Variables with over a 1000 columns may take a long time to display. Are you sure you wish to continue?'
    );
    export const tooManyColumnsYes = l10n.t('Yes');
    export const tooManyColumnsNo = l10n.t('No');
    export const tooManyColumnsDontAskAgain = l10n.t("Don't Ask Again");
    export const plotViewerTitle = l10n.t('Plots');
    export const exportPlotTitle = l10n.t('Save plot image');
    export const pdfFilter = 'PDF';
    export const pngFilter = 'PNG';
    export const svgFilter = 'SVG';
    export const exportImageFailed = (errorMessage: string) => l10n.t('Error exporting image: {0}', errorMessage);
    export const jupyterDataRateExceeded = l10n.t({
        message:
            'Cannot view variable because data rate exceeded. Please restart your server with a higher data rate limit. For example, --NotebookApp.iopub_data_rate_limit=10000000000.0',
        comment: [
            'Do not translate the text --NotebookApp.iopub_data_rate_limit=10000000000.0 as that is a command argument.'
        ]
    });
    export const addCellBelowCommandTitle = l10n.t('Add cell');
    export const debugCellCommandTitle = l10n.t('Debug Cell');
    export const debugStepOverCommandTitle = l10n.t('Step over');
    export const debugContinueCommandTitle = l10n.t('Continue');
    export const debugStopCommandTitle = l10n.t('Stop');
    export const runCurrentCellAndAddBelow = l10n.t('Run current cell and add empty cell below');
    export const jupyterDebuggerNotInstalledError = (pythonModuleName: string) =>
        l10n.t(
            'Pip module {0} is required for debugging cells. You will need to install it to debug cells.',
            pythonModuleName
        );
    export const jupyterDebuggerOutputParseError = (output: string) =>
        l10n.t(
            'Unable to parse {0} output, please log an issue with https://github.com/microsoft/vscode-jupyter',
            output
        );
    export const cellStopOnErrorMessage = l10n.t('Cell was canceled due to an error in a previous cell.');
    export const scrollToCellTitleFormatMessage = (executionCount: number) =>
        l10n.t('Go to [{0}]', executionCount.toString());
    export const instructionComments = (cellMarker: string) =>
        l10n.t(`# To add a new cell, type '{0}'\n# To add a new markdown cell, type '{0} [markdown]'\n`, cellMarker);
    export const untitledNotebookFileName = l10n.t('Untitled');
    export const exportButtonTitle = l10n.t('Export');
    export const exportAsQuickPickPlaceholder = l10n.t('Export As...');
    export const openExportedFileMessage = l10n.t('Would you like to open the exported file?');
    export const openExportFileYes = l10n.t('Yes');
    export const openExportFileNo = l10n.t('No');
    export const exportFailedGeneralMessage = l10n.t({
        message: `Please check the 'Jupyter' [output](command:jupyter.viewOutput) panel for further details.`,
        comment: [
            'Do not translate the text "command:jupyter.viewOutput", that is a command Id that will be used by VS Code to open the output panel'
        ]
    });
    export const exportToPDFDependencyMessage = l10n.t(
        'If you have not installed xelatex (TeX) you will need to do so before you can export to PDF, for further instructions please look https://nbconvert.readthedocs.io/en/latest/install.html#installing-tex. \r\nTo avoid installing xelatex (TeX) you might want to try exporting to HTML and using your browsers "Print to PDF" feature.'
    );
    export const failedExportMessage = l10n.t('Export failed.');
    export const startingJupyterLogMessage = (pythonExec: string, cliArgs: string) =>
        l10n.t('Starting Jupyter from {0} with arguments {1}', pythonExec, cliArgs);
    export const waitingForJupyterSessionToBeIdle = l10n.t('Waiting for Jupyter Session to be idle');
    export const gettingListOfKernelsForLocalConnection = l10n.t('Fetching Kernels');
    export const gettingListOfKernelsForRemoteConnection = l10n.t('Fetching Kernels');
    export const gettingListOfKernelSpecs = l10n.t('Fetching Kernel specs');
    export const startingJupyterNotebook = l10n.t('Starting Jupyter Notebook');
    export const registeringKernel = l10n.t('Registering Kernel');
    export const jupyterCommandLineReloadQuestion = l10n.t(
        'Please reload the window when changing the Jupyter command line.'
    );
    export const jupyterCommandLineReloadAnswer = l10n.t('Reload');

    export const createdNewKernel = (hostName: string, sessionId: string) =>
        l10n.t('{0}: Kernel started: {1}', hostName, sessionId);
    export const kernelInvalid = (kernelName: string) =>
        l10n.t('Kernel {0} is not usable. Check the Jupyter output tab for more information.', kernelName);

    export const jupyterSelectURIRemoteLabel = l10n.t('Existing');
    export const jupyterSelectURIQuickPickTitleRemoteOnly = l10n.t('Pick an already running Jupyter server');
    export const jupyterSelectURIRemoteDetail = l10n.t('Specify the URL of an existing server');
    export const removeRemoteJupyterServerEntryInQuickPick = l10n.t('Remove');

    export const loadClassFailedWithNoInternet = (widgetName: string, version: string) =>
        l10n.t(
            'Error loading {0}:{1}. Internet connection required for loading 3rd party widgets.',
            widgetName,
            version
        );
    export const useCDNForWidgetsNoInformation = l10n.t(
        'Widgets require us to download supporting files from a 3rd party website.'
    );
    export const enableCDNForWidgetsSetting = (widgetName: string, version: string) =>
        l10n.t(
            'Widgets require us to download supporting files from a 3rd party website. (Error loading {0}:{1}).',
            widgetName,
            version
        );

    export const enableCDNForWidgetsButton = l10n.t('Enable Downloads');

    export const unhandledMessage = (messageType: string, content: string) =>
        l10n.t('Unhandled kernel message from a widget: {0} : {1}', messageType, content);

    export const cdnWidgetScriptNotAccessibleWarningMessage = (widgetName: string, sources: string) =>
        l10n.t(
            "Unable to download widget '{0}' from 3rd party website {1}, due to network access. Expected behavior may be affected. Click [here](https://aka.ms/PVSCIPyWidgets) for more information.",
            widgetName,
            sources
        );
    export const widgetScriptNotFoundOnCDNWidgetMightNotWork = (widgetName: string, version: string, sources: string) =>
        l10n.t(
            "Unable to find widget '{0}' version '{1}' from configured widget sources {2}. Expected behavior may be affected. Click [here](https://aka.ms/PVSCIPyWidgets) for more information.",
            widgetName,
            version,
            sources
        );
    export const insecureSessionMessage = l10n.t(
        'Connecting over HTTP without a token may be an insecure connection. Do you want to connect to a possibly insecure server?'
    );
    export const insecureSessionDenied = l10n.t('Denied connection to insecure server.');
    export const selectKernelForEditor = l10n.t('[Select a kernel](command:_notebook.selectKernel) to run cells.');
    export const needIpykernel6 = l10n.t('Ipykernel setup required for this feature');
    export const setup = l10n.t('Setup');
    export const showDataViewerFail = l10n.t(
        'Failed to create the Data Viewer. Check the Jupyter tab of the Output window for more info.'
    );

    export const defaultNotebookName = l10n.t('default');
    export const recommendExtensionForNotebookLanguage = (extensionLink: string, language: string) =>
        l10n.t("The {0} extension is recommended for notebooks targeting the language '{1}'", extensionLink, language);
    export const kernelWasNotStarted = l10n.t('Kernel was not started. A kernel session is needed to start debugging.');
    export const noNotebookToDebug = l10n.t('No active notebook document to debug.');
    export const cantStartDebugging = l10n.t("Can't start debugging.");
    export const restartNotSupported = l10n.t('Restarting is not supported in the interactive window.');
    export const importingIpynb = l10n.t('Importing notebook file');
    export const exportingToFormat = (format: string) => l10n.t('Exporting to {0}', format);
    export const kernelCategoryForJupyterSession = (serverName: string) => l10n.t('({0}) Jupyter Session', serverName);
    export const kernelPrefixForRemote = l10n.t('(Remote)');
    export const kernelDefaultRemoteDisplayName = l10n.t('Remote');
    export const kernelCategoryForJupyterKernel = l10n.t('Jupyter Kernel');
    export const kernelCategoryForRemoteJupyterKernel = (kernelSpecName: string) =>
        l10n.t('({0}) Jupyter Kernel', kernelSpecName);
    export const kernelCategoryForConda = l10n.t('Conda Env');
    export const kernelCategoryForCondaWithoutPython = l10n.t('Conda Env Without Python');
    export const kernelCategoryForPoetry = l10n.t('Poetry Env');
    export const kernelCategoryForPipEnv = l10n.t('Pipenv Env');
    export const kernelCategoryForPyEnv = l10n.t('PyEnv Env');
    export const kernelCategoryForGlobal = l10n.t('Global Env');
    export const kernelCategoryForVirtual = l10n.t('Virtual Env');

    export const fileSeemsToBeInterferingWithKernelStartup = (fileName: string) =>
        l10n.t(
            "The file '{0}' seems to be overriding built in modules and interfering with the startup of the kernel. Consider renaming the file and starting the kernel again.",
            fileName
        );
    export const moduleSeemsToBeInterferingWithKernelStartup = (moduleName: string) =>
        l10n.t(
            "The module '{0}' seems to be overriding built in modules and interfering with the startup of the kernel. Consider renaming the folder and starting the kernel again.",
            moduleName
        );
    export const pipCondaInstallHoverWarning = (pipOrCondaInstaller: 'pip' | 'conda', link: string) =>
        l10n.t(
            "'!{0} install' could install packages into the wrong environment. [More info]({1})",
            pipOrCondaInstaller,
            link
        );
    export const percentPipCondaInstallInsteadOfBang = (condaOrPipInstaller: 'conda' | 'pip') =>
        l10n.t({
            message: "Use '%{0} install' instead of '!{0} install'",
            args: [condaOrPipInstaller],
            comment: [
                'Do not translate the string within quotes, such as "%{0} install" and "!{0} install" as that is a Jupyter Shell Magic command'
            ]
        });
    export const replacePipCondaInstallCodeAction = (pipOrCondaInstaller: 'pip' | 'conda') =>
        l10n.t("Replace with '%{0} install'", pipOrCondaInstaller);
    export const failedToStartKernelDueToMissingModule = (moduleName: string) =>
        l10n.t(
            "The kernel failed to start due to the missing module '{0}'. Consider installing this module.",
            moduleName
        );
    export const failedToStartKernelDueToImportFailure = (pythonModuleName: string) =>
        l10n.t("The kernel failed to start as the module '{0}' could not be imported.", pythonModuleName);
    export const failedToStartKernelDueToImportFailureFromFile = (moduleName: string, fileName: string) =>
        l10n.t("The kernel failed to start as '{0}' could not be imported from '{1}'.", moduleName, fileName);
    export const failedToStartKernelDueToUnknownDllLoadFailure = l10n.t(
        'The kernel failed to start as a dll could not be loaded.'
    );
    export const failedToStartKernelDueToDllLoadFailure = (dllName: string) =>
        l10n.t("The kernel failed to start as the dll '{0}' could not be loaded.", dllName);
    export const failedToStartKernelDueToWin32APIFailure = l10n.t(
        'The kernel failed to start due to an error with the Win32api module. Consider (re) installing this module.'
    );
    export const failedToStartKernelDueToPyZmqFailure = l10n.t({
        message:
            "The kernel failed to start due to an error with the 'pyzmq' module. Consider re-installing this module.",
        comment: ['Do not translate the string "pyzmq" as that is a Python module.']
    });
    export const failedToStartKernelDueToOldIPython = l10n.t(
        'The kernel failed to start due to an outdated version of IPython. Consider updating this module to the latest version.'
    );
    export const failedToStartKernelDueToOldIPyKernel = l10n.t(
        'The kernel failed to start due to an outdated version of IPyKernel. Consider updating this module to the latest version.'
    );
    export const failedToStartKernelDueToMissingPythonEnv = (pythonEnvName: string) =>
        l10n.t(
            `The kernel failed to start as the Python Environment '{0}' is no longer available. Consider selecting another kernel or refreshing the list of Python Environments.`,
            pythonEnvName
        );
    export const matplotlibWidgetInsteadOfOther = l10n.t("'%matplotlib' widget works best inside of VS Code");
    export const matplotlibWidgetCodeActionTitle = l10n.t('More info');
    export const allowExtensionToUseJupyterKernelApi = (extensionLink: string, prompt: string) =>
        l10n.t(
            "Do you want to give the extension '{0}' access to the Jupyter Kernels? Clicking '{1}' would allow this extension to execute code against the Jupyter Kernels.",
            extensionLink,
            prompt
        );
    export const thanksForUsingJupyterKernelApiPleaseRegisterWithUs = l10n.t(
        'Thanks for trying the Jupyter API. Please file an issue on our repo to use this API in production. This would prevent us from breaking your extension when updating the API (as it is still a work in progress).'
    );
    export const activatingPythonEnvironment = (pythonEnvName: string) =>
        l10n.t("Activating Python Environment '{0}'", pythonEnvName);

    export const cellAtFormat = (filePath: string, lineNumber: number) => l10n.t('{0} Cell {1}', filePath, lineNumber);

    export const jupyterServerConsoleOutputChannel = l10n.t(`Jupyter Server Console`);

    export const kernelConsoleOutputChannel = (kernelName: string) => l10n.t(`{0} Kernel Console Output`, kernelName);
    export const webNotSupported = l10n.t(`Operation not supported in web version of Jupyter Extension.`);
    export const validationErrorMessageForRemoteUrlProtocolNeedsToBeHttpOrHttps = l10n.t('Has to be http(s)');
    export const pickRemoteKernelTitle = l10n.t('Select a Remote Kernel');
    export const pickRemoteKernelPlaceholder = l10n.t(`type to filter`);
    export const failedToInstallPythonExtension = l10n.t(`Failed to install the Python Extension.`);
    export const filesPossiblyOverridingPythonModulesMayHavePreventedKernelFromStarting = (files: string) =>
        l10n.t(
            'Some of the following files found in the working directory may have prevented the Kernel from starting. Consider renaming them.',
            files
        );
    export const listOfFilesWithLinksThatMightNeedToBeRenamed = (files: string) =>
        l10n.t('File(s): {0} might need to be renamed.', files);
    export const failedToGetVersionOfPandas = l10n.t('Failed to get version of Pandas to use the Data Viewer.');
    export const failedToInstallPandas = l10n.t('Failed to install Pandas to use the Data Viewer.');
    export const localKernelSpecs = l10n.t('Jupyter Kernel...');

    export const localPythonEnvironments = l10n.t('Python Environments...');
    export const UserJupyterServerUrlProviderDisplayName = l10n.t('Existing Jupyter Server...');
    export const UserJupyterServerUrlProviderDetail = l10n.t('Connect to an existing Jupyter Server');
    export const UserJupyterServerUrlAlreadyExistError = l10n.t('A Jupyter Server with this URL already exists');
    export const kernelPickerSelectKernelTitle = l10n.t('Select Kernel');
    export const kernelPickerSelectLocalKernelSpecTitle = l10n.t('Select a Jupyter Kernel');
    export const kernelPickerSelectPythonEnvironmentTitle = l10n.t('Select a Python Environment');
    export const kernelPickerSelectKernelFromRemoteTitle = (kernelProvider: string) =>
        l10n.t('Select a Kernel from {0}', kernelProvider);
    export const installPythonExtensionViaKernelPickerTitle = l10n.t('Install Python Extension');
    export const installPythonExtensionViaKernelPickerToolTip = l10n.t(
        'Python Extension is required to detect and use Python environments for the execution of code cells.'
    );
    export const installPythonQuickPickTitle = l10n.t('Install Python');
    export const installPythonQuickPickToolTip = l10n.t(
        'Python Environments not detected. Upon installation reload VS Code or refresh the list of Kernels.'
    );
    export const failedToFetchKernelSpecsRemoteErrorMessageForQuickPickLabel = l10n.t({
        message: '$(error) Unable to connect to the remote server',
        comment: 'Do not translate the string $(error) as that is a VS Code icon.'
    });
    export const failedToFetchKernelSpecsRemoteErrorMessageForQuickPickDetail = l10n.t(
        'Ensure the server is running and reachable.'
    );
    export const enterRemoteJupyterUrlsThroughTheKernelPicker = l10n.t(
        "Entering Remote Jupyter Urls through the command palette has been deprecated. Please use the option 'Select Another Kernel -> Existing Jupyter Server' in the Kernel Picker."
    );
}
export namespace WebViews {
    export const collapseSingle = l10n.t('Collapse');
    export const expandSingle = l10n.t('Expand');
    export const noRowsInDataViewer = l10n.t('No rows match current filter');
    export const sliceIndexError = l10n.t({
        message: 'Index {0} out of range for axis {1} with {2} elements',
        comment: ['Do not translate the strings {0}, {1} and {2} as they are variable names and will be replaced later']
    });
    export const sliceMismatchedAxesError = l10n.t({
        message: 'Expected {0} axes, got {1} in slice expression',
        comment: ['Do not translate the strings {0} and {2} as they are variable names and will be replaced later']
    });
    export const fetchingDataViewer = l10n.t('Fetching data ...');
    export const dataViewerHideFilters = l10n.t('Hide filters');
    export const dataViewerShowFilters = l10n.t('Show filters');
    export const refreshDataViewer = l10n.t('Refresh data viewer');
    export const sliceSummaryTitle = l10n.t('SLICING');
    export const sliceData = l10n.t('Slice Data');
    export const sliceSubmitButton = l10n.t('Apply');
    export const sliceDropdownAxisLabel = l10n.t('Axis');
    export const sliceDropdownIndexLabel = l10n.t('Index');
    export const variableExplorerNameColumn = l10n.t('Name');
    export const variableExplorerTypeColumn = l10n.t('Type');
    export const variableExplorerCountColumn = l10n.t('Size');
    export const variableExplorerValueColumn = l10n.t('Value');
    export const collapseVariableExplorerLabel = l10n.t('Variables');
    export const variableLoadingValue = l10n.t('Loading...');
    export const showDataExplorerTooltip = l10n.t('Show variable snapshot in data viewer');
    export const noRowsInVariableExplorer = l10n.t('No variables defined');
    export const loadingRowsInVariableExplorer = l10n.t('Loading variables');
    export const previousPlot = l10n.t('Previous');
    export const nextPlot = l10n.t('Next');
    export const panPlot = l10n.t('Pan');
    export const zoomInPlot = l10n.t('Zoom in');
    export const zoomOutPlot = l10n.t('Zoom out');
    export const exportPlot = l10n.t('Export to different formats');
    export const deletePlot = l10n.t('Remove');
    export const selectedImageListLabel = l10n.t('Selected Image');
    export const selectedImageLabel = l10n.t('Image');
    export const errorOutputExceedsLinkToOpenFormatString = l10n.t({
        message:
            'Output exceeds the <a href={0}>size limit</a>. Open the full output data <a href={1}>in a text editor</a>',
        comment: [
            'Do not translate the the Hyperlink text "<a href={0}>size limit</a>" and "<a href={1}>in a text editor</a>". However the text inside those tags can be translated'
        ]
    });
}

export namespace Deprecated {
    export const SHOW_DEPRECATED_FEATURE_PROMPT_FORMAT_ON_SAVE = l10n.t({
        message: "The setting 'python.formatting.formatOnSave' is deprecated, please use 'editor.formatOnSave'.",
        comment: [
            'Do not translate the string "python.formatting.formatOnSave" as that is a setting in VS Code',
            'Do not translate the string "editor.formatOnSave" as that is a setting in VS Code'
        ]
    });
    export const SHOW_DEPRECATED_FEATURE_PROMPT_LINT_ON_TEXT_CHANGE = l10n.t({
        message:
            "The setting 'python.linting.lintOnTextChange' is deprecated, please enable 'python.linting.lintOnSave' and 'files.autoSave'.",
        comment: [
            'Do not translate the string "python.linting.lintOnTextChange" as that is a setting in VS Code',
            'Do not translate the string "python.linting.lintOnSave" as that is a setting in VS Code'
        ]
    });
    export const SHOW_DEPRECATED_FEATURE_PROMPT_FOR_AUTO_COMPLETE_PRELOAD_MODULES = l10n.t({
        message:
            "The setting 'python.autoComplete.preloadModules' is deprecated, please consider using Pylance Language Server ('python.languageServer' setting).",
        comment: [
            'Do not translate the string "python.autoComplete.preloadModules" as that is a setting in VS Code',
            'Do not translate the string "python.languageServer" as that is a setting in VS Code'
        ]
    });
}

export namespace Installer {
    export const noCondaOrPipInstaller = l10n.t(
        'There is no Conda or Pip installer available in the selected environment.'
    );
    export const noPipInstaller = l10n.t('There is no Pip installer available in the selected environment.');
    export const searchForHelp = l10n.t('Search for help');
}

export namespace Products {
    export const installingModule = (moduleName: string) => l10n.t('Installing {0}', moduleName);
}
