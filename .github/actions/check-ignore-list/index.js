const core = require('@actions/core');
const github = require('@actions/github');
const octokit = require('@octokit/core');
const plugin = require('@octokit/plugin-paginate-rest');
const webhooks = require('@octokit/webhooks');

async function getChangedFiles() {
    const payload = github.context.payload;
    const MyOctokit = octokit.Octokit.plugin(plugin.paginateRest);
    const caller = new MyOctokit();
    if (github.context.eventName === 'pull_request') {
        const changedFiles = await caller.paginate(
            'GET /repos/{owner}/{repo}/pulls/{pull_number}/files',
            {
                owner: payload.repository.owner.login,
                repo: payload.repository.name,
                pull_number: payload.pull_request.number,
                per_page: 100
            },
            (response) => response.data.map((fileData) => fileData.filename)
        );
        return changedFiles;
    } else if (github.context.eventName === 'push') {
        const changedFiles = await caller.paginate(
            'GET /repos/{owner}/{repo}/commits/{ref}',
            {
                owner: payload.repository.owner.login,
                repo: payload.repository.name,
                ref: payload.after,
                per_page: 100
            },
            (response) => response.data.files.map((fileData) => fileData.filename)
        );
        return changedFiles;
    } else {
        return [];
    }
}

async function run() {
    core.debug('Running ignore checker ...');
    try {
        // Get the eslint configuration
        const eslintjrc = require('../../../.eslintrc.js');

        // Get the list of changed files
        const changedFiles = await getChangedFiles();

        // Compare this against the ignored files
        const ignoredFiles = eslintjrc.ignorePatterns;
        // Ignore changes to test extension code.
        const intersection = ignoredFiles.filter((v) => changedFiles.includes(v) && !v.includes('ms-ai-tools-test'));

        if (intersection && intersection.length > 0) {
            core.setFailed(`Files are being ignored that should be linted: ${intersection.join('\n')}`);
        }
    } catch (error) {
        core.setFailed(error.message);
    } finally {
        core.debug('Finished.');
    }
}

run();
