const { createComment, getLatestScheduleComment, storeScheduleInfo, removeScheduleInfo, getScheduledPRs } = require('../src/utils');
const core = require('@actions/core');

jest.mock('@actions/core');

describe('Utils', () => {
  let mockOctokit;
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(core, 'error');
    mockOctokit = {
      rest: {
        issues: {
          createComment: jest.fn(),
          listComments: jest.fn(),
          addLabels: jest.fn(),
          removeLabel: jest.fn(),
          deleteComment: jest.fn()
        },
        search: {
          issuesAndPullRequests: jest.fn()
        }
      }
    };
  });

  describe('createComment', () => {
    test('creates comment successfully', async () => {
      await createComment(mockOctokit, 'owner', 'repo', 123, 'test comment');

      expect(mockOctokit.rest.issues.createComment).toHaveBeenCalledWith({
        owner: 'owner',
        repo: 'repo',
        issue_number: 123,
        body: 'test comment'
      });
    });

    test('handles comment creation error', async () => {
      mockOctokit.rest.issues.createComment.mockRejectedValue(new Error('API Error'));

      await expect(createComment(mockOctokit, 'owner', 'repo', 123, 'test'))
        .rejects.toThrow('API Error');
      expect(core.error).toHaveBeenCalled();
    });
  });

  describe('getLatestScheduleComment', () => {
    test('finds most recent schedule comment', async () => {
      const mockComments = {
        data: [
          { body: 'regular comment' },
          { body: '@merge-at 2024-01-01 12:00' },
          { body: 'another comment' }
        ]
      };
      mockOctokit.rest.issues.listComments.mockResolvedValue(mockComments);

      const result = await getLatestScheduleComment(mockOctokit, 'owner', 'repo', 123);
      expect(result.body).toBe('@merge-at 2024-01-01 12:00');
    });

    test('returns undefined when no schedule comments exist', async () => {
      mockOctokit.rest.issues.listComments.mockResolvedValue({
        data: [{ body: 'regular comment' }]
      });

      const result = await getLatestScheduleComment(mockOctokit, 'owner', 'repo', 123);
      expect(result).toBeUndefined();
    });

    test('handles API error', async () => {
      mockOctokit.rest.issues.listComments.mockRejectedValue(new Error('API Error'));

      await expect(getLatestScheduleComment(mockOctokit, 'owner', 'repo', 123))
        .rejects.toThrow('API Error');
      expect(core.error).toHaveBeenCalled();
    });
  });

  describe('storeScheduleInfo', () => {
    test('stores schedule information successfully', async () => {
      const scheduleDate = new Date('2024-01-01T12:00:00Z');

      await storeScheduleInfo(mockOctokit, 'owner', 'repo', 123, scheduleDate);

      expect(mockOctokit.rest.issues.addLabels).toHaveBeenCalledWith({
        owner: 'owner',
        repo: 'repo',
        issue_number: 123,
        labels: ['merge-scheduled']
      });

      expect(mockOctokit.rest.issues.createComment).toHaveBeenCalledWith({
        owner: 'owner',
        repo: 'repo',
        issue_number: 123,
        body: expect.stringContaining('MERGE_SCHEDULE_INFO')
      });
    });

    test('handles storage error', async () => {
      mockOctokit.rest.issues.addLabels.mockRejectedValue(new Error('API Error'));

      await expect(storeScheduleInfo(mockOctokit, 'owner', 'repo', 123, new Date()))
        .rejects.toThrow('API Error');
      expect(core.error).toHaveBeenCalled();
    });
  });

  describe('removeScheduleInfo', () => {
    test('removes all schedule information successfully', async () => {
      mockOctokit.rest.issues.listComments.mockResolvedValue({
        data: [{
          id: 456,
          body: '<!-- MERGE_SCHEDULE_INFO {} -->'
        }]
      });

      await removeScheduleInfo(mockOctokit, 'owner', 'repo', 123);

      expect(mockOctokit.rest.issues.removeLabel).toHaveBeenCalled();
      expect(mockOctokit.rest.issues.deleteComment).toHaveBeenCalledWith({
        owner: 'owner',
        repo: 'repo',
        comment_id: 456
      });
    });

    test('handles non-existent label gracefully', async () => {
      mockOctokit.rest.issues.removeLabel.mockRejectedValue({ status: 404 });
      mockOctokit.rest.issues.listComments.mockResolvedValue({ data: [] });

      await removeScheduleInfo(mockOctokit, 'owner', 'repo', 123);
      expect(mockOctokit.rest.issues.listComments).toHaveBeenCalled();
    });

    test('handles other errors', async () => {
      mockOctokit.rest.issues.removeLabel.mockRejectedValue(new Error('API Error'));

      await expect(removeScheduleInfo(mockOctokit, 'owner', 'repo', 123))
        .rejects.toThrow('API Error');
      expect(core.error).toHaveBeenCalled();
    });
  });

  describe('getScheduledPRs', () => {
    test('retrieves scheduled PRs successfully', async () => {
      mockOctokit.rest.search.issuesAndPullRequests.mockResolvedValue({
        data: {
          items: [{
            number: 123,
            repository_url: 'https://api.github.com/repos/owner/repo'
          }]
        }
      });

      mockOctokit.rest.issues.listComments.mockResolvedValue({
        data: [{
          body: '<!-- MERGE_SCHEDULE_INFO {"type":"merge-schedule-info","scheduleDate":"2024-01-01T12:00:00.000Z"} -->'
        }]
      });

      const result = await getScheduledPRs(mockOctokit);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        owner: 'owner',
        repo: 'repo',
        number: 123,
        scheduleTime: expect.any(Date)
      });
    });

    test('handles invalid schedule info JSON', async () => {
      mockOctokit.rest.search.issuesAndPullRequests.mockResolvedValue({
        data: {
          items: [{
            number: 123,
            repository_url: 'https://api.github.com/repos/owner/repo'
          }]
        }
      });

      mockOctokit.rest.issues.listComments.mockResolvedValue({
        data: [{
          body: '<!-- MERGE_SCHEDULE_INFO invalid-json -->'
        }]
      });

      const result = await getScheduledPRs(mockOctokit);
      expect(result).toHaveLength(0);
      expect(core.error).toHaveBeenCalled();
    });

    test('handles PR with no schedule info comment', async () => {
      mockOctokit.rest.search.issuesAndPullRequests.mockResolvedValue({
        data: {
          items: [{
            number: 123,
            repository_url: 'https://api.github.com/repos/owner/repo'
          }]
        }
      });

      mockOctokit.rest.issues.listComments.mockResolvedValue({
        data: [{
          body: 'regular comment'
        }]
      });

      const result = await getScheduledPRs(mockOctokit);
      expect(result).toHaveLength(0);
    });

    test('handles search API error', async () => {
      mockOctokit.rest.search.issuesAndPullRequests.mockRejectedValue(
        new Error('Search API Error')
      );

      await expect(getScheduledPRs(mockOctokit))
        .rejects.toThrow('Search API Error');
      expect(core.error).toHaveBeenCalled();
    });

    test('handles comments API error', async () => {
      mockOctokit.rest.search.issuesAndPullRequests.mockResolvedValue({
        data: {
          items: [{
            number: 123,
            repository_url: 'https://api.github.com/repos/owner/repo'
          }]
        }
      });

      mockOctokit.rest.issues.listComments.mockRejectedValue(
        new Error('Comments API Error')
      );

      const result = await getScheduledPRs(mockOctokit);
      expect(result).toHaveLength(0);
      // Fix the expectation to match how core.error is actually called
      expect(core.error).toHaveBeenNthCalledWith(1,
        'Error processing PR #123:',
        expect.any(Error)
      );
    });

    test('handles malformed repository URL', async () => {
      mockOctokit.rest.search.issuesAndPullRequests.mockResolvedValue({
        data: {
          items: [{
            number: 123,
            repository_url: 'invalid-url'
          }]
        }
      });

      const result = await getScheduledPRs(mockOctokit);
      expect(result).toHaveLength(0);
    });

    test('processes multiple PRs correctly', async () => {
      mockOctokit.rest.search.issuesAndPullRequests.mockResolvedValue({
        data: {
          items: [
            {
              number: 123,
              repository_url: 'https://api.github.com/repos/owner/repo'
            },
            {
              number: 124,
              repository_url: 'https://api.github.com/repos/owner/repo'
            }
          ]
        }
      });

      const mockScheduleInfo = '<!-- MERGE_SCHEDULE_INFO {"type":"merge-schedule-info","scheduleDate":"2024-01-01T12:00:00.000Z"} -->';

      mockOctokit.rest.issues.listComments.mockResolvedValueOnce({
        data: [{ body: mockScheduleInfo }]
      }).mockResolvedValueOnce({
        data: [{ body: mockScheduleInfo }]
      });

      const result = await getScheduledPRs(mockOctokit);
      expect(result).toHaveLength(2);
      expect(result[0].number).toBe(123);
      expect(result[1].number).toBe(124);
    });

    test('handles empty search results', async () => {
      mockOctokit.rest.search.issuesAndPullRequests.mockResolvedValue({
        data: {
          items: []
        }
      });

      const result = await getScheduledPRs(mockOctokit);
      expect(result).toHaveLength(0);
    });

    test('handles invalid date in schedule info', async () => {
      mockOctokit.rest.search.issuesAndPullRequests.mockResolvedValue({
        data: {
          items: [{
            number: 123,
            repository_url: 'https://api.github.com/repos/owner/repo'
          }]
        }
      });

      mockOctokit.rest.issues.listComments.mockResolvedValue({
        data: [{
          body: '<!-- MERGE_SCHEDULE_INFO {"type":"merge-schedule-info","scheduleDate":"invalid-date"} -->'
        }]
      });

      const result = await getScheduledPRs(mockOctokit);
      expect(result).toHaveLength(0);
      expect(core.error).toHaveBeenCalled();
    });

    test('handles missing repository URL', async () => {
      mockOctokit.rest.search.issuesAndPullRequests.mockResolvedValue({
        data: {
          items: [{
            number: 123
            // Missing repository_url
          }]
        }
      });

      const result = await getScheduledPRs(mockOctokit);
      expect(result).toHaveLength(0);
      expect(core.error).toHaveBeenCalledWith(
        'Invalid repository URL for PR #123'
      );
    });

    test('handles malformed repository URL without owner/repo', async () => {
      mockOctokit.rest.search.issuesAndPullRequests.mockResolvedValue({
        data: {
          items: [{
            number: 123,
            repository_url: 'invalid'
          }]
        }
      });

      mockOctokit.rest.issues = {
        listComments: jest.fn().mockResolvedValue({
          data: []
        })
      };

      await getScheduledPRs(mockOctokit);
      expect(core.error).toHaveBeenCalledWith('Malformed repository URL for PR #123');
    });

    test('handles missing schedule info in comment', async () => {
      mockOctokit.rest.search.issuesAndPullRequests.mockResolvedValue({
        data: {
          items: [{
            number: 123,
            repository_url: 'https://api.github.com/repos/owner/repo'
          }]
        }
      });

      mockOctokit.rest.issues.listComments.mockResolvedValue({
        data: [{
          body: '<!-- MERGE_SCHEDULE_INFO -->'
        }]
      });

      const result = await getScheduledPRs(mockOctokit);
      expect(result).toHaveLength(0);
    });
  });
});
