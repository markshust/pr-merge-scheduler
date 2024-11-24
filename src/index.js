const core = require('@actions/core');
const { handleComment } = require('./comment-handler');
const { processScheduledMerges } = require('./merge-scheduler');

async function run() {
  try {
    const mode = core.getInput('mode');
    const token = core.getInput('github-token');

    if (mode === 'comment') {
      const commentBody = core.getInput('comment-body');
      const prNumber = parseInt(core.getInput('pr-number'), 10);
      const repository = core.getInput('repository');

      if (!commentBody || !prNumber || !repository) {
        throw new Error('Missing required inputs for comment handling');
      }

      await handleComment(token, repository, prNumber, commentBody);
    } else if (mode === 'scheduler') {
      await processScheduledMerges(token);
    } else {
      throw new Error(`Invalid mode: ${mode}`);
    }
  } catch (error) {
    core.setFailed(`Action failed: ${error.message}`);
    if (error.stack) {
      core.debug(error.stack);
    }
  }
}

run();

