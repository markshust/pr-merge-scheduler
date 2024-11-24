const { validateScheduleTime, handleComment, hasWritePermission } = require('../src/comment-handler');
const github = require('@actions/github');
const { createComment, removeScheduleInfo, storeScheduleInfo } = require('../src/utils');

// Mock @actions/core
jest.mock('@actions/core', () => ({
  error: jest.fn(),
  debug: jest.fn()
}));

// Mock @actions/github
jest.mock('@actions/github', () => ({
  getOctokit: jest.fn(),
  context: {
    payload: {
      comment: {
        id: 'test-comment-id'
      }
    }
  }
}));

// Mock utils
jest.mock('../src/utils', () => ({
  createComment: jest.fn(),
  removeScheduleInfo: jest.fn(),
  storeScheduleInfo: jest.fn()
}));

describe('validateScheduleTime', () => {
  let originalDate;

  beforeEach(() => {
    // Mock current date to 2024-01-01 12:00:00 UTC
    originalDate = Date.now;
    const mockDate = new Date('2024-01-01T12:00:00Z');
    global.Date.now = jest.fn(() => mockDate.getTime());
    global.Date = class extends Date {
      constructor(...args) {
        if (args.length) {
          return super(...args);
        }
        return mockDate;
      }
    };
  });

  afterEach(() => {
    // Restore original Date
    global.Date = Date;
    global.Date.now = originalDate;
  });

  // 12-hour format tests
  test('accepts 12-hour format with PM attached', async () => {
    const result = await validateScheduleTime('2024-01-02 02:30PM', 'UTC');
    expect(result.toISOString()).toBe('2024-01-02T14:30:00.000Z');
  });

  test('accepts 12-hour format with PM and space', async () => {
    const result = await validateScheduleTime('2024-01-02 02:30 PM', 'UTC');
    expect(result.toISOString()).toBe('2024-01-02T14:30:00.000Z');
  });

  test('accepts 12-hour format with lowercase pm', async () => {
    const result = await validateScheduleTime('2024-01-02 02:30pm', 'UTC');
    expect(result.toISOString()).toBe('2024-01-02T14:30:00.000Z');
  });

  test('accepts 12-hour format with lowercase pm and space', async () => {
    const result = await validateScheduleTime('2024-01-02 02:30 pm', 'UTC');
    expect(result.toISOString()).toBe('2024-01-02T14:30:00.000Z');
  });

  test('accepts single-digit hour with PM', async () => {
    const result = await validateScheduleTime('2024-01-02 2:30PM', 'UTC');
    expect(result.toISOString()).toBe('2024-01-02T14:30:00.000Z');
  });

  test('handles 12 AM correctly', async () => {
    const result = await validateScheduleTime('2024-01-02 12:00AM', 'UTC');
    expect(result.toISOString()).toBe('2024-01-02T00:00:00.000Z');
  });

  test('handles 12 PM correctly', async () => {
    const result = await validateScheduleTime('2024-01-02 12:00PM', 'UTC');
    expect(result.toISOString()).toBe('2024-01-02T12:00:00.000Z');
  });

  // 24-hour format tests
  test('accepts 24-hour format', async () => {
    const result = await validateScheduleTime('2024-01-02 14:30', 'UTC');
    expect(result.toISOString()).toBe('2024-01-02T14:30:00.000Z');
  });

  test('accepts 24-hour format with leading zero', async () => {
    const result = await validateScheduleTime('2024-01-02 09:30', 'UTC');
    expect(result.toISOString()).toBe('2024-01-02T09:30:00.000Z');
  });

  test('accepts midnight in 24-hour format', async () => {
    const result = await validateScheduleTime('2024-01-02 00:00', 'UTC');
    expect(result.toISOString()).toBe('2024-01-02T00:00:00.000Z');
  });

  // Timezone tests
  test('handles different timezones correctly', async () => {
    const result = await validateScheduleTime('2024-01-02 14:30', 'America/New_York');
    expect(result.toISOString()).toBe('2024-01-02T19:30:00.000Z');
  });

  // Error cases
  test('rejects invalid hour in 12-hour format', async () => {
    await expect(validateScheduleTime('2024-01-02 13:00PM', 'UTC'))
      .rejects.toThrow('Invalid date/time format: Invalid time format');
  });

  test('rejects invalid hour in 24-hour format', async () => {
    await expect(validateScheduleTime('2024-01-02 25:00', 'UTC'))
      .rejects.toThrow('Invalid date/time format: Invalid time format');
  });

  test('rejects invalid minutes', async () => {
    await expect(validateScheduleTime('2024-01-02 12:60', 'UTC'))
      .rejects.toThrow('Invalid date/time format: Invalid time format');
  });

  test('rejects missing time components', async () => {
    await expect(validateScheduleTime('2024-01-02', 'UTC'))
      .rejects.toThrow('Invalid date/time format: Date and time must be provided');
  });

  test('rejects past dates', async () => {
    await expect(validateScheduleTime('2023-12-31 14:30', 'UTC'))
      .rejects.toThrow('Invalid date/time format: Scheduled time must be in the future');
  });

  test('rejects dates more than 30 days in future', async () => {
    await expect(validateScheduleTime('2024-02-15 14:30', 'UTC'))
      .rejects.toThrow('Invalid date/time format: Cannot schedule more than 30 days in advance');
  });

  test('rejects invalid timezone', async () => {
    await expect(validateScheduleTime('2024-01-02 14:30', 'Invalid/Timezone'))
      .rejects.toThrow('Invalid date/time format');
  });

  test('rejects malformed time format', async () => {
    await expect(validateScheduleTime('2024-01-02 1430', 'UTC'))
      .rejects.toThrow('Invalid date/time format: Invalid time format');
  });

  test('rejects invalid date format', async () => {
    await expect(validateScheduleTime('2024-13-45 14:30', 'UTC'))
      .rejects.toThrow('Invalid date/time format: Invalid date format');
  });
});

