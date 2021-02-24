# Jupyter Extension for Visual Studio Code

A [Visual Studio Code](https://code.visualstudio.com/) [extension](https://marketplace.visualstudio.com/items?itemName=ms-toolsai.jupyter) that provides basic notebook support for [language kernels](https://github.com/jupyter/jupyter/wiki/Jupyter-kernels) that are supported in [Jupyter Notebooks](https://jupyter.org/) today. Many language kernels will work with no modification. To enable advanced features, modifications may be needed in the VS Code language extensions.


## Working with Python

Whether you are on VS Code Stable or VS Code Insiders, if you would like to work with Python just make sure you're using the latest version of the [Python Extension](https://marketplace.visualstudio.com/items?itemName=ms-python.python) to enjoy the joint partnership of the Python and Juypter Extensions.

Please follow the [Python Extension ReadMe](https://github.com/microsoft/vscode-python/blob/main/README.md) instructions to get started and visit the [Python Documentation](https://code.visualstudio.com/docs/python/jupyter-support) to learn more about how the Python and Jupyter Extension are working together to provide an optimum Python notebooks experience.

## Working with other Languages

The Jupyter Extension supports other languages in addition to Python such as Julia, R, and C# in VS Code Insiders with our latest Native VS Code Notebooks Experience!

### Quick Start

-   **Step 1.** Install [VS Code Insiders](https://code.visualstudio.com/insiders/)

-   **Step 2** If not working with Python, make sure to have a Jupyter kernelspec that corresponds to the language you would like to use installed on your machine.

-   **Step 3.** Install the [Jupyter Extension](https://marketplace.visualstudio.com/items?itemName=ms-toolsai.jupyter)

-   **Step 4.** Open or create a notebook file and start coding!

- **Special Note:**  The Jupyter Extension in VS Code Insiders will include our Native Notebooks experience by default. Because we are running in VS Code Insiders and this build is updated every day, there may be times when our extension may fail to work at all. We do attempt to ensure that this doesn't happen frequently. If it does, we strive to provide an updated extension build by the next business day. However, if you'd like to opt out of the native experience while working in VS Code Insiders:
    - Open the command palette (Windows: Ctrl + Shift + P, iOS: Command + Shift + P) and select "Preferences: Open Settings (JSON)"
    - Add the following code to your JSON settings:
     `"jupyter.experiments.optOutFrom": ["NativeNotebookEditor"],`

## Notebooks Quick Start

- To create a new notebook open the command palette (Windows: Ctrl + Shift + P, iOS: Command + Shift + P) and select the command `"Jupyter: Create New Blank Notebook"`

     <img src=https://raw.githubusercontent.com/microsoft/vscode-jupyter/main/images/Jupyter%20README/CreateNewNotebook.png>

- Select your kernel by clicking on the kernel picker in the bottom right of the status bar or by invoking the `"Notebook: Select Notebook Kernel"` command.

     <img src=https://raw.githubusercontent.com/microsoft/vscode-jupyter/main/images/Jupyter%20README/KernelPicker.gif?>

- Change the cell language by clicking the language picker or by invoking the `"Notebook: Change Cell Language"` command.

     <img src=https://raw.githubusercontent.com/microsoft/vscode-jupyter/main/images/Jupyter%20README/LanguagePicker.gif?>



## Useful commands

Open the Command Palette (Command+Shift+P on macOS and Ctrl+Shift+P on Windows/Linux) and type in one of the following commands:

| Command                               | Description                                                                                                                                                    |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Jupyter: Create New Blank Notebook`| Create a new blank Jupyter Notebook   |
| `Notebook: Select Notebook Kernel`        | Select or switch kernels within your notebook|
| `Notebook: Change Cell Language`        | Change the language of the cell currently in focus |
| `Jupyter: Export to HTML Jupyter: Export to PDF` | Create a presentation-friendly version of your notebook in HTML or PDF

To see all available Jupyter Notebook commands, open the Command Palette and type `Jupyter` or `Notebook`.

## Feature details

Learn more about the rich features of the Jupyter extension:

-   [IntelliSense](https://code.visualstudio.com/docs/python/editing#_autocomplete-and-intellisense): Edit your code with auto-completion, code navigation, syntax checking and more!
     - *May be limited due to kernelspec of choice*

-   [Jupyter Notebooks](https://code.visualstudio.com/docs/python/jupyter-support): Create and edit Jupyter Notebooks, add and run code/markdown cells, render plots, create presentation-friendly versions of your notebook by exporting to HTML or PDF and more!


## Supported locales

The extension is available in multiple languages: `de`, `en`, `es`, `fa`, `fr`, `it`, `ja`, `ko-kr`, `nl`, `pl`, `pt-br`, `ru`, `tr`, `zh-cn`, `zh-tw`

## Questions, issues, feature requests, and contributions

-   If you have a question about how to accomplish something with the extension, please [ask on Stack Overflow](https://stackoverflow.com/questions/tagged/visual-studio-code+jupyter). Our [wiki](https://github.com/microsoft/vscode-jupyter/wiki) is also updated periodically with useful information.
-   Any and all feedback is appreciated and welcome! If you come across a problem with the extension, please [file an issue](https://github.com/microsoft/vscode-jupyter).
      - If someone has already [filed an issue](https://github.com/Microsoft/vscode-jupyter) that encompasses your feedback, please leave a 👍/👎 reaction on the issue.

- Contributions are always welcome! Please see our [contributing guide](https://github.com/Microsoft/vscode-jupyter/blob/main/CONTRIBUTING.md) for more details.

-   If you're interested in the development of the extension, you can read about our [development process](https://github.com/microsoft/vscode-jupyter/blob/main/CONTRIBUTING.md#development-process)

## Data and telemetry

The Microsoft Jupyter Extension for Visual Studio Code collects usage
data and sends it to Microsoft to help improve our products and
services. Read our
[privacy statement](https://privacy.microsoft.com/privacystatement) to
learn more. This extension respects the `telemetry.enableTelemetry`
setting which you can learn more about at
https://code.visualstudio.com/docs/supporting/faq#_how-to-disable-telemetry-reporting.
