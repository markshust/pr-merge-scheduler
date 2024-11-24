const core = require('@actions/core');
const github = require('@actions/github');
const { zonedTimeToUtc, utcToZonedTime } = require('date-fns-tz');
const { format, isValid, addDays } = require('date-fns');
const { createComment, storeScheduleInfo, removeScheduleInfo } = require('./utils');

const COMMAND_REGEX = /@merge-at\s+(\d{4}-\d{2}-\d{2}\s+\d{1,2}:\d{2}(?:\s*(?:AM|PM|am|pm))?)\s*([\w/]+)?/;
const CANCEL_COMMAND = '@merge-at cancel';

async function hasWritePermission(octokit, owner, repo, username) {
  try {
    const { data: permission } = await octokit.rest.repos.getCollaboratorPermissionLevel({
      owner,
      repo,
      username
    });

    // Users need admin or write permission to merge PRs
    return ['admin', 'write'].includes(permission.permission);
  } catch (error) {
    // If we can't get permissions, assume no access
    return false;
  }
}

async function validateScheduleTime(dateStr, timezone = 'UTC') {
  try {
    let date;
    const parsedDate = dateStr.trim();

    // Split into date and time parts (now handles multiple spaces)
    const [datePart, ...timeParts] = parsedDate.split(/\s+/);
    const timeWithMeridiem = timeParts.join(' ');

    if (!datePart || !timeWithMeridiem) {
      throw new Error('Date and time must be provided');
    }

    // Remove any spaces and parse time components
    const timeStr = timeWithMeridiem.replace(/\s+/g, '').toUpperCase();
    const timeMatch = timeStr.match(/^(\d{1,2}):(\d{2})(AM|PM)?$/i);

    if (!timeMatch) {
      throw new Error('Invalid time format');
    }

    const [, hours, minutes, meridiem] = timeMatch;
    const parsedHours = parseInt(hours, 10);
    const parsedMinutes = parseInt(minutes, 10);

    if (meridiem) {
      // 12-hour format validation
      if (parsedHours < 1 || parsedHours > 12 || parsedMinutes < 0 || parsedMinutes > 59) {
        throw new Error('Invalid time format');
      }

      let hour24 = parsedHours;
      const isPM = meridiem.toUpperCase() === 'PM';

      if (isPM && parsedHours !== 12) {
        hour24 += 12;
      } else if (!isPM && parsedHours === 12) {
        hour24 = 0;
      }

      const time24 = `${hour24.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
      date = zonedTimeToUtc(`${datePart} ${time24}`, timezone);
    } else {
      // 24-hour format validation
      if (parsedHours < 0 || parsedHours > 23 || parsedMinutes < 0 || parsedMinutes > 59) {
        throw new Error('Invalid time format');
      }
      date = zonedTimeToUtc(`${datePart} ${hours.padStart(2, '0')}:${minutes.padStart(2, '0')}`, timezone);
    }

    if (!isValid(date)) {
      throw new Error('Invalid date format');
    }

    const now = new Date();
    if (date <= now) {
      throw new Error('Scheduled time must be in the future');
    }

    const maxDate = addDays(now, 30);
    if (date > maxDate) {
      throw new Error('Cannot schedule more than 30 days in advance');
    }

    return date;
  } catch (error) {
    throw new Error(`Invalid date/time format: ${error.message}`);
  }
}

async function handleComment(token, repository, prNumber, commentBody) {
  const octokit = github.getOctokit(token);
  const [owner, repo] = repository.split('/');

  try {
    // Get comment author
    const { data: comment } = await octokit.rest.issues.getComment({
      owner,
      repo,
      comment_id: github.context.payload.comment.id
    });

    const commentAuthor = comment.user.login;

    // Check if user has permission to merge PRs
    const hasPermission = await hasWritePermission(octokit, owner, repo, commentAuthor);

    if (!hasPermission) {
      await createComment(octokit, owner, repo, prNumber,
        '❌ Only users with write permission can schedule PR merges.');
      return;
    }

    // Handle cancellation
    if (commentBody.includes(CANCEL_COMMAND)) {
      await removeScheduleInfo(octokit, owner, repo, prNumber);
      await createComment(octokit, owner, repo, prNumber,
        '🚫 Scheduled merge has been cancelled.');
      return;
    }

    // Parse command
    const match = COMMAND_REGEX.exec(commentBody);
    if (!match) {
      await createComment(octokit, owner, repo, prNumber,
        '❌ Invalid command format. Please use: @merge-at YYYY-MM-DD HH:mm[am|pm] [timezone]');
      return;
    }

    const [, dateTimeStr, timezone = 'UTC'] = match;

    try {
      const scheduleDate = await validateScheduleTime(dateTimeStr, timezone);

      // Format times for the message
      const localTime = format(utcToZonedTime(scheduleDate, timezone),
        'yyyy-MM-dd hh:mm a');
      const utcTime = format(scheduleDate, 'yyyy-MM-dd HH:mm');

      // Remove any existing schedule
      await removeScheduleInfo(octokit, owner, repo, prNumber);

      // Store schedule info and create the comment
      await storeScheduleInfo(
        octokit,
        owner,
        repo,
        prNumber,
        scheduleDate,
        localTime,
        utcTime,
        timezone
      );

    } catch (error) {
      await createComment(octokit, owner, repo, prNumber,
        `❌ ${error.message}`);
    }
  } catch (error) {
    core.error('Error handling comment:');
    core.error(error);
    await createComment(octokit, owner, repo, prNumber,
      '❌ An error occurred while processing your command. Please try again.');
  }
}

module.exports = {
  handleComment,
  validateScheduleTime,
  hasWritePermission
};
