import { getEventsForUser, CalendarEvent, ShowAs } from '../services/calendar';
import { upsertCurrentEvent, removeCurrentEvent, setLastReminderEventId, UserSettings } from '../services/dynamo';
import { getSlackSecretWithKey } from '../utils/secrets';
import { getUserByEmail, setUserPresence, setUserStatus, postMessage, SlackUser } from '../services/slack';
import { updateOne } from '..';

jest.mock('../services/calendar');
jest.mock('../services/dynamo');
jest.mock('../utils/secrets');
jest.mock('../services/slack');

const getEventsForUserMock = <jest.Mock>getEventsForUser;
const upsertCurrentEventMock = <jest.Mock>upsertCurrentEvent;
const removeCurrentEventMock = <jest.Mock>removeCurrentEvent;
const setLastReminderEventIdMock = <jest.Mock>setLastReminderEventId;
const getSlackSecretWithKeyMock = <jest.Mock>getSlackSecretWithKey;
const getUserByEmailMock = <jest.Mock>getUserByEmail;
const setUserPresenceMock = <jest.Mock>setUserPresence;
const setUserStatusMock = <jest.Mock>setUserStatus;
const postMessageMock = <jest.Mock>postMessage;

const currentEvent: CalendarEvent = {
  id: '123',
  name: 'Quick Chat',
  startTime: new Date(),
  endTime: new Date(),
  location: 'a room',
  body: 'blah blah blah',
  showAs: ShowAs.Free,
};
const oooEvent: CalendarEvent = {
  id: '567',
  name: 'meetings',
  showAs: ShowAs.OutOfOffice,
  body: '',
  startTime: new Date('2020-01-01'),
  endTime: new Date('2020-01-05'),
  location: 'https://my.test.url',
};
const busyEvent: CalendarEvent = {
  id: '890',
  name: 'anotha one',
  showAs: ShowAs.Busy,
  body: '',
  startTime: new Date('2020-03-01'),
  endTime: new Date('2020-03-02'),
  location: 'https://my.test.url/2',
};
const baseUserSettings: UserSettings = {
  email: 'blah@bl.ah',
  slackToken: 'userSlackToken',
};

const userWithCurrentEvent = { ...baseUserSettings, lastReminderEventId: currentEvent.id, currentEvent };

const botToken = 'botToken';
getSlackSecretWithKeyMock.mockResolvedValue(botToken);

const slackUser: SlackUser = {
  id: '12345',
  tz: 'America/Chicago',
};
getUserByEmailMock.mockResolvedValue(slackUser);

