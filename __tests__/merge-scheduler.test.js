const { mergePR, processScheduledMerges } = require('../src/merge-scheduler');
const { createComment, getScheduledPRs } = require('../src/utils');
const core = require('@actions/core');
const github = require('@actions/github');

// Mock dependencies
jest.mock('@actions/core');
jest.mock('@actions/github');
jest.mock('../src/utils');

describe('mergePR', () => {
  let mockOctokit;

  beforeEach(() => {
    jest.clearAllMocks();
    mockOctokit = {
      rest: {
        pulls: {
          get: jest.fn(),
          merge: jest.fn()
        }
      }
    };
  });

  test('successfully merges PR', async () => {
    mockOctokit.rest.pulls.get.mockResolvedValue({
      data: { mergeable: true, mergeable_state: 'clean' }
    });
    mockOctokit.rest.pulls.merge.mockResolvedValue({
      data: { merged: true }
    });

    await mergePR(mockOctokit, 'owner', 'repo', 123);

    expect(core.info).toHaveBeenCalledWith('Checking mergability for PR #123');
    expect(core.debug).toHaveBeenCalledWith('PR Status - Mergeable: true, State: clean');
    expect(core.info).toHaveBeenCalledWith('Attempting to merge PR #123');
    expect(core.info).toHaveBeenCalledWith('Successfully merged PR #123');
    expect(core.info).toHaveBeenCalledWith('Cleaned up schedule info for PR #123');

    expect(mockOctokit.rest.pulls.merge).toHaveBeenCalledWith({
      owner: 'owner',
      repo: 'repo',
      pull_number: 123,
      merge_method: 'squash'
    });
    expect(createComment).toHaveBeenCalledWith(
      mockOctokit,
      'owner',
      'repo',
      123,
      '✅ Successfully merged as scheduled!'
    );
  });

  test('handles unmergeable PR', async () => {
    mockOctokit.rest.pulls.get.mockResolvedValue({
      data: { mergeable: false, mergeable_state: 'dirty' }
    });

    await expect(mergePR(mockOctokit, 'owner', 'repo', 123))
      .rejects.toThrow('PR is not mergeable');

    expect(core.info).toHaveBeenCalledWith('Checking mergability for PR #123');
    expect(core.debug).toHaveBeenCalledWith('PR Status - Mergeable: false, State: dirty');
    expect(createComment).toHaveBeenCalledWith(
      mockOctokit,
      'owner',
      'repo',
      123,
      expect.stringContaining('Failed to merge PR: PR is not mergeable')
    );
  });

  test('handles PR not found', async () => {
    mockOctokit.rest.pulls.get.mockRejectedValue({
      status: 404,
      message: 'Not Found'
    });

    await expect(mergePR(mockOctokit, 'owner', 'repo', 123))
      .rejects.toThrow('PR not found');

    expect(core.error).toHaveBeenCalledWith('Error processing PR #123:');
    // Remove the expectation for core.info since the error occurs before that log
  });

  test('handles merge API error', async () => {
    mockOctokit.rest.pulls.get.mockResolvedValue({
      data: { mergeable: true, mergeable_state: 'clean' }
    });
    mockOctokit.rest.pulls.merge.mockRejectedValue({
      status: 405,
      message: 'PR is not mergeable at this time'
    });

    await expect(mergePR(mockOctokit, 'owner', 'repo', 123))
      .rejects.toThrow('Failed to merge PR');

    expect(core.error).toHaveBeenCalledWith(expect.stringContaining('Merge failed for PR #123'));
  });
});

