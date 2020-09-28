// Experiment for supporting run by line in data science notebooks
export enum RunByLine {
    experiment = 'RunByLine'
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
// Experiment to show a prompt asking users to join python mailing list.
export enum JoinMailingListPromptVariants {
    variant1 = 'pythonJoinMailingListVar1',
    variant2 = 'pythonJoinMailingListVar2',
    variant3 = 'pythonJoinMailingListVar3'
}