describe('handleComment', () => {
  let mockOctokit;

  beforeEach(() => {
    jest.clearAllMocks();

    mockOctokit = {
      rest: {
        issues: {
          getComment: jest.fn(),
          createComment: jest.fn()
        },
        repos: {
          getCollaboratorPermissionLevel: jest.fn()
        }
      }
    };

    github.getOctokit.mockReturnValue(mockOctokit);
  });

  test('rejects commands from users without write permission', async () => {
    // Mock comment data
    mockOctokit.rest.issues.getComment.mockResolvedValue({
      data: {
        user: {
          login: 'testuser'
        }
      }
    });

    // Mock user permissions (read-only)
    mockOctokit.rest.repos.getCollaboratorPermissionLevel.mockResolvedValue({
      data: {
        permission: 'read'
      }
    });

    await handleComment('token', 'owner/repo', 123, '@merge-at 2024-01-02 14:30');

    expect(createComment).toHaveBeenCalledWith(
      expect.anything(),
      'owner',
      'repo',
      123,
      '❌ Only users with write permission can schedule PR merges.'
    );
  });

  test('allows commands from users with write permission', async () => {
    // Mock comment data
    mockOctokit.rest.issues.getComment.mockResolvedValue({
      data: {
        user: {
          login: 'testuser'
        }
      }
    });

    // Mock user permissions (write access)
    mockOctokit.rest.repos.getCollaboratorPermissionLevel.mockResolvedValue({
      data: {
        permission: 'write'
      }
    });

    const validCommand = '@merge-at 2024-01-02 14:30';
    await handleComment('token', 'owner/repo', 123, validCommand);

    // Verify schedule info was stored
    expect(storeScheduleInfo).toHaveBeenCalled();
  });

  test('handles cancel command correctly', async () => {
    // Mock comment data with write permission
    mockOctokit.rest.issues.getComment.mockResolvedValue({
      data: {
        user: {
          login: 'testuser'
        }
      }
    });

    mockOctokit.rest.repos.getCollaboratorPermissionLevel.mockResolvedValue({
      data: {
        permission: 'write'
      }
    });

    await handleComment('token', 'owner/repo', 123, '@merge-at cancel');

    expect(removeScheduleInfo).toHaveBeenCalledWith(
      expect.anything(),
      'owner',
      'repo',
      123
    );

    expect(createComment).toHaveBeenCalledWith(
      expect.anything(),
      'owner',
      'repo',
      123,
      '🚫 Scheduled merge has been cancelled.'
    );
  });

  test('handles invalid command format', async () => {
    // Mock comment data with write permission
    mockOctokit.rest.issues.getComment.mockResolvedValue({
      data: {
        user: {
          login: 'testuser'
        }
      }
    });

    mockOctokit.rest.repos.getCollaboratorPermissionLevel.mockResolvedValue({
      data: {
        permission: 'write'
      }
    });

    await handleComment('token', 'owner/repo', 123, '@merge-at invalid-format');

    expect(createComment).toHaveBeenCalledWith(
      expect.anything(),
      'owner',
      'repo',
      123,
      '❌ Invalid command format. Please use: @merge-at YYYY-MM-DD HH:mm[am|pm] [timezone]'
    );
  });

  test('handles API errors gracefully', async () => {
    mockOctokit.rest.issues.getComment.mockRejectedValue(new Error('API Error'));

    await handleComment('token', 'owner/repo', 123, '@merge-at 2024-01-02 14:30');

    expect(createComment).toHaveBeenCalledWith(
      expect.anything(),
      'owner',
      'repo',
      123,
      '❌ An error occurred while processing your command. Please try again.'
    );
  });

  test('handles error during schedule info storage', async () => {
    mockOctokit.rest.issues.getComment.mockResolvedValue({
      data: {
        user: {
          login: 'testuser'
        }
      }
    });

    mockOctokit.rest.repos.getCollaboratorPermissionLevel.mockResolvedValue({
      data: {
        permission: 'write'
      }
    });

    // Mock storage error
    storeScheduleInfo.mockRejectedValue(new Error('Storage failed'));

    await handleComment('token', 'owner/repo', 123, '@merge-at 2024-01-02 14:30');

    expect(createComment).toHaveBeenCalledWith(
      expect.anything(),
      'owner',
      'repo',
      123,
      '❌ Storage failed'
    );
  });
});

