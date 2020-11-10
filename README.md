# Jupyter Extension for Visual Studio Code Insiders

A [Visual Studio Code Insiders](https://code.visualstudio.com/insiders/) [extension](https://marketplace.visualstudio.com/VSCode) with support for [Jupyter Notebooks](https://www.python.org/) (working towards supporting all [actively supported kernels](https://github.com/jupyter/jupyter/wiki/Jupyter-kernels)), including features such as IntelliSense, debugging, and more!

\*If working in VS Code Stable, please see the [Python Extension ReadMe](https://github.com/microsoft/vscode-python/blob/main/README.md) or the [Python Documentation](https://code.visualstudio.com/docs/python/jupyter-support).

## Quick start

-   **Step 1.** Install [VS Code Insiders](https://code.visualstudio.com/insiders/)

-   **Step 2.** Install the [Jupyter Extension](https://code.visualstudio.com/docs/python/python-tutorial#_prerequisites) in VS Code Insiders - CHANGE ME

-   **Step 2.1** If you are interested in using Python, we recommend you install the [Python Extension](https://marketplace.visualstudio.com/items?itemName=ms-python.python) instead.
-   **Step 3.** Make sure you have a kernel specification that corresponds to the language you would like to use installed on Jupyter on your machine.
-   **Step 4.** Open or create a notebook file and start coding!

## Set up your environment

<!-- use less words -->

- To create a new notebook open the command palette (Windows: Ctrl + Shift + P, iOS: Command + Shift + P) and select the command `"Jupyter: Create New Blank Jupyter Notebook"`

     <img src=https://raw.githubusercontent.com/microsoft/vscode-jupyter/main/images/Jupyter%20README/CreateNewNotebook.png>

- Select your kernel by clicking on the kernel picker in the bottom right of the status bar or by envoking the `"Notebook: Select Notebook Kernel"` command.

     <img src=https://raw.githubusercontent.com/microsoft/vscode-jupyter/main/images/Jupyter%20README/KernelPicker.gif?>

- Change the cell language by clicking the language picker or by invoking the `"Notebook: Change Cell Language"` command.

     <img src=https://raw.githubusercontent.com/microsoft/vscode-jupyter/main/images/Jupyter%20README/LanguagePicker.gif?>

To use the latest version of the extension:

-   Set the "jupyter.insidersChannel" setting to "daily" or "weekly" based on how often you would like the extension to check for updates

## Useful commands

Open the Command Palette (Command+Shift+P on macOS and Ctrl+Shift+P on Windows/Linux) and type in one of the following commands:

| Command                               | Description                                                                                                                                                    |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Jupyter: Create New Blank Jupyter Notebook`| Create a new blank Jupyter Notebook   |
| `Notebook: Select Notebook Kernel`        | Select or switch kernels within your notebook|
| `Notebook: Change Cell Language`        | Change the language of the cell currently in focus |
| `Jupyter: Export to HTML Jupyter: Export to PDF` | Create a presentation-friendly version of your notebook in HTML or PDF

To see all available Jupyter Notebook commands, open the Command Palette and type `Jupyter` or `Notebook`.

## Feature details

Learn more about the rich features of the Jupyter extension:

-   [IntelliSense](https://code.visualstudio.com/docs/python/editing#_autocomplete-and-intellisense): Edit your code with auto-completion, code navigation, syntax checking and more

-   [Debugging](https://code.visualstudio.com/docs/python/debugging): Debug your Jupyter Notebooks with the Interactive Window experience.

-   [Jupyter Notebooks](https://code.visualstudio.com/docs/python/jupyter-support): Create and edit Jupyter Notebooks, add and run code cells, render plots, visualize variables through the variable explorer, visualize dataframes with the data viewer, and more

-   [Environments](https://code.visualstudio.com/docs/python/environments): Automatically activate and switch between virtualenv, venv, pipenv, conda and pyenv environments

## Supported locales

The extension is available in multiple languages: `de`, `en`, `es`, `fa`, `fr`, `it`, `ja`, `ko-kr`, `nl`, `pl`, `pt-br`, `ru`, `tr`, `zh-cn`, `zh-tw`

## Questions, issues, feature requests, and contributions

-   If you have a question about how to accomplish something with the extension, please [ask on Stack Overflow](https://stackoverflow.com/questions/tagged/visual-studio-code+jupyter).
-   Any and all feedback is appreciated and welcome! If you come across a problem with the extension, please [file an issue](https://github.com/microsoft/vscode-jupyter).
      - If someone has already [filed an issue](https://github.com/Microsoft/vscode-jupyter) that encompasses your feedback, please leave a 👍/👎 reaction on the issue.

- Contributions are always welcome! Please see our [contributing guide](https://github.com/Microsoft/vscode-jupyter/blob/main/CONTRIBUTING.md) for more details.

-   If you're interested in the development of the extension, you can read about our [development process](https://github.com/Microsoft/vscode-jupyter/blob/main/CONTRIBUTING.md#development-process)

## Data and telemetry

The Microsoft Jupyter Extension for Visual Studio Code collects usage
data and sends it to Microsoft to help improve our products and
services. Read our
[privacy statement](https://privacy.microsoft.com/privacystatement) to
learn more. This extension respects the `telemetry.enableTelemetry`
setting which you can learn more about at
https://code.visualstudio.com/docs/supporting/faq#_how-to-disable-telemetry-reporting.
