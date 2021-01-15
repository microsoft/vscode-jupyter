const core = require('@actions/core');
const github = require('@actions/github');
const octokit = require('@octokit/core');
const plugin = require('@octokit/plugin-paginate-rest');
const webhooks = require('@octokit/webhooks');

async function run() {
    try {
        // Get the eslint configuration
        const eslintjrc = require('../../../.eslintrc.js');

        // Get the list of changed files
        if (github.context.eventName === 'pull_request') {
            const payload = github.context.payload;
            const MyOctokit = octokit.Octokit.plugin(plugin.paginateRest);
            const caller = new MyOctokit();
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
            // Make sure the changed files are not in the ignore list
            core.debug('Changed Files:');
            core.debug(changedFiles.join('\n'));
        }
    } catch (error) {
        core.setFailed(error.message);
    }
}

run();