describe('processScheduledMerges', () => {
  let mockDate;

  beforeEach(() => {
    jest.clearAllMocks();
    // Set fixed date
    mockDate = new Date('2024-01-01T12:00:00Z');
    // Mock Date.now() to return our fixed time
    Date.now = jest.fn(() => mockDate.getTime());
  });

  afterEach(() => {
    // Restore original Date.now
    jest.restoreAllMocks();
  });

  test('processes scheduled PRs successfully', async () => {
    const mockScheduledPRs = [{
      owner: 'owner',
      repo: 'repo',
      number: 123,
      scheduleTime: new Date(mockDate.getTime() - 1000).toISOString()
    }];

    getScheduledPRs.mockResolvedValue(mockScheduledPRs);

    await processScheduledMerges('fake-token');

    expect(core.info).toHaveBeenCalledWith('Found 1 scheduled PRs');
    expect(core.info).toHaveBeenCalledWith('Processing PR #123');
    expect(core.info).toHaveBeenCalledWith('→ Owner: owner');
    expect(core.info).toHaveBeenCalledWith('→ Repo: repo');
    expect(core.info).toHaveBeenCalledWith(expect.stringContaining('Time to merge PR #123'));
  });

  test('handles no scheduled PRs', async () => {
    getScheduledPRs.mockResolvedValue([]);

    await processScheduledMerges('fake-token');

    expect(core.info).toHaveBeenCalledWith('Found 0 scheduled PRs');
    expect(core.info).toHaveBeenCalledWith('Completed processing scheduled merges');
  });

  test('continues processing despite PR errors', async () => {
    const mockScheduledPRs = [
      {
        owner: 'owner',
        repo: 'repo',
        number: 123,
        scheduleTime: new Date(mockDate.getTime() - 1000).toISOString()
      },
      {
        owner: 'owner',
        repo: 'repo',
        number: 124,
        scheduleTime: new Date(mockDate.getTime() - 1000).toISOString()
      }
    ];

    getScheduledPRs.mockResolvedValue(mockScheduledPRs);
    const mockError = new Error('Merge failed');
    github.getOctokit.mockReturnValue({
      rest: {
        pulls: {
          get: jest.fn().mockRejectedValue(mockError)
        }
      }
    });

    await processScheduledMerges('fake-token');

    expect(core.error).toHaveBeenCalledWith('Error processing PR #123:');
    expect(core.error).toHaveBeenCalledWith(mockError);
    expect(core.info).toHaveBeenCalledWith('Found 2 scheduled PRs');
    expect(core.info).toHaveBeenCalledWith('Completed processing scheduled merges');
  });

  test('skips PRs scheduled for future', async () => {
    const mockScheduledPRs = [{
      owner: 'owner',
      repo: 'repo',
      number: 123,
      scheduleTime: '2024-01-01T13:00:00Z' // 1 hour in future
    }];

    getScheduledPRs.mockResolvedValue(mockScheduledPRs);
    const mockOctokitInstance = {
      rest: {
        pulls: {
          get: jest.fn(),
          merge: jest.fn()
        }
      }
    };
    github.getOctokit.mockReturnValue(mockOctokitInstance);

    await processScheduledMerges('fake-token');

    // Should not attempt to merge future PRs
    expect(mockOctokitInstance.rest.pulls.merge).not.toHaveBeenCalled();
  });

  test('processes past PRs and skips future PRs', async () => {
    const mockScheduledPRs = [
      {
        owner: 'owner',
        repo: 'repo',
        number: 123,
        scheduleTime: '2024-01-01T11:00:00Z' // 1 hour in past
      },
      {
        owner: 'owner',
        repo: 'repo',
        number: 124,
        scheduleTime: '2024-01-01T13:00:00Z' // 1 hour in future
      }
    ];

    getScheduledPRs.mockResolvedValue(mockScheduledPRs);
    const mockOctokitInstance = {
      rest: {
        pulls: {
          get: jest.fn().mockResolvedValueOnce({ data: { mergeable: true } }),
          merge: jest.fn().mockResolvedValueOnce({ data: { merged: true } })
        }
      }
    };
    github.getOctokit.mockReturnValue(mockOctokitInstance);

    await processScheduledMerges('fake-token');

    // Should only attempt to merge the past PR
    expect(mockOctokitInstance.rest.pulls.merge).toHaveBeenCalledTimes(1);
    expect(mockOctokitInstance.rest.pulls.merge).toHaveBeenCalledWith({
      owner: 'owner',
      repo: 'repo',
      pull_number: 123,
      merge_method: 'squash'
    });
  });

  test('processes PRs with exact current time', async () => {
    const mockScheduledPRs = [{
      owner: 'owner',
      repo: 'repo',
      number: 123,
      scheduleTime: '2024-01-01T12:00:00Z' // Exactly current time
    }];

    getScheduledPRs.mockResolvedValue(mockScheduledPRs);
    const mockOctokitInstance = {
      rest: {
        pulls: {
          get: jest.fn().mockResolvedValue({ data: { mergeable: true } }),
          merge: jest.fn().mockResolvedValue({ data: { merged: true } })
        }
      }
    };
    github.getOctokit.mockReturnValue(mockOctokitInstance);

    await processScheduledMerges('fake-token');

    // Should attempt to merge PR scheduled for exactly now
    expect(mockOctokitInstance.rest.pulls.merge).toHaveBeenCalledTimes(1);
    expect(mockOctokitInstance.rest.pulls.merge).toHaveBeenCalledWith({
      owner: 'owner',
      repo: 'repo',
      pull_number: 123,
      merge_method: 'squash'
    });
  });

  test('handles merge failure with detailed logging', async () => {
    const mockScheduledPRs = [{
      owner: 'owner',
      repo: 'repo',
      number: 123,
      scheduleTime: '2024-01-01T11:00:00Z' // Past time
    }];

    getScheduledPRs.mockResolvedValue(mockScheduledPRs);
    const mockError = new Error('Merge conflict');
    const mockOctokitInstance = {
      rest: {
        pulls: {
          get: jest.fn().mockResolvedValue({ data: { mergeable: true } }),
          merge: jest.fn().mockRejectedValue(mockError)
        }
      }
    };
    github.getOctokit.mockReturnValue(mockOctokitInstance);

    await processScheduledMerges('fake-token');

    // Check for the specific error message format from the code
    expect(core.error).toHaveBeenCalledWith('Merge failed for PR #123: Failed to merge PR: Merge conflict');
  });

  test('handles API errors gracefully', async () => {
    getScheduledPRs.mockRejectedValue(new Error('API Error'));

    await expect(processScheduledMerges('fake-token'))
      .rejects.toThrow('API Error');

    expect(core.error).toHaveBeenCalledWith('Failed to process scheduled merges:');
  });

  test('handles invalid schedule times', async () => {
    const mockScheduledPRs = [{
      owner: 'owner',
      repo: 'repo',
      number: 123,
      scheduleTime: 'invalid-date'
    }];

    getScheduledPRs.mockResolvedValue(mockScheduledPRs);

    await processScheduledMerges('fake-token');

    expect(core.info).toHaveBeenCalledWith('Found 1 scheduled PRs');
    expect(core.info).toHaveBeenCalledWith('Processing PR #123');
    expect(core.info).toHaveBeenCalledWith('Completed processing scheduled merges');
    // Since invalid date will be handled gracefully, we won't see an error
  });

  test('processes PRs with exact current time', async () => {
    const mockScheduledPRs = [{
      owner: 'owner',
      repo: 'repo',
      number: 123,
      scheduleTime: mockDate.toISOString()
    }];

    getScheduledPRs.mockResolvedValue(mockScheduledPRs);
    const mockOctokitInstance = {
      rest: {
        pulls: {
          get: jest.fn().mockResolvedValue({ data: { mergeable: true, mergeable_state: 'clean' } }),
          merge: jest.fn().mockResolvedValue({ data: { merged: true } })
        }
      }
    };
    github.getOctokit.mockReturnValue(mockOctokitInstance);

    await processScheduledMerges('fake-token');

    expect(core.info).toHaveBeenCalledWith('Time to merge PR #123');
    expect(mockOctokitInstance.rest.pulls.get).toHaveBeenCalled();
  });

  test('handles merge failure with detailed logging', async () => {
    const mockScheduledPRs = [{
      owner: 'owner',
      repo: 'repo',
      number: 123,
      scheduleTime: new Date(mockDate.getTime() - 1000).toISOString()
    }];

    getScheduledPRs.mockResolvedValue(mockScheduledPRs);
    const mockOctokitInstance = {
      rest: {
        pulls: {
          get: jest.fn().mockResolvedValue({ data: { mergeable: true, mergeable_state: 'clean' } }),
          merge: jest.fn().mockRejectedValue(new Error('Merge conflict'))
        }
      }
    };
    github.getOctokit.mockReturnValue(mockOctokitInstance);

    await processScheduledMerges('fake-token');

    expect(core.error).toHaveBeenCalledWith(expect.stringContaining('Failed to merge PR #123'));
    expect(core.info).toHaveBeenCalledWith('Completed processing scheduled merges');
  });
});
