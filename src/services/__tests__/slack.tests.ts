import { getUserByEmail } from '../slack';
import { WebClient, WebAPIPlatformError } from '@slack/web-api';

const mockLookupByEmail = jest.fn();
jest.mock('@slack/web-api', () => {
  return {
    WebClient: jest.fn().mockImplementation(() => {
      return {
        users: {
          lookupByEmail: mockLookupByEmail,
        },
      };
    }),
  };
});

describe('getUserByEmail', () => {
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
