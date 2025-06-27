---
mode: agent
tools: ['codebase', 'extensions', 'fetch', 'findTestFiles', 'githubRepo', 'search', 'searchResults', 'usages', 'vscodeAPI', 'websearch']
---
Read the contents of these pages https://code.visualstudio.com/docs/copilot/copilot-customization#_enable-instructions-and-prompt-files-in-vs-code, https://docs.github.com/en/enterprise-cloud@latest/copilot/how-tos/custom-instructions/adding-repository-custom-instructions-for-github-copilot?tool=webui and https://docs.github.com/en/enterprise-cloud@latest/copilot/how-tos/agents/copilot-coding-agent/best-practices-for-using-copilot-to-work-on-tasks

Review the structure of the file `.github/kernel-instructions.md`.

Basedon the structore of the contents in `.github/kernel-instructions.md`, I would like you to review the #codebase , specially the contents of `src/platform`.
Now create a file named `.github/instructions/platform.instructions.md` based on the above documentation:
Ensure the following information is in the documentation:
- The major components (names & files)
- How each component interacts with others
- Workflow for high level operations
- Any other relevant context you would notice or require to improve your work when attempting to make and/or add changes to some code (feature)
- The information should be presented in a way that would be useful to you and can reference in the future when you are working on issues, bugs or feature requests