describe('updateOne', () => {
  describe('updating Slack status', () => {
    describe('with no events found for the next minute', () => {
      beforeEach(() => {
        getEventsForUserMock.mockResolvedValueOnce([]);
      });

      describe('and no current event', () => {
        test('does not update Slack status', async () => {
          await updateOne(baseUserSettings);

          expect(setUserStatusMock).not.toBeCalled();
          expect(setUserPresenceMock).not.toBeCalled();
        });
        test('does not update DynamoDB', async () => {
          await updateOne(baseUserSettings);

          expect(upsertCurrentEventMock).not.toBeCalled();
          expect(removeCurrentEventMock).not.toBeCalled();
        });
      });
      describe('and a current event', () => {
        test('clears Slack status', async () => {
          await updateOne(userWithCurrentEvent);

          expect(setUserStatusMock).toBeCalledWith(userWithCurrentEvent.email, userWithCurrentEvent.slackToken, {
            text: '',
            emoji: '',
          });
          expect(setUserPresenceMock).toBeCalledWith(
            userWithCurrentEvent.email,
            userWithCurrentEvent.slackToken,
            'auto',
          );
        });
        test('removes event in DynamoDB', async () => {
          await updateOne(userWithCurrentEvent);

          expect(removeCurrentEventMock).toBeCalledWith(userWithCurrentEvent.email);
        });
      });
    });
    describe('with a single event found for the next minute', () => {
      describe('that matches the current event', () => {
        beforeEach(() => {
          getEventsForUserMock.mockResolvedValueOnce([currentEvent]);
        });

        test('does not update Slack status', async () => {
          await updateOne(userWithCurrentEvent);

          expect(setUserStatusMock).not.toBeCalled();
          expect(setUserPresenceMock).not.toBeCalled();
        });
        test('does not update DynamoDB', async () => {
          await updateOne(userWithCurrentEvent);

          expect(upsertCurrentEventMock).not.toBeCalled();
          expect(removeCurrentEventMock).not.toBeCalled();
        });
      });
      describe('that does not match the current event', () => {
        beforeEach(() => {
          getEventsForUserMock.mockResolvedValueOnce([oooEvent]);
        });

        test('updates Slack status to OOO', async () => {
          await updateOne(userWithCurrentEvent);

          expect(setUserStatusMock).toBeCalledWith(userWithCurrentEvent.email, userWithCurrentEvent.slackToken, {
            text: 'OOO until Saturday, January 4',
            emoji: ':ooo:',
          });
          expect(setUserPresenceMock).toBeCalledWith(
            userWithCurrentEvent.email,
            userWithCurrentEvent.slackToken,
            'away',
          );
        });
        test('sets the current event to the new event DynamoDB', async () => {
          await updateOne(userWithCurrentEvent);

          expect(upsertCurrentEventMock).toBeCalledWith(userWithCurrentEvent.email, oooEvent);
        });
      });
    });

    // TODO: move this responsibility out of updateOne to reduce surface area
    describe('with multiple events found for the next minute', () => {
      describe('when the current event is highest priority', () => {
        beforeEach(() => {
          const pastEvent = {
            ...currentEvent,
            startTime: new Date(currentEvent.startTime),
            endTime: new Date(currentEvent.endTime),
          };
          pastEvent.startTime.setMinutes(pastEvent.startTime.getMinutes() - 1);
          pastEvent.endTime.setMinutes(pastEvent.endTime.getMinutes() - 1);

          getEventsForUserMock.mockResolvedValueOnce([pastEvent, currentEvent]);
        });

        test('does not update Slack status', async () => {
          await updateOne(userWithCurrentEvent);

          expect(setUserStatusMock).not.toBeCalled();
          expect(setUserPresenceMock).not.toBeCalled();
        });
        test('does not update DynamoDB', async () => {
          await updateOne(userWithCurrentEvent);

          expect(upsertCurrentEventMock).not.toBeCalled();
          expect(removeCurrentEventMock).not.toBeCalled();
        });
      });

      describe('with different ShowAs settings', () => {
        beforeEach(() => {
          getEventsForUserMock.mockResolvedValueOnce([oooEvent, busyEvent]);
        });

        test('updates Slack status to event with highest-priority ShowAs', async () => {
          await updateOne(userWithCurrentEvent);

          expect(setUserStatusMock).toBeCalledWith(userWithCurrentEvent.email, userWithCurrentEvent.slackToken, {
            text: 'OOO until Saturday, January 4',
            emoji: ':ooo:',
          });
          expect(setUserPresenceMock).toBeCalledWith(
            userWithCurrentEvent.email,
            userWithCurrentEvent.slackToken,
            'away',
          );
        });
        test('sets the current event to event with highest-priority ShowAs in DynamoDB', async () => {
          await updateOne(userWithCurrentEvent);

          expect(upsertCurrentEventMock).toBeCalledWith(userWithCurrentEvent.email, oooEvent);
        });
      });

      describe('with the same ShowAs setting', () => {
        beforeEach(() => {
          const earlierBusyEvent = {
            ...busyEvent,
            startTime: new Date(busyEvent.startTime),
            endTime: new Date(busyEvent.endTime),
          };
          earlierBusyEvent.startTime.setMinutes(earlierBusyEvent.startTime.getMinutes() - 1);
          earlierBusyEvent.endTime.setMinutes(earlierBusyEvent.endTime.getMinutes() - 1);

          getEventsForUserMock.mockResolvedValueOnce([busyEvent, earlierBusyEvent]);
        });

        test('updates Slack status to event with latest start time', async () => {
          await updateOne(userWithCurrentEvent);

          expect(setUserStatusMock).toBeCalledWith(userWithCurrentEvent.email, userWithCurrentEvent.slackToken, {
            text: 'Away',
            emoji: ':spiral_calendar_pad:',
          });
          expect(setUserPresenceMock).toBeCalledWith(
            userWithCurrentEvent.email,
            userWithCurrentEvent.slackToken,
            'away',
          );
        });
        test('sets the current event to event with latest start time in DynamoDB', async () => {
          await updateOne(userWithCurrentEvent);

          expect(upsertCurrentEventMock).toBeCalledWith(userWithCurrentEvent.email, busyEvent);
        });
      });
    });
  });
  describe('sending meeting reminders', () => {
    describe('without an override set', () => {
      describe('and an upcoming meeting with a location', () => {
        beforeEach(() => {
          getEventsForUserMock.mockResolvedValueOnce([oooEvent]);
        });
        describe('and the user has not been sent a reminder', () => {
          test('sends a Slack reminder', async () => {
            await updateOne(userWithCurrentEvent);

            expect(postMessageMock).toBeCalledWith(botToken, {
              text: 'You have an upcoming meeting: *meetings* at https://my.test.url',
              channel: slackUser.id,
            });
          });
          test('updates the last reminder event ID in DynamoDB', async () => {
            await updateOne(userWithCurrentEvent);

            expect(setLastReminderEventIdMock).toBeCalledWith(userWithCurrentEvent.email, oooEvent.id);
          });
        });
        describe('and the user has been sent a reminder', () => {
          test('does not send a Slack reminder', async () => {
            await updateOne({ ...userWithCurrentEvent, lastReminderEventId: oooEvent.id });

            expect(postMessageMock).not.toBeCalled();
          });
          test('does not update the last reminder event ID in DynamoDB', async () => {
            await updateOne({ ...userWithCurrentEvent, lastReminderEventId: oooEvent.id });

            expect(setLastReminderEventIdMock).not.toBeCalled();
          });
        });
      });
      describe('and an upcoming meeting without a location', () => {
        beforeEach(() => {
          getEventsForUserMock.mockResolvedValueOnce([{ ...oooEvent, location: '' }]);
        });
        test('does not send a Slack reminder', async () => {
          await updateOne(userWithCurrentEvent);

          expect(postMessageMock).not.toBeCalled();
        });
        test('does not update the last reminder event ID in DynamoDB', async () => {
          await updateOne(userWithCurrentEvent);

          expect(setLastReminderEventIdMock).not.toBeCalled();
        });
      });
      describe('and no upcoming meeting', () => {
        beforeEach(() => {
          getEventsForUserMock.mockResolvedValueOnce([]);
        });
        test('does not send a Slack reminder', async () => {
          await updateOne(userWithCurrentEvent);

          expect(postMessageMock).not.toBeCalled();
        });
        test('does not update the last reminder event ID in DynamoDB', async () => {
          await updateOne(userWithCurrentEvent);

          expect(setLastReminderEventIdMock).not.toBeCalled();
        });
      });
    });
    describe('with a valid override set', () => {
      const overrideUser = { ...userWithCurrentEvent, meetingReminderTimingOverride: 15 };
      describe('and an upcoming meeting with a location', () => {
        beforeEach(() => {
          getEventsForUserMock.mockResolvedValueOnce([oooEvent]);
          getEventsForUserMock.mockResolvedValueOnce([busyEvent]);
        });
        describe('and the user has not been sent a reminder', () => {
          test('sends a Slack reminder', async () => {
            await updateOne(overrideUser);

            expect(postMessageMock).toBeCalledWith(botToken, {
              text: 'You have an upcoming meeting: *anotha one* at https://my.test.url/2',
              channel: slackUser.id,
            });
          });
          test('updates the last reminder event ID in DynamoDB', async () => {
            await updateOne(overrideUser);

            expect(setLastReminderEventIdMock).toBeCalledWith(userWithCurrentEvent.email, busyEvent.id);
          });
        });
        describe('and the user has been sent a reminder', () => {
          test('does not send a Slack reminder', async () => {
            await updateOne({ ...overrideUser, lastReminderEventId: busyEvent.id });

            expect(postMessageMock).not.toBeCalled();
          });
          test('does not update the last reminder event ID in DynamoDB', async () => {
            await updateOne({ ...overrideUser, lastReminderEventId: busyEvent.id });

            expect(setLastReminderEventIdMock).not.toBeCalled();
          });
        });
      });
      describe('and an upcoming meeting without a location', () => {
        beforeEach(() => {
          getEventsForUserMock.mockResolvedValueOnce([oooEvent]);
          getEventsForUserMock.mockResolvedValueOnce([{ ...busyEvent, location: '' }]);
        });
        test('does not send a Slack reminder', async () => {
          await updateOne(overrideUser);

          expect(postMessageMock).not.toBeCalled();
        });
        test('does not update the last reminder event ID in DynamoDB', async () => {
          await updateOne(overrideUser);

          expect(setLastReminderEventIdMock).not.toBeCalled();
        });
      });
      describe('and no upcoming meeting', () => {
        beforeEach(() => {
          getEventsForUserMock.mockResolvedValueOnce([oooEvent]);
          getEventsForUserMock.mockResolvedValueOnce([]);
        });
        test('does not send a Slack reminder', async () => {
          await updateOne(overrideUser);

          expect(postMessageMock).not.toBeCalled();
        });
        test('does not update the last reminder event ID in DynamoDB', async () => {
          await updateOne(overrideUser);

          expect(setLastReminderEventIdMock).not.toBeCalled();
        });
      });
    });
    describe('with an override that matches the default value', () => {
      test('does not make an additional request for user events', async () => {
        getEventsForUserMock.mockResolvedValueOnce([oooEvent]);
        await updateOne({ ...userWithCurrentEvent, meetingReminderTimingOverride: 1 });

        expect(getEventsForUserMock).toBeCalledTimes(1);
      });
    });
  });
});