describe('hasWritePermission', () => {
  let mockOctokit;

  beforeEach(() => {
    mockOctokit = {
      rest: {
        repos: {
          getCollaboratorPermissionLevel: jest.fn()
        }
      }
    };
  });

  test('returns true for admin permission', async () => {
    mockOctokit.rest.repos.getCollaboratorPermissionLevel.mockResolvedValue({
      data: {
        permission: 'admin'
      }
    });

    const result = await hasWritePermission(mockOctokit, 'owner', 'repo', 'testuser');
    expect(result).toBe(true);
  });

  test('returns true for write permission', async () => {
    mockOctokit.rest.repos.getCollaboratorPermissionLevel.mockResolvedValue({
      data: {
        permission: 'write'
      }
    });

    const result = await hasWritePermission(mockOctokit, 'owner', 'repo', 'testuser');
    expect(result).toBe(true);
  });

  test('returns false for read permission', async () => {
    mockOctokit.rest.repos.getCollaboratorPermissionLevel.mockResolvedValue({
      data: {
        permission: 'read'
      }
    });

    const result = await hasWritePermission(mockOctokit, 'owner', 'repo', 'testuser');
    expect(result).toBe(false);
  });

  test('returns false when API call fails', async () => {
    mockOctokit.rest.repos.getCollaboratorPermissionLevel.mockRejectedValue(
      new Error('API Error')
    );

    const result = await hasWritePermission(mockOctokit, 'owner', 'repo', 'testuser');
    expect(result).toBe(false);
  });

  test('returns false for no permission', async () => {
    mockOctokit.rest.repos.getCollaboratorPermissionLevel.mockResolvedValue({
      data: {
        permission: 'none'
      }
    });

    const result = await hasWritePermission(mockOctokit, 'owner', 'repo', 'testuser');
    expect(result).toBe(false);
  });

  test('rejects when time part is empty', async () => {
    await expect(validateScheduleTime('2024-01-02 '))
      .rejects.toThrow('Invalid date/time format: Date and time must be provided');
  });
});
