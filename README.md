# CalendarToSlack
CalendarToSlack automatically sets your Slack status and presence according to events on your Outlook calendar. It updates your Slack availability to Away whenever you have an event, and updates your Slack status to a custom status/emoji that's specific to the calendar event. [Check out the Wiki for features and documentation.](https://github.com/hudl/CalendarToSlack/wiki)

The system is still in beta, but generally seems to be working as intended.

## How it works
### 1. Authorize the app with Slack and Office365
![A user authorizing Slack](https://github.com/hudl/CalendarToSlack/blob/master/docs/authorize-slack.png)

### 2. Add a new meeting to your calendar
![Creating an Outlook meeting](https://github.com/hudl/CalendarToSlack/blob/master/docs/create-calendar-event.png)

### 3. Tell CalendarToSlack what status to set for your upcoming meeting
![Setting up custom status for the meeting](https://github.com/hudl/CalendarToSlack/blob/master/docs/set-status-for-event.png)

### 4. Your Slack status will automatically update when the meeting happens!
![Status updated in Slack](https://github.com/hudl/CalendarToSlack/blob/master/docs/slack-status-small.png)

## Features
- Setting custom status text/emoji during your meetings
- Setting presence to Away for Busy or OOO meetings
- Setting presence to Auto for Tentative or Free meetings
- Partial matching on meeting names (eg. looking for "Planning" in a meeting named "Sprint Planning")
- Sending you links via Slack as your meeting starts when its location is a URL
- Setting a default custom status for when you're not in a meeting

For a complete list of features, see [the wiki](https://github.com/hudl/CalendarToSlack/wiki).

## Technology Used
* **Language**: TypeScript
* **External APIs**: Slack, Microsoft Graph
* **Database**: Amazon DynamoDB
* **Hosting**: AWS Lambda, AWS API Gateway, Serverless
