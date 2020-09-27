// Experiment to check whether to always display the test explorer.
export enum AlwaysDisplayTestExplorerGroups {
    control = 'AlwaysDisplayTestExplorer - control',
    experiment = 'AlwaysDisplayTestExplorer - experiment'
}

// Experiment to check whether to show "Extension Survey prompt" or not.
export enum ShowExtensionSurveyPrompt {
    control = 'ShowExtensionSurveyPrompt - control',
    enabled = 'ShowExtensionSurveyPrompt - enabled'
}

// Experiment to check whether to enable re-load for web apps while debugging.
export enum WebAppReload {
    control = 'Reload - control',
    experiment = 'Reload - experiment'
}

// Experiment for supporting run by line in data science notebooks
export enum RunByLine {
    experiment = 'RunByLine'
}

/**
 * Experiment to check whether to to use a terminal to generate the environment variables of activated environments.
 *
 * @export
 * @enum {number}
 */
export enum UseTerminalToGetActivatedEnvVars {
    control = 'UseTerminalToGetActivatedEnvVars - control',
    experiment = 'UseTerminalToGetActivatedEnvVars - experiment'
}

// Dummy experiment added to validate metrics of A/B testing
export enum ValidateABTesting {
    control = 'AA_testing - control',
    experiment = 'AA_testing - experiment'
}

// Collect language server request timings.
export enum CollectLSRequestTiming {
    control = 'CollectLSRequestTiming - control',
    experiment = 'CollectLSRequestTiming - experiment'
}

// Collect Node language server request timings.
export enum CollectNodeLSRequestTiming {
    control = 'CollectNodeLSRequestTiming - control',
    experiment = 'CollectNodeLSRequestTiming - experiment'
}

/*
 * Experiment to turn on custom editor or VS Code Native Notebook API support.
 */
export enum NotebookEditorSupport {
    customEditorExperiment = 'CustomEditor',
    nativeNotebookExperiment = 'NativeNotebookEditor'
}

// Experiment to remove the Kernel/Server Tooblar in the Interactive Window when running a local Jupyter Server.
// It doesn't make sense to have it there, the user can already change the kernel
// by changing the python interpreter on the status bar.
export enum RemoveKernelToolbarInInteractiveWindow {
    experiment = 'RemoveKernelToolbarInInteractiveWindow'
}

// Experiment to offer switch to Pylance language server
export enum TryPylance {
    experiment = 'tryPylance'
}

// Experiment for the content of the tip being displayed on first extension launch:
// interpreter selection tip, feedback survey or nothing.
export enum SurveyAndInterpreterTipNotification {
    tipExperiment = 'pythonTipPromptWording',
    surveyExperiment = 'pythonMailingListPromptWording'
}

// Experiment to switch Jedi to use an LSP instead of direct providers
export enum JediLSP {
    experiment = 'jediLSP'
}
// Experiment to show a prompt asking users to join python mailing list.
export enum JoinMailingListPromptVariants {
    variant1 = 'pythonJoinMailingListVar1',
    variant2 = 'pythonJoinMailingListVar2',
    variant3 = 'pythonJoinMailingListVar3'
}
