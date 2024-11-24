const core = require('@actions/core');

const SCHEDULE_LABEL = 'merge-scheduled';

async function createComment(octokit, owner, repo, issueNumber, body) {
  try {
    await octokit.rest.issues.createComment({
      owner,
      repo,
      issue_number: issueNumber,
      body
    });
  } catch (error) {
    core.error('Error creating comment:');
    core.error(error);
    throw error;
  }
}

async function getLatestScheduleComment(octokit, owner, repo, prNumber) {
  try {
    const { data: comments } = await octokit.rest.issues.listComments({
      owner,
      repo,
      issue_number: prNumber,
      per_page: 100 // Increase if needed
    });

    return comments
      .reverse()
      .find(comment => comment.body.includes('@merge-at'));
  } catch (error) {
    core.error('Error getting latest schedule comment:');
    core.error(error);
    throw error;
  }
}

async function storeScheduleInfo(octokit, owner, repo, prNumber, scheduleDate, localTime, utcTime, timezone) {
  try {
    await octokit.rest.issues.addLabels({
      owner,
      repo,
      issue_number: prNumber,
      labels: [SCHEDULE_LABEL]
    });

    const scheduleInfo = {
      type: 'merge-schedule-info',
      scheduleDate: scheduleDate.toISOString()
    };

    const confirmationMessage = `<!-- MERGE_SCHEDULE_INFO ${JSON.stringify(scheduleInfo)} -->

📅 PR merge scheduled for:
• ${localTime} ${timezone}
• ${utcTime} UTC

I'll merge this PR at the scheduled time if it's mergeable.
To cancel, comment: @merge-at cancel`;

    await createComment(octokit, owner, repo, prNumber, confirmationMessage);
  } catch (error) {
    core.error('Error storing schedule info:');
    core.error(error);
    throw error;
  }
}

async function removeScheduleInfo(octokit, owner, repo, prNumber) {
  try {
    try {
      await octokit.rest.issues.removeLabel({
        owner,
        repo,
        issue_number: prNumber,
        name: SCHEDULE_LABEL
      });
    } catch (error) {
      // Ignore if label doesn't exist (404 error)
      if (error.status !== 404) {
        throw error;
      }
    }

    const { data: comments } = await octokit.rest.issues.listComments({
      owner,
      repo,
      issue_number: prNumber,
      per_page: 100
    });

    const scheduleComments = comments.filter(comment => 
      comment.body.includes('MERGE_SCHEDULE_INFO')
    );

    for (const comment of scheduleComments) {
      await octokit.rest.issues.deleteComment({
        owner,
        repo,
        comment_id: comment.id
      });
    }
  } catch (error) {
    core.error('Error removing schedule info:');
    core.error(error);
    throw error;
  }
}

async function getScheduledPRs(octokit) {
  try {
    const scheduledPRs = [];

    const query = `is:pr is:open label:${SCHEDULE_LABEL}`;
    const { data: { items } } = await octokit.rest.search.issuesAndPullRequests({
      q: query,
      per_page: 100
    });

    for (const item of items) {
      try {
        // Handle malformed repository URLs
        if (!item.repository_url || typeof item.repository_url !== 'string') {
          core.error(`Invalid repository URL for PR #${item.number}`);
          continue;
        }

        const urlParts = item.repository_url.split('/');
        if (urlParts.length < 2) {
          core.error(`Malformed repository URL for PR #${item.number}`);
          continue;
        }

        const [owner, repo] = urlParts.slice(-2);

        const { data: comments } = await octokit.rest.issues.listComments({
          owner,
          repo,
          issue_number: item.number,
          per_page: 100
        });

        const scheduleComment = comments.find(comment =>
          comment.body.includes('MERGE_SCHEDULE_INFO')
        );

        if (scheduleComment) {
          try {
            const match = scheduleComment.body.match(/MERGE_SCHEDULE_INFO (.+) -->/);
            if (match) {
              const scheduleInfo = JSON.parse(match[1]);
              const scheduleTime = new Date(scheduleInfo.scheduleDate);

              // Validate the date
              if (isNaN(scheduleTime.getTime())) {
                core.error(`Invalid schedule date for PR #${item.number}`);
                continue;
              }

              scheduledPRs.push({
                owner,
                repo,
                number: item.number,
                scheduleTime
              });
            }
          } catch (error) {
            core.error(`Error parsing schedule info for PR #${item.number}:`, error);
          }
        }
      } catch (error) {
        core.error(`Error processing PR #${item.number}:`, error);
      }
    }

    return scheduledPRs;
  } catch (error) {
    core.error('Error getting scheduled PRs:');
    core.error(error);
    throw error;
  }
}

module.exports = {
  createComment,
  getLatestScheduleComment,
  getScheduledPRs,
  storeScheduleInfo,
  removeScheduleInfo,
  SCHEDULE_LABEL
};

