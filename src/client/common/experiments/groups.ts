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

// Experiment to show a prompt asking users to join python mailing list.
export enum JoinMailingListPromptVariants {
    variant1 = 'pythonJoinMailingListVar1',
    variant2 = 'pythonJoinMailingListVar2',
    variant3 = 'pythonJoinMailingListVar3'
}
