---
mode: agent
tools: ['codebase', 'editFiles', 'extensions', 'fetch', 'findTestFiles', 'githubRepo', 'search', 'searchResults', 'usages', 'vscodeAPI', 'github', 'get_file_contents', 'get_issue', 'get_issue_comments', 'list_issues', 'list_pull_requests', 'search_code', 'search_issues', 'pylance mcp server', 'activePullRequest', 'websearch']
---
Now review the issue reported in https://github.com/microsoft/vscode-jupyter/issues/16709

Based on your initial review of the above issue, determine the area within the application this relates to and read the contents of the most relevant instruction file to get a detailed understanding of the code base (feature area):
- .github/instructions/platform.instructions.md
- .github/instructions/kernel-jupyter.instructions.md
- .github/instructions/kernel.instructions.md
- .github/instructions/notebooks.instructions.md
- .github/instructions/interactiveWindow.instructions.md
- .github/instructions/standalone.instructions.md

Now that you have a better understanding of the code please provide a detailed report of your findings, including:
  - The area of the code base that is affected
  - The specific files or components that are involved
  - Any relevant code snippets or patterns that are related to the issue
  - Any potential solutions or fixes that could be applied
  - DO NOT make any code changes at this time, just provide a detailed report.

Note:
- If required update any of the `.github/instructions/*.instructions.md` file (or create a new file in `.github/instructions/`) with any new insights or information gathered during the investigation. Only do so if it adds value to the existing instructions and help you.
- Do not blindly overwrite the file, patch/merge the file with the new information.
