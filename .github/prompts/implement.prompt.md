---
mode: agent
description: Executed after a plan has been created to implement a bug fix or feature request.
tools: ['codebase', 'editFiles', 'fetch', 'findTestFiles', 'githubRepo', 'problems', 'runTasks', 'runTests', 'search', 'searchResults', 'terminalLastCommand', 'terminalSelection', 'testFailure', 'usages', 'vscodeAPI', 'github', 'get_file_contents', 'get_issue', 'get_issue_comments', 'list_issues', 'list_pull_requests', 'search_code', 'search_issues', 'memory', 'sequentialthinking', 'activePullRequest', 'copilotCodingAgent', 'websearch']
---
You are a vscode-jupyter codebase expert.
Your task is to now implement the solution.

<reminder>
MUST:
- Adhere to patterns and best practices of the project
- Add required tests to ensure the fix works
- Run unit tests using the command `npm run test:unittests`
</reminder>

