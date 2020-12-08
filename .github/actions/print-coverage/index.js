const core = require('@actions/core');
const github = require('@actions/github');

async function main() {
    const githubToken = core.getInput('github_token');
    const commit = core.getInput('commit');

    const pullRequest = github.context.payload.pull_request;
    const link = (pullRequest && pullRequest.html_url) || github.context.ref;
    const conclusion = 'failure';
    const status = 'completed';
    const head_sha = commit || (pullRequest && pullRequest.head.sha) || github.context.sha;
    core.info(`Posting status '${status}' with conclusion '${conclusion}' to ${link} (sha: ${head_sha})`);
    const testAnnotation = {
        path: 'package.json',
        start_line: 0,
        end_line: 0,
        start_column: 0,
        end_column: 0,
        annotation_level: 'notice',
        title: 'Test Annotation',
        message: 'You rocked it'
    };

    const createCheckRequest = {
        ...github.context.repo,
        name: 'Test print-coverage',
        head_sha,
        status,
        conclusion,
        output: {
            title: 'title',
            summary: '',
            annotations: [testAnnotation]
        }
    };

    core.debug(JSON.stringify(createCheckRequest, null, 2));

    // make conclusion consumable by downstream actions
    core.setOutput('conclusion', conclusion);

    const octokit = github.getOctokit(githubToken);
    await octokit.checks.create(createCheckRequest);
}

main().catch(function (err) {
    console.log(err);
    core.setFailed(err.message);
});
