export async function openAndShowNotebook(file: Uri) {
    const nb = await this.vscodeNotebook.openNotebookDocument(file);
    await this.vscodeNotebook.showNotebookDocument(nb);
}
