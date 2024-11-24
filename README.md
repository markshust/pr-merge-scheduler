# PR Merge Scheduler

A GitHub Action that allows scheduling Pull Request merges for a specific time using simple commands in PR comments.

## Table of contents

- [Features](#features)
- [Setup](#setup)
- [Usage](#usage)
- [Time Format Rules](#time-format-rules)
- [Support Timezones](#supported-timezones)
- [Costs](#costs)
- [Error Handling](#error-handling)
- [Development](#development)
- [Contributing](#contributing)
- [Security](#security)
- [Limitations](#limitations)
- [Troubleshooting](#troubleshooting)
- [Credits](#credits)
- [License](#license)

## Features

- Schedule PR merges using natural datetime format
- Supports all IANA timezone names (defaults to UTC)
- Uses 24-hour format if AM/PM not specified
- Automatic merge conflict detection
- Clear feedback via PR comments
- Easy cancellation and rescheduling
- Maximum scheduling window of 30 days

## Setup

1. Create `.github/workflows/pr-merge-scheduler.yml` in your repository:

```yaml
name: PR Merge Scheduler

on:
  issue_comment:
    types: [created]
  schedule:
    - cron: '0 * * * *'

jobs:
  process-schedule:
    runs-on: ubuntu-latest
    permissions:
      pull-requests: write
      contents: write
      issues: write
    steps:
      - uses: markshust/pr-merge-scheduler@main
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          mode: ${{ github.event_name == 'issue_comment' && 'comment' || 'scheduler' }}
          comment-body: ${{ github.event.comment.body }}
          pr-number: ${{ github.event.issue.number }}
          repository: ${{ github.repository }}
```

## Usage

### Scheduling a Merge

Comment on any PR with:

```
@merge-at YYYY-MM-DD HH:mm[am|pm] [timezone]
```

Examples:
```
@merge-at 2024-01-01 14:30
@merge-at 2024-01-01 02:30PM America/New_York
@merge-at 2024-12-25 09:00 Europe/London
```

The action will respond with a confirmation comment showing both the local time and UTC time of the scheduled merge.

### Cancelling a Scheduled Merge

To cancel a scheduled merge, comment:
```
@merge-at cancel
```

### Rescheduling

To change the merge time, simply post a new `@merge-at` command. The most recent command always takes precedence.

## Time Format Rules

- If AM/PM is not specified, 24-hour format is assumed
- If timezone is not specified, UTC is used
- Date must be in YYYY-MM-DD format
- Time must be in HH:mm format
- Cannot schedule more than 30 days in advance
- Must schedule for a future time

## Supported Timezones

Supports all IANA timezone names (e.g., 'America/New_York', 'Europe/London', 'Asia/Tokyo'). 
See [full list of timezone names](https://en.wikipedia.org/wiki/List_of_tz_database_time_zones).

## Costs

### GitHub Actions Minutes Usage

This action runs on a schedule to check for PRs that are ready to be merged. The scheduled runtime impacts your GitHub Actions minutes usage:

**Hourly Schedule (Recommended)**
- 1 run per hour × 24 hours × 30 days = 720 minutes/month
- Uses standard Linux runners (1× multiplier)
- Monthly usage:
   - ~36% of Free tier minutes (2,000 included)
   - ~24% of Team tier minutes (3,000 included)
   - No overage costs on any tier

This recommended hourly schedule:
- Stays well within free tier limits
- Leaves plenty of minutes for other workflows
- Has zero overage costs
- Provides reasonable scheduling granularity (PRs merge within ~1 hour of scheduled time)

Note: GitHub rounds each workflow run up to the nearest minute, even if the actual execution time is shorter. Usage is calculated based on this rounding.

For more information about GitHub Actions billing, see [About billing for GitHub Actions](https://docs.github.com/en/billing/managing-billing-for-github-actions/about-billing-for-github-actions).

## Error Handling

The action will comment on the PR if:
- The command format is invalid
- The specified time is in the past
- The specified time is too far in the future
- The timezone is invalid
- The PR cannot be merged due to conflicts
- Any other issues occur during the merge process

## Development

### Prerequisites

- Node.js 20.x
- npm

### Installation

```bash
git clone https://github.com/[your-username]/pr-merge-scheduler.git
cd pr-merge-scheduler
npm install
```

### Building

```bash
npm run build
```

### Testing

```bash
npm test
```

### Linting

```bash
npm run lint
```

### Local Development

1. Clone the repository
2. Install dependencies: `npm install`
3. Make your changes
4. Run tests: `npm test`
5. Build: `npm run build`
6. Commit including the `dist` directory

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## Security

This action requires `contents: write` and `pull-requests: write` permissions to function. It uses GitHub's built-in `GITHUB_TOKEN` and doesn't require any additional secrets.

## Limitations

- Maximum schedule window is 30 days
- Requires appropriate permissions to merge PRs
- Schedule is lost if the PR is updated (new commits pushed)
- GitHub Actions runner must be available at the scheduled time

## Troubleshooting

### Common Issues

1. **Merge Failed**
   - Check if the branch is up to date
   - Verify there are no merge conflicts
   - Ensure branch protection rules are satisfied

2. **Invalid Command**
   - Verify the date format (YYYY-MM-DD)
   - Verify the time format (HH:mm or HH:mmAM/PM)
   - Check if the timezone name is valid

3. **Permissions**
   - Ensure the workflow has necessary permissions
   - Verify the user has permission to merge PRs

For additional help, please open an issue in the repository.

## Credits

### M.academy

This course is sponsored by <a href="https://m.academy" target="_blank">M.academy</a>, the simplest way to learn Magento.

<a href="https://m.academy" target="_blank"><img src="docs/macademy-logo.png" alt="M.academy"></a>

### Mark Shust

My name is Mark Shust and I'm the creator of this repo. I'm a <a href="https://www.credly.com/users/mark-shust/badges" target="_blank">6X Adobe Commerce Certified Developer</a> and have been involved with Magento since the early days (v0.8!). I create technical education courses full-time for my company, <a href="https://m.academy" target="_blank">M.academy</a>.

- <a href="https://m.academy/courses" target="_blank">🖥️ See my Magento lessons & courses</a>
- <a href="https://m.academy/articles" target="_blank">📖 Read my technical articles</a>
- <a href="https://youtube.com/markshust" target="_blank">🎥 Watch my YouTube videos</a>
- <a href="https://www.linkedin.com/in/MarkShust/" target="_blank">🔗 Connect on LinkedIn</a>
- <a href="https://twitter.com/MarkShust" target="_blank">🐦 Follow me on X</a>
- <a href="mailto:mark@m.academy">💌 Contact me</a>

## License

[MIT](https://opensource.org/licenses/MIT)
