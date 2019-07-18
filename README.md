CalendarToSlack automatically sets your Slack status and availability according to events on your Outlook calendar. It updates your Slack availability to Away whenever you have an event, and updates your Slack status to a custom status/emoji that's specific to the calendar event. [Check out the Wiki for features and documentation.](https://github.com/hudl/CalendarToSlack/wiki)

The system is still in beta, but generally seems to be working as intended.

![image](https://cloud.githubusercontent.com/assets/1224017/13204981/49b07646-d8a2-11e5-8ab3-eece29cdefcd.png)

# Tech

* Slack APIs for a bot
* Microsoft Graph for calendar integration
* AWS DynamoDB for storage
* AWS Lambda for integrating with the above
* Serverless for managing the AWS resources
* TypeScript
