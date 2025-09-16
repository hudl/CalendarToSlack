import { getUserByEmail, setUserDnd, setUserStatus } from '../slack';
import { WebClient, WebAPIPlatformError } from '@slack/web-api';

const mockLookupByEmail = jest.fn();
const mockSetSnooze = jest.fn();
const mockSetProfile = jest.fn();

jest.mock('@slack/web-api', () => {
  return {
    WebClient: jest.fn().mockImplementation(() => {
      return {
        users: {
          lookupByEmail: mockLookupByEmail,
          profile: {
            set: mockSetProfile,
          },
        },
        dnd: {
          setSnooze: mockSetSnooze,
        },
      };
    }),
  };
});

// Mock the dependent functions
jest.mock('../../utils/secrets');
jest.mock('../dynamo');
jest.mock('../../utils/urls');

describe('getUserByEmail', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('with empty token supplied', () => {
    test('returns undefined', async () => {
      const user = await getUserByEmail('', 'test@test.com');

      expect(user).toBeUndefined();
    });
  });
  describe('with empty email supplied', () => {
    test('returns undefined', async () => {
      const user = await getUserByEmail('token', '');

      expect(user).toBeUndefined();
    });
  });
  describe('with valid token and email supplied', () => {
    describe('and an OK response from the API', () => {
      test('returns the user', async () => {
        const expectedUser = { name: 'hello' };
        mockLookupByEmail.mockResolvedValueOnce({ ok: true, user: expectedUser });

        const user = await getUserByEmail('token', 'test@test.com');
        expect(user).toBe(expectedUser);
      });
    });
    describe('and a users_not_found error from the API', () => {
      test('returns undefined', async () => {
        mockLookupByEmail.mockRejectedValueOnce({ ok: false, data: { error: 'users_not_found' } });

        const user = await getUserByEmail('token', 'test@test.com');
        expect(user).toBeUndefined();
      });
    });
    describe('and a different error from the API', () => {
      test('throws an error', async () => {
        expect.assertions(1);

        const expectedError = { ok: false, data: { error: 'another_error' } };
        mockLookupByEmail.mockRejectedValueOnce({ ok: false, data: { error: 'another_error' } });

        try {
          await getUserByEmail('token', 'test@test.com');
        } catch (e) {
          expect(e).toEqual(expectedError);
        }
      });
    });
  });
});

describe('setUserDnd', () => {
  const email = 'test@example.com';
  const token = 'valid-token';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('with no token supplied', () => {
    test('returns early and does not call Slack API', async () => {
      await setUserDnd(email, undefined, { dnd: true, expiration: 2000000 });

      expect(mockSetSnooze).not.toHaveBeenCalled();
    });
  });

  describe('with dnd flag set to false', () => {
    test('returns early and does not call Slack API', async () => {
      await setUserDnd(email, token, { dnd: false, expiration: 2000000 });

      expect(mockSetSnooze).not.toHaveBeenCalled();
    });
  });

  describe('with no expiration provided', () => {
    test('returns early and does not call Slack API', async () => {
      await setUserDnd(email, token, { dnd: true });

      expect(mockSetSnooze).not.toHaveBeenCalled();
    });
  });

  describe('with valid parameters', () => {
    test('calls setSnooze with calculated minutes', async () => {
      // Mock Date.now to return a fixed timestamp
      const mockNow = jest.spyOn(Date, 'now').mockReturnValue(1000000);
      const expiration = 1000000 + 30 * 60 * 1000; // 30 minutes from mocked now

      mockSetSnooze.mockResolvedValueOnce({ ok: true });

      await setUserDnd(email, token, { dnd: true, expiration });

      expect(mockSetSnooze).toHaveBeenCalledWith({ num_minutes: 30 });

      mockNow.mockRestore();
    });
  });
});

describe('setUserStatus', () => {
  const email = 'test@example.com';
  const token = 'valid-token';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('DND integration', () => {
    test('calls profile set with correct parameters when DND is enabled', async () => {
      const status = {
        text: 'In a meeting',
        emoji: ':calendar:',
        expiration: 2000000,
        dnd: true,
      };

      mockSetProfile.mockResolvedValueOnce({ ok: true });

      await setUserStatus(email, token, status);

      expect(mockSetProfile).toHaveBeenCalledWith({
        profile: {
          status_text: 'In a meeting',
          status_emoji: ':calendar:',
          status_expiration: 2000,
        },
      });
    });
  });
});
