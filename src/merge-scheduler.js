const core = require('@actions/core');
const github = require('@actions/github');
const { createComment, removeScheduleInfo, getScheduledPRs } = require('./utils');

async function mergePR(octokit, owner, repo, prNumber) {
  try {
    // Check if PR is mergeable
    try {
      const { data: pr } = await octokit.rest.pulls.get({
        owner,
        repo,
        pull_number: prNumber
      });

      core.info(`Checking mergability for PR #${prNumber}`);
      core.debug(`PR Status - Mergeable: ${pr.mergeable}, State: ${pr.mergeable_state}`);

      if (!pr.mergeable) {
        const error = new Error('PR is not mergeable. There might be conflicts.');
        await createComment(octokit, owner, repo, prNumber,
          `❌ Failed to merge PR: ${error.message}`);
        throw error;
      }
    } catch (error) {
      if (error.status === 404) {
        const notFoundError = new Error('PR not found or you may not have permission to merge.');
        await createComment(octokit, owner, repo, prNumber,
          `❌ Failed to merge PR: ${notFoundError.message}`);
        throw notFoundError;
      }
      throw error;
    }

    // Attempt to merge
    try {
      core.info(`Attempting to merge PR #${prNumber}`);

      await octokit.rest.pulls.merge({
        owner,
        repo,
        pull_number: prNumber,
        merge_method: 'squash'
      });

      core.info(`Successfully merged PR #${prNumber}`);

      await createComment(octokit, owner, repo, prNumber,
        '✅ Successfully merged as scheduled!');

      // Clean up schedule info after successful merge
      await removeScheduleInfo(octokit, owner, repo, prNumber);
      core.info(`Cleaned up schedule info for PR #${prNumber}`);
    } catch (mergeError) {
      let errorMessage = 'Failed to merge PR: ';

      if (mergeError.status === 405) {
        errorMessage += 'PR is not mergeable at this time. Please resolve any conflicts or check branch protection rules.';
      } else if (mergeError.status === 404) {
        errorMessage += 'PR not found or you may not have permission to merge.';
      } else {
        errorMessage += mergeError.message || 'An unexpected error occurred.';
      }

      core.error(`Merge failed for PR #${prNumber}: ${errorMessage}`);
      await createComment(octokit, owner, repo, prNumber, `❌ ${errorMessage}`);
      throw new Error(errorMessage);
    }
  } catch (error) {
    core.error(`Error processing PR #${prNumber}:`);
    core.error(error);
    if (!error.message.includes('Failed to merge PR')) {
      await createComment(octokit, owner, repo, prNumber,
        `❌ Failed to merge PR: ${error.message}`);
    }
    throw error;
  }
}

async function processScheduledMerges(token) {
  try {
    const octokit = github.getOctokit(token);
    const scheduledPRs = await getScheduledPRs(octokit);

    core.info(`Found ${scheduledPRs.length} scheduled PRs`); // Changed from debug to info

    const now = new Date();
    core.info(`Current time: ${now.toISOString()}`);

    for (const pr of scheduledPRs) {
      try {
        core.info(`Processing PR #${pr.number}`);
        core.info(`→ Owner: ${pr.owner}`);
        core.info(`→ Repo: ${pr.repo}`);
        core.info(`→ Scheduled for: ${pr.scheduleTime}`);

        const scheduleTime = new Date(pr.scheduleTime);

        if (scheduleTime <= now) {
          core.info(`Time to merge PR #${pr.number}`);
          core.info(`→ Scheduled: ${scheduleTime.toISOString()}`);
          core.info(`→ Current: ${now.toISOString()}`);

          try {
            await mergePR(octokit, pr.owner, pr.repo, pr.number);
            core.info(`Successfully processed PR #${pr.number}`);
          } catch (mergeError) {
            core.error(`Failed to merge PR #${pr.number}:`);
            core.error(mergeError);
            // Continue to next PR
          }
        } else {
          core.info(`PR #${pr.number} is scheduled for future execution`);
          core.info(`→ Waiting time: ${Math.round((scheduleTime - now) / 1000 / 60)} minutes`);
        }
      } catch (prError) {
        core.error(`Error processing PR #${pr.number}:`);
        core.error(prError);
        // Continue to next PR
      }
    }

    core.info('Completed processing scheduled merges');
  } catch (error) {
    core.error('Failed to process scheduled merges:');
    core.error(error);
    throw error;
  }
}

module.exports = {
  mergePR,
  processScheduledMerges
};
