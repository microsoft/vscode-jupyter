---
mode: agent
tools: ['codebase', 'editFiles', 'extensions', 'fetch', 'findTestFiles', 'githubRepo', 'search', 'searchResults', 'usages', 'vscodeAPI', 'github', 'activePullRequest', 'websearch']
---
Now review the issue reported in https://github.com/microsoft/vscode-jupyter/issues/16709

Based on your initial review of the above issue, pick an area and read the contents of the most relevant instruction file to get a detailed understanding of the code base (feature area):
- .github/copilot-instructions.md
- .github/instructions/interactiveWindow.instructions.md
- .github/instructions/kernel-jupyter.instructions.md
- .github/instructions/kernel.instructions.md
- .github/instructions/notebooks.instructions.md
- .github/instructions/platform.instructions.md
- .github/instructions/standalone.instructions.md

Now that you have a better understanding of the code:
- Analyze the details of the reported issue
- Determine the root cause of the issue if possible
- Do not make any changes yet

Note:
- Finally at the end, update any of the `.github/instructions/*.instructions.md` file with any new insights or information gathered during the investigation.
- Do not blindly overwrite the file, patch/merge the file with the new information.
- If required create a new file in `.github/instructions/` with the new information, retaining the structure of existing files in the same directory.
